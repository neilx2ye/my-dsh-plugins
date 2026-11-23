/**
 * Host half of the artifact canvas.
 *
 * The agent writes a self-contained visual document (an interactive HTML page,
 * an SVG drawing, a chart, a Mermaid diagram, a Markdown document, or a code
 * sample) through one of this bundle's tools. The content is stored on disk in
 * a per-workspace artifact directory, and the browser half draws it inline in
 * the transcript and in a resizable canvas tab beside the conversation.
 *
 * The store lives under the Harness home rather than in the project: an
 * artifact is chat-adjacent work product, not a source file, and a generated
 * page should not appear in the user's repository unless they ask for it.
 */

import path from 'node:path';

import {
  ARTIFACT_TYPES,
  ArtifactStore,
  MAX_DESCRIPTION,
  describe,
  dshHome,
  expandPath,
  normalizeVersion,
  workspaceKey,
} from './lib/store.js';

/** Services this bundle needs from the Web Host composition. */
export const inject = ['tools', 'connection', 'sessions', 'workingDirectory'];

/** Browser route listing a workspace's artifacts. */
const LIST_PATH = '/api/dsh-artifacts/list';
/** Browser route returning one artifact's metadata and version list. */
const META_PATH = '/api/dsh-artifacts/meta';
/** Browser route returning one version's text as JSON (for editors and cards). */
const CONTENT_PATH = '/api/dsh-artifacts/content';
/** Browser route streaming one version with its real media type (for iframes). */
const RAW_PATH = '/api/dsh-artifacts/raw';
/** Browser route appending a new version from the canvas editor. */
const SAVE_PATH = '/api/dsh-artifacts/save';
/** Browser route renaming one artifact. */
const RENAME_PATH = '/api/dsh-artifacts/rename';
/** Browser route making an older version current again. */
const RESTORE_PATH = '/api/dsh-artifacts/restore';
/** Browser route deleting one artifact. */
const DELETE_PATH = '/api/dsh-artifacts/delete';

/** Accepted artifact kinds, in the order the tool description lists them. */
const TYPE_NAMES = Object.keys(ARTIFACT_TYPES);
/** Default ceiling for one artifact's text. */
const DEFAULT_MAX_BYTES = 1024 * 1024;
/** Default number of versions kept per artifact. */
const DEFAULT_MAX_VERSIONS = 30;

/**
 * Read the Loader row's config with named-field failures.
 * @param raw - the row's `config` value.
 * @returns normalized settings.
 */
function readSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    artifactsDir: typeof source.artifactsDir === 'string' ? source.artifactsDir.trim() : '',
    maxBytes: positiveInteger(source.maxBytes, DEFAULT_MAX_BYTES, 'maxBytes', 1024),
    maxVersions: positiveInteger(source.maxVersions, DEFAULT_MAX_VERSIONS, 'maxVersions', 1),
  };
}

/**
 * Read one positive integer config field.
 * @param value - raw value.
 * @param fallback - value used when absent.
 * @param field - field name for diagnostics.
 * @param min - smallest accepted value.
 * @returns the accepted value.
 */
function positiveInteger(value, fallback, field, min) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`dsh-artifacts: config.${field} must be an integer of at least ${min}`);
  }
  return value;
}

/**
 * Resolve the absolute artifact root for one workspace.
 * @param settings - normalized settings.
 * @param cwd - absolute project directory.
 * @returns `{ root, project }` for the store constructor.
 */
function rootFor(settings, cwd) {
  if (settings.artifactsDir === '') {
    return { root: path.join(dshHome(), 'storages', 'artifacts', workspaceKey(cwd)), project: cwd };
  }
  const configured = expandPath(settings.artifactsDir, cwd);
  return { root: path.resolve(configured), project: cwd };
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

/**
 * Read one JSON request body.
 * @param request - admitted Fetch request.
 * @returns parsed object, or a failure response.
 */
async function readBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { failure: failure(400, 'invalid-body', 'request body must be JSON') };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { failure: failure(400, 'invalid-body', 'request body must be an object') };
  }
  return { body };
}

/**
 * A content block for the model-facing tool result.
 * @param text - the whole result text.
 * @returns one text block.
 */
function textContent(text) {
  return [{ type: 'text', text }];
}

