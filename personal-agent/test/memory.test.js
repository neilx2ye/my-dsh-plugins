import assert from 'node:assert/strict';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  appendMemory,
  byteLength,
  countNotes,
  formatNote,
  normalizeMemoryText,
  readMemorySync,
  replaceMemory,
  searchMemory,
  writeMemory,
} from '../lib/memory.js';

const NOW = new Date('2026-11-19T08:00:00Z');

test('note lines are dated, compact, and sanitized', () => {
  assert.equal(formatNote('Likes  tea.\n', 'preferences', NOW), '- 2026-11-19 · [preferences] — Likes tea.');
  assert.equal(formatNote('Lives in Shanghai.', '', NOW), '- 2026-11-19 — Lives in Shanghai.');
  assert.throws(() => formatNote('   ', '', NOW), /note must not be empty/);
});

test('appending deduplicates the same note and rejects an over-budget memory', () => {
  const first = appendMemory('', 'Likes tea.', 'preferences', 6000, NOW);
  assert.equal(first.saved, true);
  assert.match(first.text, /Likes tea\./);

  const duplicate = appendMemory(first.text, 'Likes tea.', 'preferences', 6000, NOW);
  assert.equal(duplicate.saved, false);
  assert.equal(duplicate.text, first.text);

  assert.throws(() => appendMemory(first.text, 'x'.repeat(600), '', 600), /memory is full/);
});

test('normalization and note counting survive CRLF and blank lines', () => {
  const text = normalizeMemoryText('- a\r\n- b\r\n\r\n');
  assert.equal(text, '- a\n- b\n');
  assert.equal(countNotes(text), 2);
  assert.equal(byteLength('茶'), 3);
});

test('replaceMemory enforces the budget', () => {
  assert.equal(replaceMemory('- a\n', 200), '- a\n');
  assert.throws(() => replaceMemory('- ' + 'x'.repeat(100), 20), /at most 20 bytes/);
});

test('searchMemory matches case-insensitively and returns note lines only', () => {
  const text = '- 2026-01-01 — [work] Ships the exporter\n- 2026-01-02 — [prefs] Prefers tea\nnotes without a marker\n';
  assert.deepEqual(searchMemory(text, 'TEA'), ['- 2026-01-02 — [prefs] Prefers tea']);
  assert.equal(searchMemory(text, '').length, 2);
  assert.deepEqual(searchMemory(text, 'nothing'), []);
});

test('writeMemory commits atomically with owner-only permissions and reads back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-'));
  const file = join(dir, 'nested', 'memory.md');
  const text = await writeMemory(file, '- 2026-01-01 — Remembered.\n', 6000);
  assert.equal(text, '- 2026-01-01 — Remembered.\n');
  assert.equal(readMemorySync(file), text);
  const mode = (await stat(file)).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.deepEqual((await readdir(join(dir, 'nested'))).filter((name) => name.endsWith('.tmp')), []);
});

test('a missing memory file reads as empty memory', () => {
  assert.equal(readMemorySync(join(tmpdir(), 'personal-agent-does-not-exist', 'memory.md')), '');
});
