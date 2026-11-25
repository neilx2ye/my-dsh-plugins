import assert from 'node:assert/strict';
import test from 'node:test';

import { createActivityLog } from '../lib/activity.js';

test('activity moves only when a Session does something', () => {
  let clock = 1_000;
  const log = createActivityLog({ now: () => clock });
  assert.equal(log.lastActivity('s1'), 0);
  log.touch('s1');
  assert.equal(log.lastActivity('s1'), 1_000);
  clock = 2_500;
  // Silence leaves the timestamp where it was.
  assert.equal(log.lastActivity('s1'), 1_000);
  log.touch('s1');
  assert.equal(log.lastActivity('s1'), 2_500);
});

test('each Session keeps its own timestamp', () => {
  let clock = 10;
  const log = createActivityLog({ now: () => clock });
  log.touch('a');
  clock = 20;
  log.touch('b');
  assert.deepEqual(log.snapshot(), { a: 10, b: 20 });
  assert.equal(log.lastActivity('c'), 0);
});

test('blank and missing ids are ignored', () => {
  const log = createActivityLog({ now: () => 5 });
  log.touch(undefined);
  log.touch(null);
  log.touch('');
  assert.deepEqual(log.snapshot(), {});
});

test('the log keeps the most recently active Sessions', () => {
  let clock = 0;
  const log = createActivityLog({ now: () => (clock += 1), limit: 2 });
  log.touch('old');
  log.touch('middle');
  log.touch('new');
  assert.deepEqual(Object.keys(log.snapshot()), ['middle', 'new']);
  // Re-touching an old Session makes it the newest instead of duplicating it.
  log.touch('middle');
  assert.deepEqual(Object.keys(log.snapshot()), ['new', 'middle']);
});

test('a snapshot is a copy, not the live map', () => {
  let clock = 1;
  const log = createActivityLog({ now: () => clock });
  log.touch('s');
  const copy = log.snapshot();
  clock = 2;
  log.touch('s');
  assert.deepEqual(copy, { s: 1 });
  assert.deepEqual(log.snapshot(), { s: 2 });
});