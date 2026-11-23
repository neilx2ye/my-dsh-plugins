/**
 * Cache discovery, sizing, and cleanup across DSH homes.
 *
 * One DSH home (`$DSH_HOME`, normally `<user home>/.dsh`) owns three kinds of
 * disposable data on this machine:
 *
 * - `sessions/<project>/<session>/` — one append-only log per conversation.
 * - `storages/session_projcache/sessions/<id>.json` — projection checkpoints
 *   derived from those logs.
 * - `storages/artifacts/<workspace>/<artifact>/` — the canvas documents kept by
 *   `@local/dsh-artifacts`.
 *
 * A cleanup must never pull a log out from under a running writer: the JSONL
 * backend keeps one handle open for every live Session, so the process file
 * table identifies live session directories without touching the files. On
 * Linux `/proc/<pid>/fd` is readable for every account when this process is
 * root; when the table cannot be read the session target is refused rather than
 * guessed. Canvas documents are plain files with no writer handle, so their
 * target does not depend on that detection.
 *
 * This module owns no plugin state: the Host route and the agent tool both call
 * the same functions here.
 */

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Directory holding every session log under one DSH home. */
export const SESSIONS_DIR = 'sessions';
/** Directory holding every storage domain under one DSH home. */
export const STORAGES_DIR = 'storages';
/** Projection checkpoint directory, relative to one DSH home. */
export const PROJECTION_DIR = path.join(STORAGES_DIR, 'session_projcache', 'sessions');
/** Canvas artifact directory, relative to one DSH home. */
export const ARTIFACTS_DIR = path.join(STORAGES_DIR, 'artifacts');
/** Cleanup targets accepted by {@link cleanAll}. */
export const CLEAN_TARGETS = Object.freeze(['sessions', 'canvas']);
/** Longest `extraHomes` entry accepted, in entries. */
const MAX_EXTRA_HOMES = 32;
/** Longest skip/failure list returned to a caller. */
const MAX_REPORTED_ITEMS = 50;

/** Values the Loader row may override. */
export const DEFAULT_CONFIG = Object.freeze({
  extraHomes: Object.freeze([]),
  minAgeMinutes: 0,
});

/**
 * Turn a thrown value into one line of text.
 * @param {unknown} error - thrown value.
 * @returns a message.
 */
export function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Expand a leading `~` and resolve the result to an absolute path.
 * @param {string} value - configured path.
 * @returns an absolute path.
 */
export function expandHome(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('cache-cleaner: every extraHomes entry must be a non-empty string');
  }
  const trimmed = value.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(trimmed);
}

/**
 * The DSH home of the process this plugin runs in.
 * @returns an absolute path.
 */
export function currentDshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return configured === '' ? path.join(os.homedir(), '.dsh') : path.resolve(configured);
}

/**
 * Validate the Loader row's config.
 * @param {unknown} raw - the row's `config` value.
 * @returns normalized settings.
 */
export function readConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const extra = source.extraHomes ?? [];
  if (!Array.isArray(extra) || extra.length > MAX_EXTRA_HOMES) {
    throw new Error(`cache-cleaner: config.extraHomes must be an array of at most ${MAX_EXTRA_HOMES} paths`);
  }
  const extraHomes = extra.map(expandHome);
  const minAgeMinutes = source.minAgeMinutes ?? 0;
  if (!Number.isInteger(minAgeMinutes) || minAgeMinutes < 0 || minAgeMinutes > 525_600) {
    throw new Error('cache-cleaner: config.minAgeMinutes must be an integer between 0 and 525600');
  }
  return { extraHomes, minAgeMinutes };
}

/**
 * A short account label for one DSH home path.
 * @param {string} homePath - absolute `.dsh` directory.
 * @returns the account name, or the directory's own name.
 */
export function ownerOf(homePath) {
  const parent = path.dirname(homePath);
  if (parent === '/root') return 'root';
  if (parent.startsWith('/home/')) return path.basename(parent);
  return path.basename(parent) || homePath;
}

/**
 * Read one candidate home's access state without failing discovery.
 * @param {string} homePath - absolute `.dsh` directory.
 * @param {boolean} required - whether a missing directory is an error.
 * @returns the home descriptor.
 */
