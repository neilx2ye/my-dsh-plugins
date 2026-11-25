import assert from 'node:assert/strict'
import test from 'node:test'
import { ShopifyAdminClient } from '../lib/shopify.js'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('sends the admin token header and returns data and cost', async () => {
  const seen = []
  const client = new ShopifyAdminClient({
    fetchImpl: async (url, init) => {
      seen.push({ url, init })
      return response({ data: { shop: { name: 'x' } }, extensions: { cost: { actualQueryCost: 2 } } })
    },
  })
  const result = await client.execute({
    domain: 's1.myshopify.com',
    apiVersion: '2026-04',
    token: 'shpat_secret',
    document: 'query { shop { name } }',
    variables: {},
  })
  assert.equal(seen[0].url, 'https://s1.myshopify.com/admin/api/2026-04/graphql.json')
  assert.equal(seen[0].init.headers['X-Shopify-Access-Token'], 'shpat_secret')
  assert.deepEqual(result.data, { shop: { name: 'x' } })
  assert.equal(result.cost.actualQueryCost, 2)
})

test('retries throttled responses and then succeeds', async () => {
  let calls = 0
  const client = new ShopifyAdminClient({
    sleep: async () => undefined,
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) {
        return response({
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 10, restoreRate: 50 } } },
        }, 200)
      }
      return response({ data: { ok: true } })
    },
  })
  const result = await client.execute({
    domain: 's1.myshopify.com',
    apiVersion: '2026-04',
    token: 'shpat_secret',
    document: 'query { shop { name } }',
  })
  assert.equal(calls, 2)
  assert.deepEqual(result.data, { ok: true })
})

test('redacts the token from error text', async () => {
  const client = new ShopifyAdminClient({
    fetchImpl: async () => response({ errors: [{ message: 'bad token shpat_secret' }] }),
  })
  const result = await client.execute({
    domain: 's1.myshopify.com',
    apiVersion: '2026-04',
    token: 'shpat_secret',
    document: 'query { shop { name } }',
  })
  assert.equal(result.errors[0].message.includes('shpat_secret'), false)
})

test('rejects a non-JSON response', async () => {
  const client = new ShopifyAdminClient({
    fetchImpl: async () => new Response('<html>oops</html>', { status: 502 }),
  })
  await assert.rejects(
    client.execute({
      domain: 's1.myshopify.com',
      apiVersion: '2026-04',
      token: 'shpat_secret',
      document: 'query { shop { name } }',
    }),
    error => error.code === 'shopify_invalid_response',
  )
})