import assert from 'node:assert/strict';
import test from 'node:test';

import { conversationsToClear } from '../lib/conversations.js';

test('a reset keeps the new Session and skips archived, group, and participant Sessions', () => {
  assert.deepEqual(
    conversationsToClear(['old-1', 'new', 'old-2', 'group-host', 'guest', 'gone'], {
      keep: 'new',
      archived: ['gone'],
      excluded: ['group-host', 'guest'],
    }),
    ['old-1', 'old-2'],
  );
});

test('a reset tolerates repeated, empty, and non-string entries', () => {
  assert.deepEqual(
    conversationsToClear(['a', 'a', '', null, 42, 'b'], { keep: 'c' }),
    ['a', 'b'],
  );
});

test('a reset without workspace Sessions clears nothing', () => {
  assert.deepEqual(conversationsToClear(undefined, { keep: 'new' }), []);
  assert.deepEqual(conversationsToClear([], { keep: 'new' }), []);
});

test('a blank keep never hides an id', () => {
  assert.deepEqual(conversationsToClear(['a'], { keep: '' }), ['a']);
});