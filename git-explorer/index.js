/**
 * Host half of the Git explorer bundle.
 *
 * Two owner-only Fetch routes back the side panel: one reports a registered
 * Workspace's branches, working-tree changes, and a newest-first commit page;
 * the other returns one changed file's unified diff for the hover card. Both
 * accept a Workspace identity, never a path for the repository: callers can
 * read only directories the Workspace registry has already admitted, and Git
 * runs from that canonical directory.
 */

import { commitWorkingTree, inspectWorkspaceGit, readSettings, readWorkingTreeDiff, GitCommandError } from './lib/git.js';

/** Services this bundle needs from the Web Host composition. */
export const inject = ['connection', 'workspaceRegistry', 'subprocess'];

/** Exact Fetch route backing the browser panel. */
const WORKSPACE_PATH = '/api/git-explorer/workspace';
/** Exact Fetch route returning one changed file's unified diff. */
const DIFF_PATH = '/api/git-explorer/diff';
/** Exact owner-only route staging all changes and committing them. */
const COMMIT_PATH = '/api/git-explorer/commit';

/**
 * Register the read-only inspection and diff routes.
 * @param {object} ctx - Host root Context.
 * @param {unknown} config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config);

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: WORKSPACE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: (request) => workspaceRoute(ctx, settings, request),
      }),
    'git-explorer: workspace route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: DIFF_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: (request) => diffRoute(ctx, settings, request),
      }),
    'git-explorer: diff route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: COMMIT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => commitRoute(ctx, settings, request),
      }),
    'git-explorer: commit route',
  );
}

/**
 * Answer one branch/commit read.
 * @param {object} ctx - Host root Context.
 * @param {{ limit: number, timeoutMs: number }} settings - normalized settings.
 * @param {Request} request - admitted owner Fetch request.
 * @returns {Promise<Response>} JSON repository snapshot or a structured failure.
 */
