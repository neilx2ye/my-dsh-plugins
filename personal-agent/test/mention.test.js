import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * Load the browser bundle's factory without a DOM.
 *
 * The bundle is a `window.__ModuleLoader__.load` registration; a stub facade
 * captures the registration, and an inert React keeps the component
 * definitions from rendering. Only the exported pure helpers are exercised.
 * @returns {object} the module's factory exports.
 */
function loadClientExports(source) {
  let registration = null;
  const inert = new Proxy({}, { get: () => () => null });
  const require = (id) => (id === 'react' || id === 'react-dom' || id === 'react-dom/client' ? inert : {});
  const node = () => ({ dataset: {}, style: {}, remove() {}, appendChild() {}, querySelector: () => null });
  const window = { __ModuleLoader__: { load(module) { registration = module; } } };
  const run = new Function('window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame', 'fetch', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'require', source);
  run(window, node(), { language: 'zh-CN', languages: ['zh-CN'] }, { getItem: () => null, setItem() {}, removeItem() {} }, () => 0, async () => ({ ok: true, status: 200, data: {} }), console, () => 0, () => {}, () => 0, () => {}, require);
  assert.notEqual(registration, null, 'the bundle registers one client module');
  assert.equal(registration.id, '@local/personal-agent');
  return registration.factory(require);
}

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const { __mentions } = loadClientExports(source);
const { mentionTokenAt, mentionCandidates, applyMention } = __mentions;

const PARTICIPANTS = [
  { id: 'mira', name: 'Meta广告投放师', role: 'Meta广告投放师' },
  { id: 'google', name: 'Google广告投放师', role: 'Google广告投放师' },
  { id: 'agent', name: '售后员', role: '售后员' },
];

test('a bare @ opens a mention token at the caret', () => {
  assert.deepEqual(mentionTokenAt('@', 1), { start: 0, end: 1, query: '' });
});

test('an @ after whitespace opens, an email-like @ does not', () => {
  assert.deepEqual(mentionTokenAt('你好 @met', 7), { start: 3, end: 7, query: 'met' });
  assert.equal(mentionTokenAt('name@host', 9), null);
  assert.equal(mentionTokenAt('hi@meta.com', 11), null);
});

test('CJK text can open the picker without a space before the @', () => {
  assert.deepEqual(mentionTokenAt('请@Met', 5), { start: 1, end: 5, query: 'Met' });
});

test('a mention token closes once whitespace follows it', () => {
  assert.equal(mentionTokenAt('@Meta广告投放师 你好', 12), null);
});

test('a second @ starts its own token instead of widening the first', () => {
  assert.deepEqual(mentionTokenAt('@@', 2), { start: 1, end: 2, query: '' });
});

test('the token follows the caret, not the end of the draft', () => {
  assert.deepEqual(mentionTokenAt('@go hello', 3), { start: 0, end: 3, query: 'go' });
});

test('an out-of-range caret or non-draft value never opens the picker', () => {
  assert.equal(mentionTokenAt('@go', 9), null);
  assert.equal(mentionTokenAt('@go', -1), null);
  assert.equal(mentionTokenAt(null, 0), null);
});

test('candidates match by name, id, or role, and an empty query lists everyone', () => {
  assert.deepEqual(mentionCandidates(PARTICIPANTS, 'goo').map((entry) => entry.id), ['google']);
  assert.deepEqual(mentionCandidates(PARTICIPANTS, '售后').map((entry) => entry.id), ['agent']);
  assert.deepEqual(mentionCandidates(PARTICIPANTS, 'mira').map((entry) => entry.id), ['mira']);
  assert.deepEqual(mentionCandidates(PARTICIPANTS, '').map((entry) => entry.id), ['mira', 'google', 'agent']);
  assert.deepEqual(mentionCandidates(PARTICIPANTS, 'nobody'), []);
});

test('picking a participant replaces only the token and leaves the caret after the name', () => {
  const draft = '请 @go 看一下';
  const token = mentionTokenAt(draft, 5);
  assert.deepEqual(token, { start: 2, end: 5, query: 'go' });
  const next = applyMention(draft, token, PARTICIPANTS[1]);
  assert.equal(next.text, '请 @Google广告投放师  看一下');
  assert.equal(next.caret, '请 @Google广告投放师 '.length);
});

test('picking at the end of the draft leaves a trailing space for more text', () => {
  const draft = '问一下 @mi';
  const token = mentionTokenAt(draft, draft.length);
  const next = applyMention(draft, token, PARTICIPANTS[0]);
  assert.equal(next.text, '问一下 @Meta广告投放师 ');
  assert.equal(next.caret, next.text.length);
});