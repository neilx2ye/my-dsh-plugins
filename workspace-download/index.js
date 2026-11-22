/**
 * Host half of the workspace download bundle.
 *
 * Two owner-only routes read the execution device on behalf of the browser:
 * one streams a single file with a download disposition, the other streams a
 * ZIP of a directory. Both answer HEAD with the same status and headers, so the
 * browser half can report a refused download before starting it.
 *
 * A file route accepts any absolute path, matching the preview surface that can
 * already display files outside a workspace. A directory archive is fenced
 * inside the Session's workspace root, because walking an arbitrary directory
 * on the owner's machine is not something this feature offers.
 */

import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, sep } from 'node:path';
import { Readable } from 'node:stream';

/** Services this bundle needs from the Web Host composition. */
export const inject = ['connection'];

/** Exact Fetch route streaming one file as an attachment. */
const FILE_PATH = '/api/workspace-download/file';

/** Exact Fetch route streaming a directory as a ZIP attachment. */
const ZIP_PATH = '/api/workspace-download/zip';

/** Exact Fetch route reporting the archive limits to the browser. */
const LIMITS_PATH = '/api/workspace-download/limits';

/** Files up to this size are read once into memory while their CRC is computed. */
const SMALL_FILE_BYTES = 8 * 1024 * 1024;

/** Default number of archive entries one ZIP may contain. */
const DEFAULT_MAX_ENTRIES = 20000;

/** Default uncompressed byte cap for one ZIP archive (2 GiB). */
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

/** Directory names left out of a workspace archive by default. */
const DEFAULT_EXCLUDE = ['.git', 'node_modules'];

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

/**
 * A failure that maps onto one HTTP status.
 */
class DownloadError extends Error {
  /**
   * @param {number} status - HTTP status to answer.
   * @param {string} code - stable machine-readable failure code.
   * @param {string} message - human-readable failure text.
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'DownloadError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Register the file and archive routes.
 * @param {object} ctx - Host root Context.
 * @param {unknown} config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config);

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: FILE_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request) => fileRoute(ctx, request),
      }),
    'workspace-download: file route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LIMITS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: () => Response.json(
          { maxEntries: settings.maxEntries, maxTotalBytes: settings.maxTotalBytes },
          { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
        ),
      }),
    'workspace-download: limits route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ZIP_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request) => zipRoute(ctx, settings, request),
      }),
    'workspace-download: zip route',
  );
}

/**
 * Normalize the Loader row's config.
 * @param {unknown} config - raw config value.
 * @returns {{ maxEntries: number, maxTotalBytes: number, exclude: string[] }} normalized settings.
 */
export function readSettings(config) {
  const raw = config !== null && typeof config === 'object' ? config : {};
  const entries = raw.maxEntries;
  const bytes = raw.maxTotalBytes;
  const excluded = Array.isArray(raw.exclude)
    ? raw.exclude.filter((name) => typeof name === 'string' && name !== '' && !name.includes('/') && !name.includes('\\'))
    : undefined;
  return {
    // A classic ZIP stores the entry count in 16 bits.
    maxEntries: Number.isFinite(entries) && entries > 0
      ? Math.min(Math.floor(entries), 65534)
      : DEFAULT_MAX_ENTRIES,
    // A classic ZIP stores sizes in 32-bit fields; keep the cap below that limit.
    maxTotalBytes: Number.isFinite(bytes) && bytes > 0
      ? Math.min(Math.floor(bytes), 0xFFFFFFFF - 0x10000)
      : DEFAULT_MAX_TOTAL_BYTES,
    exclude: excluded ?? [...DEFAULT_EXCLUDE],
  };
}

/**
 * Answer one single-file download.
 * @param {object} ctx - Host root Context.
 * @param {Request} request - admitted owner Fetch request.
 * @returns {Promise<Response>} streamed bytes or a structured failure.
 */
async function fileRoute(ctx, request) {
  const params = new URL(request.url).searchParams;
  const path = params.get('path') ?? '';
  if (path === '') return failure(request, 400, 'invalid-path', 'path is required');
  if (path.includes('\u0000') || !isAbsolute(path)) {
    return failure(request, 400, 'invalid-path', 'path must be an absolute path without NUL bytes');
  }

  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    return failure(request, 404, 'file-unavailable', `the file is not readable: ${messageOf(error)}`);
  }
  if (info.isSymbolicLink()) {
    try {
      info = await stat(path);
    } catch (error) {
      return failure(request, 404, 'file-unavailable', `the file is not readable: ${messageOf(error)}`);
    }
  }
  if (!info.isFile()) return failure(request, 403, 'not-a-regular-file', 'the path is not a regular file');

