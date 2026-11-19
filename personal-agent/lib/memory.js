/**
 * Profile-wide memory for the Personal Agent bundle.
 *
 * Memory is one Markdown note file owned by the profile, not by a session or a
 * workspace, so every conversation reads and extends the same notes. The file
 * is deliberately plain text: the identity page edits it directly, the model
 * appends to it through the `remember` tool, and a user can read or copy it
 * without this plugin.
 *
 * Writes are serialized by the caller and committed with a same-directory
 * rename, so a crash never leaves a half-written note. The file mode is user
 * only; the Host routes that expose it are owner-admitted.
 */

import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A note line always starts with this marker. */
const NOTE_PREFIX = '- ';

/**
 * Read the memory file synchronously for prompt assembly.
 * @param file - absolute memory file path.
 * @returns the file text; a missing file reads as empty memory.
 */
export function readMemorySync(file) {
  try {
    return normalizeMemoryText(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Normalize line endings and trailing whitespace.
 * @param text - raw memory text.
 * @returns the canonical text: no CRLF, one trailing newline when non-empty.
 */
export function normalizeMemoryText(text) {
  const body = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
  return body === '' ? '' : `${body}\n`;
}

/**
 * Count the UTF-8 bytes of one text.
 * @param text - text to measure.
 * @returns the byte length.
 */
export function byteLength(text) {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Format one note line.
 * @param note - the fact to remember.
 * @param topic - optional short topic label.
 * @param now - timestamp used for the date.
 * @returns the note line, or a thrown error for an empty note.
 */
export function formatNote(note, topic, now = new Date()) {
  const text = String(note ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') throw new Error('note must not be empty');
  const label = String(topic ?? '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  const date = now.toISOString().slice(0, 10);
  return `${NOTE_PREFIX}${date}${label === '' ? '' : ` · [${label}]`} — ${text}`;
}

/**
 * Append one note to the memory text.
 * @param memoryText - current normalized text.
 * @param note - the fact to remember.
 * @param topic - optional topic label.
 * @param maxBytes - memory budget.
 * @param now - timestamp used for the date.
 * @returns `{ saved, text }`; `saved` is false when the exact note already exists.
 */
export function appendMemory(memoryText, note, topic, maxBytes, now = new Date()) {
  const current = normalizeMemoryText(memoryText);
  const line = formatNote(note, topic, now);
  const needle = line.slice(NOTE_PREFIX.length);
  if (current.includes(needle)) return { saved: false, text: current };
  const next = normalizeMemoryText(current === '' ? line : `${current}${line}`);
  if (byteLength(next) > maxBytes) {
    throw new Error(
      `memory is full: the new note would make it ${byteLength(next)} bytes, over the ${maxBytes}-byte limit. Prune notes in the Personal Agent page before saving more.`,
    );
  }
  return { saved: true, text: next };
}

/**
 * Replace the whole memory text, enforcing the budget.
 * @param text - candidate memory text.
 * @param maxBytes - memory budget.
 * @returns the normalized text.
 */
export function replaceMemory(text, maxBytes) {
  const next = normalizeMemoryText(text);
  const bytes = byteLength(next);
  if (bytes > maxBytes) throw new Error(`memory must be at most ${maxBytes} bytes (this text is ${bytes})`);
  return next;
}

/**
 * Search memory lines for one query.
 * @param memoryText - normalized memory text.
 * @param query - case-insensitive substring; empty returns every line.
 * @param limit - maximum number of lines returned.
 * @returns matching note lines, oldest first.
 */
export function searchMemory(memoryText, query, limit = 40) {
  const lines = normalizeMemoryText(memoryText)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith(NOTE_PREFIX));
  const needle = String(query ?? '').trim().toLowerCase();
  const matched = needle === '' ? lines : lines.filter((line) => line.toLowerCase().includes(needle));
  return matched.slice(0, limit);
}

/**
 * Count all note lines.
 * @param memoryText - normalized memory text.
 * @returns the note count.
 */
export function countNotes(memoryText) {
  return normalizeMemoryText(memoryText)
    .split('\n')
    .filter((line) => line.startsWith(NOTE_PREFIX)).length;
}

/**
 * Join note lines into one text suitable for a tool result.
 * @param lines - note lines.
 * @returns a newline-joined text, or an empty string.
 */
export function renderNotes(lines) {
  return lines.join('\n');
}

/**
 * Commit one memory text with a same-directory rename.
 * @param file - absolute memory file path.
 * @param text - candidate text.
 * @param maxBytes - memory budget.
 * @returns the normalized committed text.
 */
export async function writeMemory(file, text, maxBytes) {
  const next = replaceMemory(text, maxBytes);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, next, { mode: 0o600 });
  await rename(temporary, file);
  return next;
}