async function describeHome(homePath, required) {
  const descriptor = {
    path: homePath,
    owner: ownerOf(homePath),
    exists: false,
    available: false,
    writable: false,
    error: null,
  };
  let stats;
  try {
    stats = await fs.stat(homePath);
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT' && !required) return null;
    descriptor.error = messageOf(error);
    return descriptor;
  }
  if (!stats.isDirectory()) {
    descriptor.error = 'not a directory';
    return descriptor;
  }
  descriptor.exists = true;
  try {
    await fs.access(homePath, constants.R_OK);
    descriptor.available = true;
  } catch (error) {
    descriptor.error = messageOf(error);
    return descriptor;
  }
  try {
    await fs.access(homePath, constants.W_OK);
    descriptor.writable = true;
  } catch {
    // Readable but not writable: listing works and cleanup reports failures.
  }
  return descriptor;
}

/**
 * List every DSH home this process should consider: this instance's own home,
 * `/root/.dsh`, every `/home/<account>/.dsh`, then configured extra homes.
 * @param {{ extraHomes?: string[], currentHome?: string }} [options] - discovery input.
 * @returns every distinct home, current one first.
 */
export async function discoverHomes(options = {}) {
  const currentHome = path.resolve(options.currentHome ?? currentDshHome());
  const extraHomes = options.extraHomes ?? [];
  const candidates = [];
  const explicit = new Set();
  const add = (value, required) => {
    if (typeof value !== 'string' || value === '') return;
    candidates.push({ path: path.resolve(value), required });
  };
  add(currentHome, false);
  add(path.join(os.homedir(), '.dsh'), false);
  add('/root/.dsh', false);
  try {
    const accounts = await fs.readdir('/home', { withFileTypes: true });
    for (const account of accounts) {
      if (account.isDirectory()) add(path.join('/home', account.name, '.dsh'), false);
    }
  } catch {
    // No /home directory is a valid single-account machine.
  }
  for (const value of extraHomes) {
    const expanded = expandHome(value);
    explicit.add(expanded);
    add(expanded, true);
  }
  const seen = new Set();
  const homes = [];
  for (const candidate of candidates) {
    let identity;
    try {
      identity = await fs.realpath(candidate.path);
    } catch {
      identity = candidate.path;
    }
    if (seen.has(identity)) continue;
    seen.add(identity);
    const home = await describeHome(candidate.path, candidate.required || explicit.has(candidate.path));
    if (home === null) continue;
    home.current = candidate.path === currentHome;
    homes.push(home);
  }
  homes.sort((left, right) => Number(right.current) - Number(left.current) || left.path.localeCompare(right.path));
  return homes;
}

/**
 * Read the process file table and keep only paths inside the given roots.
 *
 * Every live Session's JSONL handle keeps its log (and lock) open, so a path
 * under `sessions/<project>/<session>/` identifies a session directory that
 * must not be removed. Unreadable process entries are skipped; the returned
 * `available` flag says whether `/proc` could be read at all.
 *
 * @param {readonly string[]} roots - absolute directories to watch.
 * @returns `{ available, paths }`, where `paths` maps a path to the pids holding it.
 */
export async function collectOpenPaths(roots) {
  const watched = [...new Set(roots.map((root) => path.resolve(root)))];
  const result = { available: false, restricted: false, paths: new Map() };
  if (process.platform !== 'linux' || watched.length === 0) return result;
  let entries;
  try {
    entries = await fs.readdir('/proc');
  } catch {
    return result;
  }
  result.available = true;
  let denied = 0;
  const pids = entries.filter((name) => /^\d+$/.test(name));
  /** @param {string} target - an absolute fd target. */
  const watches = (target) => watched.some((root) => target === root || target.startsWith(`${root}${path.sep}`));
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= pids.length) return;
      const pid = Number(pids[index]);
      let fds;
      try {
        fds = await fs.readdir(`/proc/${pid}/fd`);
      } catch (error) {
        if (error !== null && typeof error === 'object' && (error.code === 'EACCES' || error.code === 'EPERM')) denied += 1;
        continue;
      }
      for (const fd of fds) {
        let target;
        try {
          target = await fs.readlink(`/proc/${pid}/fd/${fd}`);
        } catch (error) {
          if (error !== null && typeof error === 'object' && (error.code === 'EACCES' || error.code === 'EPERM')) denied += 1;
          continue;
        }
        if (!target.startsWith('/')) continue;
        const plain = target.endsWith(' (deleted)') ? target.slice(0, -' (deleted)'.length) : target;
        if (!watches(plain)) continue;
        let owners = result.paths.get(plain);
        if (owners === undefined) {
          owners = new Set();
          result.paths.set(plain, owners);
        }
        owners.add(pid);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, pids.length) }, worker));
  result.restricted = denied > 0;
  return result;
}

