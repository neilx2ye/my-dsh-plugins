import assert from 'node:assert/strict';
import { sep } from 'node:path';
import test from 'node:test';

import {
  PERSONAL_PRESET_ID,
  WORKSPACE_PRESET_ID,
  hidePersonalPreset,
  inside,
  personalPresetAllowed,
  workspaceFallbackPreset,
} from '../lib/presets.js';

const HOME = `${sep}home${sep}neil${sep}.dsh${sep}personal-agent${sep}identities${sep}neil`;
const GROUPS = `${sep}home${sep}neil${sep}.dsh${sep}personal-agent${sep}groups`;
const WORKSPACE = `${sep}root${sep}work${sep}shop`;

test('inside matches the root itself and its children, but not a name prefix', () => {
  assert.equal(inside('/a/b', '/a/b'), true);
  assert.equal(inside('/a/b', '/a/b/c'), true);
  assert.equal(inside('/a/b/', '/a/b/c'), true);
  assert.equal(inside('/a/b', '/a/bc'), false);
  assert.equal(inside('', '/a/b'), false);
  assert.equal(inside('/a/b', ''), false);
});

test('only identity and group homes may run the personal preset', () => {
  const roots = { identityHomes: [HOME], groupsRoot: GROUPS };
  assert.equal(personalPresetAllowed(HOME, roots), true);
  assert.equal(personalPresetAllowed(`${HOME}${sep}notes`, roots), true);
  assert.equal(personalPresetAllowed(`${GROUPS}${sep}team`, roots), true);
  assert.equal(personalPresetAllowed(WORKSPACE, roots), false);
  assert.equal(personalPresetAllowed(`${HOME}-old`, roots), false);
});

test('an unknown working directory is left alone instead of being classified', () => {
  assert.equal(personalPresetAllowed(undefined, {}), true);
  assert.equal(personalPresetAllowed('', {}), true);
});

test('hiding the personal preset keeps the rest of the roster and its shape', () => {
  const roster = {
    default: 'standard',
    presets: [
      { id: 'standard', name: 'Standard' },
      { id: PERSONAL_PRESET_ID, name: 'Personal' },
      { id: 'readonly', name: 'Read only' },
    ],
  };
  assert.deepEqual(hidePersonalPreset(roster), {
    default: 'standard',
    presets: [
      { id: 'standard', name: 'Standard' },
      { id: 'readonly', name: 'Read only' },
    ],
  });
  assert.equal(roster.presets.length, 3, 'the input roster is not mutated');
  assert.equal(hidePersonalPreset(null), null);
  assert.deepEqual(hidePersonalPreset({ presets: 'nope' }), { presets: 'nope' });
});

test('a workspace Session falls back to standard, then to the first healthy preset', () => {
  assert.equal(WORKSPACE_PRESET_ID, 'standard');
  assert.equal(workspaceFallbackPreset([{ id: 'readonly' }, { id: 'standard' }]), 'standard');
  assert.equal(workspaceFallbackPreset([{ id: 'readonly' }, { id: 'broken', broken: 'x' }]), 'readonly');
  assert.equal(workspaceFallbackPreset([{ id: PERSONAL_PRESET_ID }]), undefined);
  assert.equal(workspaceFallbackPreset(undefined), undefined);
  assert.equal(workspaceFallbackPreset([null, 'standard']), undefined);
});