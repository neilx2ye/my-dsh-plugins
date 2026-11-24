/**
 * Host half of the model-quota bundle.
 *
 * One browser-admitted Fetch route reports the ChatGPT/Codex subscription's
 * remaining windows, read from the same endpoint the Codex client uses
 * (`GET /backend-api/codex/usage`) with the OAuth grant the `openai-codex`
 * route already stores. The token never reaches the page: this route returns
 * percentages, reset times and the plan name only.
 *
 * A stored grant is not permanent: its access token expires after days and a
 * rotated login replaces it. The route therefore renews the grant itself with
 * the refresh token pi-ai stores beside it — proactively once the recorded
 * expiry has passed, and once more when the usage endpoint refuses the access
 * token — and commits the rotated grant through the credential seam, so neither
 * a lapse nor a rotation turns into a "sign in again" prompt while the refresh
 * token is still good.
 *
 * Other routes in this profile (Aliyun MaaS, DeepSeek) publish no comparable
 * quota, so the route answers `available: false` for the page to render
 * nothing rather than a zero it cannot justify.
 */

/** Services this bundle needs from the Web Host composition. */
export const inject = ['connection', 'credentials']

/** Credential record the pi-ai Codex route authenticates with. */
const KEY = 'llm-pi-ai/openai-codex'
/** Browser-admitted route the composer pill polls. */
const ROUTE = '/api/model-quota'
/** Upstream usage endpoint. */
const USAGE_URL = 'https://chatgpt.com/backend-api/codex/usage'
/** OAuth token endpoint the Codex login flow refreshes against. */
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
/** Public OAuth client id the Codex CLI and pi-ai both refresh with. */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
/** Default reuse interval for one reading: the windows move on a multi-hour scale. */
const DEFAULT_CACHE_MS = 60_000
/** Bound one upstream call. */
const TIMEOUT_MS = 12_000

/**
 * Label a limit window by its length.
 * @param seconds - window length from the payload.
 * @returns a short label the pill can print.
 */
function windowLabel(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 'limit'
  if (seconds <= 6 * 60 * 60) return '5h'
  if (seconds <= 2 * 24 * 60 * 60) return '1d'
  if (seconds <= 8 * 24 * 60 * 60) return 'week'
  return `${Math.round(seconds / 86400)}d`
}

/**
 * Normalize one upstream window.
 * @param window - the payload's window object, if any.
 * @returns percent remaining, its label, and when it resets.
 */
function readWindow(window) {
  if (window === null || typeof window !== 'object') return null
  const used = window.used_percent
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  const length = window.limit_window_seconds
  const resetAt = typeof window.reset_at === 'number' ? window.reset_at * 1000 : null
  return {
    label: windowLabel(length),
    lengthSeconds: typeof length === 'number' ? length : null,
    usedPercent: Math.max(0, Math.min(100, used)),
    remainingPercent: Math.max(0, Math.min(100, 100 - used)),
    resetAt,
    resetAfterSeconds: typeof window.reset_after_seconds === 'number' ? window.reset_after_seconds : null,
  }
}

/**
 * Read the ChatGPT account id out of an access token's claims, the same claim
 * pi-ai reads (`https://api.openai.com/auth`.chatgpt_account_id).
 * @param access - the OAuth access token.
 * @returns the account id, or undefined when the token carries none.
 */
