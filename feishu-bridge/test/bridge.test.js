import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FeishuBridge } from '../lib/bridge.js';
import { normalizeConfig } from '../lib/config.js';

/**
 * Build a bridge with a fake Harness context and a fake Feishu channel.
 * @param {object} overrides - settings overrides.
 * @returns the bridge, captured calls, and the fake Session.
 */
async function harness(overrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'feishu-bridge-e2e-'));
  const calls = { create: [], prompt: [], send: [], rename: [], download: [] };
  const session = {
    id: 'session-1',
    seq: 0,
    snapshotEvents: () => [
      {
        type: 'assistant/message',
        data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '来自智能体的回答' }] } },
      },
    ],
  };
  const ctx = {
    get(name) {
      if (name === 'sessionController') {
        return {
          async create(request) {
            calls.create.push(request);
            return { sessionId: 'session-1' };
          },
          async prompt(request) {
            calls.prompt.push(request);
            return { accepted: true };
          },
          async rename(request) {
            calls.rename.push(request);
            return { title: request.title, seq: 1 };
          },
        };
      }
      return undefined;
    },
    sessions: { get: (id) => (id === 'session-1' ? session : undefined) },
    on: () => () => undefined,
    logger: undefined,
  };
  const settings = normalizeConfig({ streaming: false, markdown: true, ...overrides }).value;
  const bridge = new FeishuBridge(ctx, settings, { dataDir, logger: undefined });
  bridge.channel = {
    async send(chatId, input, options) {
      calls.send.push({ chatId, input, options });
      return { messageId: `om_${calls.send.length}` };
    },
    async downloadResource(fileKey) {
      calls.download.push(fileKey);
      return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    },
    async stream(chatId, input, options) {
      calls.stream = { chatId, options, appended: '', content: '' };
      const controller = {
        append: async (text) => {
          calls.stream.appended += text;
        },
        setContent: async (text) => {
          calls.stream.content = text;
        },
      };
      await input.markdown(controller);
      return { messageId: 'om_stream' };
    },
  };
  bridge.botIdentity = { openId: 'ou_bot', name: 'DSH' };
  return { bridge, calls, session, dataDir };
}

/**
 * Build one normalized Feishu message.
 * @param {object} overrides - message fields.
 * @returns the message.
 */
function message(overrides = {}) {
  return {
    messageId: 'om_message_1',
    chatId: 'oc_chat_1',
    chatType: 'p2p',
    senderId: 'ou_user_1',
    senderName: '张三',
    content: '你好',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
    ...overrides,
  };
}

