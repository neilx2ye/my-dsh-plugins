/**
 * Host half of the system-user switcher bundle.
 *
 * DSH runs as one Linux account for its whole lifetime: nothing in this
 * process can change the uid it owns. What this plugin changes is the identity
 * every shell command runs under. The long-lived Host keeps its sessions,
 * model, plugins, credentials and settings; each Bash execution is handed to
 * `setpriv` for the account selected in the sidebar. Switching therefore
 * changes the working environment only, never the Harness configuration.
 *
 * The selection is global to this Harness home and persisted in
 * `<DSH_HOME>/storages/user-switcher.json`.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

/** Services this bundle needs from the Web Host composition. */
export const inject = ['agents', 'connection', 'shell', 'workingDirectory'];

/** Exact Fetch route reporting identity, candidate users, and the selection. */
const STATE_PATH = '/api/user-switcher/state';
/** Exact Fetch route selecting the account shell commands run as. */
const SELECT_PATH = '/api/user-switcher/select';
/** Legacy route used by clients served before the identity-switch change. */
const OPEN_PATH = '/api/user-switcher/open';
/** Exact Fetch route starting or reusing one account's own Harness instance. */
const INSTANCE_PATH = '/api/user-switcher/instance';
/** Exact Fetch route hiding or showing one account in the switcher list. */
const VISIBILITY_PATH = '/api/user-switcher/visibility';

/** Privilege-dropping helper every switched command goes through. */
const SETPRIV = '/usr/bin/setpriv';
/** Marks the one wrapper installed on `ctx.shell.execute`. */
const PATCHED = Symbol.for('@local/user-switcher/patched-execute');
/** Keeps the executor's own method under any number of plugin reloads. */
const ORIGINAL = Symbol.for('@local/user-switcher/base-execute');

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
 * Register the routes and the shell-identity wrapper.
 * @param ctx - Host root Context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config);
  /** Cached privilege probe; running `sudo -n` on every paint would be rude. */
  const probe = { at: 0, allowed: false };
  /** Selected account, or null while commands run under the process account. */
  const shared = selectionState();
  /** Local accounts whose home a command directory may sit under. */
  let accounts = [];
  void readPasswd().then((rows) => { accounts = rows; });

  /**
   * Put every live session back on its own recorded directory. Switching
   * opens a session inside the selected account's home workspace, so this only
   * repairs sessions an earlier build moved off their recorded directory.
   */
  const restoreRecordedWorkspace = async () => {
    for (const agent of ctx.agents.list()) {
      try {
        const recorded = agent.session.header.cwd;
        if (typeof recorded === 'string' && recorded !== '' && ctx.workingDirectory.get(agent.session) !== recorded) {
          await ctx.workingDirectory.set(agent, recorded);
        }
      } catch {
        // A session whose directory cannot move keeps its current one.
      }
    }
  };

  void restoreSelection(settings).then((entry) => {
    shared.user = entry;
  });

  ctx.effect(
    () => {
      const shell = ctx.shell;
      const base = shell.execute[ORIGINAL] ?? shell.execute;
      const wrapped = function switched(spec) {
        const target = userForWorkdir(spec.workdir, accounts);
        if (target === undefined) return base.call(shell, spec);
        return base.call(shell, runAs(spec, target));
      };
      wrapped[PATCHED] = true;
      wrapped[ORIGINAL] = base;
      shell.execute = wrapped;
      return () => {
        if (shell.execute === wrapped) shell.execute = base;
      };
    },
    'user-switcher: shell identity',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: STATE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => Response.json(await snapshot(settings, probe, shared.user)),
      }),
    'user-switcher: state route',
  );

  /**
   * Validate one selection request and apply it.
   * @param request - admitted owner Fetch request.
   * @returns the chosen account, or a failure response.
   */
  const choose = async (request) => {
    const parsed = await readUserBody(request);
    if (parsed.failure !== undefined) return { failure: parsed.failure };
    const state = await snapshot(settings, probe, shared.user);
    const user = state.users.find((entry) => entry.name === parsed.user);
    if (user === undefined) return { failure: failure(404, 'unknown-user', `no switchable local account named ${parsed.user}`) };
    if (!state.privilege.canSwitch && user.name !== state.self.user) {
      return { failure: Response.json({ code: 'privilege-required', message: state.privilege.reason }, { status: 403 }) };
    }
    shared.user = { name: user.name, uid: user.uid, gid: user.gid, home: user.home, shell: user.shell };
    accounts = await readPasswd();
    const store = await readStore();
    store.selected = user.name;
    await writeStore(store);
    return { user };
  };

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SELECT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const chosen = await choose(request);
          if (chosen.failure !== undefined) return chosen.failure;
          await restoreRecordedWorkspace();
          return Response.json({ ok: true, selected: chosen.user.name });
        },
      }),
    'user-switcher: select route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: INSTANCE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const parsed = await readUserBody(request);
          if (parsed.failure !== undefined) return parsed.failure;
          const state = await snapshot(settings, probe, shared.user);
          const user = state.users.find((entry) => entry.name === parsed.user);
          if (user === undefined) return failure(404, 'unknown-user', `no local account named ${parsed.user}`);
          if (user.name === state.self.user) return Response.json({ ok: true, url: null });
          if (!state.privilege.canSwitch) {
            // A non-admin instance cannot read another account's sign-in link,
            // but the browser may already hold that instance's session cookie.
            const hostHeader = firstHeader(request.headers, 'x-forwarded-host') ?? firstHeader(request.headers, 'host') ?? '';
            const authority = hostHeader.split(',')[0].trim();
            const proto = (firstHeader(request.headers, 'x-forwarded-proto') ?? 'http').split(',')[0].trim().toLowerCase();
            if (authority !== '' && /^[A-Za-z0-9.\-:[\]]+$/.test(authority)) {
              const mount = user.uid === 0 ? '/' : `/${user.name}/`;
              return Response.json({ ok: true, url: `${proto === 'https' ? 'https' : 'http'}://${authority}${mount}`, loginRequired: true });
            }
            return Response.json({ code: 'privilege-required', message: state.privilege.reason }, { status: 403 });
          }
          // This instance must not keep a workspace pointing at another
          // account's home; that account's own instance owns that directory.
          const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
          if (registry !== undefined) {
            try {
              const stale = registry.list().find((workspace) => workspace.path === user.home);
              if (stale !== undefined) await registry.delete(stale.id);
            } catch {
              // A leftover registration is harmless; the instance still opens.
            }
          }
          return Response.json(await ensureInstance(user, settings, request));
        },
      }),
    'user-switcher: instance route',
  );

  // Clients served before the identity-switch change still call /open. Select
  // the account and send them through a page load so they pick up the current
  // client bundle instead of reporting a missing route.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: OPEN_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const chosen = await choose(request);
          if (chosen.failure !== undefined) return chosen.failure;
          await restoreRecordedWorkspace();
          return Response.json({ ok: true, selected: chosen.user.name, url: pageUrl(request) });
        },
      }),
    'user-switcher: legacy open route',
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
          const store = await readStore();
          const hidden = new Set(store.hidden);
          if (visible) hidden.delete(parsed.user);
          else hidden.add(parsed.user);
          store.hidden = [...hidden].sort();
          await writeStore(store);
          return Response.json({ ok: true, hidden: store.hidden });
        },
      }),
    'user-switcher: visibility route',
  );
}

