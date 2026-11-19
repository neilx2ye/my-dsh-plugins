/**
 * Host half of the system-user switcher bundle.
 *
 * DSH runs as one Linux account for its whole lifetime: nothing in this
 * process can change the uid its own commands run under. What a plugin *can*
 * do is be precise about that fact — report the identity this Harness runs as,
 * list the local accounts a session could move to, show which of them already
 * have a DSH home, detect instances already running for them, and hand back
 * exact, paste-ready commands. Launching a second instance under another
 * account is attempted only when this process already holds the privilege to
 * do it (root, or passwordless sudo); otherwise the route fails with the
 * reasons and the same commands, and never pretends the switch happened.
 *
 * Three owner-only Fetch routes back the sidebar panel; `ctx.connection.fetch`
 * performs browser admission before any handler runs.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

/** Service this bundle needs from the Web Host composition. */
export const inject = ['connection'];

/** Exact Fetch route reporting identity, candidate users, and live instances. */
const STATE_PATH = '/api/user-switcher/state';
/** Exact Fetch route returning switch commands for one account. */
const PLAN_PATH = '/api/user-switcher/plan';
/** Exact Fetch route reusing or starting one account's instance and returning its URL. */
const OPEN_PATH = '/api/user-switcher/open';
/** Exact Fetch route hiding or showing one account in the switcher list. */
const VISIBILITY_PATH = '/api/user-switcher/visibility';

/** Defaults for a row that supplies no config. */
const DEFAULTS = Object.freeze({
  port: 3081,
  minUid: 1000,
  maxUsers: 50,
});

/** Shells that cannot host an interactive session. */
const NON_INTERACTIVE_SHELLS = new Set(['/sbin/nologin', '/usr/sbin/nologin', '/bin/false', '/usr/bin/false', '/bin/sync']);

/** Groups that usually carry administrative rights. */
const ADMIN_GROUPS = new Set(['sudo', 'wheel', 'admin', 'doas']);

/**
 * Validate the row's config. Invalid values fail activation with a named field
 * instead of silently falling back.
 * @param raw - the Loader row's `config` value.
 * @returns normalized settings.
 */
function readSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    port: pickInteger(source.port, DEFAULTS.port, 'port', 1, 65535),
    minUid: pickInteger(source.minUid, DEFAULTS.minUid, 'minUid', 0, 65533),
    maxUsers: pickInteger(source.maxUsers, DEFAULTS.maxUsers, 'maxUsers', 1, 500),
  };
}

/**
 * Read one integer config field.
 * @param value - raw value, absent for the default.
 * @param fallback - default when the field is absent.
 * @param field - field name used in the error message.
 * @param min - smallest accepted value.
 * @param max - largest accepted value.
 * @returns the accepted value.
 */
function pickInteger(value, fallback, field, min, max) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`user-switcher: config.${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Register the three routes.
 * @param ctx - Host root Context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config);
  /** Cached privilege probe; running `sudo -n` on every paint would be rude. */
  const probe = { at: 0, allowed: false };

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: STATE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => Response.json(await snapshot(settings, probe)),
      }),
    'user-switcher: state route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: PLAN_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const parsed = await readUserBody(request);
          if (parsed.failure !== undefined) return parsed.failure;
          const state = await snapshot(settings, probe);
          const user = state.users.find((entry) => entry.name === parsed.user);
          if (user === undefined) return failure(404, 'unknown-user', `no local account named ${parsed.user}`);
          return Response.json(planFor(state, user));
        },
      }),
    'user-switcher: plan route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: OPEN_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const parsed = await readUserBody(request);
          if (parsed.failure !== undefined) return parsed.failure;
          const state = await snapshot(settings, probe);
          const user = state.users.find((entry) => entry.name === parsed.user);
          if (user === undefined) return failure(404, 'unknown-user', `no local account named ${parsed.user}`);

          // A live instance can only be entered with a URL this process can sign;
          // that signature belongs to one Harness home, so it works for this
          // account and for no other.
          const livePort = livePortOf(state, user.name);
          if (user.name === state.self.user) {
            if (livePort === undefined) {
              return failure(400, 'same-user', 'this account already runs the Harness serving this page');
            }
            const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${livePort}/`);
            return Response.json({ ok: true, reused: true, url });
          }
          if (livePort !== undefined) {
            return failure(
              409,
              'instance-running',
              `${user.name} already has an instance on port ${livePort}; its sign-in link is only printed in that instance's own terminal`,
            );
          }
          if (!state.privilege.canLaunch) {
            return Response.json({ code: 'privilege-required', message: state.privilege.reason }, { status: 403 });
          }
          return Response.json(await launch(state, user, settings));
        },
      }),
    'user-switcher: open route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: VISIBILITY_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const parsed = await readUserBody(request);
          if (parsed.failure !== undefined) return parsed.failure;
          const visible = parsed.body?.visible;
          if (typeof visible !== 'boolean') return failure(400, 'invalid-visible', 'visible must be a boolean');
          const known = (await readPasswd()).some((entry) => entry.name === parsed.user);
          if (!known) return failure(404, 'unknown-user', `no local account named ${parsed.user}`);
          const hidden = new Set(await readHidden());
          if (visible) hidden.delete(parsed.user);
          else hidden.add(parsed.user);
          const next = [...hidden].sort();
          await writeHidden(next);
          return Response.json({ ok: true, hidden: next });
        },
      }),
    'user-switcher: visibility route',
  );
}

