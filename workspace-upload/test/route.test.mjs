import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { apply, readSettings } from '../index.js';

const ROUTE = '/api/workspace-upload/file';

/**
 * Mount the host half against a mock composition rooted at one directory.
 * @param {string} root - directory the mock Session reports as its workspace.
 * @param {object} config - bundle row config.
 * @param {{ sessions?: boolean }} options - mount variations.
 * @returns {Promise<{ fetch: Function, dispose: Function }>} the registered route.
 */
async function mount(root, config = {}, options = {}) {
  const routes = [];
  const disposers = [];
  const session = { id: 'session-1', cwd: root };
  const workingDirectory = { get: (value) => value.cwd };
  const ctx = {
    effect(fn) {
      const disposer = fn();
      disposers.push(disposer);
      return disposer;
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
          return async () => {};
        },
      },
    },
    get(name) {
      if (name === 'workingDirectory') return workingDirectory;
      if (name === 'sessionQuery' && options.sessions !== false) {
        return {
          async inspectSession(id, read) {
            if (id !== session.id) throw new Error('unknown session');
            return read(session);
          },
        };
      }
      if (name === 'sessions' && options.sessions === false) return { get: () => session };
      return undefined;
    },
  };
  apply(ctx, config);
  const upload = routes.find((route) => route.path === ROUTE);
  const limits = routes.find((route) => route.path === '/api/workspace-upload/limits');
  const directory = routes.find((route) => route.path === '/api/workspace-upload/dir');
  const stat = routes.find((route) => route.path === '/api/workspace-upload/stat');
  const dirs = routes.find((route) => route.path === '/api/workspace-upload/dirs');
  assert.equal(routes.length, 5, 'the bundle registers upload, limits, directory, stat, and dirs routes');
  assert.ok(upload !== undefined, 'the upload route is registered');
  assert.ok(limits !== undefined, 'the limits route is registered');
  assert.ok(directory !== undefined, 'the directory route is registered');
  assert.ok(stat !== undefined, 'the stat route is registered');
  assert.ok(dirs !== undefined, 'the dirs route is registered');
  const dispose = async () => {
    for (const disposer of disposers) await disposer();
  };
  return {
    fetch: upload.fetch,
    limits: limits.fetch,
    directory: directory.fetch,
    stat: stat.fetch,
    dirs: dirs.fetch,
    dispose,
  };
}

/**
 * Build one upload request.
 * @param {string} query - query string without the leading `?`.
 * @param {string | Uint8Array | undefined} body - request body.
 * @param {string} contentType - request media type.
 * @returns {Request} the request.
 */