/**
 * Browser-facing root URL derived from an admitted request.
 * @param request - admitted owner Fetch request.
 * @returns the absolute site root, or `/` when the host is unusable.
 */
function pageUrl(request) {
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(',')[0].trim();
  if (!/^[A-Za-z0-9.\-:[\]]+$/.test(host)) return '/';
  const forwarded = (request.headers.get('x-forwarded-proto') ?? 'http').split(',')[0].trim().toLowerCase();
  return `${forwarded === 'https' ? 'https' : 'http'}://${host}/`;
}

/**
 * One selection cell shared by every plugin instance in this process, so a
 * route served by a reloaded instance and a shell wrapper installed by an
 * earlier one never disagree about the target account.
 * @returns the live selection cell.
 */
function selectionState() {
  const key = Symbol.for('@local/user-switcher/selection');
  const existing = globalThis[key];
  if (existing !== undefined) return existing;
  const created = { user: null };
  globalThis[key] = created;
  return created;
}

/**
 * Restore the persisted account from this Harness home's store.
 * @param settings - normalized settings.
 * @returns the passwd entry, or null when nothing usable is stored.
 */
async function restoreSelection(settings) {
  try {
    const store = await readStore();
    if (store.selected === null) return null;
    const entry = (await readPasswd()).find((row) => row.name === store.selected);
    if (entry === undefined) return null;
    if (entry.uid !== 0 && (entry.uid < settings.minUid || NON_INTERACTIVE_SHELLS.has(entry.shell))) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Read one header, keeping only its first comma-separated value.
 * @param headers - request headers.
 * @param name - header name.
 * @returns the trimmed value, or undefined when absent or empty.
 */
function firstHeader(headers, name) {
  const value = headers.get(name);
  if (value === null) return undefined;
  const trimmed = value.split(',')[0].trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Start or reuse one account's own Harness instance and return its sign-in URL.
 * Each account runs a separate process with its own DSH_HOME, so the two never
 * share workspaces, identities, or sessions. Cross-account work goes through
 * passwordless sudo, which this deployment grants because every account is the
 * same operator.
 * @param user - target account.
 * @param settings - normalized settings.
 * @param request - the admitted owner request, used to derive the public origin.
 * @returns `{ ok, url }` or a failure object.
 */
async function ensureInstance(user, settings, request) {
  const hostHeader = firstHeader(request.headers, 'x-forwarded-host') ?? firstHeader(request.headers, 'host') ?? '';
  const authority = hostHeader.split(',')[0].trim();
  if (authority === '' || !/^[A-Za-z0-9.\-:[\]]+$/.test(authority)) {
    return { ok: false, code: 'no-host', message: 'the request carries no usable host' };
  }
  const proto = (firstHeader(request.headers, 'x-forwarded-proto') ?? 'http').split(',')[0].trim().toLowerCase();
  const scheme = proto === 'https' ? 'https' : 'http';
  const session = user.uid === 0 ? 'dsh' : `dsh-${user.name}`;
  const pane = await tmuxAs(user.name, ['capture-pane', '-p', '-J', '-t', session, '-S', '-5000']);
  if (pane.code === 0) {
    const found = lastSignInUrl(pane.stdout);
    if (found !== undefined) return { ok: true, url: found };
  }
  if (user.uid === 0) {
    return { ok: true, url: `${scheme}://${authority}/`, loginRequired: true };
  }
  const port = settings.port + (user.uid - 1000);
  const publicUrl = `${scheme}://${authority}/${user.name}/`;
  const launched = await tmuxAs(user.name, [
    'new-session', '-d', '-s', session, '-c', user.home, '--',
    'env', '-i', `HOME=${user.home}`,
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    `DSH_HOME=${user.home}/.dsh`,
    process.argv[1] ?? 'dsh',
    'web', '--port', String(port), '--no-open',
    '--public-url', publicUrl, '--trusted-host', authority,
  ]);
  if (launched.code !== 0) {
    return { ok: false, code: 'launch-failed', message: launched.stderr.trim() || launched.stdout.trim() || 'tmux failed' };
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const next = await tmuxAs(user.name, ['capture-pane', '-p', '-J', '-t', session, '-S', '-200']);
    if (next.code !== 0) continue;
    const found = lastSignInUrl(next.stdout);
    if (found !== undefined) return { ok: true, url: found };
  }
  return { ok: false, code: 'no-url', message: 'the instance started but printed no sign-in link' };
}

/**
 * Run one tmux subcommand as the target account: directly when this process
 * already runs as it, otherwise through passwordless sudo.
 * @param target - account name.
 * @param args - tmux arguments.
 * @returns the command result.
 */
function tmuxAs(target, args) {
  if (target === userInfo().username) return runFile('tmux', args);
  return runFile('sudo', ['-n', '-u', target, 'tmux', ...args]);
}

/**
 * Free the shared secondary port by stopping another account's instance.
 * @param port - port to free.
 * @returns whether the port is free.
 */
async function freeSlot(port) {
  if (!(await portBusy(port))) return true;
  const sessions = await runFile('tmux', ['list-sessions', '-F', '#{session_name}']);
  if (sessions.code === 0) {
    for (const name of sessions.stdout.split('\n').map((line) => line.trim())) {
      if (name.startsWith('dsh-') && name !== 'dsh') await runFile('tmux', ['kill-session', '-t', name]);
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!(await portBusy(port))) return true;
  }
  return false;
}

/**
 * Report whether a TCP port currently has a listener.
 * @param port - port number.
 * @returns whether something listens.
 */
async function portBusy(port) {
  const result = await runFile('ss', ['-H', '-ltn', 'sport', '=', `:${String(port)}`]);
  return result.code === 0 && result.stdout.trim() !== '';
}

/**
 * Extract the last authenticated Harness URL from terminal text.
 * @param text - unwrapped tmux pane contents.
 * @returns the URL, or undefined.
 */
function lastSignInUrl(text) {
  const cleaned = text.replace(/\u001b\[[0-9;]*m/g, '');
  const matches = [...cleaned.matchAll(/https?:\/\/[^\s"'<>]+[?&]token=[A-Za-z0-9_-]+/g)];
  return matches.length === 0 ? undefined : matches[matches.length - 1][0];
}

/**
 * Resolve the account that owns one command directory: the non-root account
 * whose home contains it, longest home first. Every other directory keeps the
 * process account, so project and other-identity conversations stay root.
 * @param workdir - the command's working directory.
 * @returns the owning passwd entry, or undefined for the process account.
 */
function userForWorkdir(workdir, accounts) {
  if (typeof workdir !== 'string' || workdir === '') return undefined;
  let best;
  for (const user of accounts) {
    if (user.uid === 0 || user.home === '' || user.home === '/') continue;
    if (workdir !== user.home && !workdir.startsWith(`${user.home}/`)) continue;
    if (best === undefined || user.home.length > best.home.length) best = user;
  }
  return best;
}

/**
 * Rewrite one resolved shell spec so it runs under the selected account.
 * @param spec - resolved Bash execution spec.
 * @param user - owning passwd entry.
 * @returns the rewritten spec.
 */
function runAs(spec, user) {
  return {
    ...spec,
    command: `exec ${SETPRIV} --reuid=${user.uid} --regid=${user.gid} --init-groups -- bash -c ${shellQuote(spec.command)}`,
    workdir: workdirFor(spec.workdir, user),
    env: {
      ...(spec.env ?? {}),
      HOME: user.home,
      USER: user.name,
      LOGNAME: user.name,
      SHELL: user.shell,
    },
  };
}

/**
 * Pick a directory the selected account can actually start in. The Harness
 * workspace often sits inside root's private home, which no other account may
 * traverse; such a request falls back to that account's own home.
 * @param workdir - the caller's requested directory.
 * @param user - selected passwd entry.
 * @returns the directory to pass to the process.
 */
function workdirFor(workdir, user) {
  if (typeof workdir !== 'string' || workdir === '') return user.home;
  if (workdir === user.home || workdir.startsWith(`${user.home}/`)) return workdir;
  if (user.uid !== 0 && (workdir === '/root' || workdir.startsWith('/root/'))) return user.home;
  return workdir;
}

/**
 * Quote one string for a POSIX shell, including embedded single quotes.
 * @param value - raw command text.
 * @returns a single safe shell word.
 */
function shellQuote(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
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
 * Collect the whole panel state.
 * @param settings - normalized settings.
 * @param probe - privilege probe cache.
 * @param selected - currently selected passwd entry or null.
 * @returns the state payload.
 */
async function snapshot(settings, probe, selected) {
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

  const hidden = new Set((await readStore()).hidden);
  for (const user of users) user.visible = !hidden.has(user.name);

  const root = selfUid === 0;
  const sudoNoPass = root || (await sudoAllows(probe));
  return {
    host: hostname(),
    now: new Date().toISOString(),
    self: {
      user: uidNames.get(selfUid) ?? `uid:${selfUid}`,
      uid: selfUid,
      gid: selfGid,
      groupNames: selfGroups.map((gid) => gidNames.get(gid) ?? `gid:${gid}`),
    },
    privilege: {
      root,
      sudoNoPass,
      canSwitch: root || sudoNoPass,
      reason: root
        ? 'this process runs as root, so commands can drop to any local account'
        : sudoNoPass
          ? 'passwordless sudo is available for this account'
          : 'this process is a normal login and cannot change uid by itself',
    },
    selected: selected === null ? null : selected.name,
    users,
  };
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
 * @returns absolute path to the store.
 */
function storeFile() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
  return join(home, 'storages', 'user-switcher.json');
}

/**
 * Read the persisted selection and hidden set. A missing or damaged file means
 * "no selection, nothing hidden", never a failure.
 * @returns hidden names and the selected account name.
 */
async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(storeFile(), 'utf8'));
    const hidden = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((name) => typeof name === 'string')
      : [];
    const selected = parsed !== null && typeof parsed === 'object' && typeof parsed.selected === 'string'
      ? parsed.selected
      : null;
    return { hidden, selected };
  } catch {
    return { hidden: [], selected: null };
  }
}

/**
 * Persist the store with a same-directory rename, so a reader never sees a
 * half-written file.
 * @param store - hidden names and selected account.
 */
async function writeStore(store) {
  const file = storeFile();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  const body = { hidden: store.hidden, selected: store.selected };
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
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
 * Run one file without a shell, never throwing.
 * @param file - executable.
 * @param args - argument vector.
 * @returns exit code and captured output.
 */
function runFile(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error === null || error === undefined ? 0 : typeof error.code === 'number' ? error.code : 1,
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : error instanceof Error ? error.message : '',
      });
    });
  });
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