/**
 * Sum every regular file under one directory; symbolic links are not followed.
 * @param {string} dir - absolute directory.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns byte and file totals.
 */
async function treeSize(dir, signal) {
  const total = { bytes: 0, files: 0, mtimeMs: 0 };
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return total;
    throw error;
  }
  for (const entry of entries) {
    signal?.throwIfAborted?.();
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await treeSize(full, signal);
      total.bytes += nested.bytes;
      total.files += nested.files;
      total.mtimeMs = Math.max(total.mtimeMs, nested.mtimeMs);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.lstat(full);
        if (stat.isFile()) {
          total.bytes += stat.size;
          total.files += 1;
          if (entry.name !== 'session.lock') total.mtimeMs = Math.max(total.mtimeMs, stat.mtimeMs);
        }
      } catch {
        // A file removed mid-walk contributes nothing.
      }
    }
  }
  if (total.mtimeMs === 0) {
    try {
      total.mtimeMs = (await fs.stat(dir)).mtimeMs;
    } catch {
      // A directory removed mid-walk contributes no activity time.
    }
  }
  return total;
}

/**
 * Find the pids holding a session directory open.
 * @param {string} dir - session directory.
 * @param {Map<string, Set<number>>} openPaths - process file table.
 * @returns the owning pids.
 */
function livePidsFor(dir, openPaths) {
  const pids = new Set();
  const prefix = `${dir}${path.sep}`;
  for (const [openPath, owners] of openPaths) {
    if (openPath !== dir && !openPath.startsWith(prefix)) continue;
    for (const pid of owners) pids.add(pid);
  }
  return pids;
}

/**
 * Inspect one DSH home.
 * @param {object} home - a descriptor from {@link discoverHomes}.
 * @param {{ openPaths?: Map<string, Set<number>>, minAgeMinutes?: number, signal?: AbortSignal }} [options] - scan input.
 * @returns `{ report, entries }`; `entries` are the removable records behind the report.
 */
