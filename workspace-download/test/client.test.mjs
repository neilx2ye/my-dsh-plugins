import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const CLIENT = join(import.meta.dirname, '..', 'client.js');

/**
 * Load the browser half inside a sandbox with stubbed React and DOM.
 * @returns {Promise<object>} the plugin object, its effects, and what `apply` registered.
 */
async function loadClient() {
  const source = await readFile(CLIENT, 'utf8');
  const registrations = [];
  const loaded = [];
  const effects = [];
  const styleTags = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  };
  const document = {
    baseURI: 'https://dsh.example/',
    body: { appendChild: () => {}, removeChild: () => {} },
    head: { appendChild: (tag) => { styleTags.push(tag); } },
    createElement: () => ({
      dataset: {}, style: {}, textContent: '', href: '', download: '',
      remove: () => { styleTags.pop(); }, click: () => {},
    }),
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(definition) { loaded.push(definition); },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    document,
    console,
    URL,
    Response,
    fetch: async () => new Response(null, { status: 200 }),
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  vm.runInNewContext(source, sandbox, { filename: 'client.js' });

  assert.equal(loaded.length, 1, 'the module registers exactly one factory');
  assert.equal(loaded[0].id, '@local/workspace-download');
  const plugin = loaded[0].factory((name) => {
    if (name === 'react') return React;
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
      bind(namespace) {
        const scope = namespace;
        const t = (key) => `${scope}:${key}`;
        return t;
      },
    },
    contextMenus: {
      register(contribution) {
        registrations.push({ kind: 'menu', contribution });
        return () => {};
      },
      notify() {},
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

test('registers a directory menu action and two header controls', async () => {
  const { module, registrations } = await loadClient();
  assert.deepEqual([...module.inject], ['contextMenus', 'slots', 'locale']);

  const menu = registrations.find((entry) => entry.kind === 'menu');
  assert.equal(menu.contribution.id, 'workspace-download.directory');
  assert.equal(menu.contribution.target, 'directory');
  assert.equal(menu.contribution.order, 150);
  const actions = menu.contribution.resolve({ sessionId: 's', path: '/w/docs' }, new AbortController().signal);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, 'downloadZip');
  assert.equal(actions[0].label, 'workspaceDownload:zip');
  assert.equal(actions[0].icon.key, 'workspace-download.zip');
  assert.equal(typeof actions[0].run, 'function');

  const regs = registrations.filter((entry) => entry.kind === 'register');
  assert.ok(regs.some((entry) => entry.options.name === 'contextMenu.icon' && entry.options.key === 'workspace-download.zip'));
  const slots = regs.filter((entry) => entry.options.name !== 'contextMenu.icon').map((entry) => entry.options);
  assert.deepEqual(slots.map((options) => options.name), [
    'sidebar.right.tab.document.actions',
    'sidebar.right.tab.files.actions',
  ]);
  for (const options of slots) {
    assert.equal(options.id, 'workspace-download');
    assert.equal(options.order, 5);
    assert.equal(options.locale, 'workspaceDownload');
  }
  const components = regs.filter((entry) => entry.options.name !== 'contextMenu.icon');
  assert.equal(typeof components[0].component, 'function');
  assert.equal(typeof components[1].component, 'function');

  assert.ok(registrations.some((entry) => entry.kind === 'inject' && entry.key === 'contextMenu.icon'));
});

test('registers English and Chinese dictionaries with identical keys', async () => {
  const { registrations } = await loadClient();
  const locale = registrations.find((entry) => entry.kind === 'locale');
  assert.equal(locale.namespace, 'workspaceDownload');
  assert.deepEqual(Object.keys(locale.dictionaries).sort(), ['en', 'zh']);
  assert.deepEqual(
    Object.keys(locale.dictionaries.en).sort(),
    Object.keys(locale.dictionaries.zh).sort(),
    'both dictionaries describe the same keys',
  );
});

test('installs one removable stylesheet', async () => {
  const { effects, styleTags } = await loadClient();
  const style = effects.find((entry) => entry.label === 'workspace-download: styles');
  assert.ok(style !== undefined, 'a styles effect is registered');
  assert.equal(styleTags.length, 1);
  assert.match(styleTags[0].textContent, /\.wd-button/);
  style.dispose();
  assert.equal(styleTags.length, 0);
});

test('builds route URLs against the document base', async () => {
  const { internals } = await loadClient();
  const url = internals.downloadUrl('api/workspace-download/zip', 'session-1', '/root/工作区');
  assert.equal(url.origin, 'https://dsh.example');
  assert.equal(url.pathname, '/api/workspace-download/zip');
  assert.equal(url.searchParams.get('sessionId'), 'session-1');
  assert.equal(url.searchParams.get('path'), '/root/工作区');
});

test('reads the Host code from a HEAD header and falls back by status', async () => {
  const { internals } = await loadClient();
  const header = await internals.failureOf(new Response(null, {
    status: 404,
    headers: { 'x-workspace-download-code': 'file-unavailable' },
  }));
  assert.equal(header.code, 'file-unavailable');

  assert.equal((await internals.failureOf(new Response(null, { status: 401 }))).code, 'unauthorized');
  assert.equal((await internals.failureOf(new Response(null, { status: 404 }))).code, 'file-unavailable');
  assert.equal((await internals.failureOf(new Response('<html>', { status: 403 }))).code, 'rejected');
  assert.equal((await internals.failureOf(new Response('<html>', { status: 413 }))).code, 'too-large');
  assert.equal((await internals.failureOf(new Response(null, { status: 503 }))).code, 'session-unavailable');
  const coded = await internals.failureOf(new Response(JSON.stringify({ code: 'path-outside-workspace' }), { status: 403 }));
  assert.equal(coded.code, 'path-outside-workspace');
});

test('maps every Host failure code to localized copy', async () => {
  const { internals } = await loadClient();
  const t = (key) => `copy:${key}`;
  const cases = {
    'too-large': 'errorTooLarge',
    'too-many-entries': 'errorTooMany',
    'path-outside-workspace': 'errorOutside',
    'not-a-directory': 'errorNotDirectory',
    'not-a-regular-file': 'errorNotFile',
    'file-unavailable': 'errorUnavailable',
    'directory-unavailable': 'errorUnavailable',
    'session-unavailable': 'errorNoSession',
    'invalid-session': 'errorNoSession',
    'working-directory-unavailable': 'errorNoSession',
    'working-directory-failed': 'errorNoSession',
    'invalid-path': 'errorInvalidPath',
    unauthorized: 'errorUnauthorized',
    rejected: 'errorRejected',
    network: 'errorNetwork',
    'archive-failed': 'errorFailed',
    'read-failed': 'errorFailed',
  };
  for (const [code, expected] of Object.entries(cases)) {
    assert.equal(internals.failureText(new internals.DownloadFailure(code, 0), t), `copy:${expected}`, code);
  }
  assert.equal(internals.failureText(new Error('boom'), t), 'copy:errorNetwork');
});