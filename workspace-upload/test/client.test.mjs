import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const CLIENT = join(import.meta.dirname, '..', 'client.js');

/**
 * Load the browser half inside a sandbox with stubbed React and DOM.
 * @returns {Promise<{ module: object, effects: Array<{ label: string, dispose: Function }>, registrations: object[] }>}
 *   the plugin object and what `apply` registered.
 */
async function loadClient() {
  const source = await readFile(CLIENT, 'utf8');
  const registrations = [];
  const loaded = [];
  const effects = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    useCallback: (fn) => fn,
  };
  const styleTags = [];
  const document = {
    baseURI: 'https://dsh.example/',
    head: { appendChild: (tag) => { styleTags.push(tag); } },
    createElement: () => ({ dataset: {}, textContent: '', remove: () => { styleTags.pop(); } }),
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          loaded.push(definition);
        },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      innerWidth: 1440,
      innerHeight: 900,
    },
    document,
    console,
    URL,
    XMLHttpRequest: class {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  vm.runInNewContext(source, sandbox, { filename: 'client.js' });

  assert.equal(loaded.length, 1, 'the module registers exactly one factory');
  assert.equal(loaded[0].id, '@local/workspace-upload');
  const plugin = loaded[0].factory((name) => {
    if (name === 'react') return React;
    if (name === 'react-dom') return { createPortal: (element) => element };
    throw new Error(`unexpected require(${name})`);
  });
  const ctx = {
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose });
      return dispose;
    },
    locale: {
      register(namespace, dictionaries) {
        registrations.push({ kind: 'locale', namespace, dictionaries });
        return () => {};
      },
    },
    slots: {
      inject(key, callback) {
        registrations.push({ kind: 'inject', key });
        callback();
        return () => {};
      },
      register(options, component) {
        registrations.push({ kind: 'register', options, component });
        return () => {};
      },
    },
  };
  plugin.apply(ctx);
  return { module: plugin, internals: plugin.__internals, effects, registrations, styleTags };
}

test('registers the Files page entry through the slot system', async () => {
  const { module, registrations } = await loadClient();
  assert.deepEqual([...module.inject], ['contextMenus', 'slots', 'locale']);
  const inject = registrations.find((entry) => entry.kind === 'inject');
  assert.equal(inject.key, 'sidebar.right.tab.files.actions');
  const registration = registrations.find((entry) => entry.kind === 'register');
  assert.equal(registration.options.name, 'sidebar.right.tab.files.actions');
  assert.equal(registration.options.id, 'workspace-upload');
  assert.equal(registration.options.locale, 'workspaceUpload');
  assert.equal(typeof registration.options.order, 'number');
  assert.equal(typeof registration.component, 'function');
});

test('registers English and Chinese dictionaries with identical keys', async () => {
  const { registrations } = await loadClient();
  const locale = registrations.find((entry) => entry.kind === 'locale');
  assert.equal(locale.namespace, 'workspaceUpload');
  assert.deepEqual(Object.keys(locale.dictionaries).sort(), ['en', 'zh']);
  const english = Object.keys(locale.dictionaries.en).sort();
  const chinese = Object.keys(locale.dictionaries.zh).sort();
  assert.deepEqual(english, chinese, 'both dictionaries describe the same keys');
});

