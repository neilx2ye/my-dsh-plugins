import assert from 'node:assert/strict'
import test from 'node:test'
import { readConfig } from '../index.js'

const base = {
  stores: [{
    id: 's1',
    domain: 's1.myshopify.com',
  }],
}

test('defaults both token slots to local references', () => {
  const config = readConfig(base)
  assert.deepEqual(config.stores[0].readToken, { provider: 'local', ref: 'SHOPIFY_S1_READ_TOKEN' })
  assert.deepEqual(config.stores[0].writeToken, { provider: 'local', ref: 'SHOPIFY_S1_WRITE_TOKEN' })
  assert.equal(config.infisical, undefined)
})

test('write defaults to Infisical when the connection block exists', () => {
  const config = readConfig({
    ...base,
    infisical: {
      baseUrl: 'https://infisical.example.com',
      projectId: 'project-1',
      environment: 'prod',
      clientIdRef: 'INFISICAL_CLIENT_ID',
      clientSecretRef: 'INFISICAL_CLIENT_SECRET',
    },
  })
  assert.deepEqual(config.stores[0].writeToken, {
    provider: 'infisical',
    service: 'shopify',
    key: 'ADMIN_ACCESS_TOKEN',
  })
  assert.deepEqual(config.stores[0].readToken, { provider: 'local', ref: 'SHOPIFY_S1_READ_TOKEN' })
  assert.equal(config.infisical.secretPathPrefix, '/stores')
})

test('explicit read and write slots are preserved', () => {
  const config = readConfig({
    ...base,
    stores: [{
      id: 's1',
      domain: 's1.myshopify.com',
      readToken: { provider: 'local', ref: 'LOCAL_READ' },
      writeToken: { provider: 'infisical', service: 'shopify', key: 'ADMIN_ACCESS_TOKEN' },
    }],
    infisical: { projectId: 'p', baseUrl: 'https://infisical.example.com' },
  })
  assert.deepEqual(config.stores[0].readToken, { provider: 'local', ref: 'LOCAL_READ' })
  assert.deepEqual(config.stores[0].writeToken, { provider: 'infisical', service: 'shopify', key: 'ADMIN_ACCESS_TOKEN' })
})

test('legacy string token references still load as local slots', () => {
  const config = readConfig({
    ...base,
    stores: [{ id: 's1', domain: 's1.myshopify.com', readTokenRef: 'READ', writeTokenRef: 'WRITE' }],
  })
  assert.deepEqual(config.stores[0].readToken, { provider: 'local', ref: 'READ' })
  assert.deepEqual(config.stores[0].writeToken, { provider: 'local', ref: 'WRITE' })
})

test('Infisical without a connection block is rejected', () => {
  assert.throws(() => readConfig({
    ...base,
    stores: [{ id: 's1', domain: 's1.myshopify.com', writeToken: { provider: 'infisical' } }],
  }), /config\.infisical is missing/)
})

test('unknown token slot keys are rejected', () => {
  assert.throws(() => readConfig({
    ...base,
    stores: [{ id: 's1', domain: 's1.myshopify.com', readToken: { provider: 'local', ref: 'READ', bogus: true } }],
  }), /unknown stores\[0\]\.readToken key/)
})

test('http Infisical base URLs are limited to localhost', () => {
  assert.throws(() => readConfig({
    ...base,
    infisical: { baseUrl: 'http://infisical.example.com', projectId: 'p' },
  }), /must use HTTPS/)
  const local = readConfig({ ...base, infisical: { baseUrl: 'http://localhost:8080', projectId: 'p' } })
  assert.equal(local.infisical.baseUrl, 'http://localhost:8080')
})