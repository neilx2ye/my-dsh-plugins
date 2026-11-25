import assert from 'node:assert/strict'
import test from 'node:test'
import { createInfisicalProvider } from '../lib/infisical.js'

function config(overrides = {}) {
  return {
    baseUrl: 'https://infisical.test',
    projectId: 'project-1',
    environment: 'prod',
    secretPathPrefix: '/stores',
    clientIdRef: 'ID',
    clientSecretRef: 'SECRET',
    cacheTtlMs: 30_000,
    requestTimeoutMs: 5_000,
    ...overrides,
  }
}

const identity = async ref => (ref === 'ID' ? 'client-id' : ref === 'SECRET' ? 'client-secret' : undefined)

test('logs in once and reads a secret with the expected path', async () => {
  const calls = []
  let time = 0
  const provider = createInfisicalProvider({
    config: config(),
    resolveRef: identity,
    now: () => time,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('/auth/universal-auth/login')) {
        return Response.json({ accessToken: 'access-token', expiresIn: 3600 })
      }
      return Response.json({ secret: { secretValue: 'admin-token' } })
    },
  })

  assert.equal(await provider.getSecret({ storeId: 's1', service: 'shopify', key: 'ADMIN_ACCESS_TOKEN' }), 'admin-token')
  assert.equal(await provider.getSecret({ storeId: 's1', service: 'shopify', key: 'ADMIN_ACCESS_TOKEN' }), 'admin-token')
  assert.equal(calls.length, 2)
  assert.match(calls[1].url, /\/api\/v4\/secrets\/ADMIN_ACCESS_TOKEN\?/)
  assert.match(calls[1].url, /secretPath=%2Fstores%2Fs1%2Fshopify/)
  assert.match(calls[1].url, /environment=prod/)
  assert.match(calls[1].url, /projectId=project-1/)
  assert.equal(calls[1].init.headers.Authorization, 'Bearer access-token')
  time += 31_000
  await provider.getSecret({ storeId: 's1', service: 'shopify', key: 'ADMIN_ACCESS_TOKEN' })
  assert.equal(calls.length, 3)
  assert.equal(String(calls[2].url).includes('/api/v4/secrets/'), true)
})

test('404 reads as undefined and is not cached', async () => {
  let calls = 0
  const provider = createInfisicalProvider({
    config: config(),
    resolveRef: identity,
    fetchImpl: async url => {
      calls += 1
      if (String(url).includes('/auth/')) return Response.json({ accessToken: 'access-token', expiresIn: 3600 })
      return new Response('not found', { status: 404 })
    },
  })
  assert.equal(await provider.getSecret({ storeId: 's1', service: 'shopify', key: 'MISSING' }), undefined)
  assert.equal(await provider.getSecret({ storeId: 's1', service: 'shopify', key: 'MISSING' }), undefined)
  assert.equal(calls, 3)
})

test('a missing machine identity fails with a stable code', async () => {
  const provider = createInfisicalProvider({
    config: config(),
    resolveRef: async () => undefined,
    fetchImpl: async () => Response.json({}),
  })
  await assert.rejects(
    provider.getSecret({ storeId: 's1', service: 'shopify', key: 'X' }),
    error => error.code === 'infisical_credentials_missing',
  )
})