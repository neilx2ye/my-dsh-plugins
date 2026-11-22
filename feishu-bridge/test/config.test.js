import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULTS,
  describeIssues,
  hasCredentials,
  normalizeConfig,
  resolveAppSecret,
} from '../lib/config.js';

test('an empty row normalizes to the documented defaults', () => {
  const result = normalizeConfig({});
  assert.equal(result.issues, undefined);
  assert.deepEqual(result.value, {
    enabled: true,
    appId: '',
    appSecret: '',
    domain: 'feishu',
    cwd: '',
    agentPreset: '',
    dmMode: 'open',
    dmAllowlist: [],
    groupAllowlist: [],
    requireMention: true,
    respondToMentionAll: false,
    streaming: true,
    markdown: true,
    replyInThread: false,
  });
  assert.equal(result.value.enabled, DEFAULTS.enabled);
});

test('lists are trimmed, de-duplicated, and ignore unusable entries', () => {
  const result = normalizeConfig({
    dmAllowlist: [' ou_a ', 'ou_a', 42, '', null],
    groupAllowlist: ['oc_1', 'oc_1'],
  });
  assert.deepEqual(result.value.dmAllowlist, ['ou_a', '42']);
  assert.deepEqual(result.value.groupAllowlist, ['oc_1']);
});

test('an unknown domain is rejected with a path', () => {
  const result = normalizeConfig({ domain: 'dingtalk' });
  assert.equal(result.value, undefined);
  assert.match(describeIssues(result.issues), /domain: domain must be/);
});

test('an invalid preset id is rejected', () => {
  const result = normalizeConfig({ agentPreset: 'my preset' });
  assert.equal(result.value, undefined);
  assert.match(describeIssues(result.issues), /agentPreset/);
});

test('a secret can name a process environment variable', () => {
  const result = normalizeConfig({ appId: 'cli_x', appSecret: '$FEISHU_APP_SECRET' });
  assert.equal(resolveAppSecret(result.value, { FEISHU_APP_SECRET: 'secret-value' }), 'secret-value');
  assert.equal(resolveAppSecret(result.value, {}), '');
  assert.equal(hasCredentials(result.value, { FEISHU_APP_SECRET: 'secret-value' }), true);
  assert.equal(hasCredentials(result.value, {}), false);
});

test('a literal secret is used as-is and whitespace-only credentials do not count', () => {
  const literal = normalizeConfig({ appId: 'cli_x', appSecret: '  literal  ' });
  assert.equal(resolveAppSecret(literal.value, {}), 'literal');
  assert.equal(hasCredentials(literal.value, {}), true);
  const blank = normalizeConfig({ appId: '  ', appSecret: '  ' });
  assert.equal(hasCredentials(blank.value, {}), false);
});

test('booleans keep explicit false and fall back on non-booleans', () => {
  const result = normalizeConfig({ enabled: false, streaming: 'no', markdown: false });
  assert.equal(result.value.enabled, false);
  assert.equal(result.value.streaming, true);
  assert.equal(result.value.markdown, false);
});

test('an App ID with whitespace is rejected', () => {
  const result = normalizeConfig({ appId: 'cli x' });
  assert.equal(result.value, undefined);
  assert.match(describeIssues(result.issues), /App ID/);
});