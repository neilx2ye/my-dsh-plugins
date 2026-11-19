/**
 * Host half of the Personal Agent bundle.
 *
 * The bundle turns ONE DSH profile into a set of named personal identities
 * instead of a project container:
 *
 * - each identity has its own agent-scoped persona and memory sections, so two
 *   identities can talk at the same time without seeing each other's notes;
 * - each identity has a home directory, registered as one Harness workspace
 *   titled after the identity, and the browser's sidebar lists identities
 *   rather than workspaces or sessions;
 * - `remember` / `recall` resolve the calling agent's identity from its working
 *   directory and write that identity's memory only;
 * - clicking an identity returns its newest non-archived conversation, and the
 *   Host decides whether a conversation exists at all. The user never picks a
 *   workspace or presses New Session.
 *
 * Nothing here is device-global. The Loader layer exists only in the profile
 * that lists this bundle, and every file this plugin owns lives under that
 * profile's own directory (`<profile>/personal-agent/`). A profile without the
 * bundle is untouched.
 *
 * The Harness data model still binds sessions to a directory, so the workspace
 * registry is reused rather than bypassed. What changes is the presentation:
 * one home per identity, no workspace/session browser, and no New Session
 * control (the client hides the shell's control).
 */

import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

import {
  Config,
  composeIdentitySection,
  composeMemorySection,
  mergeIdentity,
  normalizeIdentity,
  parseConfig,
  serializeIdentity,
} from './lib/identity.js';
import { appendMemory, byteLength, countNotes, normalizeMemoryText, readMemorySync, renderNotes, searchMemory, writeMemory } from './lib/memory.js';
import { resolveIdentityPaths } from './lib/paths.js';

export { Config };

/** Identity state and manager payload. */
const STATE_PATH = '/api/personal-agent/state';
/** Create or update one identity through the profile config editor. */
const IDENTITY_PATH = '/api/personal-agent/identity';
/** Remove one identity: archive its conversations, hide its workspace, move its data. */
const REMOVE_PATH = '/api/personal-agent/identity/remove';
/** Replace one identity's memory note file. */
const MEMORY_PATH = '/api/personal-agent/memory';
/** Ensure one identity's home and return its newest conversation, if any. */
const OPEN_PATH = '/api/personal-agent/open';

/** Prompt section order just after the fixed Harness identity and before any preset persona. */
const IDENTITY_SECTION_ORDER = -999;
/** Memory renders after the tool guidance, before the deployment persona suffix. */
const MEMORY_SECTION_ORDER = 10150;

/** Name of the agent preset this bundle declares. */
const PRESET_ID = 'personal';

/**
 * Resolve the DSH home the same way the launcher does: `$DSH_HOME`, then
 * `~/.dsh`.
 * @returns absolute Harness home.
 */
function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return configured === '' ? join(homedir(), '.dsh') : resolve(configured);
}

/**
 * Describe a thrown value as one readable line.
 * @param error - thrown value.
 * @returns message text.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read the plugin's workspace-id state file.
 *
 * Version 0.1 stored one top-level `{ workspaceId, titledName }`; that record
 * is read as the legacy identity `default`. The new shape maps identity ids to
 * their workspace facts.
 * @param file - absolute state file path.
 * @returns identity id to workspace facts.
 */
function readState(file) {
  const states = new Map();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return states;
    if (parsed.identities !== null && typeof parsed.identities === 'object' && !Array.isArray(parsed.identities)) {
      for (const [id, value] of Object.entries(parsed.identities)) {
        if (value === null || typeof value !== 'object') continue;
        states.set(id, {
          workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : undefined,
          titledName: typeof value.titledName === 'string' ? value.titledName : undefined,
        });
      }
    }
    if (typeof parsed.workspaceId === 'string' && !states.has('default')) {
      states.set('default', {
        workspaceId: parsed.workspaceId,
        titledName: typeof parsed.titledName === 'string' ? parsed.titledName : undefined,
      });
    }
  } catch {
    // A missing or damaged file means "rediscover by path", never a failure.
  }
  return states;
}

