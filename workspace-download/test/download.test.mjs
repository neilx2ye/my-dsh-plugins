import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { apply, archivePlanBytes, attachment, readSettings } from '../index.js';

const FILE_ROUTE = '/api/workspace-download/file';
const ZIP_ROUTE = '/api/workspace-download/zip';

/**
 * Mount the host half against a mock composition rooted at one directory.
 * @param {string} root - directory the mock Session reports as its workspace.
 * @param {object} config - bundle row config.
 * @returns {Promise<{ file: Function, zip: Function, dispose: Function }>} the registered routes.
 */
async function mount(root, config = {}) {
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
      if (name === 'sessionQuery') {
        return {
          async inspectSession(id, read) {
            if (id !== session.id) throw new Error('unknown session');
            return read(session);
          },
        };
      }
      return undefined;
    },
  };
  apply(ctx, config);
  const file = routes.find((route) => route.path === FILE_ROUTE);
  const zip = routes.find((route) => route.path === ZIP_ROUTE);
  const limits = routes.find((route) => route.path === '/api/workspace-download/limits');
  assert.ok(file !== undefined, 'the file route is registered');
  assert.ok(zip !== undefined, 'the zip route is registered');
  assert.ok(limits !== undefined, 'the limits route is registered');
  return {
    file: file.fetch,
    zip: zip.fetch,
    limits: limits.fetch,
    dispose: async () => { for (const disposer of disposers) await disposer(); },
  };
}

/**
 * Build one route request.
 * @param {string} route - route path.
 * @param {Record<string, string>} query - query parameters.
 * @param {string} method - HTTP method.
 * @returns {Request} the request.
 */