  const headers = {
    'content-type': 'application/octet-stream',
    'content-length': String(info.size),
    'content-disposition': attachment(basename(path)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (request.method === 'HEAD') return new Response(null, { headers });

  try {
    const stream = createReadStream(path);
    return new Response(Readable.toWeb(stream), { headers });
  } catch (error) {
    return failure(request, 500, 'read-failed', messageOf(error));
  }
}

/**
 * Answer one directory archive download.
 * @param {object} ctx - Host root Context.
 * @param {{ maxEntries: number, maxTotalBytes: number, exclude: string[] }} settings - normalized settings.
 * @param {Request} request - admitted owner Fetch request.
 * @returns {Promise<Response>} streamed ZIP bytes or a structured failure.
 */
async function zipRoute(ctx, settings, request) {
  const params = new URL(request.url).searchParams;
  const sessionId = (params.get('sessionId') ?? '').trim();
  if (sessionId === '') return failure(request, 400, 'invalid-session', 'sessionId is required');
  const path = params.get('path') ?? '';
  if (path === '') return failure(request, 400, 'invalid-path', 'path is required');
  if (path.includes('\u0000') || !isAbsolute(path)) {
    return failure(request, 400, 'invalid-path', 'path must be an absolute path without NUL bytes');
  }

  const root = await workspaceRootOf(ctx, sessionId);
  if (!root.ok) return failure(request, root.status, root.code, root.message);

  let target;
  let canonical;
  let realRoot;
  try {
    realRoot = await realpath(root.path);
    canonical = await realpath(path);
    target = await stat(canonical);
  } catch (error) {
    return failure(request, 404, 'directory-unavailable', `the directory is not readable: ${messageOf(error)}`);
  }
  if (!within(realRoot, canonical)) {
    return failure(request, 403, 'path-outside-workspace', 'the directory is outside the workspace');
  }
  if (!target.isDirectory()) return failure(request, 403, 'not-a-directory', 'the path is not a directory');

  let archive;
  try {
    archive = await collectArchive(canonical, settings);
  } catch (error) {
    if (error instanceof DownloadError) return failure(request, error.status, error.code, error.message);
    return failure(request, 500, 'archive-failed', messageOf(error));
  }

  const archiveName = basename(canonical);
  const headers = {
    'content-type': 'application/octet-stream',
    // The plan knows the exact length, so the download manager can show progress.
    'content-length': String(archive.planBytes),
    'content-disposition': attachment(archiveName.endsWith('.zip') ? archiveName : `${archiveName}.zip`),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (request.method === 'HEAD') return new Response(null, { headers });

  const stream = Readable.toWeb(Readable.from(zipChunks(archive)));
  return new Response(stream, { headers });
}

/**
 * Collect the archive entries of one directory, enforcing the configured limits.
 * @param {string} directory - canonical directory to archive.
 * @param {{ maxEntries: number, maxTotalBytes: number, exclude: string[] }} settings - normalized settings.
 * @returns {Promise<{ prefix: string, entries: object[], totalBytes: number }>} archive plan.
 * @throws {DownloadError} when the archive would exceed a limit.
 */
async function collectArchive(directory, settings) {
  const excluded = new Set(settings.exclude);
  const prefix = basename(directory);
  const entries = [];
  let totalBytes = 0;

  const addDirectory = (name) => {
    entries.push({ kind: 'dir', name });
    if (entries.length > settings.maxEntries) {
      throw new DownloadError(413, 'too-many-entries', `the archive exceeds ${settings.maxEntries} entries`);
    }
  };
  const addFile = (entry) => {
    totalBytes += entry.size;
    entries.push({ kind: 'file', ...entry });
    if (entries.length > settings.maxEntries) {
      throw new DownloadError(413, 'too-many-entries', `the archive exceeds ${settings.maxEntries} entries`);
    }
    if (totalBytes > settings.maxTotalBytes) {
      throw new DownloadError(413, 'too-large', `the archive exceeds ${settings.maxTotalBytes} bytes`);
    }
  };

  addDirectory(`${prefix}/`);
  const walk = async (current, relative) => {
    let children;
    try {
      children = await readdir(current, { withFileTypes: true });
    } catch (error) {
      throw new DownloadError(500, 'archive-failed', `a directory could not be listed: ${messageOf(error)}`);
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (excluded.has(child.name) || child.name.startsWith('.dsh-upload-')) continue;
      const full = join(current, child.name);
      const name = `${relative}${child.name}`;
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        addDirectory(`${prefix}/${name}/`);
        await walk(full, `${name}/`);
      } else if (child.isFile()) {
        let info;
        try {
          info = await stat(full);
        } catch (error) {
          throw new DownloadError(500, 'archive-failed', `a file could not be read: ${messageOf(error)}`);
        }
        addFile({ name: `${prefix}/${name}`, path: full, size: info.size, mtime: info.mtime });
      }
    }
  };
  await walk(directory, '');
  const planBytes = archivePlanBytes(entries);
  if (planBytes > 0xFFFFFFFF) {
    throw new DownloadError(413, 'too-large', 'the archive would exceed the classic ZIP size limit');
  }
  return { prefix, entries, totalBytes, planBytes };
}

/**
 * Exact byte size of the archive this plan produces.
 * @param {object[]} entries - archive entries with names and sizes.
 * @returns {number} local headers, data, central directory, and the end record.
 */
export function archivePlanBytes(entries) {
  let total = 22;
  for (const entry of entries) {
    const nameLength = Buffer.byteLength(entry.name, 'utf8');
    total += 30 + nameLength;
    total += entry.kind === 'file' ? entry.size : 0;
    total += 46 + nameLength;
  }
  return total;
}

/**
 * Stream one ZIP archive for the collected plan.
 * @param {{ prefix: string, entries: object[], totalBytes: number }} archive - archive plan.
 * @returns {AsyncGenerator<Buffer>} ZIP chunks in order.
 */
async function* zipChunks(archive) {
  let offset = 0;
  for (const entry of archive.entries) {
    const stamp = dosTimestamp(entry.kind === 'file' ? entry.mtime : undefined);
    entry.dosTime = stamp.time;
    entry.dosDate = stamp.date;
    if (entry.kind === 'dir') {
      entry.crc = 0;
      entry.offset = offset;
      const header = localHeader(entry, 0, 0);
      yield header;
      offset += header.length;
      continue;
    }
    let info;
    try {
      info = await stat(entry.path);
    } catch (error) {
      throw new DownloadError(409, 'file-changed', `a file changed while it was being archived: ${messageOf(error)}`);
    }
    if (info.size !== entry.size || (entry.mtime instanceof Date && info.mtime.getTime() !== entry.mtime.getTime())) {
      throw new DownloadError(409, 'file-changed', 'a file changed while it was being archived');
    }
    const { crc, bytes } = await checksum(entry.path, entry.size);
    if (bytes !== undefined && bytes.length !== entry.size) {
      throw new DownloadError(409, 'file-changed', 'a file changed while it was being archived');
    }
    entry.crc = crc;
    entry.offset = offset;
    const header = localHeader(entry, crc, entry.size);
    yield header;
    offset += header.length;
    if (bytes !== undefined) {
      yield bytes;
      offset += bytes.length;
      continue;
    }
    let copied = 0;
    let running = 0xFFFFFFFF;
    for await (const chunk of createReadStream(entry.path)) {
      copied += chunk.length;
      if (copied > entry.size) {
        throw new DownloadError(409, 'file-changed', 'a file changed while it was being archived');
      }
      running = crc32Update(running, chunk);
      yield chunk;
      offset += chunk.length;
    }
    if (copied !== entry.size || ((running ^ 0xFFFFFFFF) >>> 0) !== crc) {
      throw new DownloadError(409, 'file-changed', 'a file changed while it was being archived');
    }
  }

  let centralSize = 0;
  for (const entry of archive.entries) {
    const header = centralHeader(entry);
    yield header;
    centralSize += header.length;
  }
  yield endRecord(archive.entries.length, centralSize, offset);
}

/**
 * Compute one file's CRC-32, reading it fully only when it is small.
 * @param {string} path - file path.
 * @param {number} size - declared byte size.
 * @returns {Promise<{ crc: number, bytes?: Buffer }>} checksum and small-file bytes.
 */
async function checksum(path, size) {
  if (size <= SMALL_FILE_BYTES) {
    const bytes = await readFile(path);
    return { crc: crc32(bytes), bytes };
  }
  let crc = 0xFFFFFFFF;
  for await (const chunk of createReadStream(path)) crc = crc32Update(crc, chunk);
  return { crc: (crc ^ 0xFFFFFFFF) >>> 0 };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * Fold bytes into a running CRC-32.
 * @param {number} crc - running value (pre-inverted).
 * @param {Uint8Array} bytes - next chunk.
 * @returns {number} the updated pre-inverted value.
 */
function crc32Update(crc, bytes) {
  let value = crc;
  for (let index = 0; index < bytes.length; index += 1) value = CRC_TABLE[(value ^ bytes[index]) & 0xFF] ^ (value >>> 8);
  return value >>> 0;
}

/**
 * Compute the CRC-32 of one buffer.
 * @param {Uint8Array} bytes - complete bytes.
 * @returns {number} the checksum.
 */
function crc32(bytes) {
  return (crc32Update(0xFFFFFFFF, bytes) ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Build one local file header.
 * @param {object} entry - archive entry.
 * @param {number} crc - checksum.
 * @param {number} size - uncompressed size.
 * @returns {Buffer} the header.
 */
function localHeader(entry, crc, size) {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(entry.dosTime, 10);
  header.writeUInt16LE(entry.dosDate, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

/**
 * Build one central directory header.
 * @param {object} entry - archive entry.
 * @returns {Buffer} the header.
 */
function centralHeader(entry) {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(46 + name.length);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc ?? 0, 16);
  header.writeUInt32LE(entry.kind === 'dir' ? 0 : entry.size, 20);
  header.writeUInt32LE(entry.kind === 'dir' ? 0 : entry.size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(entry.kind === 'dir' ? 0x10 : 0, 38);
  header.writeUInt32LE(entry.offset, 42);
  name.copy(header, 46);
  return header;
}

/**
 * Build the end-of-central-directory record.
 * @param {number} count - entry count.
 * @param {number} centralSize - central directory byte size.
 * @param {number} centralOffset - central directory start offset.
 * @returns {Buffer} the record.
 */
function endRecord(count, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_SIGNATURE, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

/**
 * Convert an instant to the DOS date/time pair used by ZIP.
 * @param {Date | undefined} date - modification time, or now.
 * @returns {{ time: number, date: number }} the two packed fields.
 */
function dosTimestamp(date) {
  const value = date instanceof Date && Number.isFinite(date.valueOf()) ? date : new Date();
  const year = Math.min(2107, Math.max(1980, value.getFullYear()));
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

/**
 * Build one download disposition header value.
 * @param {string} name - suggested file name.
 * @returns {string} the header value.
 */
export function attachment(name) {
  // Header-safe ASCII fallback plus the exact UTF-8 name for modern browsers.
  const ascii = name.replace(/[^\u0020-\u007e]/gu, '_').replace(/["\\]/gu, '_');
  // RFC 5987 attr-char excludes ' ( ) *, which encodeURIComponent leaves alone.
  const encoded = encodeURIComponent(name).replace(/['()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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
      // Unknown or unreadable Sessions fall through to the live store below.
    }
  }

  const session = ctx.get('sessions')?.get(sessionId);
  if (session !== undefined) {
    try {
      const path = workingDirectory.get(session);
      if (typeof path === 'string' && path !== '') return { ok: true, path };
    } catch (error) {
      return { ok: false, status: 500, code: 'working-directory-failed', message: messageOf(error) };
    }
  }

  return { ok: false, status: 404, code: 'session-unavailable', message: `Session ${sessionId} has no readable working directory` };
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
 * Answer one structured failure, stopping an unread request body too.
 * @param {Request} request - request whose body was not consumed.
 * @param {number} status - HTTP status.
 * @param {string} code - stable failure code.
 * @param {string} message - human-readable failure text.
 * @returns {Response} JSON failure.
 */
function failure(request, status, code, message) {
  if (request.body !== null) void request.body.cancel().catch(() => {});
  return Response.json(
    { code, message },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        // HEAD carries no body, so the browser half reads the code here.
        'x-workspace-download-code': code,
      },
    },
  );
}