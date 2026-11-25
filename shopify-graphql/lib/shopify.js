/**
 * Minimal Shopify Admin GraphQL transport: one POST per request, structured
 * GraphQL errors, throttle-aware retries, and token redaction.
 */
import { AppError } from './errors.js'
import { redactText } from './util.js'

/**
 * Normalize a Shopify GraphQL error list.
 * @param errors - raw errors.
 * @returns bounded error records.
 */
function normalizeErrors(errors) {
  if (!Array.isArray(errors)) return []
  return errors.slice(0, 50).map(error => ({
    message: typeof error?.message === 'string' ? error.message : 'Unknown GraphQL error',
    path: Array.isArray(error?.path) ? error.path : undefined,
    code: typeof error?.extensions?.code === 'string' ? error.extensions.code : undefined,
  }))
}

/**
 * Admin GraphQL client with a bounded retry policy for throttling.
 */
export class ShopifyAdminClient {
  /**
   * @param options - fetch implementation, request timeout, retry ceiling, and sleep.
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxRetries = options.maxRetries ?? 3
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  /**
   * Execute one GraphQL document against a store.
   * @param request - store endpoint, token, document, variables, and cancellation.
   * @returns data, errors, cost, and timing.
   */
  async execute(request) {
    const { domain, apiVersion, token, document, variables, operationName, signal } = request
    const url = `https://${domain}/admin/api/${apiVersion}/graphql.json`
    const body = JSON.stringify({
      query: document,
      ...(variables === undefined ? {} : { variables }),
      ...(operationName === undefined ? {} : { operationName }),
    })
    let attempt = 0

    for (;;) {
      const startedAt = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      const onAbort = () => controller.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      let response
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': token,
          },
          body,
          signal: controller.signal,
        })
      } catch (error) {
        if (signal?.aborted === true) throw new AppError('cancelled', 'The request was cancelled.')
        if (attempt < this.maxRetries) {
          attempt += 1
          await this.sleep(Math.min(500 * 2 ** attempt, 4_000))
          continue
        }
        throw new AppError('shopify_transport_error', `Shopify request failed: ${redactText(error?.message ?? error, [token])}`)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }

      const text = await response.text()
      let payload
      try {
        payload = text === '' ? {} : JSON.parse(text)
      } catch {
        throw new AppError('shopify_invalid_response', `Shopify returned a non-JSON response (HTTP ${response.status}).`)
      }

      const errors = normalizeErrors(payload.errors).map(error => ({
        ...error,
        message: redactText(error.message, [token]),
      }))
      const throttled = response.status === 429
        || response.status === 430
        || errors.some(error => error.code === 'THROTTLED' || /throttl/i.test(error.message))
      if (throttled && attempt < this.maxRetries) {
        attempt += 1
        await this.sleep(throttleDelay(payload, attempt))
        continue
      }

      if (!response.ok && errors.length === 0) {
        throw new AppError(
          'shopify_http_error',
          `Shopify returned HTTP ${response.status}${text === '' ? '' : `: ${redactText(text.slice(0, 300), [token])}`}`,
        )
      }

      return {
        httpStatus: response.status,
        data: payload.data ?? null,
        errors,
        cost: payload.extensions?.cost ?? null,
        durationMs: Date.now() - startedAt,
      }
    }
  }
}

/**
 * Estimate a throttle wait from the cost extension, with exponential fallback.
 * @param payload - parsed Shopify response.
 * @param attempt - retry ordinal starting at 1.
 * @returns milliseconds to wait.
 */
function throttleDelay(payload, attempt) {
  const status = payload?.extensions?.cost?.throttleStatus
  const available = Number(status?.currentlyAvailable)
  const restoreRate = Number(status?.restoreRate)
  const requested = Number(payload?.extensions?.cost?.requestedQueryCost) || 0
  if (Number.isFinite(available) && Number.isFinite(restoreRate) && restoreRate > 0 && requested > available) {
    return Math.min(Math.ceil(((requested - available) / restoreRate) * 1000) + 100, 10_000)
  }
  return Math.min(500 * 2 ** attempt, 5_000)
}