test('a direct message creates one Session and prompts it once', async () => {
  const { bridge, calls, dataDir } = await harness();
  try {
    await bridge.handleMessage(message());
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0].cwd, join(dataDir, 'home'));
    assert.equal(calls.prompt.length, 1);
    assert.equal(calls.prompt[0].sessionId, 'session-1');
    assert.deepEqual(calls.prompt[0].content, [{ type: 'text', text: '你好' }]);
    assert.equal(calls.prompt[0].mode, 'queue');
    assert.equal(calls.prompt[0].requestId, 'feishu:om_message_1');
  } finally {
    await bridge.store.flush();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a duplicate redelivery is ignored and an existing binding is reused', async () => {
  const { bridge, calls, dataDir } = await harness();
  try {
    await bridge.handleMessage(message());
    await bridge.handleMessage(message());
    assert.equal(calls.create.length, 1);
    assert.equal(calls.prompt.length, 1);
    // A second, genuinely new message reuses the bound Session.
    await bridge.handleMessage(message({ messageId: 'om_message_2', content: '再来一条' }));
    assert.equal(calls.create.length, 1);
    assert.equal(calls.prompt.length, 2);
    assert.equal(calls.prompt[1].sessionId, 'session-1');
  } finally {
    await bridge.store.flush();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a group message is labelled with its sender', async () => {
  const { bridge, calls, dataDir } = await harness({ requireMention: false });
  try {
    await bridge.handleMessage(message({ chatId: 'oc_group', chatType: 'group', content: '@DSH 看下这个' }));
    assert.equal(calls.prompt[0].content[0].text, '[张三] @DSH 看下这个');
  } finally {
    await bridge.store.flush();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('an image resource becomes an image prompt part', async () => {
  const { bridge, calls, dataDir } = await harness();
  try {
    await bridge.handleMessage(
      message({
        content: '看图',
        resources: [{ type: 'image', fileKey: 'img_1', fileName: 'a.png' }],
      }),
    );
    assert.deepEqual(calls.download, ['img_1']);
    assert.equal(calls.prompt[0].content[0].type, 'text');
    assert.equal(calls.prompt[0].content[1].type, 'image');
    assert.equal(calls.prompt[0].content[1].mediaType, 'image/png');
  } finally {
    await bridge.store.flush();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a turn end sends the recorded assistant text back to the chat', async () => {
  const { bridge, calls, session, dataDir } = await harness();
  try {
    await bridge.handleMessage(message());
    bridge.onSessionEvent(session, { type: 'turn/start', data: { turn: 1 } });
    bridge.onSessionEvent(session, {
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '来自智能体的回答' }] } },
    });
    bridge.onSessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls.send.length, 1);
    assert.equal(calls.send[0].chatId, 'oc_chat_1');
    assert.deepEqual(calls.send[0].input, { markdown: '来自智能体的回答' });
    assert.equal(calls.send[0].options.replyTo, 'om_message_1');
  } finally {
    await bridge.store.flush();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a failed turn reports the failure when the model produced no text', async () => {
  const { bridge, calls, session, dataDir } = await harness();
  try {
    await bridge.handleMessage(message());
    session.snapshotEvents = () => [];
    bridge.onSessionEvent(session, { type: 'turn/start', data: { turn: 1 } });
    bridge.onSessionEvent(session, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { message: 'model down' } } },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls.send.length, 1);
    assert.match(calls.send[0].input.markdown, /处理失败：model down/);
  } finally {
    await bridge.store.flush();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a message with no readable content is answered without prompting', async () => {
  const { bridge, calls, dataDir } = await harness();
  try {
    await bridge.handleMessage(
      message({ content: '', resources: [{ type: 'file', fileKey: 'file_1', fileName: 'a.pdf' }] }),
    );
    assert.equal(calls.prompt.length, 0);
    assert.equal(calls.create.length, 0);
    assert.equal(calls.send.length, 1);
    assert.match(calls.send[0].input.markdown, /文件/);
  } finally {
    await bridge.store.flush();
    await rm(dataDir, { recursive: true, force: true });
  }
});
test('streaming appends live deltas and finishes with the recorded answer', async () => {
  const { bridge, calls, session, dataDir } = await harness({ streaming: true });
  try {
    await bridge.handleMessage(message());
    bridge.onSessionEvent(session, { type: 'turn/start', data: { turn: 1 } });
    bridge.onAssistantStream({
      agent: { session: { id: 'session-1' } },
      frame: { type: 'chunk', turn: 1, chunk: { type: 'text-delta', text: '来自' } },
    });
    bridge.onAssistantStream({
      agent: { session: { id: 'session-1' } },
      frame: { type: 'chunk', turn: 1, chunk: { type: 'text-delta', text: '智能体的回答' } },
    });
    bridge.onSessionEvent(session, {
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '来自智能体的回答' }] } },
    });
    bridge.onSessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls.send.length, 0, 'a successful card stream does not duplicate the answer as text');
    assert.equal(calls.stream.chatId, 'oc_chat_1');
    assert.equal(calls.stream.options.replyTo, 'om_message_1');
    assert.equal(calls.stream.appended, '来自智能体的回答');
    assert.equal(calls.stream.content, '来自智能体的回答');
  } finally {
    await bridge.store.flush();
    await rm(dataDir, { recursive: true, force: true });
  }
});
