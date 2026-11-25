import assert from 'node:assert/strict'
import test from 'node:test'
import { createPendingManager } from '../lib/pending.js'

function request(overrides = {}) {
  return {
    storeId: 's1',
    operationType: 'mutation',
    operationName: 'M',
    document: 'mutation M { tagsAdd(id: "gid://shopify/Order/1", tags: ["x"]) { node { id } } }',
    variables: {},
    visual: { summary: '添加标签', risk: ['write'] },
    timeoutMs: 5_000,
    ...overrides,
  }
}

test('approve resolves the waiting call and binds the stored record', async () => {
  const pending = createPendingManager()
  const record = pending.create(request())
  const waiting = pending.wait(record.id)
  pending.decide(record.id, 'approve')
  const outcome = await waiting
  assert.equal(outcome.decision, 'approve')
  assert.equal(outcome.record.status, 'approved')
  assert.equal(record.document, request().document)
})

test('reject resolves without approval', async () => {
  const pending = createPendingManager()
  const record = pending.create(request())
  const waiting = pending.wait(record.id)
  pending.decide(record.id, 'reject')
  const outcome = await waiting
  assert.equal(outcome.decision, 'reject')
  assert.equal(outcome.record.status, 'rejected')
})

test('timeout expires a request', async () => {
  const pending = createPendingManager()
  const record = pending.create(request({ timeoutMs: 20 }))
  const outcome = await pending.wait(record.id)
  assert.equal(outcome.decision, 'timeout')
  assert.equal(pending.list().length, 0)
})

test('cancellation abandons a request', async () => {
  const pending = createPendingManager()
  const record = pending.create(request())
  const controller = new AbortController()
  const waiting = pending.wait(record.id, controller.signal)
  controller.abort()
  const outcome = await waiting
  assert.equal(outcome.decision, 'cancelled')
  assert.equal(pending.get(record.id).status, 'cancelled')
})

test('a second decision is rejected', async () => {
  const pending = createPendingManager()
  const record = pending.create(request())
  pending.decide(record.id, 'approve')
  assert.throws(() => pending.decide(record.id, 'reject'), error => error.code === 'request_not_pending')
})