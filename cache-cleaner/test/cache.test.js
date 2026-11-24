/**
 * Unit tests for the cache-cleaner Host logic.
 *
 * Every fixture is a temporary DSH home. Live-session protection is exercised
 * with an explicit process-file-table map, so the test neither depends on this
 * machine's real sessions nor deletes anything outside its temporary directory.
 * One test reads the real `/proc` table for a file this process holds open.
 */

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cleanAll,
  removeSessionIfUnchanged,
  removeSessionLocked,
  collectOpenPaths,
  discoverHomes,
  expandHome,
  formatBytes,
  inspectHome,
  normalizeTargets,
  ownerOf,
  readConfig,
} from '../lib/cache.js';

/**
 * Write a file with parent directories.
 * @param {string} file - absolute path.
 * @param {string} content - file content.
 */
async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

/**
 * Create one temporary DSH home with two sessions, two checkpoints, and two
 * canvas artifacts.
 * @returns the fixture paths.
 */
async function fixture(archived = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-cleaner-'));
  const home = { path: root, owner: 'tester', current: false, exists: true, available: true, writable: true, error: null };
  const project = path.join(root, 'sessions', '--project--');
  const first = path.join(project, 'session-one');
  const second = path.join(project, 'session-two');
  await write(path.join(first, 'session.v4.jsonl.zstd'), 'a'.repeat(100));
  await write(path.join(first, 'session.lock'), '');
  await write(path.join(second, 'session.v4.jsonl.zstd'), 'b'.repeat(200));
  await write(path.join(second, 'session.lock'), '');
  const cacheRoot = path.join(root, 'storages', 'session_projcache', 'sessions');
  await write(path.join(cacheRoot, 'session-one.json'), 'c'.repeat(50));
  await write(path.join(cacheRoot, 'session-two.json'), 'd'.repeat(60));
  await write(path.join(cacheRoot, 'session-one.json.bak.1'), 'e'.repeat(7));
  const workspace = path.join(root, 'storages', 'artifacts', 'workspace');
  await write(path.join(workspace, 'artifact-one', 'meta.json'), 'f'.repeat(10));
  await write(path.join(workspace, 'artifact-one', 'v1.html'), 'g'.repeat(20));
  await write(path.join(workspace, 'artifact-two', 'meta.json'), 'h'.repeat(5));
  await write(
    path.join(root, 'storages', 'workspace.json'),
    JSON.stringify({ unit: { name: 'workspace', version: 2 }, global: { archivedSessionIds: archived } }),
  );
  return { root, home, project, first, second, cacheRoot, workspace };
}

/**
 * Build the process-file-table map that marks one session live.
 * @param {string} sessionDir - session directory.
 * @param {number} [pid] - owning pid.
 * @returns the map.
 */
function liveMap(sessionDir, pid = 4242) {
  return new Map([[path.join(sessionDir, 'session.v4.jsonl.zstd'), new Set([pid])]]);
}

/**
 * Wait for a bounded time.
 * @param {number} ms - milliseconds.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hold one session's cross-process write lock in a child process.
 * @param {string} lockPath - `session.lock` path.
 * @returns the child holding the lock.
 */
async function releaseLock(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await exited;
}

async function holdLock(lockPath) {
  const child = spawn('flock', ['-n', '--', lockPath, 'sleep', '30'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await delay(30);
    const code = await new Promise((resolve) => {
      execFile('flock', ['-n', '--', lockPath, 'true'], (error) => {
        resolve(error === null ? 0 : 1);
      });
    });
    if (code === 1) return child;
    if (child.exitCode !== null) break;
  }
  child.kill();
  throw new Error('test could not acquire the session lock');
}

test('ownerOf labels standard DSH homes', () => {
  assert.equal(ownerOf('/root/.dsh'), 'root');
  assert.equal(ownerOf('/home/neil/.dsh'), 'neil');
  assert.equal(ownerOf('/opt/dsh/.dsh'), 'dsh');
});

test('expandHome expands a leading tilde', () => {
  assert.equal(expandHome('~/.dsh'), path.join(os.homedir(), '.dsh'));
  assert.equal(expandHome('/var/lib/dsh'), '/var/lib/dsh');
  assert.throws(() => expandHome(''), /non-empty/);
});

test('readConfig validates the row config', () => {
  assert.deepEqual(readConfig(undefined), { extraHomes: [], minAgeMinutes: 0 });
  assert.deepEqual(readConfig({ extraHomes: ['/x/.dsh'], minAgeMinutes: 30 }), {
    extraHomes: ['/x/.dsh'],
    minAgeMinutes: 30,
  });
  assert.throws(() => readConfig({ extraHomes: 'nope' }), /extraHomes/);
  assert.throws(() => readConfig({ minAgeMinutes: -1 }), /minAgeMinutes/);
  assert.throws(() => readConfig({ minAgeMinutes: 1.5 }), /minAgeMinutes/);
});

test('normalizeTargets keeps canonical order and rejects unknown targets', () => {
  assert.deepEqual(normalizeTargets(undefined), ['sessions', 'canvas']);
  assert.deepEqual(normalizeTargets(['canvas', 'sessions', 'canvas']), ['sessions', 'canvas']);
  assert.throws(() => normalizeTargets(['everything']), /unknown target/);
  assert.throws(() => normalizeTargets([]), /at least one/);
});

test('formatBytes renders compact sizes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(16 * 1024 * 1024), '16.0 MB');
});