/**
 * Register storage, browser routes, the artifact tools, and the prompt section.
 * @param ctx - Host root Context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config);
  /** One artifact store per project directory. */
  const stores = new Map();

  /**
   * Resolve a Session's artifact store.
   * @param session - live Session object.
   * @returns project facts, or undefined when the Session has no directory.
   */
  function storeOfSession(session) {
    if (session === undefined) return undefined;
    let cwd;
    try {
      cwd = ctx.workingDirectory.get(session);
    } catch {
      return undefined;
    }
    if (typeof cwd !== 'string' || cwd === '') return undefined;
    const { root, project } = rootFor(settings, cwd);
    let store = stores.get(root);
    if (store === undefined) {
      store = new ArtifactStore(root, project, settings);
      stores.set(root, store);
    }
    return { store, cwd, root, sessionId: typeof session.id === 'string' ? session.id : '' };
  }

  /**
   * Resolve the store of a live Session id coming from the browser.
   * @param sessionId - Session identity.
   * @returns project facts, or undefined for an unknown Session.
   */
  function storeOfId(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined;
    return storeOfSession(ctx.sessions.get(sessionId));
  }

  /**
   * Resolve the store of the Agent making a tool call.
   * @param exec - tool execution context.
   * @returns project facts, or undefined outside an Agent.
   */
  function storeOfAgent(exec) {
    return storeOfSession(exec.agent?.session);
  }

  /**
   * Resolve a request's store from its query string or JSON body.
   * @param request - admitted Fetch request.
   * @param body - already-parsed body, when the route has one.
   * @returns project facts and the request body, or a failure response.
   */
  async function requireStore(request, body) {
    let sessionId = body !== undefined && typeof body.sessionId === 'string' ? body.sessionId : '';
    if (sessionId === '') sessionId = new URL(request.url).searchParams.get('sessionId') ?? '';
    const found = storeOfId(sessionId);
    if (found === undefined) return { failure: failure(404, 'project-unavailable', 'this chat has no open project directory') };
    return { ...found, sessionId };
  }

  // ------------------------------------------------------------------ routes

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LIST_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const found = await requireStore(request);
          if (found.failure !== undefined) return found.failure;
          try {
            const scope = new URL(request.url).searchParams.get('scope') === 'project' ? 'project' : 'session';
            const metas = await found.store.list();
            const visible = scope === 'project' ? metas : metas.filter((meta) => (meta.sessionId ?? '') === found.sessionId);
            return Response.json({
              scope,
              project: found.cwd,
              directory: found.root,
              artifacts: visible.map(describe),
            });
          } catch (error) {
            return failure(500, 'list-failed', messageOf(error));
          }
        },
      }),
    'dsh-artifacts: list route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: META_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const found = await requireStore(request);
          if (found.failure !== undefined) return found.failure;
          const id = new URL(request.url).searchParams.get('id') ?? '';
          try {
            const meta = await found.store.meta(id);
            if (meta === undefined) return failure(404, 'artifact-not-found', 'this artifact no longer exists');
            return Response.json({ artifact: describe(meta) });
          } catch (error) {
            return failure(400, 'meta-failed', messageOf(error));
          }
        },
      }),
    'dsh-artifacts: meta route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: CONTENT_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const found = await requireStore(request);
          if (found.failure !== undefined) return found.failure;
          const url = new URL(request.url);
          const id = url.searchParams.get('id') ?? '';
          try {
            const read = await found.store.read(id, normalizeVersion(url.searchParams.get('version') ?? undefined));
            return Response.json({
              artifact: describe(read.meta),
              version: read.version,
              content: read.content,
            });
          } catch (error) {
            return failure(404, 'artifact-not-found', messageOf(error));
          }
        },
      }),
    'dsh-artifacts: content route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: RAW_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const found = await requireStore(request);
          if (found.failure !== undefined) return found.failure;
          const url = new URL(request.url);
          const id = url.searchParams.get('id') ?? '';
          try {
            const read = await found.store.read(id, normalizeVersion(url.searchParams.get('version') ?? undefined));
            const mediaType = ARTIFACT_TYPES[read.meta.type]?.mime ?? 'text/plain; charset=utf-8';
            const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
            const name = `${slugify(read.meta.title)}-v${read.version}.${ARTIFACT_TYPES[read.meta.type]?.ext ?? 'txt'}`;
            return new Response(read.content, {
              status: 200,
              headers: {
                'content-type': mediaType,
                'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
                'cache-control': 'no-store',
                'x-content-type-options': 'nosniff',
                // The document is untrusted model output. The CSP sandbox makes
                // it an opaque origin even when someone opens the raw URL in a
                // top-level tab, so it can never call the Harness API with the
                // user's session cookie.
                'content-security-policy': 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads',
              },
            });
          } catch (error) {
            return failure(404, 'artifact-not-found', messageOf(error));
          }
        },
      }),
    'dsh-artifacts: raw route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SAVE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const parsed = await readBody(request);
          if (parsed.failure !== undefined) return parsed.failure;
          const found = await requireStore(request, parsed.body);
          if (found.failure !== undefined) return found.failure;
          try {
            const meta = await found.store.update(stringField(parsed.body.id, 'id'), {
              content: parsed.body.content,
              title: parsed.body.title,
              language: parsed.body.language,
              description: parsed.body.description,
            });
            return Response.json({ artifact: describe(meta) });
          } catch (error) {
            return failure(400, 'save-failed', messageOf(error));
          }
        },
      }),
    'dsh-artifacts: save route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: RENAME_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const parsed = await readBody(request);
          if (parsed.failure !== undefined) return parsed.failure;
          const found = await requireStore(request, parsed.body);
          if (found.failure !== undefined) return found.failure;
          try {
            const meta = await found.store.rename(stringField(parsed.body.id, 'id'), stringField(parsed.body.title, 'title'));
            return Response.json({ artifact: describe(meta) });
          } catch (error) {
            return failure(400, 'rename-failed', messageOf(error));
          }
        },
      }),
    'dsh-artifacts: rename route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: RESTORE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const parsed = await readBody(request);
          if (parsed.failure !== undefined) return parsed.failure;
          const found = await requireStore(request, parsed.body);
          if (found.failure !== undefined) return found.failure;
          try {
            const meta = await found.store.restore(stringField(parsed.body.id, 'id'), parsed.body.version);
            return Response.json({ artifact: describe(meta) });
          } catch (error) {
            return failure(400, 'restore-failed', messageOf(error));
          }
        },
      }),
    'dsh-artifacts: restore route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: DELETE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const parsed = await readBody(request);
          if (parsed.failure !== undefined) return parsed.failure;
          const found = await requireStore(request, parsed.body);
          if (found.failure !== undefined) return found.failure;
          try {
            const meta = await found.store.remove(stringField(parsed.body.id, 'id'));
            return Response.json({ ok: true, id: meta.id });
          } catch (error) {
            return failure(400, 'delete-failed', messageOf(error));
          }
        },
      }),
    'dsh-artifacts: delete route',
  );

  // ------------------------------------------------------------------- tools

  /** Output schema shared by every artifact tool. */
  const ARTIFACT_OUTPUT = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'title', 'type', 'version', 'path'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      type: { type: 'string' },
      version: { type: 'integer' },
      path: { type: 'string' },
      description: { type: 'string' },
      bytes: { type: 'integer' },
      summary: { type: 'string' },
    },
  };

  /** Projection shared by every artifact tool: everything the canvas card needs. */
  const presentationMeta = (_args, value) => ({
    artifact: {
      id: value.id,
      title: value.title,
      type: value.type,
      version: value.version,
      bytes: value.bytes,
      description: value.description ?? '',
    },
  });

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'artifact_create',
        description:
          'Create a rich artifact the user can view in a canvas panel. Use it when the deliverable is a self-contained visual document rather than prose: an interactive HTML page or widget, an SVG illustration, a chart, a Mermaid diagram, a formatted Markdown document, or a substantial code sample meant to be read. The artifact is stored outside the repository and shown inline in chat. Keep the chat reply to a short summary instead of pasting the whole document. Types: "html" (a full HTML document; inline <style>/<script> are allowed and run in a sandboxed iframe), "svg" (inline <svg> markup), "markdown" (GitHub-flavored Markdown), "mermaid" (a Mermaid diagram source), "chart" (a JSON chart spec, see below), "code" (source text plus an optional language hint). Chart spec: {"kind":"bar"|"line"|"area"|"pie"|"donut","title":"...","labels":["Q1","Q2"],"series":[{"name":"2025","values":[12,18]}],"unit":"$k","stacked":false}. Do not use artifacts for short snippets, ordinary answers, or files the user asked to save in the project (write those with the write tool).',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'type', 'content'],
          properties: {
            title: { type: 'string', description: `Short display title for the artifact, at most ${120} characters.` },
            type: { type: 'string', enum: TYPE_NAMES, description: 'Artifact kind.' },
            content: {
              type: 'string',
              description: 'The complete artifact source. For chart, a JSON chart spec; for code, the source text.',
            },
            language: { type: 'string', description: 'For code: language hint such as ts, python, sql, bash.' },
            description: { type: 'string', description: `One line explaining what the artifact is, at most ${MAX_DESCRIPTION} characters.` },
          },
        },
        output: {
          schema: ARTIFACT_OUTPUT,
          render: (_args, value) => textContent(artifactSummary(value)),
          presentationMeta,
        },
        async execute(args, exec) {
          const project = storeOfAgent(exec);
          if (project === undefined) throw new Error('artifact_create requires an open chat with a project directory');
          const meta = await project.store.create({
            title: args.title,
            type: args.type,
            content: args.content,
            language: args.language,
            description: args.description,
            sessionId: project.sessionId,
          });
          return describeForTool(project, meta);
        },
      }),
    'dsh-artifacts: create tool',
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'artifact_update',
        description:
          'Revise an existing artifact. Pass the artifact id returned by artifact_create. Supply either "content" to replace the whole document (a new version is stored) or "edits" to apply exact string replacements, which is cheaper for small changes in a long document. The canvas updates immediately; every previous version stays recoverable. Use artifact_list when you do not know the id.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Artifact id from artifact_create or artifact_list.' },
            content: { type: 'string', description: 'Replacement document. Omit when using edits.' },
            edits: {
              type: 'array',
              description: 'Exact replacements applied in order to the current content. Each old_string must occur exactly once unless replace_all is true.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['old_string', 'new_string'],
                properties: {
                  old_string: { type: 'string' },
                  new_string: { type: 'string' },
                  replace_all: { type: 'boolean' },
                },
              },
            },
            title: { type: 'string', description: 'New title, when the revision renames the artifact.' },
            language: { type: 'string', description: 'New language hint for a code artifact.' },
            description: { type: 'string', description: 'New one-line description.' },
          },
        },
        output: {
          schema: ARTIFACT_OUTPUT,
          render: (_args, value) => textContent(artifactSummary(value)),
          presentationMeta,
        },
        async execute(args, exec) {
          const project = storeOfAgent(exec);
          if (project === undefined) throw new Error('artifact_update requires an open chat with a project directory');
          const id = stringField(args.id, 'id');
          if (args.content !== undefined && Array.isArray(args.edits)) {
            throw new Error('artifact_update accepts content or edits, not both');
          }
          const current = await project.store.read(id);
          let content = args.content;
          if (content === undefined) {
            if (!Array.isArray(args.edits) || args.edits.length === 0) {
              throw new Error('artifact_update requires either content or a non-empty edits array');
            }
            content = applyEdits(current.content, args.edits);
          }
          const meta = await project.store.update(id, {
            content,
            title: args.title,
            language: args.language,
            description: args.description,
          });
          return describeForTool(project, meta);
        },
      }),
    'dsh-artifacts: update tool',
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'artifact_list',
        description:
          'List the artifacts made in this chat, newest first, with their ids, kinds, versions, and titles. Use it to find the id of an artifact the user refers to before calling artifact_update.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            all: { type: 'boolean', description: 'List every artifact in this project instead of only this chat.' },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['artifacts'],
            properties: {
              artifacts: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    type: { type: 'string' },
                    version: { type: 'integer' },
                  },
                },
              },
              summary: { type: 'string' },
            },
          },
          render: (_args, value) => textContent(value.summary),
        },
        async execute(args, exec) {
          const project = storeOfAgent(exec);
          if (project === undefined) throw new Error('artifact_list requires an open chat with a project directory');
          const metas = await project.store.list();
          const visible = args.all === true ? metas : metas.filter((meta) => (meta.sessionId ?? '') === project.sessionId);
          if (visible.length === 0) {
            return { artifacts: [], summary: 'No artifacts in this chat yet. Create one with artifact_create.' };
          }
          const lines = visible.map(
            (meta, index) =>
              `${index + 1}. ${meta.id} — ${meta.title} — ${meta.type} — v${meta.current} — updated ${meta.updatedAt}`,
          );
          return {
            artifacts: visible.map((meta) => ({ id: meta.id, title: meta.title, type: meta.type, version: meta.current })),
            summary: `${visible.length} artifact(s), newest first:\n${lines.join('\n')}`,
          };
        },
      }),
    'dsh-artifacts: list tool',
  );

  const promptService = ctx.get('systemPrompt');
  if (promptService !== undefined) {
    ctx.effect(
      () =>
        promptService.section({
          name: 'tool:dsh-artifacts',
          order: 2740,
          text: ({ scope }) =>
            ctx.tools.get('artifact_create', scope) === undefined
              ? ''
              : 'Artifacts: create one with artifact_create on your own initiative whenever the deliverable is visual, interactive, diagrammed, charted, or long-form — the user does NOT need to name the tool. Typical triggers: a web page, app, widget, or demo; a flow, architecture, or sequence diagram; a chart built from data; a formatted report, plan, or release note longer than a couple of paragraphs; a substantial code sample meant for reading. Keep the chat reply to at most two short sentences (what it is, one next step) and do not paste the document into the transcript. Revise an existing artifact with artifact_update (whole content or exact edits) instead of creating a duplicate, and use artifact_list to find its id. Do not use an artifact for a short snippet, a brief inline answer, or a file the user asked to save in the repository — write those directly. Design quality: one restrained palette (an accent plus neutrals), one clear type scale, generous spacing, and real data or none; avoid decorative gradients, nested containers, invented legends, and micro-labels under ~12px — the content, not the chrome, should carry the layout.',
        }),
      'dsh-artifacts: prompt section',
    );
  }

  /**
   * Build the model-facing summary of a stored artifact.
   * @param value - the tool's canonical output.
   * @returns the text the model receives.
   */
  function artifactSummary(value) {
    return [
      `${value.summary}`,
      `id: ${value.id}`,
      `kind: ${value.type} · version: v${value.version} · ${value.bytes} bytes`,
      `file: ${value.path}`,
      'The user sees this artifact as a card in the chat (click it to expand the live preview in place) and in the canvas panel.',
    ].join('\n');
  }

  /**
   * Project one stored artifact into the tool's canonical output.
   * @param project - resolved project facts.
   * @param meta - stored metadata.
   * @returns canonical output value.
   */
  function describeForTool(project, meta) {
    const current = meta.versions.find((record) => record.v === meta.current);
    return {
      id: meta.id,
      title: meta.title,
      type: meta.type,
      version: meta.current,
      path: current === undefined ? path.join(project.root, meta.id) : path.join(project.root, meta.id, current.file),
      bytes: current === undefined ? 0 : current.bytes,
      description: meta.description ?? '',
      summary: `Artifact ${meta.id} "${meta.title}" (${meta.type}) saved at v${meta.current}.`,
    };
  }
}

