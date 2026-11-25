/**
 * Infisical Universal Auth secret reader for write tokens.
 *
 * The machine identity (client id/secret) is resolved through the local
 * credential store, so it follows the same per-DSH-home isolation as every
 * other secret. Reads are cached briefly and concurrent lookups share one
 * request; misses are not cached.
 */
import { AppError } from './errors.js'
import { redactText } from './util.js'

/**
 * Build the Infisical secret reader.
 * @param options - connection config, local reference resolver, and test seams.
 * @returns a `getSecret({ storeId, service, key })` reader.
 */
export function createInfisicalProvider(options) {
  const { config, resolveRef } = options
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  const cache = new Map()
  let session
  let loginRequest

  /**
   * Resolve the machine identity from the local credential store.
   * @returns client id and secret.
   */
  async function identity() {
    const clientId = await resolveRef(config.clientIdRef)
    const clientSecret = await resolveRef(config.clientSecretRef)
    if (typeof clientId !== 'string' || clientId === '' || typeof clientSecret !== 'string' || clientSecret === '') {
      throw new AppError(
        'infisical_credentials_missing',
        `Infisical machine identity is not configured (references ${config.clientIdRef} and ${config.clientSecretRef}).`,
      )
    }
    return { clientId, clientSecret }
  }

  /**
   * Log in with Universal Auth and cache the access token.
   * @returns bearer token.
   */
  async function accessToken() {
    if (session !== undefined && now() < session.expiresAt) return session.token
    if (loginRequest !== undefined) return loginRequest
    loginRequest = (async () => {
      const { clientId, clientSecret } = await identity()
      let response
      try {
        response = await fetchImpl(`${config.baseUrl}/api/v1/auth/universal-auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ clientId, clientSecret }),
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        })
      } catch (error) {
        throw new AppError(
          'infisical_unavailable',
          `Infisical login failed: ${redactText(error?.message ?? error, [clientSecret])}`,
        )
      }
      const text = await response.text()
      let payload
      try {
        payload = text === '' ? {} : JSON.parse(text)
      } catch {
        throw new AppError('infisical_invalid_response', `Infisical login returned a non-JSON response (HTTP ${response.status}).`)
      }
      if (!response.ok || typeof payload.accessToken !== 'string' || payload.accessToken === '') {
        throw new AppError(
          'infisical_login_failed',
          `Infisical login failed (HTTP ${response.status}).`,
        )
      }
      const ttlSeconds = Math.max(0, Number(payload.expiresIn ?? 3600) - 60)
      session = { token: payload.accessToken, expiresAt: now() + ttlSeconds * 1000 }
      return session.token
    })().finally(() => {
      loginRequest = undefined
    })
    return loginRequest
  }

  /**
   * Read one secret from the store/service path.
   * @param request - store id, service, and key.
   * @returns the secret value, or undefined when Infisical has no such secret.
   */
  async function getSecret(request) {
    const name = normalizeSecretName(request.key)
    const secretPath = joinSecretPath(config.secretPathPrefix, request.storeId, request.service)
    const cacheKey = `${secretPath}\0${name}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined && now() < cached.expiresAt) return cached.value
    if (cached !== undefined) cache.delete(cacheKey)

    const token = await accessToken()
    const url = new URL(`${config.baseUrl}/api/v4/secrets/${encodeURIComponent(name)}`)
    url.searchParams.set('projectId', config.projectId)
    url.searchParams.set('environment', config.environment)
    url.searchParams.set('secretPath', secretPath)
    url.searchParams.set('type', 'shared')
    url.searchParams.set('viewSecretValue', 'true')
    url.searchParams.set('expandSecretReferences', 'true')
    url.searchParams.set('includeImports', 'true')

    let response
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      })
    } catch (error) {
      throw new AppError(
        'infisical_unavailable',
        `Infisical secret lookup failed: ${redactText(error?.message ?? error, [token])}`,
      )
    }
    if (response.status === 404) return undefined
    const text = await response.text()
    let payload
    try {
      payload = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new AppError('infisical_invalid_response', `Infisical secret lookup returned a non-JSON response (HTTP ${response.status}).`)
    }
    if (!response.ok) {
      throw new AppError(
        'infisical_lookup_failed',
        `Infisical secret lookup failed (HTTP ${response.status}): ${redactText(text.slice(0, 200), [token])}`,
      )
    }
    const value = payload?.secret?.secretValue
    if (typeof value !== 'string' || value === '') return undefined
    cache.set(cacheKey, { value, expiresAt: now() + config.cacheTtlMs })
    return value
  }

  return { getSecret }
}

/**
 * Normalize a secret key to Infisical's uppercase underscore form.
 * @param key - configured key.
 * @returns normalized name.
 */
function normalizeSecretName(key) {
  return String(key)
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

/**
 * Join a secret path with slash trimming.
 * @param parts - path segments.
 * @returns an absolute secret path.
 */
function joinSecretPath(...parts) {
  const joined = parts
    .map(part => String(part ?? '').trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
  return `/${joined}`
}