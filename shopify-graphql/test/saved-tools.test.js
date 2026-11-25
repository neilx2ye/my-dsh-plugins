import assert from 'node:assert/strict'
import test from 'node:test'
import { SavedToolStore } from '../lib/saved-tools.js'

function fakeCtx() {
  const registry = new Map()
  return {
    registry,
    ctx: {
      tools: {
        get: name => registry.get(name),
        register: definition => {
          registry.set(definition.name, definition)
          return () => registry.delete(definition.name)
        },
      },
    },
  }
}

const entry = {
  id: 'run_1',
  status: 'ok',
  storeId: 's1',
  operationType: 'mutation',
  operationName: 'AddOrderTags',
  document: 'mutation Add($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } } }',
  variables: { id: 'gid://shopify/Order/1001', tags: ['urgent'] },
  variableDefs: [
    { name: 'id', type: 'ID!', required: true, schema: { type: 'string' } },
    { name: 'tags', type: 'String', required: false, schema: { type: 'string' } },
  ],
}

async function makeStore(overrides = {}) {
  const { ctx, registry } = fakeCtx()
  const calls = []
  const runner = {
    run: async request => {
      calls.push(request)
      return { status: 'ok', summary: 'ok', data: { id: '1' } }
    },
    invokeSaved: async (tool, variables) => runner.run({ tool, variables }),
  }
  const store = new SavedToolStore({
    ctx,
    file: '/tmp/shopify-graphql-test-tools.json',
    runner,
  })
  store.tools = []
  return { store, registry, calls, ...overrides }
}

test('creates a tool from history and fixes unexposed variables', async () => {
  const { store, registry, calls } = await makeStore()
  const tool = await store.createFromHistory({
    historyEntry: entry,
    name: 'order_add_urgent',
    title: '给订单加急',
    description: 'Adds the urgent tag',
    params: [{ name: 'id', description: 'Order GID' }],
  })
  assert.equal(tool.name, 'shopify_order_add_urgent')
  assert.deepEqual(tool.fixedVariables, { tags: ['urgent'] })
  const schema = store.buildParameters(tool)
  assert.deepEqual(schema.required, ['id'])
  assert.equal(schema.properties.id.type, 'string')
  assert.equal(registry.get('shopify_order_add_urgent') !== undefined, true)
  await registry.get('shopify_order_add_urgent').execute({ id: 'gid://shopify/Order/2' }, { signal: undefined })
  assert.deepEqual(calls[0].variables, { tags: ['urgent'], id: 'gid://shopify/Order/2' })
})

test('rejects a required variable that is neither exposed nor fixed', async () => {
  const { store } = await makeStore()
  const broken = { ...entry, variables: {} }
  await assert.rejects(
    store.createFromHistory({ historyEntry: broken, name: 'x', title: 'x', params: [] }),
    error => error.code === 'invalid_param',
  )
})

test('rejects duplicate tool names', async () => {
  const { store } = await makeStore()
  await store.createFromHistory({ historyEntry: entry, name: 'dup', title: 'dup', params: [] })
  await assert.rejects(
    store.createFromHistory({ historyEntry: entry, name: 'dup', title: 'dup2', params: [] }),
    error => error.code === 'tool_name_conflict',
  )
})

test('disable unregisters and enable re-registers', async () => {
  const { store, registry } = await makeStore()
  const tool = await store.createFromHistory({ historyEntry: entry, name: 'toggle', title: 'toggle', params: [] })
  await store.update(tool.id, { enabled: false })
  assert.equal(registry.get(tool.name), undefined)
  await store.update(tool.id, { enabled: true })
  assert.notEqual(registry.get(tool.name), undefined)
})

test('removing a tool unregisters it', async () => {
  const { store, registry } = await makeStore()
  const tool = await store.createFromHistory({ historyEntry: entry, name: 'gone', title: 'gone', params: [] })
  await store.remove(tool.id)
  assert.equal(registry.get(tool.name), undefined)
  assert.equal(store.get(tool.id), undefined)
})