/**
 * Read one required string field.
 * @param value - raw value.
 * @param field - field name for the error.
 * @returns the string.
 */
function stringField(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`);
  return value;
}

/**
 * Apply exact string replacements to a document.
 * @param content - current document.
 * @param edits - requested replacements.
 * @returns the revised document.
 */
function applyEdits(content, edits) {
  let next = content;
  for (const edit of edits) {
    if (edit === null || typeof edit !== 'object') throw new Error('each edit must be an object');
    const oldString = stringField(edit.old_string, 'edits[].old_string');
    const newString = typeof edit.new_string === 'string' ? edit.new_string : undefined;
    if (newString === undefined) throw new Error('edits[].new_string must be a string');
    const count = next.split(oldString).length - 1;
    if (count === 0) throw new Error(`edits[].old_string was not found: ${truncate(oldString)}`);
    if (count > 1 && edit.replace_all !== true) {
      throw new Error(`edits[].old_string occurs ${count} times; pass replace_all or a longer excerpt: ${truncate(oldString)}`);
    }
    next = edit.replace_all === true ? next.split(oldString).join(newString) : next.replace(oldString, () => newString);
  }
  return next;
}

/**
 * Shorten a string for an error message.
 * @param value - candidate.
 * @returns at most 80 characters.
 */
function truncate(value) {
  const oneLine = value.replace(/\s+/g, ' ');
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine;
}

/**
 * Turn a title into a safe download file stem.
 * @param title - artifact title.
 * @returns a lowercase stem.
 */
function slugify(title) {
  const slug = String(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug === '' ? 'artifact' : slug;
}

/**
 * Extract a readable message from a thrown value.
 * @param error - thrown value.
 * @returns the message.
 */
function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}