function request(route, query = {}, method = 'GET') {
  const url = new URL(`http://localhost${route}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url, { method });
}

test('streams one file with a download disposition and no extra encoding', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wd-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'notes.txt');
  await writeFile(path, 'hello download');
  const { file, dispose } = await mount(root);
  t.after(dispose);

  const response = await file(request(FILE_ROUTE, { sessionId: 'session-1', path }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('content-length'), '14');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="notes\.txt"/);
  assert.equal(await response.text(), 'hello download');

  const head = await file(request(FILE_ROUTE, { path }, 'HEAD'));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '14');
  assert.equal(await head.text(), '');
});

test('refuses relative paths, directories, and missing files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wd-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs'));
  const { file, dispose } = await mount(root);
  t.after(dispose);

  const relative = await file(request(FILE_ROUTE, { path: 'relative.txt' }));
  assert.equal(relative.status, 400);
  assert.equal(relative.headers.get('x-workspace-download-code'), 'invalid-path');
  assert.equal((await file(request(FILE_ROUTE, {}))).status, 400);
  assert.equal((await file(request(FILE_ROUTE, { path: join(root, 'docs') }))).status, 403);
  const absent = await file(request(FILE_ROUTE, { path: join(root, 'absent.txt') }));
  assert.equal(absent.status, 404);
  assert.equal(absent.headers.get('x-workspace-download-code'), 'file-unavailable');
});

test('archives a directory with names, contents, and directory entries', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wd-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'project');
  await mkdir(join(directory, 'src'), { recursive: true });
  await mkdir(join(directory, 'empty'), { recursive: true });
  await writeFile(join(directory, 'readme.md'), '# readme');
  await writeFile(join(directory, 'src', 'main.js'), 'console.log("hi")');
  const { zip, dispose } = await mount(root);
  t.after(dispose);

  const response = await zip(request(ZIP_ROUTE, { sessionId: 'session-1', path: directory }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.match(response.headers.get('content-disposition'), /filename="project\.zip"/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  const entries = readZip(bytes);
  assert.equal(archivePlanBytes(entries.map((entry) => ({
    name: entry.name,
    kind: entry.name.endsWith('/') ? 'dir' : 'file',
    size: entry.size,
  }))), bytes.length);
  assert.deepEqual(entries.map((entry) => entry.name), [
    'project/',
    'project/empty/',
    'project/readme.md',
    'project/src/',
    'project/src/main.js',
  ]);
  assert.equal(entries[2].text, '# readme');
  assert.equal(entries[4].text, 'console.log("hi")');
  for (const entry of entries.filter((item) => item.name.endsWith('.md') || item.name.endsWith('.js'))) {
    assert.equal(entry.crcOk, true, `${entry.name} carries a valid CRC`);
  }
});

test('skips excluded and symlinked entries', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wd-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'work');
  await mkdir(join(directory, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(directory, '.git'), { recursive: true });
  await writeFile(join(directory, 'keep.txt'), 'keep');
  await writeFile(join(directory, 'node_modules', 'pkg', 'index.js'), 'skip me');
  await writeFile(join(directory, '.git', 'HEAD'), 'skip me');
  await symlink('/etc/hosts', join(directory, 'link.txt'));
  const { zip, dispose } = await mount(root);
  t.after(dispose);

  const entries = readZip(new Uint8Array(await (await zip(request(ZIP_ROUTE, {
    sessionId: 'session-1', path: directory,
  }))).arrayBuffer()));
  assert.deepEqual(entries.map((entry) => entry.name), ['work/', 'work/keep.txt']);
});

test('refuses a directory outside the session workspace', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wd-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'wd-outside-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const { zip, dispose } = await mount(root);
  t.after(dispose);

  const response = await zip(request(ZIP_ROUTE, { sessionId: 'session-1', path: outside }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'path-outside-workspace');
});

test('enforces the entry and byte limits before streaming', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wd-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'many');
  await mkdir(directory, { recursive: true });
  for (const name of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(directory, name), '1234');

  const limitedEntries = await mount(root, { maxEntries: 2 });
  t.after(limitedEntries.dispose);
  const entries = await limitedEntries.zip(request(ZIP_ROUTE, { sessionId: 'session-1', path: directory }));
  assert.equal(entries.status, 413);
  assert.equal((await entries.json()).code, 'too-many-entries');

  const limitedBytes = await mount(root, { maxTotalBytes: 5 });
  t.after(limitedBytes.dispose);
  const bytes = await limitedBytes.zip(request(ZIP_ROUTE, { sessionId: 'session-1', path: directory }));
  assert.equal(bytes.status, 413);
  assert.equal((await bytes.json()).code, 'too-large');
});

test('answers HEAD for an archive without a body', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wd-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'docs');
  await mkdir(directory);
  await writeFile(join(directory, 'a.txt'), 'a');
  const { zip, dispose } = await mount(root);
  t.after(dispose);

  const response = await zip(request(ZIP_ROUTE, { sessionId: 'session-1', path: directory }, 'HEAD'));
  assert.equal(response.status, 200);
  assert.ok(Number(response.headers.get('content-length')) > 0);
  assert.equal(await response.text(), '');
});

test('normalizes settings and clamps the archive size to ZIP32', () => {
  assert.deepEqual(readSettings(undefined), {
    maxEntries: 20000,
    maxTotalBytes: 2 * 1024 * 1024 * 1024,
    exclude: ['.git', 'node_modules'],
  });
  assert.deepEqual(readSettings({ maxEntries: 5, maxTotalBytes: 10, exclude: ['dist'] }), {
    maxEntries: 5,
    maxTotalBytes: 10,
    exclude: ['dist'],
  });
  assert.equal(readSettings({ maxTotalBytes: 10 * 1024 * 1024 * 1024 }).maxTotalBytes, 0xFFFFFFFF - 0x10000);
  assert.equal(readSettings({ maxEntries: 70000 }).maxEntries, 65534);
  assert.deepEqual(readSettings({ exclude: ['../bad', 'ok'] }).exclude, ['ok']);
  assert.equal(attachment('报告.pdf').includes('filename*=UTF-8\'\'%E6%8A%A5%E5%91%8A.pdf'), true);
});


/**
 * Parse a ZIP archive written by the plugin and verify each entry's CRC.
 * @param {Uint8Array} bytes - complete archive bytes.
 * @returns {object[]} entries with name, size, text, and crcOk.
 */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50, 'central header');
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtra;
    const data = bytes.subarray(dataStart, dataStart + size);
    entries.push({
      name,
      size,
      text: name.endsWith('/') ? '' : new TextDecoder().decode(data),
      crcOk: name.endsWith('/') ? true : crc32(data) === crc,
    });
    cursor += 46 + nameLength;
  }
  return entries;
}

/**
 * CRC-32 used to verify the archive.
 * @param {Uint8Array} bytes - entry bytes.
 * @returns {number} the checksum.
 */
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
test('does not double the archive suffix for a folder already named .zip', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wd-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'bundle.zip');
  await mkdir(directory);
  await writeFile(join(directory, 'a.txt'), 'a');
  const { zip, dispose } = await mount(root);
  t.after(dispose);

  const response = await zip(request(ZIP_ROUTE, { sessionId: 'session-1', path: directory }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /filename="bundle\.zip"/);
  assert.doesNotMatch(response.headers.get('content-disposition'), /bundle\.zip\.zip/);
});

test('reports the archive limits to the browser', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wd-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { limits, dispose } = await mount(root, { maxEntries: 7, maxTotalBytes: 12 });
  t.after(dispose);

  const response = await limits(new Request('http://localhost/api/workspace-download/limits'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { maxEntries: 7, maxTotalBytes: 12 });
});
