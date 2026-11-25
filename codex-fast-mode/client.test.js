import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

for (const prefix of ['/', '/techpod/']) {
  test(`reads and saves Fast Mode via the application's base ${prefix}`, async () => {
    const baseURI = `https://dsh.example${prefix}`;
    const calls = [];
    let module;
    let option;
    let selected = 'other-provider';
    let effect;
    const initial = [{ enabled: false, last: null }, false, null];
    const react = {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useId: () => 'description',
      useState: () => [initial.shift(), () => {}],
      useReducer: () => [0, () => {}],
      useRef: () => ({ current: false }),
      useEffect: (run) => { effect = run; },
      useSyncExternalStore: (_listen, snapshot) => snapshot(),
    };
    runInNewContext(client, {
      URL, AbortController, AbortSignal, setTimeout, clearTimeout,
      document: { baseURI },
      window: { __ModuleLoader__: { load: ({ factory }) => { module = factory(() => react); } } },
      fetch: async (url, init) => {
        calls.push([String(url), init.method ?? 'GET', init.body]);
        return Response.json({ enabled: init.method === 'POST' });
      },
    });
    module.apply({ effect() {}, slots: { inject: (_seat, mount) => mount(), register: (_def, render) => { option = render; } } });
    const props = { directory: { getSnapshot: () => ({ current: { provider: selected } }) }, sessionId: 'a & b', t: key => key };
    assert.equal(option(props), null);
    selected = 'openai-codex';
    const element = option(props);
    const switchTree = element.type(element.props);
    const cleanup = effect();
    try {
      await new Promise(resolve => setImmediate(resolve));
      const button = switchTree.children.find(child => child.type === 'button');
      await button.props.onClick();
      assert.deepEqual(calls, [
        [`https://dsh.example${prefix}api/codex-fast-mode?sessionId=a+%26+b`, 'GET', undefined],
        [`https://dsh.example${prefix}api/codex-fast-mode?sessionId=a+%26+b`, 'POST', '{"enabled":true}'],
      ]);
    } finally {
      cleanup();
    }
  });
}
