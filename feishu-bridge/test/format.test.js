import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistantTextForTurn,
  inferImageMediaType,
  resourceNote,
  shortTitle,
  stripBotMention,
  textOfAssistantEvent,
  textOfContent,
  turnFailureText,
} from '../lib/format.js';

test('assistant text joins only text blocks and trims', () => {
  assert.equal(
    textOfContent([
      { type: 'text', text: 'hello ' },
      { type: 'tool-call', name: 'x' },
      { type: 'text', text: 'world' },
    ]),
    'hello world',
  );
  assert.equal(textOfContent(undefined), '');
});

test('assistant text skips replacement nodes and keeps log order', () => {
  const events = [
    { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'one' }] } } },
    { type: 'user/message', data: { turn: 1 } },
    {
      type: 'assistant/message',
      data: { turn: 1, message: { content: [{ type: 'text', text: 'two' }] } },
      surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 },
    },
    { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: 'other turn' }] } } },
  ];
  assert.equal(assistantTextForTurn(events, 1), 'one');
  assert.equal(assistantTextForTurn(events), 'one\n\nother turn');
  assert.equal(textOfAssistantEvent(events[0]), 'one');
});

test('turn failures render a short user-facing line', () => {
  assert.equal(turnFailureText({ kind: 'completed' }), '');
  assert.equal(turnFailureText({ kind: 'error', error: { message: 'model down' } }), '处理失败：model down');
  assert.equal(turnFailureText({ kind: 'blocked' }), '这次请求被拦下了，没有执行。');
  assert.equal(turnFailureText({ kind: 'max-tokens' }), '回复达到长度上限，已截断。');
});

test('image media types are recognized from magic bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  const gif = Buffer.from('GIF89a______', 'ascii');
  assert.equal(inferImageMediaType(png), 'image/png');
  assert.equal(inferImageMediaType(jpeg), 'image/jpeg');
  assert.equal(inferImageMediaType(webp), 'image/webp');
  assert.equal(inferImageMediaType(gif), 'image/gif');
  assert.equal(inferImageMediaType(Buffer.from('not an image')), undefined);
});

test('a group message loses the bot mention but keeps other text', () => {
  assert.equal(
    stripBotMention('@DSH 帮我看下 /tmp', [
      { name: 'DSH', isBot: true },
      { name: 'Ada', isBot: false },
    ]),
    '帮我看下 /tmp',
  );
  assert.equal(stripBotMention('@Ada hi', [{ name: 'Ada', isBot: false }]), '@Ada hi');
  assert.equal(stripBotMention('  hi  ', undefined), 'hi');
});

test('resource notes name each unsupported type once', () => {
  assert.equal(resourceNote([{ type: 'file' }, { type: 'file' }, { type: 'video' }]), '（收到 文件、视频，其中无法读取的内容已省略）');
  assert.equal(resourceNote([]), '');
});

test('titles are single-line and bounded', () => {
  assert.equal(shortTitle('  飞书群 · 研发  '), '飞书群 · 研发');
  assert.equal(shortTitle(''), '飞书对话');
  assert.equal(shortTitle('x'.repeat(60)).endsWith('…'), true);
});