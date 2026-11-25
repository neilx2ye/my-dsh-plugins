import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { apply, loadSdkModels } from './index.js';
import { attachFastMode } from './fast.js';

const official = { provider: 'openai-codex', api: 'openai-codex-responses', baseUrl: 'https://chatgpt.com/backend-api' };

test('passes through disabled, other-session, non-Codex and non-official requests', async () => {
  const prototype = { streamSimple(model, context, options) { return options; } };
  const original = prototype.streamSimple;
  const mode = attachFastMode(prototype);
  const a = { sessionId: 'a' };
  const b = { sessionId: 'b' };
  assert.deepEqual(mode.statusOf('a'), { enabled: false, last: null });
  assert.equal(prototype.streamSimple(official, {}, a), a);
  mode.setEnabled('a', true);
  assert.equal(prototype.streamSimple(official, {}, b), b);
  assert.equal(prototype.streamSimple({ ...official, provider: 'openai' }, {}, a), a);
  assert.equal(prototype.streamSimple({ ...official, baseUrl: 'https://chatgpt.com.example.net/backend-api' }, {}, a), a);
  const hooked = prototype.streamSimple(official, {}, { ...a, onPayload: () => ({ kept: true }) });
  assert.deepEqual(await hooked.onPayload({}, { ...official, baseUrl: 'https://gateway.test/backend-api' }), { kept: true });
  assert.deepEqual(await hooked.onPayload({}, official), { kept: true, service_tier: 'priority' });
  await hooked.onProviderStreamEvent({ type: 'response.completed', response: { service_tier: 'default' } }, official);
  assert.deepEqual(mode.statusOf('a').last, { phase: 'ended', reported: 'default' });
  const failed = prototype.streamSimple(official, {}, a);
  await failed.onPayload({}, official);
  await failed.onProviderStreamEvent({ type: 'response.failed', response: { service_tier: 'priority' } }, official);
  assert.deepEqual(mode.statusOf('a').last, { phase: 'failed' });
  mode.setEnabled('a', false);
  assert.deepEqual(await hooked.onPayload({}, official), { kept: true });
  assert.equal(prototype.streamSimple(official, {}, a), a);
  mode.dispose();
  assert.equal(prototype.streamSimple, original);
});

const installDir = process.env.DSH_INSTALL_DIR;
test('the menu endpoint changes the installed Codex wire body and reports the unmodified server tier', { skip: !installDir && 'requires DSH_INSTALL_DIR' }, async () => {
  const installAnchor = join(installDir, 'package.json');
  const { createModels } = await loadSdkModels(installAnchor);
  const { builtinModels } = await import(pathToFileURL(join(installDir, 'node_modules/@earendil-works/pi-ai/dist/providers/all.js')).href);
  const models = builtinModels();
  const prototype = Object.getPrototypeOf(models);
  const original = prototype.streamSimple;
  let route;
  let dispose;
  await apply({
    get: () => ({ installAnchor }),
    effect: (fn) => { const disposers = [...fn()]; dispose = () => disposers.reverse().forEach((f) => f()); },
    sessions: new Map([['a', {}], ['b', {}]]),
    connection: { fetch: { register: (definition) => { route = definition; return () => { route = undefined; }; } } },
  });
  try {
    assert.equal(prototype, Object.getPrototypeOf(createModels()));
    const model = models.getModel('openai-codex', 'gpt-6.2-sol');
    assert.ok(model);
    const request = (id, init) => route.fetch(new Request(`https://dsh.test${route.path}?sessionId=${id}`, init));
    const read = async (id) => (await request(id)).json();
    const set = (id, enabled, extra = {}) => request(id, { method: 'POST',
      headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify({ enabled }) });
    const bodies = [];
    const credential = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture' } })).toString('base64')}.signature`;
    models.getAuth = async () => ({ auth: { apiKey: credential } });
    const stream = async (sessionId, tier) => {
      const events = models.streamSimple(model, { messages: [] }, {
        apiKey: credential, sessionId, transport: 'sse', maxRetries: 0,
        fetch: async (url, init) => {
          assert.equal(new URL(url).origin, 'https://chatgpt.com');
          const body = init.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(init.body) : init.body;
          bodies.push(JSON.parse(body));
          const end = { type: 'response.completed', response: { id: 'r', status: 'completed', output: [], service_tier: tier } };
          return new Response(`data: ${JSON.stringify(end)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
        },
      });
      for await (const event of events) assert.notEqual(event.type, 'error', event.error?.errorMessage);
    };
    assert.deepEqual(await read('a'), { enabled: false, last: null });
    assert.equal((await set('q', true)).status, 404);
    assert.equal((await set('a', true, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await set('a', 'yes')).status, 400);
    assert.equal((await set('a', true, { 'content-type': 'text/plain' })).status, 415);
    assert.deepEqual(await read('a'), { enabled: false, last: null });
    assert.equal((await (await set('a', true)).json()).enabled, true);
    await Promise.all([stream('a', 'priority'), stream('b', 'default')]);
    assert.equal(bodies[0].reasoning?.effort, bodies[1].reasoning?.effort);
    assert.equal(bodies.find((b) => b.prompt_cache_key === 'a').service_tier, 'priority');
    assert.equal(bodies.find((b) => b.prompt_cache_key === 'b').service_tier, undefined);
    assert.deepEqual((await read('a')).last, { phase: 'ended', reported: 'priority' });
    await stream('a', undefined);
    assert.deepEqual((await read('a')).last, { phase: 'ended' });
    assert.equal((await (await set('a', false)).json()).enabled, false);
    await stream('a', 'default');
    assert.equal(bodies.at(-1).service_tier, undefined);
  } finally {
    dispose();
  }
  assert.equal(prototype.streamSimple, original);
  assert.equal(route, undefined);
});
