/**
 * Host half of the workspace upload bundle.
 *
 * One owner-only streaming route receives the bytes a browser picked from the
 * local computer and writes them into the Session's workspace directory — the
 * same directory the Files page and its tree show. The route never buffers a
 * whole file: chunks flow from the request body into a hidden temporary file in
 * the destination directory, and publication links or renames that file into
 * place, so the tree never lists a partially written upload.
 *
 * Identity is the Session, never a free-form target path: the Host asks the
 * working-directory service for that Session's effective directory (live or
 * restored from its log), and every write is fenced inside it.
 */

import { createWriteStream } from 'node:fs';
import { link, lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Services this bundle needs from the Web Host composition. */
export const inject = ['connection'];

/** Exact Fetch route receiving one browser file for a Session's workspace. */
const UPLOAD_PATH = '/api/workspace-upload/file';

/** Exact Fetch route creating one workspace-relative directory. */
export const DIRECTORY_PATH = '/api/workspace-upload/dir';

/** Exact Fetch route reporting the accepted file size to the browser. */
const LIMITS_PATH = '/api/workspace-upload/limits';

/**
 * Default largest accepted body, in bytes (500 MiB). It stays below a typical
 * reverse proxy's 512 MiB request cap, where an oversized body would be refused
 * before it reaches this route.
 */
const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** Hidden prefix of a temporary file inside the destination directory. */
const TEMP_PREFIX = '.dsh-upload-';

/** Longest accepted file name, in characters. */
const MAX_NAME_LENGTH = 255;

/** How many alternative names one publication may try before giving up. */
const PUBLISH_ATTEMPTS = 4;

/**
 * A failure that maps onto one HTTP status.
 */
class UploadError extends Error {
  /**
   * @param {number} status - HTTP status to answer.
   * @param {string} code - stable machine-readable failure code.
   * @param {string} message - human-readable failure text.
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Register the upload route.
 * @param {object} ctx - Host root Context.
 * @param {unknown} config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config);

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LIMITS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: () => Response.json(
          { maxUploadBytes: settings.maxUploadBytes },
          { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
        ),
      }),
    'workspace-upload: limits route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: UPLOAD_PATH,
        methods: ['POST'],
        requestBody: 'streaming',
        fetch: (request) => uploadRoute(ctx, settings, request),
      }),
    'workspace-upload: upload route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: DIRECTORY_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => directoryRoute(ctx, request),
      }),
    'workspace-upload: directory route',
  );
}

/**
 * Create one workspace-relative directory, keeping an uploaded folder's shape.
 * @param {object} ctx - Host root Context.
 * @param {Request} request - admitted owner Fetch request.
 * @returns {Promise<Response>} the created directory or a structured failure.
 */
async function directoryRoute(ctx, request) {
  const params = new URL(request.url).searchParams;
  const sessionId = (params.get('sessionId') ?? '').trim();
  if (sessionId === '') return failure(400, 'invalid-session', 'sessionId is required');
  const directory = params.get('dir') ?? '';
  if (directory === '') return failure(400, 'invalid-directory', 'dir is required');
  if (directory.includes('\u0000')) return failure(400, 'invalid-directory', 'the directory name contains a NUL byte');

  const root = await workspaceRootOf(ctx, sessionId);
  if (!root.ok) return failure(root.status, root.code, root.message);

  try {
    const path = await prepareDirectory(root.path, directory);
    return Response.json(
      { ok: true, value: { path } },
      { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
    );
  } catch (error) {
    if (error instanceof UploadError) return failure(error.status, error.code, error.message);
    return failure(500, 'directory-failed', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Normalize the Loader row's config.
 * @param {unknown} config - raw config value.
 * @returns {{ maxUploadBytes: number, onConflict: 'rename' | 'overwrite' }} normalized settings.
 */
export function readSettings(config) {
  const raw = config !== null && typeof config === 'object' ? config : {};
  const candidate = raw.maxUploadBytes;
  const maxUploadBytes = typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
    ? Math.floor(candidate)
    : DEFAULT_MAX_UPLOAD_BYTES;
  return {
    maxUploadBytes,
    onConflict: raw.onConflict === 'overwrite' ? 'overwrite' : 'rename',
  };
}

/**
 * Answer one file upload.
 * @param {object} ctx - Host root Context.
 * @param {{ maxUploadBytes: number, onConflict: 'rename' | 'overwrite' }} settings - normalized settings.
 * @param {Request} request - admitted owner Fetch request.
 * @returns {Promise<Response>} the stored file, or a structured failure.
 */
async function uploadRoute(ctx, settings, request) {
  const essence = String(request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (essence !== 'application/octet-stream') {
    return refuse(request, 415, 'unsupported-media-type', 'content-type must be application/octet-stream');
  }

  const params = new URL(request.url).searchParams;
  const sessionId = (params.get('sessionId') ?? '').trim();
  if (sessionId === '') return refuse(request, 400, 'invalid-session', 'sessionId is required');

  let name;
  try {
    name = safeName(params.get('name') ?? '');
  } catch (error) {
    return refuse(request, 400, 'invalid-name', error instanceof Error ? error.message : String(error));
  }

  const directory = params.get('dir') ?? '';
  if (directory.includes('\u0000')) return refuse(request, 400, 'invalid-directory', 'the directory name contains a NUL byte');

  const root = await workspaceRootOf(ctx, sessionId);
  if (!root.ok) return refuse(request, root.status, root.code, root.message);

  let destination;
  try {
    destination = await prepareDirectory(root.path, directory);
  } catch (error) {
    if (error instanceof UploadError) return refuse(request, error.status, error.code, error.message);
    return refuse(request, 500, 'directory-failed', error instanceof Error ? error.message : String(error));
  }

  let written = 0;
  const temporary = join(destination, `${TEMP_PREFIX}${randomBytes(8).toString('hex')}.part`);
  try {
    written = await receiveBody(request, temporary, settings.maxUploadBytes);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    if (error instanceof UploadError) return failure(error.status, error.code, error.message);
    if (request.signal.aborted) return failure(499, 'request-aborted', 'the upload was cancelled');
    return failure(500, 'upload-failed', error instanceof Error ? error.message : String(error));
  }

  try {
    const stored = await publish(temporary, destination, name, settings.onConflict);
    return Response.json(
      {
        ok: true,
        value: {
          name: stored.name,
          path: stored.path,
          bytes: written,
          replaced: stored.replaced,
        },
      },
      {
        headers: {
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      },
    );
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    if (error instanceof UploadError) return failure(error.status, error.code, error.message);
    return failure(500, 'publish-failed', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Resolve the Session's effective workspace directory without activating an Agent.
 * @param {object} ctx - Host root Context.
 * @param {string} sessionId - Session identity from the request.
 * @returns {Promise<{ ok: true, path: string } | { ok: false, status: number, code: string, message: string }>}
 *   the directory, or why it is unavailable.
 */
async function workspaceRootOf(ctx, sessionId) {
  const workingDirectory = ctx.get('workingDirectory');
  if (workingDirectory === undefined) {
    return { ok: false, status: 503, code: 'working-directory-unavailable', message: 'the working-directory service is not mounted' };
  }

  const sessionQuery = ctx.get('sessionQuery');
  if (sessionQuery !== undefined) {
    try {
      const path = await sessionQuery.inspectSession(sessionId, (session) => workingDirectory.get(session));
      if (typeof path === 'string' && path !== '') return { ok: true, path };
    } catch (error) {
      // An unknown or unreadable Session is the common case here; fall through to
      // the live store before reporting it, so a just-opened Session still works.
    }
  }

  const session = ctx.get('sessions')?.get(sessionId);
  if (session !== undefined) {
    try {
      const path = workingDirectory.get(session);
      if (typeof path === 'string' && path !== '') return { ok: true, path };
    } catch (error) {
      return { ok: false, status: 500, code: 'working-directory-failed', message: error instanceof Error ? error.message : String(error) };
    }
  }

  return { ok: false, status: 404, code: 'session-unavailable', message: `Session ${sessionId} has no readable working directory` };
}

/**
 * Resolve and create the destination directory inside the workspace root.
 * @param {string} root - the Session's workspace directory.
 * @param {string} directory - workspace-relative directory, empty for the root itself.
 * @returns {Promise<string>} the canonical destination directory.
 * @throws {UploadError} when the directory escapes the workspace or cannot be created.
 */
async function prepareDirectory(root, directory) {
  const rootAbsolute = resolve(root);
  let rootCanonical;
  try {
    rootCanonical = await realpath(rootAbsolute);
  } catch (error) {
    throw new UploadError(404, 'workspace-unavailable', `the workspace directory is not readable: ${messageOf(error)}`);
  }

  const requested = resolve(rootCanonical, directory === '' ? '.' : directory);
  if (!within(rootCanonical, requested)) {
    throw new UploadError(400, 'path-outside-workspace', 'the destination directory is outside the workspace');
  }

  try {
    await mkdir(requested, { recursive: true });
  } catch (error) {
    throw new UploadError(500, 'directory-failed', `the destination directory could not be created: ${messageOf(error)}`);
  }

  // Creating through a symbolic link would escape the fence, so containment is
  // re-checked against the canonical directory that will actually receive bytes.
  let canonical;
  try {
    canonical = await realpath(requested);
  } catch (error) {
    throw new UploadError(500, 'directory-failed', `the destination directory is not readable: ${messageOf(error)}`);
  }
  if (!within(rootCanonical, canonical)) {
    throw new UploadError(400, 'path-outside-workspace', 'the destination directory links outside the workspace');
  }
  return canonical;
}

/**
 * Stream the request body into one hidden temporary file.
 * @param {Request} request - request owning the body and its cancellation.
 * @param {string} temporary - absolute path of the temporary file.
 * @param {number} maxBytes - inclusive byte cap for the body.
 * @returns {Promise<number>} the number of bytes written.
 * @throws {UploadError} when the body exceeds the cap.
 */
async function receiveBody(request, temporary, maxBytes) {
  if (request.body === null) {
    // An empty file is a legitimate upload: it publishes a zero-byte file.
    await writeFile(temporary, new Uint8Array(0), { flag: 'wx' });
    return 0;
  }

  let written = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      written += chunk.length;
      if (written > maxBytes) {
        callback(new UploadError(413, 'too-large', `the file exceeds the ${maxBytes}-byte upload limit`));
        return;
      }
      callback(null, chunk);
    },
  });

  const source = Readable.fromWeb(request.body);
  await pipeline(source, counter, createWriteStream(temporary, { flags: 'wx' }), { signal: request.signal });
  return written;
}

/**
 * Publish the temporary file under the requested name.
 * @param {string} temporary - absolute path of the completed temporary file.
 * @param {string} directory - canonical destination directory.
 * @param {string} name - requested file name, already validated.
 * @param {'rename' | 'overwrite'} onConflict - what to do when the name is taken.
 * @returns {Promise<{ name: string, path: string, replaced: boolean }>} the stored name and path.
 * @throws {UploadError} when no publishable name exists.
 */
async function publish(temporary, directory, name, onConflict) {
  const first = join(directory, name);
  const existing = await lstat(first).catch(() => undefined);

  if (existing === undefined) {
    try {
      await place(temporary, first, false);
      return { name, path: first, replaced: false };
    } catch (error) {
      // A concurrent upload took the name after this request observed it free;
      // fall through to the alternative-name search below.
      if (!(error instanceof UploadError) || error.code !== 'name-conflict') throw error;
    }
  } else if (onConflict === 'overwrite') {
    if (existing.isSymbolicLink()) throw new UploadError(409, 'symlink-target', 'the destination name is a symbolic link');
    if (existing.isDirectory()) throw new UploadError(409, 'directory-target', 'the destination name is a directory');
    await place(temporary, first, true);
    return { name, path: first, replaced: true };
  }

  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = `${stem} (${attempt})${extension}`;
    const path = join(directory, candidate);
    const taken = await lstat(path).catch(() => undefined);
    if (taken !== undefined) continue;
    try {
      await place(temporary, path, false);
      return { name: candidate, path, replaced: false };
    } catch (error) {
      if (error instanceof UploadError && error.code === 'name-conflict') continue;
      throw error;
    }
  }
  throw new UploadError(409, 'name-unavailable', 'no free name is available for this file');
}

/**
 * Move the temporary file to its final path.
 * @param {string} temporary - absolute path of the temporary file.
 * @param {string} target - absolute final path.
 * @param {boolean} replace - whether an existing target may be replaced.
 * @returns {Promise<void>} resolves once the file is published.
 * @throws {UploadError} `name-conflict` when a create-if-absent publication lost a race.
 */
async function place(temporary, target, replace) {
  if (replace) {
    await rename(temporary, target);
    return;
  }
  // A hard link publishes without replacing, so a concurrent upload cannot
  // silently overwrite the file this request observed as absent.
  for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt += 1) {
    try {
      await link(temporary, target);
      await rm(temporary, { force: true });
      return;
    } catch (error) {
      if (error?.code === 'EEXIST') throw new UploadError(409, 'name-conflict', 'the file name is already taken');
      if (error?.code !== 'EPERM' && error?.code !== 'ENOTSUP' && error?.code !== 'EOPNOTSUPP') throw error;
      // Filesystems without hard links fall back to an atomic rename after a
      // fresh existence check; the race window is the same as a plain rename.
      const existing = await lstat(target).catch(() => undefined);
      if (existing !== undefined) throw new UploadError(409, 'name-conflict', 'the file name is already taken');
      await rename(temporary, target);
      return;
    }
  }
  throw new UploadError(500, 'publish-failed', 'the file could not be published');
}

/**
 * Validate one browser-supplied file name.
 * @param {string} value - raw `name` query parameter.
 * @returns {string} the accepted name.
 * @throws {Error} when the name is empty, too long, or contains a separator or control character.
 */
export function safeName(value) {
  if (typeof value !== 'string' || value === '') throw new Error('a file name is required');
  const name = value.normalize('NFC');
  if (name === '.' || name === '..') throw new Error('the file name is not usable');
  if (name.length > MAX_NAME_LENGTH) throw new Error(`the file name exceeds ${MAX_NAME_LENGTH} characters`);
  if (name.includes('/') || name.includes('\\')) throw new Error('the file name must not contain a path separator');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('the file name must not contain control characters');
  if (basename(name) !== name) throw new Error('the file name must not contain a path');
  return name;
}

/**
 * Test whether one canonical path is the root or inside it.
 * @param {string} root - canonical root directory.
 * @param {string} candidate - canonical candidate path.
 * @returns {boolean} true when the candidate is contained.
 */
function within(root, candidate) {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * Extract a readable message from an unknown failure.
 * @param {unknown} error - the thrown value.
 * @returns {string} the message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Refuse an upload whose body was never read, stopping the browser's stream too.
 * @param {Request} request - request owning the body.
 * @param {number} status - HTTP status.
 * @param {string} code - stable failure code.
 * @param {string} message - human-readable failure text.
 * @returns {Promise<Response>} JSON failure.
 */
async function refuse(request, status, code, message) {
  try {
    await request.body?.cancel();
  } catch {
    // A body that is already closed or errored needs no further cancellation.
  }
  return failure(status, code, message);
}

/**
 * Answer one structured failure.
 * @param {number} status - HTTP status.
 * @param {string} code - stable failure code.
 * @param {string} message - human-readable failure text.
 * @returns {Response} JSON failure.
 */
function failure(status, code, message) {
  return Response.json(
    { code, message },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}

