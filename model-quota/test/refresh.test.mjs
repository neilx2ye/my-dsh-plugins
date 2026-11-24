import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { apply } from '../index.js'

/** Upstream JSON the usage endpoint usually answers with. */
const USAGE_BODY = {
  plan_type: 'team',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 5, limit_window_seconds: 18000, reset_at: 1_800_000_000 },
  },
  credits: { has_credits: false, unlimited: false },
}

/**
 * Mount the plugin over an in-memory credential record and a scripted fetch.
 * @param initial - the record the store starts with.
 * @param handler - replaces the global fetch for the test.
 * @param staleRead - when set, the first read answers this older snapshot.
 * @returns the mounted route and the current record.
 */
function mount(initial, handler, staleRead) {
  let record = initial
  let firstRead = staleRead !== undefined
  const routes = []
  const ctx = {
    credentials: {
      readRecord: async () => {
        if (firstRead) {
          firstRead = false
          return staleRead
        }
        return record
      },
      modifyRecord: async (key, mutate) => {
        const next = await mutate(record)
        if (next !== undefined) record = next
        return record
      },
    },
    connection: { fetch: { register: (route) => { routes.push(route); return () => {} } } },
    effect: (fn) => fn(),
  }
  globalThis.fetch = handler
  apply(ctx, { cacheMs: 1000 })
  return { route: routes[0], record: () => record }
}

/** Fresh OAuth record with the given access/refresh tokens. */
function grant({ access = 'old-access', refresh = 'old-refresh', expires = Date.now() + 60_000 } = {}) {
  return { kind: 'grant', payload: { type: 'oauth', access, refresh, expires, accountId: 'acct-1' } }
}

/** Token endpoint success body. */
function rotated(access, refresh) {
  return { access_token: access, refresh_token: refresh, expires_in: 3600 }
}

afterEach(() => {
  delete globalThis.fetch
})

test('an expired grant is renewed before the usage call', async () => {
  const calls = []
  const { route, record } = mount(grant({ expires: Date.now() - 1000 }), async (url, init) => {
    calls.push(url)
    if (url.includes('/oauth/token')) {
      assert.equal(init.method, 'POST')
      assert.match(String(init.body), /grant_type=refresh_token/)
      assert.match(String(init.body), /refresh_token=old-refresh/)
      return Response.json(rotated('new-access', 'new-refresh'))
    }
    assert.equal(init.headers.authorization, 'Bearer new-access')
    assert.equal(init.headers['chatgpt-account-id'], 'acct-1')
    return Response.json(USAGE_BODY)
  })

  const payload = await route.fetch({ url: 'http://host/api/model-quota?fresh=1' }).then((r) => r.json())

  assert.equal(payload.available, true)
  assert.equal(payload.plan, 'team')
  assert.equal(record().payload.access, 'new-access')
  assert.equal(record().payload.refresh, 'new-refresh')
  assert.ok(record().payload.expires > Date.now())
})

test('a refused access token is renewed and the usage call retried once', async () => {
  let usageCalls = 0
  const { route, record } = mount(grant(), async (url, init) => {
    if (url.includes('/oauth/token')) return Response.json(rotated('new-access', 'new-refresh'))
    usageCalls += 1
    if (init.headers.authorization === 'Bearer old-access') return new Response('no', { status: 401 })
    return Response.json(USAGE_BODY)
  })

  const payload = await route.fetch({ url: 'http://host/api/model-quota?fresh=1' }).then((r) => r.json())

  assert.equal(payload.available, true)
  assert.equal(usageCalls, 2)
  assert.equal(record().payload.access, 'new-access')
})

test('a refused grant whose renewal fails reports UNAUTHORIZED without writing', async () => {
  const initial = grant()
  const { route, record } = mount(initial, async (url) => {
    if (url.includes('/oauth/token')) return new Response('invalid_grant', { status: 400 })
    return new Response('no', { status: 403 })
  })

  const payload = await route.fetch({ url: 'http://host/api/model-quota?fresh=1' }).then((r) => r.json())

  assert.equal(payload.available, false)
  assert.equal(payload.reason, 'UNAUTHORIZED')
  assert.deepEqual(record(), initial)
})

test('a renewal that loses the race keeps the grant another writer committed', async () => {
  const used = []
  const current = grant({ access: 'other-access', refresh: 'other-refresh' })
  const { route, record } = mount(current, async (url, init) => {
    assert.ok(!url.includes('/oauth/token'), 'the store already held a newer grant, so nothing to refresh')
    if (init.headers.authorization === 'Bearer old-access') return new Response('no', { status: 401 })
    used.push(init.headers.authorization)
    return Response.json(USAGE_BODY)
  }, grant())

  const payload = await route.fetch({ url: 'http://host/api/model-quota?fresh=1' }).then((r) => r.json())

  assert.equal(payload.available, true)
  assert.equal(record().payload.access, 'other-access')
  assert.deepEqual(used, ['Bearer other-access'])
})

test('a failed reading is cached so a stubborn 401 does not rotate on every poll', async () => {
  let tokenCalls = 0
  const { route } = mount(grant(), async (url) => {
    if (url.includes('/oauth/token')) {
      tokenCalls += 1
      return new Response('invalid_grant', { status: 400 })
    }
    return new Response('no', { status: 401 })
  })

  await route.fetch({ url: 'http://host/api/model-quota' })
  await route.fetch({ url: 'http://host/api/model-quota' })

  assert.equal(tokenCalls, 1)
})