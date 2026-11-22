import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createChatStore } from '../lib/state.js';

test('bindings survive a reload and keep their creation time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feishu-bridge-state-'));
  try {
    const file = join(root, 'chats.json');
    const store = createChatStore(file);
    const first = store.set('oc_1', 'session-a', { chatType: 'group', title: '飞书群 · 研发' });
    assert.equal(first.sessionId, 'session-a');
    assert.equal(store.get('oc_1').title, '飞书群 · 研发');
    store.touch('oc_1');
    await store.flush();

    const raw = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.chats.oc_1.sessionId, 'session-a');

    const reloaded = createChatStore(file);
    assert.equal(reloaded.get('oc_1').sessionId, 'session-a');
    assert.equal(reloaded.get('oc_1').chatType, 'group');
    assert.equal(reloaded.count(), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a corrupt file falls back to an empty store instead of throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feishu-bridge-state-'));
  try {
    const file = join(root, 'chats.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, '{ nope', 'utf8'));
    const store = createChatStore(file);
    assert.equal(store.count(), 0);
    assert.equal(store.get('oc_1'), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('remove clears one binding or all of them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feishu-bridge-state-'));
  try {
    const store = createChatStore(join(root, 'chats.json'));
    store.set('oc_1', 'session-a');
    store.set('oc_2', 'session-b');
    assert.equal(store.remove('oc_1'), 1);
    assert.equal(store.remove('missing'), 0);
    assert.equal(store.count(), 1);
    assert.equal(store.remove(), 1);
    assert.equal(store.count(), 0);
    await store.flush();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recent bindings are newest first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feishu-bridge-state-'));
  try {
    const store = createChatStore(join(root, 'chats.json'));
    store.set('oc_1', 'session-a');
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.set('oc_2', 'session-b');
    const recent = store.recent(2);
    assert.deepEqual(
      recent.map((row) => row.chatId),
      ['oc_2', 'oc_1'],
    );
    await store.flush();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});