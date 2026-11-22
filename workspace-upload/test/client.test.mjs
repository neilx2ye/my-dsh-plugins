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
  return { module: plugin, effects, registrations, styleTags };
}

test('registers the Files page entry through the slot system', async () => {
  const { module, registrations } = await loadClient();
  assert.deepEqual([...module.inject], ['slots', 'locale']);
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