function request(query, body, contentType = 'application/octet-stream') {
  return new Request(`http://localhost${ROUTE}?${query}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: body === undefined ? null : body,
  });
}

test('writes one file into the session workspace and answers its name', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fetch, dispose } = await mount(root);
  t.after(dispose);

  const response = await fetch(request('sessionId=session-1&name=notes.txt', 'hello workspace'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.value.name, 'notes.txt');
  assert.equal(body.value.bytes, 15);
  assert.equal(body.value.replaced, false);
  assert.equal(await readFile(join(root, 'notes.txt'), 'utf8'), 'hello workspace');
});

test('publishes binary bytes unchanged and leaves no temporary file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fetch, dispose } = await mount(root);
  t.after(dispose);

  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252]);
  const response = await fetch(request('sessionId=session-1&name=image.bin', bytes));
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await readFile(join(root, 'image.bin'))), bytes);
  assert.deepEqual((await readdir(root)).filter((name) => name.startsWith('.dsh-upload-')), []);
});

test('renames a taken name instead of replacing the file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'report.txt'), 'original');
  const { fetch, dispose } = await mount(root, { onConflict: 'rename' });
  t.after(dispose);

  const response = await fetch(request('sessionId=session-1&name=report.txt', 'second'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.value.name, 'report (1).txt');
  assert.equal(body.value.replaced, false);
  assert.equal(await readFile(join(root, 'report.txt'), 'utf8'), 'original');
  assert.equal(await readFile(join(root, 'report (1).txt'), 'utf8'), 'second');
});

test('replaces the file when the row asks for overwrite', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'report.txt'), 'original');
  const { fetch, dispose } = await mount(root, { onConflict: 'overwrite' });
  t.after(dispose);

  const response = await fetch(request('sessionId=session-1&name=report.txt', 'replaced'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.value.replaced, true);
  assert.equal(await readFile(join(root, 'report.txt'), 'utf8'), 'replaced');
});

test('asks before replacing a taken name and replaces on request', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'report.txt'), 'original');
  const { fetch, dispose } = await mount(root);
  t.after(dispose);

  const conflict = await fetch(request('sessionId=session-1&name=report.txt', 'next'));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'name-conflict');
  assert.equal(await readFile(join(root, 'report.txt'), 'utf8'), 'original');

  const replaced = await fetch(request('sessionId=session-1&name=report.txt&overwrite=1', 'next'));
  assert.equal(replaced.status, 200);
  assert.equal((await replaced.json()).value.replaced, true);
  assert.equal(await readFile(join(root, 'report.txt'), 'utf8'), 'next');
});

test('reports whether a target already exists', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'taken.txt'), 'x');
  await mkdir(join(root, 'folder'));
  const { stat, dispose } = await mount(root);
  t.after(dispose);

  const check = (dir, name) => stat(new Request(
    `http://localhost/api/workspace-upload/stat?sessionId=session-1&dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`,
  ));
  assert.deepEqual(await (await check('', 'taken.txt')).json(), { exists: true, kind: 'file' });
  assert.deepEqual(await (await check('', 'folder')).json(), { exists: true, kind: 'directory' });
  assert.deepEqual(await (await check('', 'absent.txt')).json(), { exists: false, kind: 'absent' });
  assert.deepEqual(await (await check('folder', 'taken.txt')).json(), { exists: false, kind: 'absent' });
  assert.equal((await check('..', 'x')).status, 400);
  assert.equal((await check('missing', 'x')).status, 404);
});

test('lists child directories for navigation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'file.txt'), 'x');
  const { dirs, dispose } = await mount(root);
  t.after(dispose);

  const list = (dir) => dirs(new Request(
    `http://localhost/api/workspace-upload/dirs?sessionId=session-1&dir=${encodeURIComponent(dir)}`,
  ));
  assert.deepEqual((await (await list('')).json()).dirs, ['docs', 'src']);
  assert.deepEqual((await (await list('docs')).json()).dirs, []);
  assert.equal((await list('missing')).status, 404);
  assert.equal((await list('..')).status, 400);
});

test('writes into a contained subdirectory and still refuses escapes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs'));
  const { fetch, dispose } = await mount(root);
  t.after(dispose);

  const inside = await fetch(request('sessionId=session-1&dir=docs&name=readme.md', '# readme'));
  assert.equal(inside.status, 200);
  assert.equal(await readFile(join(root, 'docs', 'readme.md'), 'utf8'), '# readme');

  const outside = await fetch(request('sessionId=session-1&dir=..&name=escape.txt', 'nope'));
  assert.equal(outside.status, 400);
  const body = await outside.json();
  assert.equal(body.code, 'path-outside-workspace');
});

test('rejects traversal names, control characters, and separators', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fetch, dispose } = await mount(root);
  t.after(dispose);

  for (const name of ['..', 'a/b.txt', 'a\\b.txt', 'bad\u0001name', '']) {
    const response = await fetch(request(`sessionId=session-1&name=${encodeURIComponent(name)}`, 'x'));
    assert.equal(response.status, 400, `name ${JSON.stringify(name)} is rejected`);
    const body = await response.json();
    assert.equal(body.code, 'invalid-name');
  }
});