/**
 * Read and validate one `{ user }` request body.
 * @param request - admitted owner Fetch request.
 * @returns the account name and the parsed body, or a failure response.
 */
async function readUserBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { failure: failure(400, 'invalid-body', 'request body must be JSON') };
  }
  if (body === null || typeof body !== 'object') return { failure: failure(400, 'invalid-body', 'request body must be an object') };
  const user = body.user;
  if (typeof user !== 'string' || user.trim() === '') return { failure: failure(400, 'invalid-user', 'user must be a non-empty string') };
  if (user.length > 64) return { failure: failure(413, 'user-too-long', 'user must not exceed 64 characters') };
  return { user: user.trim(), body };
}

/**
 * Collect the whole panel state. Cached briefly because one paint asks for it
 * once and the underlying files change rarely.
 * @param settings - normalized settings.
 * @param probe - privilege probe cache.
 * @returns the state payload.
 */
async function snapshot(settings, probe) {
  const passwd = await readPasswd();
  const groupTable = await readGroups();
  const uidNames = new Map(passwd.map((entry) => [entry.uid, entry.name]));
  const gidNames = new Map([...groupTable.values()].map((group) => [group.gid, group.name]));
  const selfGroups = process.getgroups?.() ?? [];
  const selfUid = process.getuid?.() ?? -1;
  const selfGid = process.getgid?.() ?? -1;

  const users = [];
  for (const entry of passwd) {
    if (users.length >= settings.maxUsers) break;
    if (entry.uid !== 0 && entry.uid < settings.minUid) continue;
    if (NON_INTERACTIVE_SHELLS.has(entry.shell)) continue;
    const groups = groupsOf(entry, groupTable);
    users.push({
      name: entry.name,
      uid: entry.uid,
      gid: entry.gid,
      home: entry.home,
      shell: entry.shell,
      root: entry.uid === 0,
      admin: groups.some((name) => ADMIN_GROUPS.has(name)),
      groups,
      homeState: await inspectPath(entry.home),
      dshHomeState: await inspectPath(join(entry.home, '.dsh')),
    });
  }
  users.sort((a, b) => a.uid - b.uid);

  const hidden = new Set(await readHidden());
  const instances = await readInstances(uidNames);
  for (const user of users) {
    user.running = instances.filter((instance) => instance.user === user.name).length;
    user.visible = !hidden.has(user.name);
  }

  const root = selfUid === 0;
  const sudoNoPass = root || (await sudoAllows(probe));
  const dshBin = process.argv[1] ?? 'dsh';
  return {
    host: hostname(),
    now: new Date().toISOString(),
    port: settings.port,
    self: {
      user: uidNames.get(selfUid) ?? `uid:${selfUid}`,
      uid: selfUid,
      gid: selfGid,
      groupNames: selfGroups.map((gid) => gidNames.get(gid) ?? `gid:${gid}`),
    },
    privilege: {
      root,
      sudoNoPass,
      canLaunch: root || sudoNoPass,
      reason: root
        ? 'this process runs as root, so it can start an instance under another account'
        : sudoNoPass
          ? 'passwordless sudo is available for this account'
          : 'this process is a normal login and has no passwordless sudo, so it cannot change uid by itself',
    },
    dshBin,
    dshBinPrivate: isInsideHome(dshBin),
    users,
    instances,
  };
}

/**
 * Find the port of an instance already serving the Web UI for one account.
 * @param state - snapshot payload.
 * @param name - account name.
 * @returns the port, or undefined when no instance advertises one.
 */
function livePortOf(state, name) {
  const live = state.instances.find((instance) => instance.user === name && typeof instance.port === 'number');
  return live === undefined ? undefined : live.port;
}