export async function inspectHome(home, options = {}) {
  const openPaths = options.openPaths instanceof Map ? options.openPaths : new Map();
  const minAgeMinutes = options.minAgeMinutes ?? 0;
  const signal = options.signal;
  const report = {
    path: home.path,
    owner: home.owner ?? ownerOf(home.path),
    current: home.current === true,
    exists: home.exists !== false,
    available: home.available !== false,
    writable: home.writable !== false,
    error: home.error ?? null,
    sessions: {
      root: path.join(home.path, SESSIONS_DIR),
      count: 0,
      liveCount: 0,
      recentCount: 0,
      projectCount: 0,
      bytes: 0,
      liveBytes: 0,
      recentBytes: 0,
      files: 0,
      error: null,
    },
    projectionCache: {
      root: path.join(home.path, PROJECTION_DIR),
      count: 0,
      liveCount: 0,
      bytes: 0,
      liveBytes: 0,
      files: 0,
      error: null,
    },
    canvas: {
      root: path.join(home.path, ARTIFACTS_DIR),
      count: 0,
      workspaceCount: 0,
      bytes: 0,
      files: 0,
      error: null,
    },
    bytes: 0,
  };
  const entries = { sessions: [], cache: [], artifacts: [], projectDirs: [], workspaceDirs: [] };
  if (!report.available) return { report, entries };
  const now = Date.now();
  const sessionRoot = report.sessions.root;

  let projects = [];
  try {
    projects = await fs.readdir(sessionRoot, { withFileTypes: true });
  } catch (error) {
    if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') {
      report.sessions.error = messageOf(error);
      report.error ??= `${sessionRoot}: ${report.sessions.error}`;
    }
  }
  for (const project of projects) {
    signal?.throwIfAborted?.();
    if (!project.isDirectory()) continue;
    const projectDir = path.join(sessionRoot, project.name);
    entries.projectDirs.push(projectDir);
    let sessions = [];
    try {
      sessions = await fs.readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const dir = path.join(projectDir, session.name);
      let size;
      try {
        size = await treeSize(dir, signal);
      } catch (error) {
        report.error ??= `${dir}: ${messageOf(error)}`;
        continue;
      }
      const pids = livePidsFor(dir, openPaths);
      const live = pids.size > 0;
      const recent = !live && minAgeMinutes > 0 && size.mtimeMs > 0 && now - size.mtimeMs < minAgeMinutes * 60_000;
      entries.sessions.push({
        dir,
        id: session.name,
        bytes: size.bytes,
        files: size.files,
        activityMs: size.mtimeMs,
        live,
        recent,
        pids: [...pids],
      });
      report.sessions.count += 1;
      report.sessions.bytes += size.bytes;
      report.sessions.files += size.files;
      if (live) {
        report.sessions.liveCount += 1;
        report.sessions.liveBytes += size.bytes;
      }
      if (recent) {
        report.sessions.recentCount += 1;
        report.sessions.recentBytes += size.bytes;
      }
    }
  }
  report.sessions.projectCount = entries.projectDirs.length;

  const liveIds = new Set(entries.sessions.filter((entry) => entry.live).map((entry) => entry.id));
  let cacheFiles = [];
  try {
    cacheFiles = await fs.readdir(report.projectionCache.root, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code !== 'ENOENT') {
      report.projectionCache.error = messageOf(error);
      report.error ??= `${report.projectionCache.root}: ${report.projectionCache.error}`;
    }
  }
  for (const item of cacheFiles) {
    signal?.throwIfAborted?.();
    if (!item.isFile()) continue;
    const file = path.join(report.projectionCache.root, item.name);
    let bytes = 0;
    try {
      bytes = (await fs.stat(file)).size;
    } catch {
      continue;
    }
    const isRecord = item.name.endsWith('.json');
    const id = item.name.replace(/\.json(?:\.bak\..*)?$/, '');
    const live = isRecord && liveIds.has(id);
    entries.cache.push({ path: file, id, bytes, live, bak: !isRecord });
    report.projectionCache.files += 1;
    report.projectionCache.bytes += bytes;
    if (isRecord) report.projectionCache.count += 1;
    if (live) {
      report.projectionCache.liveCount += 1;
      report.projectionCache.liveBytes += bytes;
    }
  }

  const artifactRoot = report.canvas.root;
  let workspaces = [];
  try {
    workspaces = await fs.readdir(artifactRoot, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code !== 'ENOENT') {
      report.canvas.error = messageOf(error);
      report.error ??= `${report.canvas.root}: ${report.canvas.error}`;
    }
  }
  for (const workspace of workspaces) {
    signal?.throwIfAborted?.();
    if (!workspace.isDirectory()) continue;
    const workspaceDir = path.join(artifactRoot, workspace.name);
    entries.workspaceDirs.push(workspaceDir);
    report.canvas.workspaceCount += 1;
    let artifacts = [];
    try {
      artifacts = await fs.readdir(workspaceDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const artifact of artifacts) {
      if (!artifact.isDirectory()) continue;
      const dir = path.join(workspaceDir, artifact.name);
      let size;
      try {
        size = await treeSize(dir, signal);
      } catch (error) {
        report.error ??= `${dir}: ${messageOf(error)}`;
        continue;
      }
      entries.artifacts.push({ dir, bytes: size.bytes, files: size.files });
      report.canvas.count += 1;
      report.canvas.bytes += size.bytes;
      report.canvas.files += size.files;
    }
  }

  report.bytes = report.sessions.bytes + report.projectionCache.bytes + report.canvas.bytes;
  return { report, entries };
}

/**
 * Sum a set of home reports.
 * @param {readonly object[]} reports - home reports.
 * @returns aggregate totals.
 */
