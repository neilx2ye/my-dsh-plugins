import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Exercise the navigation transaction without rendering the browser components.
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
let factory;
new Function('window', 'localStorage', source)(
  { __ModuleLoader__: { load(module) { factory = module.factory; } } },
  { getItem: () => null },
);
const { followFreshConversation } = factory(() => ({ createElement() {} })).__conversations;

function fixture() {
  const calls = [];
  let active = 'old';
  let openState = 'open';
  let catalog = {};
  const identity = { id: 'ada', freshResetFrom: 'old', freshSessionId: 'new', home: { workspaceId: 'home' } };
  const binding = { session: { getSnapshot: () => ({ openState }) } };
  const args = {
    identity, source: 'old', fromHistory: false,
    stillViewing: () => active === args.source,
    sessions: {
      binding: () => binding,
      list: { getSnapshot: () => ({ byId: catalog }) },
      async refresh() { calls.push('refresh'); catalog = { new: { origin: 'root' } }; },
      async using(id, _options, use) { calls.push(`preload:${id}`); return use({ binding }); },
    },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [], items: [{ workspaceId: 'home', sessionIds: ['old', 'new'] }] }) } },
    ui: { openSession(id) { calls.push(`open:${id}`); active = id; } },
    async acknowledge(id, sessionId) { calls.push(`archive:${id}:${sessionId}`); },
  };
  return { args, calls, navigate: (id) => { active = id; }, setOpenState: (state) => { openState = state; } };
}

test('/new follows the same identity even from history, then archives only after the new composer is open', async () => {
  const { args, calls, setOpenState } = fixture();
  args.fromHistory = true;
  assert.equal(await followFreshConversation(args), true);
  assert.deepEqual(calls, ['refresh', 'preload:new', 'open:new']);
  args.source = 'new';
  setOpenState('loading');
  assert.equal(await followFreshConversation(args), false);
  setOpenState('open');
  assert.equal(await followFreshConversation(args), true);
  assert.deepEqual(calls, ['refresh', 'preload:new', 'open:new', 'archive:ada:new']);
});

test('a failed open leaves the source selected and does not archive its history', async () => {
  const { args, calls, setOpenState } = fixture();
  setOpenState('error');
  assert.equal(await followFreshConversation(args), false);
  assert.deepEqual(calls, ['refresh', 'preload:new']);
});

test('a workspace selection made while the target loads is not overridden', async () => {
  const { args, calls, navigate } = fixture();
  const using = args.sessions.using;
  args.sessions.using = (...params) => {
    navigate('project');
    return using(...params);
  };
  assert.equal(await followFreshConversation(args), false);
  assert.deepEqual(calls, ['refresh', 'preload:new']);
});

test('another session cannot follow a pending reset; tool-driven changes still respect history', async () => {
  const { args, calls, navigate } = fixture();
  args.source = 'other';
  navigate('other');
  assert.equal(await followFreshConversation(args), false);
  args.identity.freshResetFrom = null;
  args.fromHistory = true;
  assert.equal(await followFreshConversation(args), false);
  assert.deepEqual(calls, []);
  args.fromHistory = false;
  assert.equal(await followFreshConversation(args), true);
  args.source = 'new';
  assert.equal(await followFreshConversation(args), false);
  assert.deepEqual(calls, ['refresh', 'preload:new', 'open:new']);
});