/**
 * Commit the identity state file atomically; a failure is logged, never fatal.
 * @param file - absolute state file path.
 * @param states - identity id to workspace facts.
 * @param logger - optional logger.
 */
async function writeState(file, states, logger) {
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const document = { identities: Object.fromEntries(states) };
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    logger?.warn?.(`personal-agent: could not persist ${file}: ${messageOf(error)}`);
  }
}

/**
 * Build one JSON response.
 * @param body - JSON payload.
 * @param status - HTTP status.
 * @returns the response.
 */
function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Build one structured failure.
 * @param status - HTTP status.
 * @param code - stable machine-readable code.
 * @param message - readable message.
 * @returns the response.
 */
function failure(status, code, message) {
  return json({ code, message }, status);
}

/**
 * Parse one JSON object request body.
 * @param request - buffered request.
 * @returns the parsed object.
 */
async function readObjectBody(request) {
  const value = await request.json();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request body must be a JSON object');
  }
  return value;
}

/**
 * Build the model-facing `remember` tool.
 * @param recordFor - resolve the calling agent's identity record.
 * @returns a tool definition accepted by `ctx.tools.register`.
 */
function buildRememberTool(recordFor) {
  return {
    name: 'remember',
    description:
      'Save one durable fact to this identity\u2019s memory so later conversations with the same identity remember it. Use it for stable preferences, how the user wants to be addressed, ongoing projects, decisions, and anything the user explicitly asks you to remember. Do not store secrets, credentials, or session-only trivia.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        note: { type: 'string', description: 'The fact, written as one self-contained sentence.' },
        topic: { type: 'string', description: 'Optional short topic label, such as "preferences" or "work".' },
      },
      required: ['note'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          saved: { type: 'boolean' },
          notes: { type: 'integer' },
          bytes: { type: 'integer' },
        },
        required: ['saved', 'notes', 'bytes'],
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.saved
            ? `Saved to memory (${value.notes} notes, ${value.bytes} bytes).`
            : 'That note is already in memory; nothing was written.',
        },
      ],
    },
    execute(args, exec) {
      const record = recordFor(exec);
      return record.store.mutate(async () => {
        const result = appendMemory(record.store.read(), args.note, args.topic, record.store.maxBytes());
        if (result.saved) {
          const text = await writeMemory(record.paths.memoryFile, result.text, record.store.maxBytes());
          record.store.commit(text);
        }
        return {
          saved: result.saved,
          notes: countNotes(record.store.read()),
          bytes: byteLength(record.store.read()),
        };
      });
    },
  };
}

/**
 * Build the model-facing `recall` tool.
 * @param recordFor - resolve the calling agent's identity record.
 * @returns a tool definition accepted by `ctx.tools.register`.
 */
function buildRecallTool(recordFor) {
  return {
    name: 'recall',
    description:
      'Search this identity\u2019s memory notes. Pass a query to find related notes, or omit it to read everything this identity has saved. Use it before asking the user something earlier conversations may already answer.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Case-insensitive words to look for. Omit to read the whole memory.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: { type: 'integer' },
          notes: { type: 'integer' },
          text: { type: 'string' },
        },
        required: ['matches', 'notes', 'text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute(args, exec) {
      const record = recordFor(exec);
      const lines = searchMemory(record.store.read(), typeof args.query === 'string' ? args.query : '', 60);
      const notes = countNotes(record.store.read());
      return Promise.resolve({
        matches: lines.length,
        notes,
        text:
          lines.length === 0
            ? notes === 0
              ? 'This identity\u2019s memory is empty. Use remember to save durable facts about the user.'
              : 'No saved notes match that query.'
            : renderNotes(lines),
      });
    },
  };
}

/**
 * Move one removed identity's home and memory out of the active paths.
 *
 * Nothing is deleted: files the identity created are moved under
 * `<profile>/personal-agent/removed/<id>-<timestamp>/` for recovery. Paths a
 * custom configuration placed outside the plugin data directory are retained
 * where they are and reported back.
 * @param record - identity record.
 * @param dataDir - the plugin's profile-local data directory.
 * @returns the removal destination and any retained external paths.
 */
