import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'

function fakeContext(credentials) {
  const tools = new Map()
  const routes = new Map()
  const effects = []
  return {
    tools,
    routes,
    effects,
    ctx: {
      tools: {
        get: name => tools.get(name),
        register: definition => {
          tools.set(definition.name, definition)
          const dispose = () => tools.delete(definition.name)
          effects.push(dispose)
          return dispose
        },
      },
      connection: {
        fetch: {
          register: route => {
            routes.set(route.path, route)
            return () => routes.delete(route.path)
          },
        },
      },
      get: name => (name === 'credentials' ? credentials : undefined),
      effect: (factory, _label) => {
        const disposer = factory()
        if (typeof disposer === 'function') effects.push(disposer)
        return disposer
      },
    },
  }
}

function credentials(values) {
  return {
    resolve: async ref => (values[ref] === undefined ? undefined : { value: values[ref], source: 'test' }),
    describe: async ref => ({ configured: values[ref] !== undefined, writable: true }),
    set: async (ref, value) => { values[ref] = value },
    unset: async ref => { delete values[ref] },
  }
}

async function waitForPending(routes) {
  for (let index = 0; index < 100; index += 1) {
    const response = await routes.get('/api/shopify-graphql/state').fetch(new Request('http://local/api/shopify-graphql/state'))
    const body = await response.json()
    if (body.pending.length > 0) return body.pending[0]
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('pending request did not appear')
}

test('plugin wires the tool, routes, approval, history, and saved tools end to end', async t => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    assert.match(String(url), /graphql\.json$/)
    if (body.query.startsWith('query')) {
      return Response.json({ data: { shop: { name: 'Test shop' } } })
    }
    return Response.json({ data: { tagsAdd: { node: { id: 'gid://shopify/Order/1001' } } } })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const stateDir = await mkdtemp(path.join(tmpdir(), 'shopify-graphql-plugin-'))
  const { ctx, tools, routes } = fakeContext(credentials({ READ: 'read-token', WRITE: 'write-token' }))
  await apply(ctx, {
    stores: [{
      id: 's1',
      domain: 's1.myshopify.com',
      readTokenRef: 'READ',
      writeTokenRef: 'WRITE',
      apiVersion: '2026-04',
    }],
    stateDir,
  })

  const tool = tools.get('shopify_graphql')
  assert.notEqual(tool, undefined)
  assert.equal(routes.size, 11)
  // DSH's HTTP bridge treats any non-buffered route as a request with a stream body.
  // A GET must use buffered mode, which omits the body when no bytes arrive.
  for (const route of routes.values()) {
    assert.equal(route.requestBody, 'buffered', route.path)
  }

  const query = await tool.execute({ document: 'query Shop { shop { name } }' }, { signal: new AbortController().signal })
  assert.equal(query.status, 'ok')
  assert.equal(query.data.shop.name, 'Test shop')

  const running = tool.execute({
    document: 'mutation Add($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } } }',
    variables: { id: 'gid://shopify/Order/1001', tags: ['urgent'] },
  }, { signal: new AbortController().signal })
  const pending = await waitForPending(routes)
  const decision = await routes.get('/api/shopify-graphql/decide').fetch(new Request('http://local/api/shopify-graphql/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: pending.id, decision: 'approve' }),
  }))
  assert.equal(decision.status, 200)
  const mutation = await running
  assert.equal(mutation.status, 'ok')
  assert.equal(mutation.decision, 'approved')

  const historyResponse = await routes.get('/api/shopify-graphql/history').fetch(new Request(`http://local/api/shopify-graphql/history?id=${mutation.requestId}`))
  const historyBody = await historyResponse.json()
  assert.equal(historyBody.entry.operationType, 'mutation')

  const saveResponse = await routes.get('/api/shopify-graphql/save-tool').fetch(new Request('http://local/api/shopify-graphql/save-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      historyId: mutation.requestId,
      name: 'add_urgent',
      title: 'Add urgent tag',
      description: 'Adds urgent',
      params: [{ name: 'id', description: 'Order GID' }],
    }),
  }))
  assert.equal(saveResponse.status, 200)
  const saved = tools.get('shopify_add_urgent')
  assert.notEqual(saved, undefined)
  assert.deepEqual(saved.parameters.required, ['id'])

  const credentialResponse = await routes.get('/api/shopify-graphql/credential').fetch(new Request('http://local/api/shopify-graphql/credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId: 's1', kind: 'read', value: 'rotated-read-token' }),
  }))
  assert.equal(credentialResponse.status, 200)
  const credentialBody = await credentialResponse.json()
  assert.equal(credentialBody.credential.configured, true)

  const savedRun = saved.execute({ id: 'gid://shopify/Order/2002' }, { signal: new AbortController().signal })
  const savedPending = await waitForPending(routes)
  await routes.get('/api/shopify-graphql/decide').fetch(new Request('http://local/api/shopify-graphql/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: savedPending.id, decision: 'approve' }),
  }))
  const savedResult = await savedRun
  assert.equal(savedResult.status, 'ok')
  assert.equal(savedResult.decision, 'approved')
})
test('external (Infisical) write tokens cannot be overwritten from the panel', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'shopify-graphql-external-'))
  const { ctx, routes } = fakeContext(credentials({}))
  await apply(ctx, {
    stores: [{
      id: 's1',
      domain: 's1.myshopify.com',
      readToken: { provider: 'local', ref: 'READ' },
      writeToken: { provider: 'infisical' },
    }],
    infisical: {
      baseUrl: 'https://infisical.test',
      projectId: 'project-1',
    },
    stateDir,
  })
  const response = await routes.get('/api/shopify-graphql/credential').fetch(new Request('http://local/api/shopify-graphql/credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId: 's1', kind: 'write', value: 'local-override' }),
  }))
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.code, 'credential_external')
})


