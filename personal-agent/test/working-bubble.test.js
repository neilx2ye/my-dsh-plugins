import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Exercise the working-bubble rule without rendering the browser components.
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
let factory;
new Function('window', 'localStorage', source)(
  { __ModuleLoader__: { load(module) { factory = module.factory; } } },
  { getItem: () => null },
);
const { isTurnQuiet } = factory(() => ({ createElement() {} })).__progress;

const MINUTE = 60_000;

test('a running turn with fresh activity is never called stuck', () => {
  const now = 10 * MINUTE;
  assert.equal(
    isTurnQuiet({
      now,
      activity: { s1: now - 1_000 },
      running: [{ id: 's1' }],
      quietMs: 2 * MINUTE,
    }),
    false,
  );
});

test('silence past the threshold admits the turn may be stuck', () => {
  const now = 10 * MINUTE;
  assert.equal(
    isTurnQuiet({
      now,
      activity: { s1: now - 2 * MINUTE },
      running: [{ id: 's1' }],
      quietMs: 2 * MINUTE,
    }),
    true,
  );
  assert.equal(
    isTurnQuiet({
      now,
      activity: { s1: now - 90_000 },
      running: [{ id: 's1' }],
      quietMs: 2 * MINUTE,
    }),
    false,
  );
});

test('the most recently active running Session keeps the bubble quiet', () => {
  const now = 10 * MINUTE;
  assert.equal(
    isTurnQuiet({
      now,
      activity: { busy: now - 120_000, other: now - 5_000 },
      running: [{ id: 'busy' }, { id: 'other' }],
      quietMs: 2 * MINUTE,
    }),
    false,
  );
});

test('no running turn, unknown activity, or missing Host clock stays quiet', () => {
  const now = 10 * MINUTE;
  assert.equal(isTurnQuiet({ now, activity: {}, running: [], quietMs: 2 * MINUTE }), false);
  // Nothing observed is not evidence of being stuck.
  assert.equal(isTurnQuiet({ now, activity: {}, running: [{ id: 's1' }], quietMs: 2 * MINUTE }), false);
  // The Host clock comes from the same snapshot as the activity stamps.
  assert.equal(
    isTurnQuiet({ now: undefined, activity: { s1: now - 9 * MINUTE }, running: [{ id: 's1' }], quietMs: 2 * MINUTE }),
    false,
  );
});

test('a long turn that keeps streaming is not stuck at the two-minute mark', () => {
  let now = 0;
  let last = 0;
  for (let second = 0; second < 300; second += 1) {
    now = second * 1_000;
    // A token arrives every two seconds for five minutes.
    if (second % 2 === 0) last = now;
    assert.equal(isTurnQuiet({ now, activity: { s1: last }, running: [{ id: 's1' }], quietMs: 2 * MINUTE }), false);
  }
});