async function moveRemovedIdentityData(record, dataDir) {
  const inside = (path) => path === dataDir || path.startsWith(`${dataDir}${sep}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetRoot = join(dataDir, 'removed', `${record.identity.id}-${stamp}`);
  const moved = [];
  const retained = [];
  const move = async (source, target) => {
    if (!existsSync(source)) return;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await rename(source, target);
    moved.push(target);
  };
  if (record.identity.id !== 'default' && inside(record.paths.root)) {
    // A generated identity keeps home and memory inside its own root.
    await move(record.paths.root, targetRoot);
    if (!inside(record.paths.home)) retained.push(record.paths.home);
    if (!inside(record.paths.memoryFile)) retained.push(record.paths.memoryFile);
  } else {
    // The legacy identity uses the data root's own home/ and memory.md.
    if (inside(record.paths.home)) await move(record.paths.home, join(targetRoot, 'home'));
    else retained.push(record.paths.home);
    if (inside(record.paths.memoryFile)) await move(record.paths.memoryFile, join(targetRoot, 'memory.md'));
    else retained.push(record.paths.memoryFile);
  }
  return { movedTo: moved.length > 0 ? targetRoot : null, retained };
}

/**
 * Create one identity's in-memory note cache.
 * @param file - absolute memory file path.
 * @param maxBytes - memory budget.
 * @returns the store with read/commit/serialized mutation helpers.
 */
function createMemoryStore(file, maxBytes) {
  let text = normalizeMemoryText(readMemorySync(file));
  let tail = Promise.resolve();
  return {
    file: () => file,
    maxBytes: () => maxBytes,
    read: () => text,
    commit: (next) => {
      text = normalizeMemoryText(next);
    },
    mutate: (operation) => {
      const run = () => operation();
      const next = tail.then(run, run);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

/**
 * Register the identity model, tools, homes, and browser routes.
 * @param ctx - Host root Context.
 * @param rawConfig - Loader row configuration, validated by {@link Config}.
 */
export function apply(ctx, rawConfig) {
  const settings = parseConfig(rawConfig);
  const profile = ctx.get('profileContext');
  const dataDir = profile === undefined ? join(dshHome(), 'personal-agent') : join(profile.dir, 'personal-agent');
  const logger = ctx.logger;

  /**
   * One identity plus every path it owns.
   * @type {Array<{ identity: object, paths: { home: string, memoryFile: string, root: string }, canonicalHome: string, store: ReturnType<typeof createMemoryStore> }>}
   */
  const records = settings.identities.map((identity) => {
    const paths = resolveIdentityPaths(identity, dataDir);
    return {
      identity,
      paths,
      canonicalHome: resolve(paths.home),
      store: createMemoryStore(paths.memoryFile, settings.memory.maxBytes),
    };
  });

  // Two identities must not share a home or a memory file: both would fight
  // over one workspace and one set of notes.
  const homes = new Map();
  const memories = new Map();
  for (const record of records) {
    const otherHome = homes.get(record.paths.home);
    if (otherHome !== undefined) {
      throw new Error(`personal-agent: identities "${otherHome}" and "${record.identity.name}" share the home directory ${record.paths.home}`);
    }
    homes.set(record.paths.home, record.identity.name);
    const otherMemory = memories.get(record.paths.memoryFile);
    if (otherMemory !== undefined) {
      throw new Error(`personal-agent: identities "${otherMemory}" and "${record.identity.name}" share the memory file ${record.paths.memoryFile}`);
    }
    memories.set(record.paths.memoryFile, record.identity.name);
  }

  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    for (const record of records) {
      mkdirSync(record.paths.home, { recursive: true, mode: 0o700 });
      try {
        record.canonicalHome = realpathSync(record.paths.home);
      } catch {
        record.canonicalHome = resolve(record.paths.home);
      }
      mkdirSync(dirname(record.paths.memoryFile), { recursive: true, mode: 0o700 });
    }
  } catch (error) {
    logger?.warn?.(`personal-agent: could not create its data directory: ${messageOf(error)}`);
  }

  const stateFile = join(dataDir, 'state.json');
  const states = readState(stateFile);
  /** Live home details by identity id. */
  const homesInfo = new Map();
  for (const record of records) {
    const state = states.get(record.identity.id);
    homesInfo.set(record.identity.id, {
      workspaceId: state?.workspaceId,
      titledName: state?.titledName,
      title: record.identity.name,
      path: record.paths.home,
      error: undefined,
    });
  }

  /**
   * Choose the identity whose home contains a working directory.
   * @param cwd - effective working directory, or undefined.
   * @returns the nearest identity record, or the first identity as fallback.
   */
  function recordForCwd(cwd) {
    if (typeof cwd === 'string' && cwd !== '') {
      let nearest;
      for (const record of records) {
        const home = record.canonicalHome;
        const inside = cwd === home || cwd.startsWith(home.endsWith(sep) ? home : `${home}${sep}`);
        if (inside && (nearest === undefined || home.length > nearest.canonicalHome.length)) nearest = record;
      }
      return nearest;
    }
    return undefined;
  }

  /**
   * Read the effective working directory of one session without I/O.
   * @param session - session to inspect.
   * @param source - context that may provide `workingDirectory`.
   * @returns the directory, or undefined.
   */
  function cwdOf(session, source) {
    try {
      const workingDirectory = source.get('workingDirectory');
      if (workingDirectory !== undefined) return workingDirectory.get(session);
    } catch {
      // Fall through to the recorded header.
    }
    return session?.header?.cwd;
  }

  /**
   * Resolve the identity for one Agent.
   * @param agent - live agent.
   * @param source - context that may provide `workingDirectory`.
   * @returns the identity record.
   */
  function recordForAgent(agent, source) {
    if (agent === undefined) return undefined;
    return recordForCwd(cwdOf(agent.session, source));
  }

  /**
   * Resolve the identity for one tool call.
   * @param exec - tool execution context.
   * @returns the identity record.
   */
  function recordForExec(exec) {
    const record = recordForAgent(exec.agent, ctx);
    if (record === undefined) {
      throw new Error('This conversation is not running inside a personal identity home. Open an identity from the sidebar first.');
    }
    return record;
  }

  // ── per-agent identity and memory prompts ─────────────────────────────────

  ctx.inject(['agents', 'systemPrompt'], (scope) => {
    const installs = new Map();
    /**
     * Attach this profile's identity and memory sections to one agent. The
     * sections live on the agent scope, so two identities never share a prompt.
     * @param agent - agent to decorate.
     */
    const install = (agent) => {
      if (installs.has(agent)) return;
      const record = recordForAgent(agent, scope);
      // Project conversations keep their coding-agent behavior. Only sessions
      // living in an identity's home receive that identity's persona and memory.
      if (record === undefined) return;
      try {
        const fiber = agent.ctx.inject(['systemPrompt'], (scoped) => {
          scoped.systemPrompt.section({
            name: 'personal-agent:identity',
            order: IDENTITY_SECTION_ORDER,
            text: () => composeIdentitySection(record.identity, { siblingCount: records.length }),
          });
          scoped.systemPrompt.section({
            name: 'personal-agent:memory',
            order: MEMORY_SECTION_ORDER,
            text: () => (settings.memory.includeInPrompt ? composeMemorySection(record.identity, record.store.read()) : ''),
          });
        });
        installs.set(agent, fiber);
      } catch (error) {
        logger?.warn?.(`personal-agent: could not register identity prompt for ${agent.id}: ${messageOf(error)}`);
      }
    };
    for (const agent of scope.agents.list()) install(agent);
    scope.on('agent/created', ({ agent }) => install(agent));
    scope.on('agent/disposed', ({ agent }) => {
      const fiber = installs.get(agent);
      if (fiber !== undefined) {
        installs.delete(agent);
        fiber.dispose().catch((error) => logger?.warn?.(`personal-agent: prompt cleanup failed: ${messageOf(error)}`));
      }
    });
    // The agent scope outlives this plugin; unloading must remove our sections.
    scope.effect(
      () => () => {
        const fibers = [...installs.values()];
        installs.clear();
        for (const fiber of fibers) fiber.dispose().catch(() => undefined);
      },
      'personal-agent: identity prompts',
    );
  });

  ctx.inject(['tools'], (scope) => {
    const when = ({ agent }) => recordForAgent(agent, ctx) !== undefined;
    scope.tools.register(buildRememberTool(recordForExec), { when });
    scope.tools.register(buildRecallTool(recordForExec), { when });
  });

  // ── one home workspace per identity ──────────────────────────────────────

  /** Ensures in flight, keyed by identity id. */
  const ensureInFlight = new Map();

  /**
   * Ensure one identity's home exists and is registered, then reconcile its
   * title when the identity name changed. A title the user chose by hand is
   * preserved: only a title this plugin applied, or the directory's own name,
   * follows the identity.
   * @param record - identity record.
   * @param registry - Host workspace registry.
   * @returns the workspace entity.
   */
  async function ensureWorkspace(record, registry) {
    const identity = record.identity;
    const info = homesInfo.get(identity.id);
    await mkdir(record.paths.home, { recursive: true, mode: 0o700 });
    const canonical = await realpath(record.paths.home);
    if (!isAbsolute(canonical)) throw new Error('personal-agent: home directory did not resolve to an absolute path');
    record.canonicalHome = canonical;

    const title = identity.name;
    let entity = registry.list().find((workspace) => workspace.path === canonical);
    if (entity === undefined) {
      entity = await registry.create(canonical, title);
      states.set(identity.id, { workspaceId: entity.id, titledName: title });
      await writeState(stateFile, states, logger);
      info.titledName = title;
    } else if (entity.title === info.titledName || entity.title === basename(canonical)) {
      if (entity.title !== title) await entity.setTitle(title);
      if (info.titledName !== title) {
        states.set(identity.id, { workspaceId: entity.id, titledName: title });
        await writeState(stateFile, states, logger);
        info.titledName = title;
      }
    } else {
      states.set(identity.id, { ...states.get(identity.id), workspaceId: entity.id });
      await writeState(stateFile, states, logger);
    }

    info.workspaceId = entity.id;
    info.title = entity.title;
    info.path = canonical;
    info.error = undefined;
    return entity;
  }

  /**
   * Ensure one identity, sharing an in-flight attempt.
   * @param identityId - identity id.
   * @param registry - Host workspace registry.
   * @returns the workspace entity.
   */
  function ensureIdentity(identityId, registry) {
    const running = ensureInFlight.get(identityId);
    if (running !== undefined) return running;
    const record = records.find((candidate) => candidate.identity.id === identityId);
    if (record === undefined) return Promise.reject(new Error(`personal-agent: unknown identity "${identityId}"`));
    const promise = ensureWorkspace(record, registry).finally(() => {
      ensureInFlight.delete(identityId);
    });
    ensureInFlight.set(identityId, promise);
    return promise;
  }

  /**
   * Keep identity workspaces after the profile's project workspaces, so
   * installing identities does not reorder the user's existing project list.
   * The shipped browser renders the registry order; identity groups belong at
   * the bottom, not in front of the projects.
   * @param registry - Host workspace registry.
   */
  async function reconcileIdentityOrder(registry) {
    const identityHomes = new Set(records.map((record) => record.canonicalHome));
    for (;;) {
      const entities = registry.list();
      let lastProject = -1;
      entities.forEach((workspace, index) => {
        if (!identityHomes.has(workspace.path)) lastProject = index;
      });
      if (lastProject < 0) return;
      const misplaced = entities.findIndex((workspace, index) => index < lastProject && identityHomes.has(workspace.path));
      if (misplaced < 0) return;
      try {
        await registry.insertBefore(entities[misplaced].id);
      } catch {
        return;
      }
    }
  }

  /**
   * Ensure every identity in order, recording per-identity failures.
   * @param registry - Host workspace registry.
   */
  async function ensureAll(registry) {
    for (const record of records) {
      try {
        await ensureIdentity(record.identity.id, registry);
      } catch (error) {
        const info = homesInfo.get(record.identity.id);
        if (info !== undefined) info.error = messageOf(error);
        logger?.warn?.(`personal-agent: ${record.identity.name}: ${messageOf(error)}`);
      }
    }
  }

  /** Resolves with the workspace registry once the Host provides it. */
  let provideRegistry;
  const registryReady = new Promise((resolveReady) => {
    provideRegistry = resolveReady;
  });

  /**
   * Wait briefly for the workspace registry, which may initialize after the
   * connection routes are already serving.
   * @param milliseconds - longest wait.
   * @returns the registry, or undefined when it did not arrive in time.
   */
  async function registryWithin(milliseconds) {
    const available = ctx.get('workspaceRegistry');
    if (available !== undefined) {
      registryRef = available;
      return available;
    }
    const ready = await Promise.race([
      registryReady,
      new Promise((resolveLater) => {
        setTimeout(() => resolveLater(undefined), milliseconds);
      }),
    ]);
    if (ready !== undefined) registryRef = ready;
    return ready;
  }

  /** Latest registry, used by the project list in the browser payload. */
  let registryRef;

  ctx.inject(['workspaceRegistry'], (scope) => {
    registryRef = scope.workspaceRegistry;
    provideRegistry(scope.workspaceRegistry);
    void ensureAll(scope.workspaceRegistry).then(() => reconcileIdentityOrder(scope.workspaceRegistry)).catch((error) => {
      logger?.warn?.(`personal-agent: could not order identity workspaces: ${messageOf(error)}`);
    });
  });

  // ── browser routes ───────────────────────────────────────────────────────

  ctx.inject(['connection'], (scope) => {
    /**
     * Workspaces that are not identity homes: existing projects in this
     * profile. They stay reachable as project rows so installing the bundle
     * into an established profile never hides the user's work.
     * @returns project rows with their newest non-archived conversation.
     */
    function listProjects() {
      const registry = registryRef;
      if (registry === undefined) return [];
      const owned = new Set(records.map((record) => record.canonicalHome));
      const archived = new Set(registry.archivedSessionIds);
      return registry
        .list()
        .filter((workspace) => !owned.has(workspace.path))
        .map((workspace) => ({
          workspaceId: workspace.id,
          title: workspace.title,
          path: workspace.path,
          sessionId: workspace.sessionIds.find((id) => !archived.has(id)) ?? null,
          sessionCount: workspace.sessionIds.length,
        }));
    }

    /**
     * Build the complete client-facing state payload.
     * @returns the state object.
     */
    function snapshot() {
      return {
        version: 3,
        profile: profile?.name ?? null,
        preset: PRESET_ID,
        autoOpen: settings.autoOpen,
        projects: listProjects(),
        identities: records.map((record) => {
          const info = homesInfo.get(record.identity.id);
          const identity = record.identity;
          return {
            id: identity.id,
            name: identity.name,
            role: identity.role,
            userName: identity.userName,
            persona: identity.persona,
            accent: identity.accent,
            avatar: identity.avatar,
            home: {
              path: record.paths.home,
              title: info?.title ?? identity.name,
              workspaceId: info?.workspaceId ?? null,
              exists: existsSync(record.paths.home),
              error: info?.error ?? null,
            },
            memory: {
              path: record.paths.memoryFile,
              text: record.store.read(),
              bytes: byteLength(record.store.read()),
              notes: countNotes(record.store.read()),
              maxBytes: settings.memory.maxBytes,
            },
          };
        }),
        memoryPolicy: {
          includeInPrompt: settings.memory.includeInPrompt,
          maxBytes: settings.memory.maxBytes,
        },
        tools: ['remember', 'recall'],
        editable: ctx.get('configEditor') !== undefined && ctx.fiber?.entry !== undefined,
      };
    }

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: STATE_PATH,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async () => {
            const registry = await registryWithin(1500);
            if (registry !== undefined) {
              for (const record of records) {
                const info = homesInfo.get(record.identity.id);
                if (info?.workspaceId === undefined) {
                  try {
                    await ensureIdentity(record.identity.id, registry);
                  } catch (error) {
                    if (info !== undefined) info.error = messageOf(error);
                  }
                }
              }
            }
            return json(snapshot());
          },
        }),
      'personal-agent: state route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: IDENTITY_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }

            const patch = body.identity !== null && typeof body.identity === 'object' ? body.identity : body;
            const updateId = typeof body.id === 'string' && body.id !== '' ? body.id : undefined;
            let nextIdentities;
            let target;
            try {
              if (updateId === undefined) {
                const used = new Set(settings.identities.map((identity) => identity.id));
                target = normalizeIdentity({ ...patch, home: '', memoryFile: '' }, { used });
                nextIdentities = [...settings.identities, target];
              } else {
                const current = settings.identities.find((identity) => identity.id === updateId);
                if (current === undefined) return failure(404, 'unknown-identity', `no identity "${updateId}"`);
                target = mergeIdentity(current, patch);
                nextIdentities = settings.identities.map((identity) => (identity.id === updateId ? target : identity));
              }
              const normalized = parseConfig({ identities: nextIdentities, memory: settings.memory });
              const homesSeen = new Map();
              const memoriesSeen = new Map();
              for (const identity of normalized.identities) {
                const paths = resolveIdentityPaths(identity, dataDir);
                if (homesSeen.has(paths.home)) {
                  throw new Error(`identities "${homesSeen.get(paths.home)}" and "${identity.name}" would share the home directory ${paths.home}`);
                }
                homesSeen.set(paths.home, identity.name);
                if (memoriesSeen.has(paths.memoryFile)) {
                  throw new Error(`identities "${memoriesSeen.get(paths.memoryFile)}" and "${identity.name}" would share the memory file ${paths.memoryFile}`);
                }
                memoriesSeen.set(paths.memoryFile, identity.name);
              }
              target = normalized.identities.find((identity) => identity.id === target.id) ?? target;
              nextIdentities = normalized.identities;
            } catch (error) {
              return failure(400, 'invalid-config', messageOf(error));
            }

            const editor = ctx.get('configEditor');
            const entry = ctx.fiber?.entry;
            if (editor === undefined || entry === undefined) {
              return failure(409, 'not-editable', 'this profile has no configuration editor, so identities cannot be saved from the page');
            }
            try {
              await editor.edit(entry, (current) => {
                const { identity: _legacyIdentity, home: _legacyHome, ...rest } = current;
                return {
                  ...rest,
                  identities: nextIdentities.map(serializeIdentity),
                  memory: { includeInPrompt: settings.memory.includeInPrompt, maxBytes: settings.memory.maxBytes },
                };
              });
            } catch (error) {
              return failure(409, 'save-failed', messageOf(error));
            }
            return json({ ok: true, identity: target });
          },
        }),
      'personal-agent: identity route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: REMOVE_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const identityId = typeof body.id === 'string' ? body.id : '';
            if (identityId === '') return failure(400, 'invalid-identity', 'id must be a non-empty string');
            const record = records.find((candidate) => candidate.identity.id === identityId);
            if (record === undefined) return failure(404, 'unknown-identity', `no identity "${identityId}"`);
            const editor = ctx.get('configEditor');
            const entry = ctx.fiber?.entry;
            if (editor === undefined || entry === undefined) {
              return failure(409, 'not-editable', 'this profile has no configuration editor, so identities cannot be removed from the page');
            }

            // Stop and archive the identity's conversations, then drop its
            // workspace registration. The directory and logs are retained; the
            // shipped browser hides archived sessions by default.
            const registry = await registryWithin(2000);
            let archived = 0;
            if (registry !== undefined) {
              const workspace = registry.list().find((candidate) => candidate.path === record.canonicalHome);
              if (workspace !== undefined) {
                const alreadyArchived = new Set(registry.archivedSessionIds);
                for (const sessionId of workspace.sessionIds) {
                  if (alreadyArchived.has(sessionId)) continue;
                  try {
                    await registry.archiveSession(sessionId, { stopActivity: true });
                    archived += 1;
                  } catch (error) {
                    return failure(500, 'archive-failed', `could not archive conversation ${sessionId}: ${messageOf(error)}`);
                  }
                }
                try {
                  await registry.delete(workspace.id);
                } catch (error) {
                  return failure(500, 'workspace-delete-failed', messageOf(error));
                }
              }
            }

            states.delete(identityId);
            await writeState(stateFile, states, logger);

            const nextIdentities = settings.identities.filter((identity) => identity.id !== identityId);
            try {
              await editor.edit(entry, (current) => {
                const { identity: _legacyIdentity, home: _legacyHome, ...rest } = current;
                return {
                  ...rest,
                  identities: nextIdentities.map(serializeIdentity),
                  memory: { includeInPrompt: settings.memory.includeInPrompt, maxBytes: settings.memory.maxBytes },
                };
              });
            } catch (error) {
              return failure(409, 'save-failed', messageOf(error));
            }

            let movedTo = null;
            let retained = [];
            try {
              const moved = await moveRemovedIdentityData(record, dataDir);
              movedTo = moved.movedTo;
              retained = moved.retained;
            } catch (error) {
              logger?.warn?.(`personal-agent: could not move removed identity data: ${messageOf(error)}`);
            }
            return json({ ok: true, removed: identityId, archived, movedTo, retained });
          },
        }),
      'personal-agent: remove identity route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: MEMORY_PATH,
          methods: ['PUT'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            if (typeof body.identityId !== 'string' || body.identityId === '') {
              return failure(400, 'invalid-identity', 'identityId must be a non-empty string');
            }
            if (typeof body.text !== 'string') return failure(400, 'invalid-memory', 'text must be a string');
            const record = records.find((candidate) => candidate.identity.id === body.identityId);
            if (record === undefined) return failure(404, 'unknown-identity', `no identity "${body.identityId}"`);
            try {
              const saved = await record.store.mutate(async () => {
                const text = await writeMemory(record.paths.memoryFile, body.text, settings.memory.maxBytes);
                record.store.commit(text);
                return { text, bytes: byteLength(text), notes: countNotes(text) };
              });
              return json({ ok: true, ...saved });
            } catch (error) {
              return failure(400, 'memory-rejected', messageOf(error));
            }
          },
        }),
      'personal-agent: memory route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: OPEN_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const registry = await registryWithin(2000);
            if (registry === undefined) {
              return failure(409, 'workspace-unavailable', 'this Host has no workspace registry, so the home cannot be opened');
            }
            if (typeof body.workspaceId === 'string' && body.workspaceId !== '') {
              const workspace = registry.get(body.workspaceId);
              if (workspace === undefined) return failure(404, 'unknown-workspace', `no workspace "${body.workspaceId}"`);
              const archived = new Set(registry.archivedSessionIds);
              const sessionId = workspace.sessionIds.find((id) => !archived.has(id)) ?? null;
              return json({ ok: true, workspaceId: workspace.id, sessionId, title: workspace.title, agentPreset: null });
            }
            if (typeof body.identityId !== 'string' || body.identityId === '') {
              return failure(400, 'invalid-target', 'identityId or workspaceId must be a non-empty string');
            }
            const record = records.find((candidate) => candidate.identity.id === body.identityId);
            if (record === undefined) return failure(404, 'unknown-identity', `no identity "${body.identityId}"`);
            try {
              const workspace = await ensureIdentity(record.identity.id, registry);
              const archived = new Set(registry.archivedSessionIds);
              const sessionId = workspace.sessionIds.find((id) => !archived.has(id)) ?? null;
              return json({ ok: true, workspaceId: workspace.id, sessionId, title: workspace.title, agentPreset: PRESET_ID });
            } catch (error) {
              const info = homesInfo.get(record.identity.id);
              if (info !== undefined) info.error = messageOf(error);
              return failure(500, 'open-failed', messageOf(error));
            }
          },
        }),
      'personal-agent: open route',
    );
  });
}