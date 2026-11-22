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
  assert.equal(routes.length, 1, 'the bundle registers exactly one route');
  const dispose = async () => {
    for (const disposer of disposers) await disposer();
  };
  return { fetch: routes[0].fetch, dispose };
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
  const { fetch, dispose } = await mount(root);
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
  assert.deepEqual(readSettings(undefined), { maxUploadBytes: 2 * 1024 * 1024 * 1024, onConflict: 'rename' });
  assert.deepEqual(readSettings({ maxUploadBytes: 10, onConflict: 'overwrite' }), { maxUploadBytes: 10, onConflict: 'overwrite' });
  assert.equal(readSettings({ maxUploadBytes: -1 }).maxUploadBytes, 2 * 1024 * 1024 * 1024);
  assert.equal(readSettings({ onConflict: 'sideways' }).onConflict, 'rename');
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
