import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeDirectMessagePrompt,
  composePeerSection,
  dmPairKey,
  normalizeDirectMessage,
  renderDirectMessageHistory,
  DM_MESSAGE_MAX,
} from '../lib/direct-message.js';

const ADA = { id: 'ada', name: 'Ada', role: 'personal assistant' };
const MIRA = { id: 'mira', name: 'Mira', role: 'coach' };
const THEO = { id: 'theo', name: 'Theo', role: 'researcher' };

test('a pair key is stable regardless of message direction', () => {
  assert.equal(dmPairKey('mira', 'ada'), 'ada--mira');
  assert.equal(dmPairKey('ada', 'mira'), 'ada--mira');
  assert.notEqual(dmPairKey('ada', 'mira'), dmPairKey('ada', 'theo'));
});

test('a pair key needs two different identities', () => {
  assert.throws(() => dmPairKey('ada', 'ada'), /itself/);
  assert.throws(() => dmPairKey('', 'mira'), /two identity ids/);
  assert.throws(() => dmPairKey('ada', undefined), /two identity ids/);
});

test('the peer roster names every other identity and nothing about itself', () => {
  const text = composePeerSection(ADA, [ADA, MIRA, THEO]);
  assert.match(text, /Mira \(id: mira, role: coach\)/);
  assert.match(text, /Theo \(id: theo, role: researcher\)/);
  assert.doesNotMatch(text, /Ada \(id: ada/);
  assert.match(text, /message_identity/);
  assert.match(text, /private 1:1 message, not a group chat/);
  assert.match(text, /Never invent their reply/);
});

test('the peer roster is empty for a single identity', () => {
  assert.equal(composePeerSection(ADA, [ADA]), '');
  assert.equal(composePeerSection(ADA, []), '');
});

test('a direct message is trimmed and bounded', () => {
  assert.equal(normalizeDirectMessage('  hello Mira  '), 'hello Mira');
  assert.throws(() => normalizeDirectMessage('   '), /must not be empty/);
  assert.throws(() => normalizeDirectMessage(42), /must be a string/);
  assert.throws(() => normalizeDirectMessage('x'.repeat(DM_MESSAGE_MAX + 1)), /at most/);
  assert.equal(normalizeDirectMessage('x'.repeat(DM_MESSAGE_MAX)).length, DM_MESSAGE_MAX);
});

test('history keeps the recent messages oldest first and skips malformed entries', () => {
  const messages = [
    { name: 'Ada', text: 'first' },
    null,
    { name: 'Mira', text: '  second  ' },
    { name: '', text: '' },
  ];
  assert.equal(renderDirectMessageHistory(messages), '- Ada: first\n- Mira: second');
  assert.equal(renderDirectMessageHistory(messages, 1), '- Mira: second');
  assert.equal(renderDirectMessageHistory(messages, 10, 24), '- Mira: second');
  assert.equal(renderDirectMessageHistory('nope'), '');
  assert.equal(renderDirectMessageHistory([]), '');
});

test('the first direct message prompt asks the target to answer as itself', () => {
  const text = composeDirectMessagePrompt({ caller: ADA, target: MIRA, message: 'Can you review this plan?' });
  assert.match(text, /Ada \(personal assistant\)/);
  assert.match(text, /private 1:1 conversation/);
  assert.match(text, /not a group chat/);
  assert.match(text, /first direct message with Ada/);
  assert.match(text, /Ada sent:\nCan you review this plan\?/);
  assert.match(text, /Reply to Ada as Mira/);
  assert.match(text, /Do not speak for Ada/);
  assert.match(text, /do not start a new direct message/);
});

test('a continuing thread carries the recent exchange into the prompt', () => {
  const history = [
    { id: '1', role: 'agent', name: 'Ada', text: 'Are you free?' },
    { id: '2', role: 'assistant', name: 'Mira', text: 'Yes, what do you need?' },
  ];
  const text = composeDirectMessagePrompt({ caller: ADA, target: MIRA, message: 'Summarize this note.', history });
  assert.match(text, /Recent direct messages with Ada:/);
  assert.match(text, /- Ada: Are you free\?/);
  assert.match(text, /- Mira: Yes, what do you need\?/);
  assert.doesNotMatch(text, /first direct message/);
  assert.match(text, /Summarize this note\./);
});