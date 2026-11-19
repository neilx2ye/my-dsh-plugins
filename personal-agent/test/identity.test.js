import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Config,
  DEFAULT_IDENTITY,
  DEFAULT_MEMORY_POLICY,
  composeIdentitySection,
  composeMemorySection,
  mergeIdentity,
  mergeMemoryPolicy,
  nextIdentityId,
  normalizeIdentity,
  parseConfig,
  serializeIdentity,
} from '../lib/identity.js';
import { resolveIdentityPaths } from '../lib/paths.js';

test('an empty config becomes one legacy identity with the original home', () => {
  const settings = parseConfig(undefined);
  assert.equal(settings.identities.length, 1);
  const identity = settings.identities[0];
  assert.equal(identity.id, 'default');
  assert.equal(identity.name, DEFAULT_IDENTITY.name);
  assert.deepEqual(settings.memory, DEFAULT_MEMORY_POLICY);
  assert.deepEqual(resolveIdentityPaths(identity, '/data'), {
    root: '/data/identities/default',
    home: '/data/home',
    memoryFile: '/data/memory.md',
  });
});

test('the single-identity shape maps home and memory paths onto the legacy identity', () => {
  const settings = parseConfig({
    identity: { name: 'Ada', role: 'assistant' },
    home: { directory: '/srv/ada-home' },
    memory: { file: '/srv/ada.md', includeInPrompt: false, maxBytes: 7000 },
  });
  assert.equal(settings.identities.length, 1);
  assert.equal(settings.identities[0].id, 'default');
  assert.equal(settings.identities[0].home, '/srv/ada-home');
  assert.equal(settings.identities[0].memoryFile, '/srv/ada.md');
  assert.deepEqual(settings.memory, { includeInPrompt: false, maxBytes: 7000 });
  assert.deepEqual(resolveIdentityPaths(settings.identities[0], '/data'), {
    root: '/data/identities/default',
    home: '/srv/ada-home',
    memoryFile: '/srv/ada.md',
  });
});

test('multiple identities get generated ids and per-identity homes', () => {
  const settings = parseConfig({
    identities: [{ name: 'Ada' }, { name: 'Mira' }, { name: 'Mira' }],
    memory: { maxBytes: 8000 },
  });
  assert.deepEqual(settings.identities.map((identity) => identity.id), ['ada', 'mira', 'mira-2']);
  assert.deepEqual(resolveIdentityPaths(settings.identities[1], '/data'), {
    root: '/data/identities/mira',
    home: '/data/identities/mira/home',
    memoryFile: '/data/identities/mira/memory.md',
  });
  assert.equal(settings.memory.maxBytes, 8000);
});

test('explicit ids are validated and must be unique', () => {
  assert.equal(normalizeIdentity({ name: 'One', id: 'agent-1' }).id, 'agent-1');
  assert.throws(() => normalizeIdentity({ name: 'One', id: 'Bad ID' }), /must be lowercase letters/);
  assert.throws(
    () => parseConfig({ identities: [{ id: 'same', name: 'One' }, { id: 'same', name: 'Two' }] }),
    /duplicate identity id "same"/,
  );
  assert.deepEqual(parseConfig({ identities: [] }).identities, []);
});