test('installs one removable stylesheet', async () => {
  const { effects, styleTags } = await loadClient();
  const style = effects.find((entry) => entry.label === 'workspace-upload: styles');
  assert.ok(style !== undefined, 'a styles effect is registered');
  assert.equal(styleTags.length, 1);
  assert.match(styleTags[0].textContent, /\.wu-button/);
  style.dispose();
  assert.equal(styleTags.length, 0, 'disposing the plugin removes its stylesheet');
});
/** Translator stand-in that keeps the key and its parameters visible in assertions. */
const t = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`);

test('renders the upload outcome copy for every terminal state', async () => {
  const { internals } = await loadClient();
  const base = { name: 'notes.txt', savedAs: 'notes.txt', replaced: false, progress: 1, detail: '' };
  assert.equal(internals.statusText({ ...base, state: 'queued' }, t), 'statusQueued');
  assert.equal(internals.statusText({ ...base, state: 'uploading', progress: 0.5 }, t), 'statusUploading:{"percent":50}');
  assert.equal(internals.statusText({ ...base, state: 'saving' }, t), 'statusSaving');
  assert.equal(internals.statusText({ ...base, state: 'done' }, t), 'statusDone');
  assert.equal(internals.statusText({ ...base, state: 'done', savedAs: 'notes (1).txt' }, t), 'statusRenamed:{"name":"notes (1).txt"}');
  assert.equal(internals.statusText({ ...base, state: 'done', replaced: true }, t), 'statusReplaced');
  assert.equal(internals.statusText({ ...base, name: '.env', savedAs: '.env', state: 'done' }, t), 'statusHidden');
  assert.equal(internals.statusText({ ...base, state: 'cancelled' }, t), 'statusCancelled');
  assert.equal(internals.statusText({ ...base, state: 'error', code: 'too-large' }, t), 'errorTooLarge');
});

test('maps every Host failure code to localized copy and keeps detail out of it', async () => {
  const { internals } = await loadClient();
  const cases = {
    network: 'errorNetwork',
    'too-large': 'errorTooLarge',
    'unsupported-media-type': 'errorRejected',
    rejected: 'errorRejected',
    unauthorized: 'errorUnauthorized',
    'session-unavailable': 'errorNoSession',
    'invalid-session': 'errorNoSession',
    'workspace-unavailable': 'errorNoSession',
    'working-directory-unavailable': 'errorNoSession',
    'working-directory-failed': 'errorNoSession',
    'path-outside-workspace': 'errorOutside',
    'directory-failed': 'errorDirectory',
    'invalid-directory': 'errorDirectory',
    'name-conflict': 'errorName',
    'name-unavailable': 'errorName',
    'directory-target': 'errorName',
    'symlink-target': 'errorName',
    'invalid-name': 'errorName',
    'request-aborted': 'statusCancelled',
    cancelled: 'statusCancelled',
    http: 'errorUpload',
    'upload-failed': 'errorFailed',
    'publish-failed': 'errorFailed',
  };
  for (const [code, expected] of Object.entries(cases)) {
    assert.equal(internals.errorText({ state: 'error', code, detail: 'EACCES: /secret/path' }, t), expected, code);
  }
});

test('normalizes relative paths and splits them for the route', async () => {
  const { internals } = await loadClient();
  assert.equal(internals.normalizeRelative('a\\b/../c/./d'), 'a/c/d');
  assert.equal(internals.normalizeRelative('/folder/sub/'), 'folder/sub');
  assert.equal(internals.normalizeRelative(undefined), '');
  assert.deepEqual({ ...internals.splitUploadPath('folder/sub/a.txt') }, { dir: 'folder/sub', name: 'a.txt' });
  assert.deepEqual({ ...internals.splitUploadPath('a.txt') }, { dir: '', name: 'a.txt' });
});

test('creates only the directories no uploaded file implies', async () => {
  const { internals } = await loadClient();
  const entries = [{ label: 'folder/a.txt' }, { label: 'folder/sub/b.txt' }];
  assert.deepEqual(
    [...internals.emptyDirectories(entries, ['folder', 'folder/empty', 'folder/sub', 'folder/sub/deeper'])],
    ['folder/empty', 'folder/sub/deeper'],
  );
  assert.deepEqual([...internals.emptyDirectories([], ['empty/sub'])], ['empty/sub']);
  assert.deepEqual([...internals.emptyDirectories([{ label: 'a.txt' }], [])], []);
});

test('collects a dropped folder recursively and keeps its paths', async () => {
  const { internals } = await loadClient();
  const file = (name, size) => ({
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve) => { queueMicrotask(() => resolve({ name, size })); },
  });
  const directory = (name, children) => ({
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let served = false;
      return {
        readEntries: (callback) => {
          const batch = served ? [] : children;
          served = true;
          queueMicrotask(() => callback(batch));
        },
      };
    },
  });
  const tree = directory('proj', [
    file('a.txt', 3),
    directory('src', [file('main.js', 4)]),
    directory('empty', []),
  ]);
  const collected = await internals.collectDropped({
    items: [{ kind: 'file', webkitGetAsEntry: () => tree }],
  });
  assert.deepEqual([...collected.entries.map((entry) => entry.relative).sort()], ['proj/a.txt', 'proj/src/main.js']);
  assert.deepEqual([...collected.directories].sort(), ['proj', 'proj/empty', 'proj/src']);

  const plain = await internals.collectDropped({ files: [{ name: 'x.txt', size: 1 }] });
  assert.equal(plain.entries.length, 1);
  assert.equal(plain.entries[0].relative, 'x.txt');
});

test('places the panel below or above the control and ignores hidden geometry', async () => {
  const { internals } = await loadClient();
  const below = internals.panelPosition({
    getBoundingClientRect: () => ({ top: 100, bottom: 128, left: 1000, right: 1028, width: 28, height: 28 }),
  });
  assert.equal(below.top, 134);
  assert.equal(below.width, 360);
  assert.equal(below.maxHeight, 360);
  assert.equal(below.left, 668);

  assert.equal(internals.panelPosition({
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
  }), null);

  assert.equal(internals.samePosition({ top: 1, left: 2, width: 3, maxHeight: 4 }, { top: 1, left: 2, width: 3, maxHeight: 4 }), true);
  assert.equal(internals.samePosition({ top: 1, left: 2, width: 3, maxHeight: 4 }, { top: 1, left: 2, width: 3, maxHeight: 5 }), false);
  assert.equal(internals.samePosition(null, null), true);
});

test('formats byte sizes for the panel', async () => {
  const { internals } = await loadClient();
  assert.equal(internals.formatBytes(0), '0 B');
  assert.equal(internals.formatBytes(999), '999 B');
  assert.equal(internals.formatBytes(500 * 1024 * 1024), '500 MB');
  assert.equal(internals.formatBytes(1536), '1.50 KB');
});
