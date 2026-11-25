import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkPolicy, defaultPolicy, loadPolicy, validatePolicy } from '../lib/policy.js'

async function stateDir() {
  return mkdtemp(path.join(tmpdir(), 'shopify-graphql-policy-'))
}

test('missing policy falls back to defaults', async () => {
  const dir = await stateDir()
  const loaded = await loadPolicy({ stateDir: dir, storeId: 's1' })
  assert.equal(loaded.exists, false)
  assert.deepEqual(loaded.policy, defaultPolicy())
})

test('valid policy is loaded and hashed', async () => {
  const dir = await stateDir()
  await mkdir(path.join(dir, 'policies'), { recursive: true })
  await writeFile(path.join(dir, 'policies', 's1.yaml'), [
    'readOnly: true',
    'blockedRootFields: [appUninstall]',
    'limits:',
    '  maxDocumentBytes: 2048',
    '  approvalTimeoutMs: 1000',
  ].join('\n'))
  const loaded = await loadPolicy({ stateDir: dir, storeId: 's1' })
  assert.equal(loaded.exists, true)
  assert.equal(loaded.policy.readOnly, true)
  assert.deepEqual(loaded.policy.blockedRootFields, ['appUninstall'])
  assert.equal(loaded.policy.limits.maxDocumentBytes, 2048)
  assert.equal(loaded.policy.limits.maxVariablesBytes, 65_536)
  assert.match(loaded.hash, /^[0-9a-f]{64}$/)
})

test('unknown policy keys fail instead of being stripped', () => {
  assert.throws(
    () => validatePolicy({ requiresApproval: ['shopify.addOrderTags'] }),
    error => error.code === 'policy_invalid',
  )
})

test('read-only policy rejects mutations', () => {
  assert.throws(
    () => checkPolicy({ ...defaultPolicy(), readOnly: true }, {
      operationType: 'mutation',
      rootFields: ['tagsAdd'],
      documentBytes: 10,
      variablesBytes: 2,
    }),
    error => error.code === 'policy_read_only',
  )
})

test('blocked root fields and limits are enforced', () => {
  assert.throws(
    () => checkPolicy({ ...defaultPolicy(), blockedRootFields: ['appUninstall'] }, {
      operationType: 'mutation',
      rootFields: ['appUninstall'],
      documentBytes: 10,
      variablesBytes: 2,
    }),
    error => error.code === 'policy_blocked',
  )
  assert.throws(
    () => checkPolicy(defaultPolicy(), {
      operationType: 'query',
      rootFields: ['shop'],
      documentBytes: 70_000,
      variablesBytes: 2,
    }),
    error => error.code === 'policy_limit_document',
  )
})