export function totalsOf(reports) {
  const totals = {
    bytes: 0,
    sessions: 0,
    liveSessions: 0,
    recentSessions: 0,
    sessionBytes: 0,
    liveSessionBytes: 0,
    recentSessionBytes: 0,
    cacheRecords: 0,
    cacheBytes: 0,
    liveCacheBytes: 0,
    artifacts: 0,
    canvasBytes: 0,
  };
  for (const report of reports) {
    totals.bytes += report.bytes;
    totals.sessions += report.sessions.count;
    totals.liveSessions += report.sessions.liveCount;
    totals.recentSessions += report.sessions.recentCount;
    totals.sessionBytes += report.sessions.bytes;
    totals.liveSessionBytes += report.sessions.liveBytes;
    totals.recentSessionBytes += report.sessions.recentBytes;
    totals.cacheRecords += report.projectionCache.count;
    totals.cacheBytes += report.projectionCache.bytes;
    totals.liveCacheBytes += report.projectionCache.liveBytes;
    totals.artifacts += report.canvas.count;
    totals.canvasBytes += report.canvas.bytes;
  }
  return totals;
}

/**
 * Inspect every home and build the public report.
 * @param {readonly object[]} homes - home descriptors.
 * @param {{ openPaths?: Map<string, Set<number>>, minAgeMinutes?: number, signal?: AbortSignal }} [options] - scan input.
 * @returns `{ report, details }`.
 */
export async function inspectAll(homes, options = {}) {
  const sessionRoots = homes
    .filter((home) => home.available !== false)
    .map((home) => path.join(home.path, SESSIONS_DIR));
  const supplied = options.openPaths instanceof Map;
  const open = supplied
    ? { available: true, paths: options.openPaths }
    : await collectOpenPaths(sessionRoots);
  const details = [];
  for (const home of homes) {
    options.signal?.throwIfAborted?.();
    details.push(await inspectHome(home, {
      openPaths: open.paths,
      minAgeMinutes: options.minAgeMinutes ?? 0,
      signal: options.signal,
    }));
  }
  const reports = details.map((detail) => detail.report);
  const live = [];
  for (const detail of details) {
    for (const entry of detail.entries.sessions) {
      if (entry.live) live.push({ home: detail.report.path, path: entry.dir, sessionId: entry.id, pids: entry.pids });
    }
  }
  const report = {
    scannedAt: new Date().toISOString(),
    platform: process.platform,
    liveDetection: open.available ? (open.restricted ? 'proc-restricted' : 'proc') : 'unavailable',
    liveDetectionRestricted: open.restricted === true,
    homes: reports,
    totals: totalsOf(reports),
    liveCount: live.length,
    live: live.slice(0, MAX_REPORTED_ITEMS),
  };
  return { report, details };
}

/**
 * Keep at most `MAX_REPORTED_ITEMS` records in a caller-facing list.
 * @param {readonly object[]} list - full list.
 * @returns the bounded list.
 */
function bounded(list) {
  return list.slice(0, MAX_REPORTED_ITEMS);
}

/**
 * Normalize the requested cleanup targets.
 * @param {unknown} value - raw targets from a caller.
 * @returns the accepted targets, in canonical order.
 */
export function normalizeTargets(value) {
  if (value === undefined || value === null) return [...CLEAN_TARGETS];
  if (!Array.isArray(value)) throw new Error('targets must be an array');
  const accepted = [];
  for (const item of value) {
    if (!CLEAN_TARGETS.includes(item)) throw new Error(`unknown target "${String(item)}"; use sessions or canvas`);
    if (!accepted.includes(item)) accepted.push(item);
  }
  if (accepted.length === 0) throw new Error('targets must name at least one cache');
  return CLEAN_TARGETS.filter((target) => accepted.includes(target));
}


/**
 * Run `flock` without throwing.
 * @param {string[]} args - flock arguments.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns exit facts.
 */
function runFlock(args, signal) {
  return new Promise((resolve) => {
    execFile('flock', args, { signal, timeout: 60_000, maxBuffer: 64 * 1024 }, (error, _stdout, stderr) => {
      resolve({ error, stderr: typeof stderr === 'string' ? stderr.trim() : '' });
    });
  });
}

/**
 * Remove one session directory while holding its cross-process write lock.
 *
 * The JSONL backend takes `flock(2)` on `session.lock` for the whole life of a
 * write handle, so acquiring that same lock before `rm` makes deletion atomic
 * against a writer that starts at any moment: the kernel grants it to exactly
 * one side. A held lock exits nonzero with empty stderr; an unreadable lock or
 * a failing `rm` carries a diagnostic and the caller reports it instead of
 * deleting. When the `flock` executable is absent the caller falls back to the
 * process-file-table check.
 *
 * @param {string} dir - session directory.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns `{ status, message? }` where status is removed, busy, unverifiable, unsupported, cancelled, or failed.
 */