test('inspectHome sizes each category and marks the live session', async () => {
  const data = await fixture(['session-one']);
  try {
    const { report, entries } = await inspectHome(data.home, {
      openPaths: liveMap(data.first),
      minAgeMinutes: 0,
    });
    assert.equal(report.available, true);
    assert.equal(report.sessions.count, 2);
    assert.equal(report.sessions.liveCount, 1);
    assert.equal(report.sessions.projectCount, 1);
    assert.equal(report.sessions.bytes, 100 + 200);
    assert.equal(report.sessions.liveBytes, 100);
    assert.equal(report.sessions.archivedCount, 1);
    assert.equal(report.sessions.archivedBytes, 100);
    assert.equal(report.sessions.archivedLiveCount, 1);
    assert.equal(report.sessions.otherCount, 1);
    assert.equal(report.sessions.otherBytes, 200);
    assert.equal(report.archive.available, true);
    assert.equal(report.archive.count, 1);
    assert.equal(report.projectionCache.count, 2);
    assert.equal(report.projectionCache.liveCount, 1);
    assert.equal(report.projectionCache.bytes, 50 + 60 + 7);
    assert.equal(report.projectionCache.liveBytes, 50);
    assert.equal(report.canvas.count, 2);
    assert.equal(report.canvas.workspaceCount, 1);
    assert.equal(report.canvas.bytes, 35);
    assert.equal(report.bytes, 300 + 117 + 35);
    assert.equal(entries.sessions.length, 2);
    assert.equal(entries.sessions.find((entry) => entry.id === 'session-one').live, true);
    assert.equal(entries.sessions.find((entry) => entry.id === 'session-two').live, false);
  } finally {
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('cleanAll removes cold archived logs and keeps an archived live session', async () => {
  const data = await fixture(['session-one', 'session-two']);
  const holder = await holdLock(path.join(data.first, 'session.lock'));
  try {
    const result = await cleanAll([data.home], {
      targets: ['sessions'],
      openPaths: new Map(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.removed.sessions, 1);
    assert.equal(result.freed.sessionsBytes, 200);
    assert.equal(result.freed.cacheBytes, 60);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.skippedByReason.live, 1);
    assert.equal(result.retained.unarchivedSessions, 0);
    assert.equal(result.skipped[0].sessionId, 'session-one');
    assert.equal(result.skipped[0].reason, 'live');
    assert.equal(result.after.sessions, 1);
    assert.equal(result.before.sessions, 2);

    await assert.doesNotReject(fs.stat(data.first));
    await assert.rejects(fs.stat(data.second), { code: 'ENOENT' });
    await assert.doesNotReject(fs.stat(path.join(data.cacheRoot, 'session-one.json')));
    await assert.rejects(fs.stat(path.join(data.cacheRoot, 'session-two.json')), { code: 'ENOENT' });
    await assert.doesNotReject(fs.stat(path.join(data.cacheRoot, 'session-one.json.bak.1')));
    await assert.doesNotReject(fs.stat(data.project));
    await assert.doesNotReject(fs.stat(path.join(data.workspace, 'artifact-one', 'meta.json')));
  } finally {
    await releaseLock(holder);
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('cleanAll keeps unarchived sessions and their checkpoints', async () => {
  const data = await fixture(['session-two']);
  try {
    const result = await cleanAll([data.home], {
      targets: ['sessions'],
      openPaths: new Map(),
    });
    assert.equal(result.removed.sessions, 1);
    assert.equal(result.freed.sessionsBytes, 200);
    assert.equal(result.freed.cacheBytes, 60);
    assert.equal(result.skippedCount, 0);
    assert.equal(result.retained.unarchivedSessions, 1);
    assert.equal(result.retained.unarchivedBytes, 100);
    await assert.doesNotReject(fs.stat(data.first));
    await assert.rejects(fs.stat(data.second), { code: 'ENOENT' });
    await assert.doesNotReject(fs.stat(path.join(data.cacheRoot, 'session-one.json')));
    await assert.doesNotReject(fs.stat(path.join(data.cacheRoot, 'session-one.json.bak.1')));
    await assert.rejects(fs.stat(path.join(data.cacheRoot, 'session-two.json')), { code: 'ENOENT' });
  } finally {
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('an unreadable archive file keeps every session log and reports it', async () => {
  const data = await fixture(['session-one']);
  try {
    await fs.writeFile(path.join(data.root, 'storages', 'workspace.json'), '{not json');
    const result = await cleanAll([data.home], { targets: ['sessions'], openPaths: new Map() });
    assert.equal(result.removed.sessions, 0);
    assert.equal(result.failureCount, 1);
    assert.match(result.failures[0].message, /JSON/i);
    await assert.doesNotReject(fs.stat(data.first));
    await assert.doesNotReject(fs.stat(data.second));
  } finally {
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('a home without archive state keeps every session log', async () => {
  const data = await fixture([]);
  try {
    await fs.rm(path.join(data.root, 'storages', 'workspace.json'));
    const result = await cleanAll([data.home], { targets: ['sessions'], openPaths: new Map() });
    assert.equal(result.removed.sessions, 0);
    assert.equal(result.failureCount, 0);
    await assert.doesNotReject(fs.stat(data.first));
    await assert.doesNotReject(fs.stat(data.second));
  } finally {
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('cleanAll removes canvas artifacts without touching sessions', async () => {
  const data = await fixture(['session-one']);
  try {
    const result = await cleanAll([data.home], {
      targets: ['canvas'],
      openPaths: liveMap(data.first),
    });
    assert.equal(result.removed.artifacts, 2);
    assert.equal(result.removed.canvasWorkspaces, 1);
    assert.equal(result.freed.canvasBytes, 35);
    await assert.rejects(fs.stat(data.workspace), { code: 'ENOENT' });
    await assert.doesNotReject(fs.stat(path.join(data.first, 'session.v4.jsonl.zstd')));
    await assert.doesNotReject(fs.stat(path.join(data.cacheRoot, 'session-one.json')));
  } finally {
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('minAgeMinutes skips a session modified inside the window', async () => {
  const data = await fixture(['session-one', 'session-two']);
  try {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(path.join(data.first, 'session.v4.jsonl.zstd'), old, old);
    const result = await cleanAll([data.home], {
      targets: ['sessions'],
      openPaths: new Map(),
      minAgeMinutes: 60,
    });
    assert.equal(result.removed.sessions, 1);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.skipped[0].sessionId, 'session-two');
    assert.equal(result.skipped[0].reason, 'recent');
    await assert.rejects(fs.stat(data.first), { code: 'ENOENT' });
    await assert.doesNotReject(fs.stat(data.second));
  } finally {
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('removeSessionIfUnchanged skips a session that grew after the scan', async () => {
  const data = await fixture(['session-two']);
  try {
    const original = await inspectHome(data.home, { openPaths: new Map() });
    const target = original.entries.sessions.find((entry) => entry.id === 'session-two');
    assert.ok(target !== undefined);
    await fs.appendFile(path.join(data.second, 'session.v4.jsonl.zstd'), 'late');
    const outcome = await removeSessionIfUnchanged(target);
    assert.equal(outcome.status, 'changed');
    await assert.doesNotReject(fs.stat(data.second));
  } finally {
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('removeSessionLocked deletes a free session and reports a held one', async () => {
  const data = await fixture(['session-one']);
  const holder = await holdLock(path.join(data.first, 'session.lock'));
  try {
    const busy = await removeSessionLocked(data.first);
    assert.equal(busy.status, 'busy');
    await assert.doesNotReject(fs.stat(data.first));
  } finally {
    await releaseLock(holder);
  }
  try {
    const removed = await removeSessionLocked(data.second);
    assert.equal(removed.status, 'removed');
    await assert.rejects(fs.stat(data.second), { code: 'ENOENT' });
  } finally {
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('a read-only home is reported instead of deleted', async () => {
  const data = await fixture(['session-one', 'session-two']);
  try {
    const result = await cleanAll([{ ...data.home, writable: false }], {
      targets: ['sessions', 'canvas'],
      openPaths: new Map(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.failureCount, 1);
    assert.match(result.failures[0].message, /not writable/);
    await assert.doesNotReject(fs.stat(path.join(data.first, 'session.v4.jsonl.zstd')));
  } finally {
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('collectOpenPaths finds a file this process holds open', { skip: process.platform !== 'linux' }, async () => {
  const data = await fixture(['session-one']);
  const handle = await fs.open(path.join(data.first, 'session.v4.jsonl.zstd'), 'r');
  try {
    const open = await collectOpenPaths([path.join(data.root, 'sessions')]);
    assert.equal(open.available, true);
    const owners = open.paths.get(path.join(data.first, 'session.v4.jsonl.zstd'));
    assert.ok(owners instanceof Set);
    assert.ok(owners.has(process.pid));
    const { report } = await inspectHome(data.home, { openPaths: open.paths });
    assert.equal(report.sessions.liveCount, 1);
  } finally {
    await handle.close();
    await fs.rm(data.root, { recursive: true, force: true });
  }
});

test('discoverHomes reports a configured missing home and puts the current one first', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-cleaner-home-'));
  const missing = path.join(root, 'missing-home');
  try {
    const homes = await discoverHomes({ currentHome: root, extraHomes: [missing] });
    assert.equal(homes[0].path, root);
    assert.equal(homes[0].current, true);
    const absent = homes.find((home) => home.path === missing);
    assert.ok(absent !== undefined);
    assert.equal(absent.available, false);
    assert.ok(absent.error !== null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});