/**
 * Build the paste-ready switch commands for one account.
 * @param state - snapshot payload.
 * @param user - the candidate account.
 * @returns the plan payload.
 */
function planFor(state, user) {
  const dshHome = join(user.home, '.dsh');
  const launch = `${state.dshBin} web --port ${state.port} --no-open`;
  const steps = [
    {
      id: 'launch',
      title: 'run a separate Harness instance as this account',
      command: `sudo -u ${user.name} -H env DSH_HOME=${dshHome} ${launch}`,
    },
    {
      id: 'shell',
      title: 'open a login shell for this account, then start it there',
      command: `sudo -iu ${user.name}`,
      followUp: launch,
    },
    {
      id: 'attach',
      title: 'open that account\u2019s UI once the instance is listening',
      command: `xdg-open http://127.0.0.1:${state.port}/  # from a graphical session`,
    },
  ];

  const warnings = [];
  if (state.dshBinPrivate) {
    warnings.push(
      `the Harness binary is ${state.dshBin}, which sits inside a private home directory; another account usually cannot execute it. A shared install (for example under /opt) removes this step.`,
    );
  }
  if (user.dshHomeState === 'missing') warnings.push(`${dshHome} does not exist yet; the first start creates it.`);
  if (user.dshHomeState === 'denied') warnings.push(`${dshHome} cannot be inspected from this account.`);
  if (user.homeState === 'denied') warnings.push(`${user.home} cannot be inspected from this account.`);
  if (user.running > 0) warnings.push(`this account already has ${user.running} Harness instance(s) running; check their ports before starting another.`);
  if (user.name !== state.self.user) warnings.push('sessions, credentials, and the workspace stay private to each account; only code placed in a shared path is common to both.');

  return { user: user.name, port: state.port, steps, warnings, canLaunch: state.privilege.canLaunch };
}

/**
 * Start one detached instance under another account, and report where it listens.
 * @param state - snapshot payload.
 * @param user - target account.
 * @param settings - normalized settings.
 * @returns the launch outcome.
 */
async function launch(state, user, settings) {
  const session = `dsh-${user.name}`;
  const dshHome = join(user.home, '.dsh');
  const argv = [
    'tmux',
    'new-session',
    '-d',
    '-s',
    session,
    '--',
    'sudo',
    '-u',
    user.name,
    '-H',
    'env',
    `DSH_HOME=${dshHome}`,
    state.dshBin,
    'web',
    '--port',
    String(settings.port),
    '--no-open',
  ];
  const result = await runFile(argv[0], argv.slice(1));
  if (result.code !== 0) {
    return {
      ok: false,
      code: 'launch-failed',
      message: result.stderr.trim() || result.stdout.trim() || `tmux exited with code ${result.code}`,
    };
  }
  const url = await printedUrl(session, settings.port);
  return {
    ok: true,
    session,
    url,
    message: url === undefined ? `started ${session}; its sign-in link is in the tmux pane of that account` : `started ${session}`,
  };
}

/**
 * Wait for a freshly started instance to print its own authenticated URL.
 *
 * A Harness signs its browser URL with the secret of the home it runs from, so
 * the only way to obtain another account's link is to read what it printed.
 * @param session - tmux session name.
 * @param port - port the instance was told to use.
 * @returns the printed URL, or undefined when it has not appeared yet.
 */
async function printedUrl(session, port) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const pane = await runFile('tmux', ['capture-pane', '-p', '-t', session, '-S', '-80']);
    if (pane.code !== 0) continue;
    const found = /http:\/\/127\.0\.0\.1:(\d+)\/\S*/.exec(pane.stdout);
    if (found !== null && Number(found[1]) === port) return found[0];
  }
  return undefined;
}

/**
 * Run one file without a shell, never throwing.
 * @param file - executable.
 * @param args - argument vector.
 * @returns exit code and captured output.
 */
function runFile(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error === null || error === undefined ? 0 : typeof error.code === 'number' ? error.code : 1,
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : error instanceof Error ? error.message : '',
      });
    });
  });
}

/**
 * Probe (and cache) whether `sudo -n` succeeds for this account.
 * @param probe - probe cache mutated in place.
 * @returns whether a non-interactive sudo is available.
 */
async function sudoAllows(probe) {
  const now = Date.now();
  if (now - probe.at < 20_000) return probe.allowed;
  const result = await runFile('sudo', ['-n', 'true']);
  probe.at = now;
  probe.allowed = result.code === 0;
  return probe.allowed;
}

/**
 * Resolve the switcher's own state file inside this Harness home.
 * @returns absolute path to the visibility file.
 */