test('identity fields are trimmed and validated with their config path', () => {
  const settings = parseConfig({ identities: [{ name: '  Ada  ', role: ' Assistant ', accent: '#AABBCC', avatar: ' 🜂 ' }] });
  assert.deepEqual(settings.identities[0], {
    id: 'ada',
    name: 'Ada',
    role: 'Assistant',
    userName: '',
    persona: '',
    accent: '#aabbcc',
    avatar: '🜂',
    home: '',
    memoryFile: '',
  });
  assert.throws(() => parseConfig({ identities: [{ name: '  ' }] }), /identity.name must not be empty/);
  assert.throws(() => parseConfig({ identities: [{ name: 'X', accent: 'violet' }] }), /must be a #rrggbb colour/);
  assert.throws(() => parseConfig({ identities: [{ name: 'X', home: 'relative/dir' }] }), /absolute path or start with ~/);
  assert.throws(() => parseConfig({ memory: { maxBytes: 10 } }), /memory.maxBytes must be an integer between/);
});

test('the Host config schema returns normalized values and issues', () => {
  const valid = Config['~standard'].validate({ identities: [{ name: 'Ada' }] });
  assert.equal(valid.value.identities[0].name, 'Ada');

  const invalid = Config['~standard'].validate({ identities: [{ name: '' }] });
  assert.ok(Array.isArray(invalid.issues));
  assert.match(invalid.issues[0].message, /name must not be empty/);
});

test('autoOpen defaults to true and rejects a non-boolean value', () => {
  assert.equal(parseConfig({}).autoOpen, true);
  assert.equal(parseConfig({ autoOpen: false }).autoOpen, false);
  assert.throws(() => parseConfig({ autoOpen: 'yes' }), /autoOpen must be a boolean/);
});

test('nextIdentityId skips ids already in use', () => {
  const used = new Set(['ada', 'ada-2']);
  assert.equal(nextIdentityId('Ada', used), 'ada-3');
  assert.equal(nextIdentityId('小满', new Set()), 'agent');
});

test('a page edit merges over one identity and preserves its paths', () => {
  const current = parseConfig({ identities: [{ id: 'mira', name: 'Mira', home: '/srv/mira', memoryFile: '/srv/mira.md' }] }).identities[0];
  const next = mergeIdentity(current, { name: 'Mira Chen', userName: 'Sam', role: 'coach' });
  assert.equal(next.id, 'mira');
  assert.equal(next.name, 'Mira Chen');
  assert.equal(next.userName, 'Sam');
  assert.equal(next.home, '/srv/mira');
  assert.equal(next.memoryFile, '/srv/mira.md');
  assert.throws(() => mergeIdentity(current, { accent: 'red' }), /accent/);
});

test('serializeIdentity writes only the config fields', () => {
  const identity = parseConfig({ identities: [{ name: 'Ada' }] }).identities[0];
  assert.deepEqual(serializeIdentity(identity), {
    id: 'ada',
    name: 'Ada',
    role: 'personal assistant',
    userName: '',
    persona: '',
    accent: '#5b5bd6',
    avatar: '',
    home: '',
    memoryFile: '',
  });
});

test('memory policy edits keep the budget bounds', () => {
  assert.deepEqual(mergeMemoryPolicy({ includeInPrompt: true, maxBytes: 6000 }, { includeInPrompt: false, maxBytes: 9000 }), {
    includeInPrompt: false,
    maxBytes: 9000,
  });
  assert.throws(() => mergeMemoryPolicy({}, { maxBytes: 10 }), /must be an integer between/);
});

test('the identity section names one identity and explains the shared profile', () => {
  const single = composeIdentitySection({ ...DEFAULT_IDENTITY, name: 'Mira', userName: 'Sam', role: 'assistant', persona: 'Be brief.' });
  assert.match(single, /You are Mira, the personal agent of Sam/);
  assert.match(single, /The user is a person and you are their assistant/);
  assert.match(single, /not a project folder/);
  assert.match(single, /do not ask them to pick a workspace/);
  assert.match(single, /Be brief\./);

  const multi = composeIdentitySection({ ...DEFAULT_IDENTITY, name: 'Mira' }, { siblingCount: 3 });
  assert.match(multi, /hosts several personal agents/);
  assert.match(multi, /only your own home and memory apply/);
});

test('the memory section explains itself and quotes saved notes', () => {
  const identity = { ...DEFAULT_IDENTITY, userName: 'Sam' };
  assert.match(composeMemorySection(identity, ''), /You have not saved any notes yet/);
  const filled = composeMemorySection(identity, '- 2026-01-01 — [preferences] Likes tea');
  assert.match(filled, /=== MEMORY ===/);
  assert.match(filled, /Likes tea/);
});

test('the user label falls back to "the person you are talking to" rather than inventing a name', () => {
  const text = composeIdentitySection({ ...DEFAULT_IDENTITY, userName: '' });
  assert.match(text, /the personal agent of the person you are talking to/);
});