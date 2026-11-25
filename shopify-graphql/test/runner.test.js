import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { HistoryStore } from '../lib/history.js'
import { createPendingManager } from '../lib/pending.js'
import { createRunner } from '../lib/runner.js'

const QUERY = 'query Shop { shop { name } }'
const MUTATION = 'mutation Add($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { message } } }'

async function harness(options = {}) {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'shopify-graphql-runner-'))
  const config = {
    stores: [{
      id: 's1',
      domain: 's1.myshopify.com',
      apiVersion: '2026-04',
      readToken: { provider: 'local', ref: 'READ_TOKEN' },
      writeToken: { provider: 'local', ref: 'WRITE_TOKEN' },
    }],
    stateDir,
  }
  const calls = []
  const secrets = {
    resolve: async (store, kind) => {
      if (kind === 'read') return 'read-secret'
      return options.writeToken === false ? undefined : 'write-secret'
    },
  }
  const client = {
    execute: async request => {
      calls.push(request)
      return { data: { ok: true }, errors: [], cost: null, durationMs: 1 }
    },
  }
  const history = new HistoryStore({
    file: path.join(stateDir, 'history.json'),
    auditFile: path.join(stateDir, 'audit.jsonl'),
  })
  await history.load()
  const pending = createPendingManager()
  const runner = createRunner({ config, secrets, pending, history, client, stateDir })
  return { runner, pending, history, calls, stateDir }
}

async function waitForPending(pending) {
  for (let index = 0; index < 200; index += 1) {
    const list = pending.list()
    if (list.length > 0) return list[0]
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('pending request did not appear')
}

test('queries execute directly with the read token and never ask for approval', async () => {
  const { runner, pending, calls, history } = await harness()
  const result = await runner.run({ storeId: 's1', document: QUERY, variables: {} })
  assert.equal(result.status, 'ok')
  assert.equal(pending.list().length, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].token, 'read-secret')
  assert.equal(history.list()[0].decision, 'auto')
})

test('mutations wait for approval and then use the write token', async () => {
  const { runner, pending, calls, history } = await harness()
  const running = runner.run({
    storeId: 's1',
    document: MUTATION,
    variables: { id: 'gid://shopify/Order/1001', tags: ['urgent'] },
  })
  const request = await waitForPending(pending)
  assert.equal(calls.length, 0)
  pending.decide(request.id, 'approve')
  const result = await running
  assert.equal(result.status, 'ok')
  assert.equal(result.decision, 'approved')
  assert.equal(calls[0].token, 'write-secret')
  assert.equal(history.list()[0].decision, 'approved')
})

test('a rejected mutation never touches Shopify', async () => {
  const { runner, pending, calls, history } = await harness()
  const running = runner.run({ storeId: 's1', document: MUTATION, variables: { id: 'gid://shopify/Order/1', tags: ['x'] } })
  const request = await waitForPending(pending)
  pending.decide(request.id, 'reject')
  const result = await running
  assert.equal(result.status, 'rejected')
  assert.equal(calls.length, 0)
  assert.equal(history.list()[0].status, 'rejected')
})

test('a missing write token fails before asking for approval', async () => {
  const { runner, pending } = await harness({ writeToken: false })
  await assert.rejects(
    runner.run({ storeId: 's1', document: MUTATION, variables: { id: 'gid://shopify/Order/1', tags: ['x'] } }),
    error => error.code === 'secret_missing',
  )
  assert.equal(pending.list().length, 0)
})

test('read-only policy blocks mutations before token resolution', async () => {
  const { runner, stateDir } = await harness()
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(path.join(stateDir, 'policies'), { recursive: true })
  await writeFile(path.join(stateDir, 'policies', 's1.yaml'), 'readOnly: true\n')
  await assert.rejects(
    runner.run({ storeId: 's1', document: MUTATION, variables: { id: 'gid://shopify/Order/1', tags: ['x'] } }),
    error => error.code === 'policy_read_only',
  )
})
