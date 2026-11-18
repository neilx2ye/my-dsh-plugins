/**
 * Host half of the command runner bundle.
 *
 * Three owner-only Fetch routes under `/api` back the browser window: one
 * reports a registered Workspace's directory (with a Session's effective
 * directory as a fallback), one streams a shell command's output from that
 * directory, and one writes input to an interactive PTY run.
 * `ctx.connection.fetch` performs browser admission before any handler runs,
 * so these routes are never reachable anonymously.
 */

import { randomUUID } from 'node:crypto';
import { runCommand, runInteractiveCommand, resolveShell } from './lib/exec.js';

/** Services this bundle needs from the Web Host composition. */
export const inject = ['connection', 'sessions', 'workingDirectory', 'subprocess', 'workspaceRegistry'];

/** Exact Fetch route reporting the Workspace directory. */
const WORKSPACE_PATH = '/api/command-runner/workspace';
/** Exact Fetch route running one command and streaming its output. */
const RUN_PATH = '/api/command-runner/run';
/** Exact Fetch route forwarding one line to an interactive command's PTY. */
const INPUT_PATH = '/api/command-runner/input';

/** Accepted command length; longer input is rejected before a process exists. */
const MAX_COMMAND_LENGTH = 8192;
/** Accepted raw size of one interactive input write. */
const MAX_INPUT_LENGTH = 65536;

const DEFAULTS = Object.freeze({
  maxOutputBytes: 1024 * 1024,
});

/**
 * Validate the row's config. Invalid values fail activation with a named field
 * instead of silently falling back.
 * @param raw - the Loader row's `config` value.
 * @returns normalized settings.
 */
function readSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    maxOutputBytes: pickInteger(source.maxOutputBytes, DEFAULTS.maxOutputBytes, 'maxOutputBytes', 1024, 64 * 1024 * 1024),
    shell: typeof source.shell === 'string' && source.shell.trim() !== '' ? source.shell.trim() : undefined,
  };
}

/**
 * Read one positive integer config field.
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
    throw new Error(`command-runner: config.${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Register the workspace and run routes.
 * @param ctx - Host root Context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config);
  /** Live interactive PTY handles keyed by the run id advertised in `start`. */
  const runs = new Map();

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: WORKSPACE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const params = new URL(request.url).searchParams;
          const workspaceId = params.get('workspaceId');
          if (workspaceId !== null) {
            const cwd = workspaceDirectory(ctx, workspaceId);
            if (cwd === undefined) {
              return failure(404, 'workspace-unavailable', 'the workspace is not registered in this process');
            }
            return Response.json({ cwd, shell: resolveShell(settings.shell) });
          }
          const sessionId = params.get('sessionId') ?? '';
          const target = locate(ctx, sessionId);
          if (target === undefined) {
            return failure(404, 'session-unavailable', 'the session is not open in this process');
          }
          return Response.json({ cwd: target.cwd, shell: resolveShell(settings.shell) });
        },
      }),
    'command-runner: workspace route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: RUN_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => runRoute(ctx, settings, request, runs),
      }),
    'command-runner: run route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: INPUT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => inputRoute(runs, request),
      }),
    'command-runner: input route',
  );
}

/**
 * Parse and execute one run request, returning an SSE response immediately and
 * driving the child process behind it.
 * @param ctx - Host root Context.
 * @param settings - normalized plugin settings.
 * @param request - admitted owner Fetch request.
 * @returns the event stream response, or a JSON failure before spawning.
 */