async function workspaceRoute(ctx, settings, request) {
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get('workspaceId') ?? '';
  if (workspaceId === '') {
    return failure(400, 'invalid-workspace', 'workspaceId is required');
  }

  const workspace = ctx.workspaceRegistry.get(workspaceId);
  if (workspace === undefined) {
    return failure(404, 'workspace-unavailable', 'the workspace is not registered in this process');
  }
  const cwd = workspace.path;
  if (typeof cwd !== 'string' || cwd === '') {
    return failure(404, 'workspace-unavailable', 'the workspace has no directory');
  }

  const ref = params.get('ref') ?? undefined;
  const timeout = AbortSignal.timeout(settings.timeoutMs);
  const signal = AbortSignal.any([request.signal, timeout]);

  let result;
  try {
    result = await inspectWorkspaceGit({
      subprocess: ctx.subprocess,
      workspaceId,
      cwd,
      ref,
      limit: settings.limit,
      signal,
    });
  } catch (error) {
    if (request.signal.aborted) return failure(499, 'request-aborted', 'the request was cancelled');
    if (timeout.aborted) return failure(504, 'git-timeout', 'reading Git timed out');
    if (error instanceof GitCommandError) {
      return failure(500, 'git-failed', error.message, { detail: error.stderr });
    }
    return failure(500, 'git-failed', error instanceof Error ? error.message : String(error));
  }

  if (!result.ok) {
    return failure(result.code === 'unknown-ref' ? 400 : 500, result.code, result.message);
  }
  return Response.json(result.value, {
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Answer one manual commit request.
 * @param {object} ctx - Host root Context.
 * @param {{ commitTimeoutMs: number }} settings - normalized settings.
 * @param {Request} request - admitted owner Fetch request carrying `{ workspaceId, message }`.
 * @returns {Promise<Response>} the created commit or a structured failure.
 */
async function commitRoute(ctx, settings, request) {
  const essence = String(request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (essence !== 'application/json') {
    return failure(415, 'unsupported-media-type', 'content-type must be application/json');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return failure(400, 'invalid-body', 'request body must be JSON');
  }
  if (body === null || typeof body !== 'object') {
    return failure(400, 'invalid-body', 'request body must be an object');
  }

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const message = typeof body.message === 'string' ? body.message : '';
  if (workspaceId === '') {
    return failure(400, 'invalid-workspace', 'workspaceId is required');
  }
  if (message.trim() === '') {
    return failure(400, 'invalid-message', 'a commit message is required');
  }

  const workspace = ctx.workspaceRegistry.get(workspaceId);
  if (workspace === undefined) {
    return failure(404, 'workspace-unavailable', 'the workspace is not registered in this process');
  }
  const cwd = workspace.path;
  if (typeof cwd !== 'string' || cwd === '') {
    return failure(404, 'workspace-unavailable', 'the workspace has no directory');
  }

  const timeout = AbortSignal.timeout(settings.commitTimeoutMs);
  const signal = AbortSignal.any([request.signal, timeout]);

  let result;
  try {
    result = await commitWorkingTree({
      subprocess: ctx.subprocess,
      cwd,
      message,
      signal,
    });
  } catch (error) {
    if (request.signal.aborted) return failure(499, 'request-aborted', 'the request was cancelled');
    if (timeout.aborted) return failure(504, 'commit-timeout', 'the commit timed out');
    if (error instanceof GitCommandError) {
      return failure(500, 'commit-failed', error.message, { detail: error.stderr });
    }
    return failure(500, 'commit-failed', error instanceof Error ? error.message : String(error));
  }

  if (!result.ok) {
    const status =
      result.code === 'invalid-message' || result.code === 'not-a-repository'
        ? 400
        : result.code === 'nothing-to-commit'
          ? 409
          : 500;
    return failure(status, result.code, result.message);
  }
  return Response.json(result.value, {
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Answer one changed file's diff read.
 * @param {object} ctx - Host root Context.
 * @param {{ limit: number, timeoutMs: number }} settings - normalized settings.
 * @param {Request} request - admitted owner Fetch request.
 * @returns {Promise<Response>} JSON diff or a structured failure.
 */
async function diffRoute(ctx, settings, request) {
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get('workspaceId') ?? '';
  if (workspaceId === '') {
    return failure(400, 'invalid-workspace', 'workspaceId is required');
  }
  const path = params.get('path') ?? '';
  if (path === '') {
    return failure(400, 'invalid-path', 'path is required');
  }
  const oldPath = params.get('oldPath') ?? undefined;

  const workspace = ctx.workspaceRegistry.get(workspaceId);
  if (workspace === undefined) {
    return failure(404, 'workspace-unavailable', 'the workspace is not registered in this process');
  }
  const cwd = workspace.path;
  if (typeof cwd !== 'string' || cwd === '') {
    return failure(404, 'workspace-unavailable', 'the workspace has no directory');
  }

  const timeout = AbortSignal.timeout(settings.timeoutMs);
  const signal = AbortSignal.any([request.signal, timeout]);

  let result;
  try {
    result = await readWorkingTreeDiff({
      subprocess: ctx.subprocess,
      cwd,
      path,
      oldPath,
      signal,
    });
  } catch (error) {
    if (request.signal.aborted) return failure(499, 'request-aborted', 'the request was cancelled');
    if (timeout.aborted) return failure(504, 'git-timeout', 'reading the diff timed out');
    if (error instanceof GitCommandError) {
      return failure(500, 'git-failed', error.message, { detail: error.stderr });
    }
    return failure(500, 'git-failed', error instanceof Error ? error.message : String(error));
  }

  if (!result.ok) {
    const status = result.code === 'invalid-path' ? 400 : result.code === 'not-changed' ? 404 : 500;
    return failure(status, result.code, result.message);
  }
  return Response.json(result.value, {
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Build one JSON failure response.
 * @param {number} status - HTTP status.
 * @param {string} code - machine-readable code.
 * @param {string} message - human-readable message.
 * @param {object} [extra] - additional JSON fields.
 * @returns {Response} the failure response.
 */
function failure(status, code, message, extra = {}) {
  return Response.json({ code, message, ...extra }, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}