export async function removeSessionLocked(dir, signal) {
  const lock = path.join(dir, 'session.lock');
  const { error, stderr } = await runFlock(['-n', '--', lock, 'rm', '-rf', '--', dir], signal);
  if (error === null) return { status: 'removed' };
  if (error.code === 'ABORT_ERR') return { status: 'cancelled', message: 'cancelled' };
  if (error.code === 'ENOENT' && stderr === '') return { status: 'unsupported' };
  if (/Permission denied|Operation not permitted/i.test(stderr)) return { status: 'unverifiable', message: stderr };
  if (/No such file or directory/i.test(stderr)) {
    try {
      await fs.stat(dir);
    } catch {
      return { status: 'removed' };
    }
  }
  if (stderr === '') return { status: 'busy' };
  return { status: 'failed', message: stderr };
}

/**
 * Re-check one scanned session and delete it only if it is still unchanged.
 *
 * The scan may be seconds old by the time a large home reaches a session, so the
 * size and activity time are compared again, then the write lock is taken for
 * the deletion itself. Any difference is reported as `changed` rather than
 * removed.
 *
 * @param {object} entry - one session entry from {@link inspectHome}.
 * @param {{ signal?: AbortSignal }} [options] - cancellation.
 * @returns `{ status, message? }` with the same statuses as {@link removeSessionLocked} plus `changed`.
 */
export async function removeSessionIfUnchanged(entry, options = {}) {
  let now;
  try {
    now = await treeSize(entry.dir, options.signal);
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return { status: 'removed' };
    return { status: 'failed', message: messageOf(error) };
  }
  if (now.bytes !== entry.bytes || now.mtimeMs !== entry.activityMs) return { status: 'changed' };
  return removeSessionLocked(entry.dir, options.signal);
}

/**
 * Delete cold session logs, their projection checkpoints, and canvas artifacts.
 *
 * A session is skipped when its log or lock is open in any process, when its
 * files changed after the scan, when it was modified inside `minAgeMinutes`, or
 * when its write lock cannot be taken. Session targets are refused when `/proc`
 * is unavailable and the `flock` fallback cannot verify locks, because guessing
 * there could remove a log a running writer still appends to.
 *
 * @param {readonly object[]} homes - home descriptors.
 * @param {{ targets?: string[], minAgeMinutes?: number, signal?: AbortSignal, openPaths?: Map<string, Set<number>> }} [options] - cleanup input.
 * @returns the cleanup result, including before and after totals.
 */
