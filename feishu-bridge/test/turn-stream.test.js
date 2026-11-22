import assert from 'node:assert/strict';
import test from 'node:test';

import { TurnStream } from '../lib/turn-stream.js';

test('deltas are appended in order and the final text is authoritative', async () => {
  const appended = [];
  let final = '';
  const stream = new TurnStream(async (producer) => {
    await producer({
      append: async (chunk) => appended.push(chunk),
      setContent: async (text) => {
        final = text;
      },
    });
    return { messageId: 'om_1' };
  });
  stream.push('Hello');
  stream.push(' world');
  await stream.close('Hello world!');
  assert.deepEqual(appended, ['Hello', ' world']);
  assert.equal(final, 'Hello world!');
});

test('closing before the producer starts still writes the final text', async () => {
  let final = '';
  const stream = new TurnStream(async (producer) => {
    await producer({
      append: async () => undefined,
      setContent: async (text) => {
        final = text;
      },
    });
  });
  await stream.close('only this');
  assert.equal(final, 'only this');
});

test('a failed card stream is observable', async () => {
  const stream = new TurnStream(async () => {
    throw new Error('card permission denied');
  });
  await assert.rejects(stream.close('text'), /card permission denied/);
  assert.match(stream.failed.message, /card permission denied/);
});

test('fail closes the stream with a final line', async () => {
  let final = '';
  const stream = new TurnStream(async (producer) => {
    await producer({
      append: async () => undefined,
      setContent: async (text) => {
        final = text;
      },
    });
  });
  stream.fail('服务已停止。');
  await stream.promise;
  assert.equal(final, '服务已停止。');
});