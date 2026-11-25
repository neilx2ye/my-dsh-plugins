/**
 * Read-only credential resolution for store tokens. Values are resolved for the
 * duration of one request and never returned to a model, a route payload, or an
 * audit record.
 */

/**
 * Create the vault facade over the Harness credential service with an
 * environment fallback for profiles without it.
 * @param ctx - Host plugin context.
 * @param env - process environment (injectable for tests).
 * @returns resolve/describe helpers.
 */
export function createVault(ctx, env = process.env) {
  const credentials = () => {
    try {
      return ctx.get('credentials')
    } catch {
      return undefined
    }
  }

  /**
   * Resolve one credential reference to its current value.
   * @param ref - POSIX-style credential reference.
   * @returns the secret value, or undefined when unset.
   */
  async function resolve(ref) {
    if (typeof ref !== 'string' || ref.trim() === '') return undefined
    const service = credentials()
    if (service !== undefined) {
      try {
        const hit = await service.resolve(ref)
        if (typeof hit?.value === 'string' && hit.value !== '') return hit.value
      } catch {
        // Fall through to the process environment.
      }
    }
    const ambient = env[ref]
    return typeof ambient === 'string' && ambient !== '' ? ambient : undefined
  }

  /**
   * Describe whether a reference is configured without exposing its value.
   * @param ref - POSIX-style credential reference.
   * @returns configured flag and source label.
   */
  async function describe(ref) {
    if (typeof ref !== 'string' || ref.trim() === '') return { configured: false }
    const service = credentials()
    if (service !== undefined) {
      try {
        const info = await service.describe(ref)
        if (info?.configured === true) {
          return { configured: true, source: typeof info.source === 'string' ? info.source : 'store' }
        }
      } catch {
        // Fall through to the environment check.
      }
    }
    return env[ref] ? { configured: true, source: 'env' } : { configured: false }
  }

  return { resolve, describe }
}