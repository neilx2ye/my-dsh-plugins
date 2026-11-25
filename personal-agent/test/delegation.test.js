import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DELEGATION_EVENT,
  DELEGATION_TOOLS,
  delegationDenyFilter,
  readDelegationChoice,
} from '../lib/delegation.js';

const on = { type: DELEGATION_EVENT, data: { enabled: true } };
const off = { type: DELEGATION_EVENT, data: { enabled: false } };

test('a conversation without a recorded choice may not spawn subagents', () => {
  assert.equal(readDelegationChoice([]), false);
  assert.equal(readDelegationChoice([{ type: 'turn/start', data: {} }]), false);
});

test('the last recorded selection wins', () => {
  assert.equal(readDelegationChoice([on]), true);
  assert.equal(readDelegationChoice([on, off]), false);
  assert.equal(readDelegationChoice([on, off, on]), true);
});

test('an unrelated later event does not reset the selection', () => {
  assert.equal(readDelegationChoice([on, { type: 'turn/end', data: {} }]), true);
});

test('a malformed selection counts as off rather than granting permission', () => {
  assert.equal(readDelegationChoice([{ type: DELEGATION_EVENT, data: {} }]), false);
  assert.equal(readDelegationChoice([{ type: DELEGATION_EVENT, data: null }]), false);
  assert.equal(readDelegationChoice([{ type: DELEGATION_EVENT, data: { enabled: 'yes' } }]), false);
  assert.equal(readDelegationChoice(undefined), false);
});

test('the deny filter names every delegation tool and nothing else', () => {
  const filter = delegationDenyFilter();
  assert.deepEqual([...filter.deny].sort(), [...DELEGATION_TOOLS].sort());
  assert.ok(filter.deny.includes('subagent'));
  assert.ok(filter.deny.includes('workflow'));
  assert.equal(filter.deny.includes('bash'), false);
});

test('the deny filter is a fresh copy each time', () => {
  const first = delegationDenyFilter();
  first.deny.push('bash');
  assert.equal(delegationDenyFilter().deny.includes('bash'), false);
});