function accountIdOf(access) {
  try {
    const part = access.split('.')[1]
    if (part === undefined || part === '') return undefined
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    const id = claims?.['https://api.openai.com/auth']?.chatgpt_account_id
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

/**
 * Exchange a stored refresh token for a fresh grant, without touching storage.
 * @param grant - the stored OAuth credential.
 * @returns the rotated credential, or undefined when the token endpoint
 * refused or answered unusably.
 */
async function rotateGrant(grant) {
  const refresh = grant?.refresh
  if (typeof refresh !== 'string' || refresh === '') return undefined
  let response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: CLIENT_ID,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return undefined
  }
  if (!response.ok) return undefined
  let body
  try {
    body = await response.json()
  } catch {
    return undefined
  }
  const access = body?.access_token
  const ttl = body?.expires_in
  if (typeof access !== 'string' || access === '' || typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
    return undefined
  }
  const next = {
    access,
    refresh: typeof body.refresh_token === 'string' && body.refresh_token !== '' ? body.refresh_token : refresh,
    expires: Date.now() + ttl * 1000,
  }
  const accountId = accountIdOf(access) ?? (typeof grant.accountId === 'string' && grant.accountId !== '' ? grant.accountId : undefined)
  if (accountId !== undefined) next.accountId = accountId
  return next
}

/**
 * Register the quota route.
 * @param ctx - Host root Context.
 */
export function apply(ctx, config) {
  const rawCache = config?.cacheMs
  if (rawCache !== undefined && (!Number.isInteger(rawCache) || rawCache < 1_000 || rawCache > 3_600_000)) {
    throw new Error('model-quota: config.cacheMs must be an integer between 1000 and 3600000')
  }
  const cacheMs = rawCache ?? DEFAULT_CACHE_MS
  /** Last completed reading, reused inside the cache window. */
  let cached = null
  /** Reading in flight, shared by concurrent polls. */
  let pending = null

  /**
   * Read the subscription quota through the stored Codex grant, renewing the
   * grant once when it lapsed or was refused.
   * @returns the page payload; never a token.
   */
  const read = async () => {
    const record = await ctx.credentials.readRecord(KEY).catch(() => undefined)
    let grant = record?.kind === 'grant' ? record.payload : undefined
    if (typeof grant?.access !== 'string' || grant.access === '') {
      return { available: false, reason: 'NO_GRANT' }
    }

    /**
     * Renew the grant the reading started from, under the credential store's
     * exclusive section — the same lock pi-ai refreshes under — so a rotation
     * another process completed first is observed instead of raced. A store
     * that still holds the stale grant after the attempt means the refresh
     * itself failed.
     * @param stale - the grant whose access token was just refused.
     * @returns the grant to use for the next call, or undefined.
     */
    const renew = async (stale) => {
      const stored = await ctx.credentials.modifyRecord(KEY, async (current) => {
        const payload = current?.kind === 'grant' ? current.payload : undefined
        if (typeof payload?.access !== 'string' || payload.access === '') return undefined
        // Another writer already replaced this grant: keep theirs.
        if (payload.access !== stale.access) return undefined
        const refreshed = await rotateGrant(payload)
        if (refreshed === undefined) return undefined
        return { kind: 'grant', payload: { ...payload, ...refreshed } }
      }).catch(() => undefined)
      const payload = stored?.kind === 'grant' ? stored.payload : undefined
      if (typeof payload?.access !== 'string' || payload.access === '') return undefined
      if (payload.access === stale.access) return undefined
      return payload
    }

    /**
     * Ask the usage endpoint for one grant.
     * @param current - the grant to authenticate with.
     * @returns the upstream body, or the failure it produced.
     */
    const usage = async (current) => {
      const headers = {
        authorization: `Bearer ${current.access}`,
        originator: 'pi',
        accept: 'application/json',
        ...(typeof current.accountId === 'string' && current.accountId !== ''
          ? { 'chatgpt-account-id': current.accountId }
          : {}),
      }
      let response
      try {
        response = await fetch(USAGE_URL, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      } catch (error) {
        return { status: 'NETWORK', detail: error instanceof Error ? error.message : String(error) }
      }
      if (response.status === 401 || response.status === 403) return { status: 'UNAUTHORIZED' }
      if (!response.ok) return { status: 'UPSTREAM', detail: `HTTP ${response.status}` }
      try {
        return { status: 'OK', body: await response.json() }
      } catch {
        return { status: 'UPSTREAM', detail: 'malformed JSON' }
      }
    }

    if (typeof grant.expires === 'number' && grant.expires <= Date.now()) {
      grant = await renew(grant)
      if (grant === undefined) return { available: false, reason: 'EXPIRED' }
    }

    let result = await usage(grant)
    if (result.status === 'UNAUTHORIZED') {
      const renewed = await renew(grant)
      if (renewed === undefined) return { available: false, reason: 'UNAUTHORIZED' }
      grant = renewed
      result = await usage(grant)
    }
    if (result.status === 'UNAUTHORIZED') return { available: false, reason: 'UNAUTHORIZED' }
    if (result.status !== 'OK') {
      return { available: false, reason: result.status, ...(result.detail === undefined ? {} : { detail: result.detail }) }
    }

    const body = result.body
    const rateLimit = body?.rate_limit ?? null
    const windows = [
      readWindow(rateLimit?.primary_window),
      readWindow(rateLimit?.secondary_window),
    ].filter((window) => window !== null)
    const credits = body?.credits
    return {
      available: true,
      plan: typeof body?.plan_type === 'string' ? body.plan_type : null,
      email: typeof body?.email === 'string' ? body.email : null,
      allowed: rateLimit?.allowed !== false,
      limitReached: rateLimit?.limit_reached === true,
      reachedType: typeof body?.rate_limit_reached_type === 'string' ? body.rate_limit_reached_type : null,
      windows,
      credits: credits === null || typeof credits !== 'object'
        ? null
        : {
            hasCredits: credits.has_credits === true,
            unlimited: credits.unlimited === true,
            overageLimitReached: credits.overage_limit_reached === true,
            balance: typeof credits.balance === 'number' ? credits.balance : null,
          },
      sampledAt: Date.now(),
    }
  }

  /**
   * Serve one reading, sharing an in-flight upstream call.
   * @param force - bypass the cache for an explicit refresh.
   * @returns the page payload.
   */
  const serve = async (force) => {
    if (!force && cached !== null && Date.now() - cached.readAt < cacheMs) return cached.value
    if (pending !== null) return pending
    pending = read()
      // A failed reading is cached too: a revoke that survives the renewal
      // should not rotate the refresh token on every poll.
      .then((value) => {
        cached = { readAt: Date.now(), value }
        return value
      })
      .catch((error) => ({ available: false, reason: 'FAILED', detail: error instanceof Error ? error.message : String(error) }))
      .finally(() => { pending = null })
    return pending
  }

  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const force = new URL(request.url).searchParams.get('fresh') === '1'
      return Response.json(await serve(force), { headers: { 'cache-control': 'no-store' } })
    },
  }), 'model-quota: quota route')
}