test('rejects an oversized body without leaving a partial file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fetch, dispose } = await mount(root, { maxUploadBytes: 4 });
  t.after(dispose);

  const response = await fetch(request('sessionId=session-1&name=big.txt', 'more than four bytes'));
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.code, 'too-large');
  assert.deepEqual(await readdir(root), []);
});

test('rejects an unknown media type and an unknown session', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fetch, dispose } = await mount(root);
  t.after(dispose);

  const wrongType = await fetch(request('sessionId=session-1&name=a.txt', 'x', 'text/plain'));
  assert.equal(wrongType.status, 415);

  const missingSession = await fetch(request('name=a.txt', 'x'));
  assert.equal(missingSession.status, 400);

  const unknownSession = await fetch(request('sessionId=session-2&name=a.txt', 'x'));
  assert.equal(unknownSession.status, 404);
  assert.equal((await unknownSession.json()).code, 'session-unavailable');
});

test('falls back to the live session store when session query is unavailable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fetch, dispose } = await mount(root, {}, { sessions: false });
  t.after(dispose);

  const response = await fetch(request('sessionId=session-1&name=fallback.txt', 'live'));
  assert.equal(response.status, 200);
  assert.equal(await readFile(join(root, 'fallback.txt'), 'utf8'), 'live');
});

test('normalizes settings', () => {
  assert.deepEqual(readSettings(undefined), { maxUploadBytes: 500 * 1024 * 1024, onConflict: 'ask' });
  assert.deepEqual(readSettings({ maxUploadBytes: 10, onConflict: 'overwrite' }), { maxUploadBytes: 10, onConflict: 'overwrite' });
  assert.equal(readSettings({ maxUploadBytes: -1 }).maxUploadBytes, 500 * 1024 * 1024);
  assert.equal(readSettings({ onConflict: 'sideways' }).onConflict, 'ask');
});

test('reports the accepted file size to the browser', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { limits, dispose } = await mount(root, { maxUploadBytes: 12345 });
  t.after(dispose);

  const response = await limits(new Request('http://localhost/api/workspace-upload/limits'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { maxUploadBytes: 12345, onConflict: 'ask' });
});
test('accepts an empty file and publishes a zero-byte entry', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { fetch, dispose } = await mount(root);
  t.after(dispose);

  const response = await fetch(request('sessionId=session-1&name=.gitkeep', ''));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.value.bytes, 0);
  assert.equal((await readFile(join(root, '.gitkeep'))).byteLength, 0);
});

test('does not publish a temporary file when the body is rejected mid-stream', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'keep.txt'), 'keep');
  const { fetch, dispose } = await mount(root, { maxUploadBytes: 8 });
  t.after(dispose);

  const response = await fetch(request('sessionId=session-1&name=partial.txt', 'a'.repeat(64)));
  assert.equal(response.status, 413);
  assert.deepEqual((await readdir(root)).sort(), ['keep.txt']);
});

test('creates a workspace-relative directory and keeps it idempotent', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wu-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { directory, dispose } = await mount(root);
  t.after(dispose);

  const create = (dir) => directory(new Request(
    `http://localhost/api/workspace-upload/dir?sessionId=session-1&dir=${encodeURIComponent(dir)}`,
    { method: 'POST' },
  ));

  const first = await create('proj/src');
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.ok, true);
  assert.equal(body.value.path, join(await (await import('node:fs/promises')).realpath(root), 'proj', 'src'));

  assert.equal((await create('proj/src')).status, 200, 'creating an existing directory is harmless');
  assert.equal((await create('')).status, 400);
  assert.equal((await create('../outside')).status, 400);
  assert.equal((await create('/etc')).status, 400);

  const unknown = await directory(new Request(
    'http://localhost/api/workspace-upload/dir?sessionId=other&dir=proj',
    { method: 'POST' },
  ));
  assert.equal(unknown.status, 404);
});