export async function cleanAll(homes, options = {}) {
  const targets = normalizeTargets(options.targets);
  const signal = options.signal;
  const startedAt = Date.now();
  const sessionRoots = homes
    .filter((home) => home.available !== false)
    .map((home) => path.join(home.path, SESSIONS_DIR));
  const supplied = options.openPaths instanceof Map;
  const open = supplied
    ? { available: true, restricted: false, paths: options.openPaths }
    : await collectOpenPaths(sessionRoots);
  if (targets.includes('sessions') && !open.available) {
    const error = new Error('cannot detect sessions that are still being written on this platform; refusing to delete session logs');
    error.code = 'live-detection-unavailable';
    throw error;
  }
  const minAgeMinutes = options.minAgeMinutes ?? 0;
  const before = await inspectAll(homes, { openPaths: open.paths, minAgeMinutes, signal });

  // A session can be resumed after the scan; refresh the open-file table right
  // before deletion so a writer that started during the walk is still caught.
  const fresh = supplied ? open : await collectOpenPaths(sessionRoots);
  const livePaths = fresh.available ? fresh.paths : open.paths;
  const restrictedLive = open.restricted === true || (fresh.available === true && fresh.restricted === true);
  const liveIds = new Set();
  for (const detail of before.details) {
    for (const entry of detail.entries.sessions) {
      if (entry.live || livePidsFor(entry.dir, livePaths).size > 0) liveIds.add(entry.id);
    }
  }

  const removed = { sessions: 0, sessionProjects: 0, cacheRecords: 0, cacheFiles: 0, artifacts: 0, canvasWorkspaces: 0 };
  const freed = { sessionsBytes: 0, cacheBytes: 0, canvasBytes: 0 };
  const preservedIds = new Set();
  const skipped = [];
  const skippedByReason = { live: 0, recent: 0, changed: 0, unverifiable: 0 };
  const failures = [];
  let flockAvailable = true;

  /**
   * Record one skipped session.
   * @param {object} entry - session entry.
   * @param {string} reason - skip reason.
   * @param {object} [extra] - additional report fields.
   */
  const skip = (entry, reason, extra = {}) => {
    skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
    skipped.push({ path: entry.dir, sessionId: entry.id, reason, ...extra });
  };

  for (const detail of before.details) {
    signal?.throwIfAborted?.();
    const home = detail.report;
    if (!home.available) {
      failures.push({ path: home.path, message: home.error ?? 'DSH home is unavailable' });
      continue;
    }
    if (!home.writable) {
      failures.push({ path: home.path, message: 'permission denied: this DSH home is not writable by the Harness process' });
      continue;
    }
    if (targets.includes('sessions') && home.sessions.error !== null) {
      failures.push({ path: home.sessions.root, message: home.sessions.error });
    }
    if (targets.includes('sessions') && home.projectionCache.error !== null) {
      failures.push({ path: home.projectionCache.root, message: home.projectionCache.error });
    }
    if (targets.includes('canvas') && home.canvas.error !== null) {
      failures.push({ path: home.canvas.root, message: home.canvas.error });
    }
    if (targets.includes('sessions')) {
      for (const entry of detail.entries.sessions) {
        signal?.throwIfAborted?.();
        const freshPids = livePidsFor(entry.dir, livePaths);
        if (entry.live || freshPids.size > 0) {
          preservedIds.add(entry.id);
          skip(entry, 'live', { pids: freshPids.size > 0 ? [...freshPids] : entry.pids });
          continue;
        }
        if (entry.recent) {
          preservedIds.add(entry.id);
          skip(entry, 'recent');
          continue;
        }
        const outcome = flockAvailable
          ? await removeSessionIfUnchanged(entry, { signal })
          : { status: 'unsupported' };
        if (outcome.status === 'removed') {
          removed.sessions += 1;
          freed.sessionsBytes += entry.bytes;
          continue;
        }
        if (outcome.status === 'busy') {
          preservedIds.add(entry.id);
          skip(entry, 'live');
          continue;
        }
        if (outcome.status === 'unverifiable') {
          preservedIds.add(entry.id);
          skip(entry, 'unverifiable', { message: outcome.message });
          continue;
        }
        if (outcome.status === 'changed') {
          preservedIds.add(entry.id);
          skip(entry, 'changed');
          continue;
        }
        if (outcome.status === 'cancelled') {
          signal?.throwIfAborted?.();
          throw new Error('cache cleanup cancelled');
        }
        if (outcome.status === 'unsupported') {
          flockAvailable = false;
          if (restrictedLive) {
            preservedIds.add(entry.id);
            skip(entry, 'unverifiable', { message: 'flock is unavailable and the open-file table is restricted' });
            continue;
          }
          try {
            await fs.rm(entry.dir, { recursive: true, force: true, maxRetries: 2 });
            removed.sessions += 1;
            freed.sessionsBytes += entry.bytes;
          } catch (error) {
            preservedIds.add(entry.id);
            failures.push({ path: entry.dir, message: messageOf(error) });
          }
          continue;
        }
        preservedIds.add(entry.id);
        failures.push({ path: entry.dir, message: outcome.message === undefined ? 'failed to delete' : outcome.message });
      }
      for (const projectDir of detail.entries.projectDirs) {
        try {
          await fs.rmdir(projectDir);
          removed.sessionProjects += 1;
        } catch {
          // A project directory with remaining sessions stays.
        }
      }
      for (const entry of detail.entries.cache) {
        if (entry.live || liveIds.has(entry.id) || preservedIds.has(entry.id)) continue;
        try {
          signal?.throwIfAborted?.();
          await fs.unlink(entry.path);
          if (entry.bak) removed.cacheFiles += 1;
          else removed.cacheRecords += 1;
          freed.cacheBytes += entry.bytes;
        } catch (error) {
          if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') {
            failures.push({ path: entry.path, message: messageOf(error) });
          }
        }
      }
    }
    if (targets.includes('canvas')) {
      for (const entry of detail.entries.artifacts) {
        try {
          signal?.throwIfAborted?.();
          await fs.rm(entry.dir, { recursive: true, force: true, maxRetries: 2 });
          removed.artifacts += 1;
          freed.canvasBytes += entry.bytes;
        } catch (error) {
          failures.push({ path: entry.dir, message: messageOf(error) });
        }
      }
      for (const workspaceDir of detail.entries.workspaceDirs) {
        try {
          await fs.rmdir(workspaceDir);
          removed.canvasWorkspaces += 1;
        } catch {
          // A workspace directory with remaining artifacts stays.
        }
      }
    }
  }

  const after = await inspectAll(homes, { openPaths: livePaths, minAgeMinutes, signal });
  return {
    ok: failures.length === 0,
    targets,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    removed,
    freed: {
      sessionsBytes: freed.sessionsBytes,
      cacheBytes: freed.cacheBytes,
      canvasBytes: freed.canvasBytes,
      bytes: freed.sessionsBytes + freed.cacheBytes + freed.canvasBytes,
    },
    skippedCount: skipped.length,
    skippedByReason,
    skipped: bounded(skipped),
    failureCount: failures.length,
    failures: bounded(failures),
    before: before.report.totals,
    after: after.report.totals,
  };
}