async function runRoute(ctx, settings, request, runs) {
  let body;
  try {
    body = await request.json();
  } catch {
    return failure(400, 'invalid-body', 'request body must be JSON');
  }
  if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');

  const { sessionId, workspaceId, command, interactive } = body;
  if (typeof command !== 'string' || command.trim() === '') return failure(400, 'invalid-command', 'command must be a non-empty string');
  if (command.length > MAX_COMMAND_LENGTH) return failure(413, 'command-too-long', `command must not exceed ${MAX_COMMAND_LENGTH} characters`);

  let cwd;
  if (workspaceId !== undefined && workspaceId !== null) {
    if (typeof workspaceId !== 'string' || workspaceId === '') return failure(400, 'invalid-workspace', 'workspaceId must be a non-empty string');
    cwd = workspaceDirectory(ctx, workspaceId);
    if (cwd === undefined) return failure(404, 'workspace-unavailable', 'the workspace is not registered in this process');
  } else {
    if (typeof sessionId !== 'string' || sessionId === '') return failure(400, 'invalid-session', 'sessionId must be a non-empty string');
    const target = locate(ctx, sessionId);
    if (target === undefined) return failure(404, 'session-unavailable', 'the session is not open in this process');
    cwd = target.cwd;
  }

  const interactiveRun = interactive === true;
  const runId = interactiveRun ? randomUUID() : undefined;
  if (runId !== undefined) runs.set(runId, { handle: undefined });

  const abort = new AbortController();
  const encoder = new TextEncoder();
  let streamController;
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  const send = (event) => {
    if (closed || streamController === undefined) return;
    try {
      streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      closed = true;
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      streamController.close();
    } catch {}
  };

  if (request.signal.aborted) {
    close();
  } else {
    request.signal.addEventListener(
      'abort',
      () => {
        abort.abort();
        close();
      },
      { once: true },
    );
  }

  if (!interactiveRun) send({ type: 'start', cwd, command });
  void execute({ ctx, settings, cwd, command, send, close, signal: abort.signal, interactive: interactiveRun, runId, runs });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Run the command and frame its terminal event.
 * @param options.ctx - Host root Context.
 * @param options.settings - normalized plugin settings.
 * @param options.cwd - directory the command runs in.
 * @param options.command - command line.
 * @param options.send - event sink.
 * @param options.close - stream terminator.
 * @param options.signal - cancellation tied to the HTTP request.
 * @param options.interactive - whether to run on a PTY with input routing.
 * @param options.runId - interactive run identity advertised in `start`.
 * @param options.runs - live interactive handles keyed by run id.
 */
async function execute({ ctx, settings, cwd, command, send, close, signal, interactive, runId, runs }) {
  let result;
  try {
    const common = {
      subprocess: ctx.subprocess,
      command,
      cwd,
      shell: settings.shell,
      maxOutputBytes: settings.maxOutputBytes,
      send,
      signal,
    };
    result = interactive
      ? await runInteractiveCommand({
          ...common,
          onTerminal: (handle) => {
            const record = runs.get(runId);
            if (record === undefined) {
              void handle.terminate().catch(() => {});
              return;
            }
            record.handle = handle;
            send({ type: 'start', cwd, command, runId });
          },
        })
      : await runCommand(common);
  } catch (error) {
    if (!signal.aborted) send({ type: 'error', message: messageOf(error) });
    close();
    return;
  } finally {
    if (runId !== undefined) {
      const record = runs.get(runId);
      runs.delete(runId);
      if (result === undefined && record !== undefined && record.handle !== undefined) {
        void record.handle.terminate().catch(() => {});
      }
    }
  }
  if (result.failure !== undefined && !signal.aborted) {
    send({ type: 'error', message: messageOf(result.failure) });
  } else if (!signal.aborted) {
    send({ type: 'exit', code: result.exitCode, signal: result.signal });
  }
  close();
}

/**
 * Forward one interactive input line to the PTY identified by its run id.
 * @param runs - live interactive handles keyed by run id.
 * @param request - admitted owner Fetch request carrying `{ runId, data }`.
 * @returns 204 on acceptance, or a structured failure.
 */
async function inputRoute(runs, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return failure(400, 'invalid-body', 'request body must be JSON');
  }
  if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
  const { runId, data } = body;
  if (typeof runId !== 'string' || runId === '') return failure(400, 'invalid-run', 'runId must be a non-empty string');
  if (typeof data !== 'string' || data === '') return failure(400, 'invalid-input', 'data must be a non-empty string');
  if (Buffer.byteLength(data) > MAX_INPUT_LENGTH) return failure(413, 'input-too-long', `input must not exceed ${MAX_INPUT_LENGTH} bytes`);
  const record = runs.get(runId);
  if (record === undefined) return failure(404, 'run-unavailable', 'the command is no longer running');
  if (record.handle === undefined) return failure(409, 'run-not-ready', 'the command is still starting');
  try {
    await record.handle.write(data);
  } catch {
    return failure(409, 'run-closed', 'the command is no longer accepting input');
  }
  return new Response(null, { status: 204 });
}

/**
 * Resolve one registered Workspace's canonical directory.
 * @param ctx - Host root Context.
 * @param workspaceId - Workspace identity from the request.
 * @returns the directory, or undefined when the Workspace is unavailable.
 */
function workspaceDirectory(ctx, workspaceId) {
  if (typeof workspaceId !== 'string' || workspaceId === '') return undefined;
  const workspace = ctx.workspaceRegistry?.get?.(workspaceId);
  if (workspace === undefined) return undefined;
  const cwd = workspace.path;
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined;
}

/**
 * Resolve a Session's effective working directory.
 * @param ctx - Host root Context.
 * @param sessionId - Session identity from the request.
 * @returns the Session and its directory, or undefined when either is unavailable.
 */
function locate(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined;
  const session = ctx.sessions.get(sessionId);
  if (session === undefined) return undefined;
  let cwd;
  try {
    cwd = ctx.workingDirectory.get(session);
  } catch {
    return undefined;
  }
  if (typeof cwd !== 'string' || cwd === '') return undefined;
  return { session, cwd };
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
 * Flatten an unknown thrown value into one line.
 * @param error - thrown value.
 * @returns its message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}