function visibilityFile() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
  return join(home, 'storages', 'user-switcher.json');
}

/**
 * Read the accounts the user chose to hide. A missing or damaged file means
 * "nothing hidden", never a failure.
 * @returns hidden account names.
 */
async function readHidden() {
  try {
    const parsed = JSON.parse(await readFile(visibilityFile(), 'utf8'));
    const hidden = parsed !== null && typeof parsed === 'object' ? parsed.hidden : undefined;
    return Array.isArray(hidden) ? hidden.filter((name) => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Persist the hidden set with a same-directory rename, so a reader never sees a
 * half-written file.
 * @param hidden - account names to hide.
 */
async function writeHidden(hidden) {
  const file = visibilityFile();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ hidden }, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

/**
 * Read the local account table.
 * @returns parsed passwd rows.
 */
async function readPasswd() {
  let text;
  try {
    text = await readFile('/etc/passwd', 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const fields = line.split(':');
    if (fields.length < 7) continue;
    const uid = Number(fields[2]);
    const gid = Number(fields[3]);
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) continue;
    rows.push({ name: fields[0], uid, gid, home: fields[5], shell: fields[6] });
  }
  return rows;
}

/**
 * Read the local group table.
 * @returns group name to gid/members map.
 */
async function readGroups() {
  let text;
  try {
    text = await readFile('/etc/group', 'utf8');
  } catch {
    return new Map();
  }
  const table = new Map();
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const fields = line.split(':');
    if (fields.length < 4) continue;
    const gid = Number(fields[2]);
    if (!Number.isInteger(gid)) continue;
    table.set(fields[0], { name: fields[0], gid, members: fields[3] === '' ? [] : fields[3].split(',') });
  }
  return table;
}

/**
 * Resolve every group name one account belongs to.
 * @param entry - passwd row.
 * @param table - group table.
 * @returns group names, primary first.
 */
function groupsOf(entry, table) {
  const names = [];
  for (const group of table.values()) {
    if (group.gid === entry.gid) names.push(group.name);
    else if (group.members.includes(entry.name)) names.push(group.name);
  }
  return names;
}

/**
 * Report what a path looks like from this account, distinguishing absence from
 * denial so the panel never claims a private file is missing.
 * @param path - absolute path.
 * @returns `directory`, `file`, `missing`, or `denied`.
 */
async function inspectPath(path) {
  try {
    const info = await stat(path);
    return info.isDirectory() ? 'directory' : 'file';
  } catch (error) {
    return error !== null && typeof error === 'object' && error.code === 'ENOENT' ? 'missing' : 'denied';
  }
}

/**
 * Scan /proc for Harness instances already serving the Web UI.
 * @param uidNames - uid to account name map.
 * @returns one entry per instance this account may see.
 */
async function readInstances(uidNames) {
  let pids;
  try {
    pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  const found = [];
  for (const pid of pids) {
    let argv;
    try {
      argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter((part) => part !== '');
    } catch {
      continue;
    }
    if (argv.length === 0) continue;
    const joined = argv.join(' ');
    if (!joined.includes('dsh') || !/(^|\s)web(\s|$)/.test(joined)) continue;
    let uid;
    try {
      uid = (await stat(`/proc/${pid}`)).uid;
    } catch {
      continue;
    }
    found.push({
      pid: Number(pid),
      uid,
      user: uidNames.get(uid) ?? `uid:${uid}`,
      port: portOf(argv),
      args: joined.length > 400 ? `${joined.slice(0, 400)}\u2026` : joined,
    });
  }
  return found;
}

/**
 * Extract an explicit `--port` from a process argument vector.
 * @param argv - process arguments.
 * @returns the port, or undefined when the instance used the default.
 */
function portOf(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--port' && index + 1 < argv.length) {
      const value = Number(argv[index + 1]);
      if (Number.isInteger(value)) return value;
    }
    const match = /^--port=(\d+)$/.exec(argv[index]);
    if (match !== null) return Number(match[1]);
  }
  return undefined;
}

/**
 * Whether a path sits inside a home directory, which makes it unreadable to
 * other accounts on most distributions.
 * @param path - the path to test.
 * @returns whether it looks like a private-home path.
 */
function isInsideHome(path) {
  return /^\/(home|Users)\/[^/]+\//.test(path);
}

/**
 * Build one JSON failure response.
 * @param status - HTTP status.
 * @param code - machine-readable code.
 * @param message - human-readable message.
 * @returns the response.
 */
function failure(status, code, message) {
  return Response.json({ code, message }, { status });
}