/**
 * Render a byte count for compact UI and tool text.
 * @param {number} bytes - byte count.
 * @returns a short human-readable size.
 */
export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let scaled = value;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${units[index]}`;
}

/**
 * Describe a scan report as bounded plain text for the agent tool.
 * @param {object} report - a report from {@link inspectAll}.
 * @returns the text.
 */
export function formatScan(report) {
  const lines = [
    `DSH cache scan · ${report.scannedAt}`,
    `Live-session detection: ${report.liveDetection}${report.liveDetectionRestricted ? ' (open-file counts may be incomplete; deletion still checks each session lock)' : ''}`,
    'Deletion guard: per-session flock + changed-after-scan check.',
  ];
  for (const home of report.homes) {
    const prefix = `${home.path} (${home.owner}${home.current ? ', current' : ''})`;
    if (!home.available) {
      lines.push(`- ${prefix}: unavailable${home.error === null ? '' : ` — ${home.error}`}`);
      continue;
    }
    lines.push(
      `- ${prefix}: ${formatBytes(home.bytes)} total`
        + ` · sessions ${formatBytes(home.sessions.bytes)} in ${home.sessions.count}`
        + ` · projection ${formatBytes(home.projectionCache.bytes)} in ${home.projectionCache.count}`
        + ` · canvas ${formatBytes(home.canvas.bytes)} in ${home.canvas.count}`
        + ` · live ${home.sessions.liveCount}`
        + (home.writable ? '' : ' · read-only'),
    );
  }
  const totals = report.totals;
  lines.push(
    `Total ${formatBytes(totals.bytes)}: sessions ${formatBytes(totals.sessionBytes)},`
      + ` projection ${formatBytes(totals.cacheBytes)}, canvas ${formatBytes(totals.canvasBytes)}.`
      + ` ${totals.liveSessions} live session(s) would be skipped.`,
  );
  return lines.join('\n');
}

/**
 * Describe a cleanup result as bounded plain text for the agent tool.
 * @param {object} result - a result from {@link cleanAll}.
 * @returns the text.
 */
export function formatClean(result) {
  const removed = result.removed;
  const lines = [
    `Freed ${formatBytes(result.freed.bytes)} from ${result.targets.join(' + ')} in ${result.durationMs} ms.`,
    `Removed ${removed.sessions} session log(s), ${removed.cacheRecords} projection record(s), ${removed.artifacts} canvas artifact(s).`,
  ];
  if (result.skippedCount > 0) {
    const live = result.skipped.filter((entry) => entry.reason === 'live').length;
    const recent = result.skipped.filter((entry) => entry.reason === 'recent').length;
    lines.push(`Skipped ${result.skippedCount}: ${live} live, ${recent} recently modified.`);
  }
  if (result.failureCount > 0) {
    lines.push(`Failures (${result.failureCount}):`);
    for (const failure of result.failures.slice(0, 10)) lines.push(`- ${failure.path}: ${failure.message}`);
    if (result.failureCount > 10) lines.push(`- … and ${result.failureCount - 10} more`);
  }
  lines.push(`Remaining cache: ${formatBytes(result.after.bytes)}.`);
  return lines.join('\n');
}