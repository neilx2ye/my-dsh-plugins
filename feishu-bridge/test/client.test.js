import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * Load the browser bundle's factory without a browser.
 * @param {string} source - client.js source.
 * @returns the registered module.
 */
function loadClientModule(source) {
  let registration = null;
  const inert = { createElement: () => null, useState: () => [], useEffect: () => undefined, useCallback: (fn) => fn };
  const require = (id) => (id === 'react' ? inert : {});
  const element = () => ({ dataset: {}, style: {}, remove() {}, appendChild() {}, textContent: '' });
  const document = {
    head: element(),
    querySelector: () => null,
    createElement: () => element(),
    visibilityState: 'visible',
  };
  const window = { __ModuleLoader__: { load(module) { registration = module; } } };
  const run = new Function('window', 'document', 'navigator', 'localStorage', 'fetch', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'require', source);
  run(
    window,
    document,
    { language: 'zh-CN', languages: ['zh-CN'] },
    { getItem: () => null, setItem() {}, removeItem() {} },
    async () => ({ ok: true, status: 200, json: async () => ({}) }),
    console,
    () => 0,
    () => {},
    () => 0,
    () => {},
    require,
  );
  assert.notEqual(registration, null, 'the bundle registers one client module');
  return registration;
}

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('the client registers one module under the bundle name', () => {
  const registration = loadClientModule(source);
  assert.equal(registration.id, '@local/feishu-bridge');
  assert.equal(typeof registration.factory, 'function');
});

test('the Settings section and icon register under the same id', () => {
  const { factory } = loadClientModule(source);
  const client = factory((id) => (id === 'react' ? { createElement: () => null, useState: () => [], useEffect: () => undefined, useCallback: (fn) => fn } : {}));
  const registrations = [];
  const disposers = [];
  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: () => () => undefined,
    },
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component });
      },
    },
  };
  client.apply(ctx);
  assert.deepEqual(
    registrations.map((entry) => [entry.options.name, entry.options.id]),
    [
      ['settings.section', 'feishu'],
      ['settings.section.icon', 'feishu'],
    ],
  );
  assert.equal(typeof registrations[0].component, 'function');
  assert.equal(typeof registrations[1].component, 'function');
  for (const dispose of disposers) dispose();
});