test('runtime store files are isolated by state directory', async () => {
  const dirA = await mkdtemp(path.join(tmpdir(), 'shopify-graphql-user-a-'))
  const dirB = await mkdtemp(path.join(tmpdir(), 'shopify-graphql-user-b-'))
  await writeFile(path.join(dirA, 'stores.yaml'), 'stores:\n  - id: store-a\n    domain: store-a.myshopify.com\n')
  await writeFile(path.join(dirB, 'stores.yaml'), 'stores:\n  - id: store-b\n    domain: store-b.myshopify.com\n')

  const first = fakeContext(credentials({}))
  await apply(first.ctx, { stores: [], stateDir: dirA })
  const firstState = await (await first.routes.get('/api/shopify-graphql/state').fetch(new Request('http://local/api/shopify-graphql/state'))).json()
  assert.deepEqual(firstState.stores.map(store => store.id), ['store-a'])

  const second = fakeContext(credentials({}))
  await apply(second.ctx, { stores: [], stateDir: dirB })
  const secondState = await (await second.routes.get('/api/shopify-graphql/state').fetch(new Request('http://local/api/shopify-graphql/state'))).json()
  assert.deepEqual(secondState.stores.map(store => store.id), ['store-b'])
})

test('a store id cannot appear in both the runtime file and the loader config', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'shopify-graphql-duplicate-'))
  await writeFile(path.join(stateDir, 'stores.yaml'), 'stores:\n  - id: s1\n    domain: s1.myshopify.com\n')
  const { ctx } = fakeContext(credentials({}))
  await assert.rejects(
    apply(ctx, {
      stores: [{ id: 's1', domain: 's1.myshopify.com' }],
      stateDir,
    }),
    /defined in both/,
  )
})


test('the settings routes add, configure, and remove a store without a restart', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ data: { shop: { name: 'S2' } } })
  try {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'shopify-graphql-store-'))
    const { ctx, tools, routes } = fakeContext(credentials({}))
    await apply(ctx, { stores: [], stateDir })

    const add = await routes.get('/api/shopify-graphql/store').fetch(new Request('http://local/api/shopify-graphql/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', id: 's2', domain: 's2.myshopify.com', writeProvider: 'local' }),
    }))
    assert.equal(add.status, 200)

    const stateAfterAdd = await (await routes.get('/api/shopify-graphql/state').fetch(new Request('http://local/api/shopify-graphql/state'))).json()
    assert.deepEqual(stateAfterAdd.stores.map(store => store.id), ['s2'])
    assert.equal(stateAfterAdd.stores[0].source, 'runtime')

    const token = await routes.get('/api/shopify-graphql/credential').fetch(new Request('http://local/api/shopify-graphql/credential', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: 's2', kind: 'read', value: 'read-token-2' }),
    }))
    assert.equal(token.status, 200)

    const result = await tools.get('shopify_graphql').execute({
      storeId: 's2',
      document: 'query Shop { shop { name } }',
    }, { signal: new AbortController().signal })
    assert.equal(result.status, 'ok')

    const remove = await routes.get('/api/shopify-graphql/store').fetch(new Request('http://local/api/shopify-graphql/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', id: 's2' }),
    }))
    assert.equal(remove.status, 200)
    const stateAfterRemove = await (await routes.get('/api/shopify-graphql/state').fetch(new Request('http://local/api/shopify-graphql/state'))).json()
    assert.deepEqual(stateAfterRemove.stores, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the Infisical connection can be saved and used by a new store slot', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'shopify-graphql-infisical-'))
  const { ctx, routes } = fakeContext(credentials({}))
  await apply(ctx, { stores: [], stateDir })

  const saved = await routes.get('/api/shopify-graphql/infisical').fetch(new Request('http://local/api/shopify-graphql/infisical', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: 'https://infisical.test',
      projectId: 'project-1',
      environment: 'prod',
    }),
  }))
  assert.equal(saved.status, 200)

  const add = await routes.get('/api/shopify-graphql/store').fetch(new Request('http://local/api/shopify-graphql/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', id: 's3', domain: 's3.myshopify.com', writeProvider: 'infisical' }),
  }))
  assert.equal(add.status, 200)

  const state = await (await routes.get('/api/shopify-graphql/state').fetch(new Request('http://local/api/shopify-graphql/state'))).json()
  assert.equal(state.stores[0].write.provider, 'infisical')
  assert.equal(state.config.infisical.projectId, 'project-1')
  assert.equal(state.config.infisical.identity.clientId.configured, false)

  const identity = await routes.get('/api/shopify-graphql/credential').fetch(new Request('http://local/api/shopify-graphql/credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'infisical-id', value: 'client-id' }),
  }))
  assert.equal(identity.status, 200)
})
