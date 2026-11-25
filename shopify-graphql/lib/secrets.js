/**
 * Token routing for one store: read tokens from the local credential store, and
 * write tokens from Infisical when the store's slot names that provider.
 */
import { AppError } from './errors.js'
import { createInfisicalProvider } from './infisical.js'
import { createVault } from './vault.js'

/**
 * Build the per-store secret resolver.
 * @param options - Host context and the plugin's Infisical config (optional).
 * @returns resolve/describe for read and write token slots.
 */
export function createSecrets({ ctx, infisical, fetchImpl }) {
  const local = createVault(ctx)
  let remote = infisical === undefined
    ? undefined
    : createInfisicalProvider({ config: infisical, resolveRef: local.resolve, fetchImpl })

  /**
   * Resolve one token slot.
   * @param store - normalized store config.
   * @param kind - "read" or "write".
   * @returns the token, or undefined when the provider has no value.
   */
  async function resolve(store, kind) {
    const slot = kind === 'read' ? store.readToken : store.writeToken
    if (slot.provider === 'infisical') {
      if (remote === undefined) {
        throw new AppError('infisical_not_configured', 'This store reads its write token from Infisical, but no Infisical config is present.')
      }
      return remote.getSecret({ storeId: store.id, service: slot.service, key: slot.key })
    }
    return local.resolve(slot.ref)
  }

  /**
   * Describe one token slot without resolving the remote value.
   * @param store - normalized store config.
   * @param kind - "read" or "write".
   * @returns provider, configured state (undefined when remote), and a label.
   */
  async function describe(store, kind) {
    const slot = kind === 'read' ? store.readToken : store.writeToken
    if (slot.provider === 'infisical') {
      return {
        provider: 'infisical',
        configured: undefined,
        label: `${slot.service}/${slot.key}`,
      }
    }
    const info = await local.describe(slot.ref)
    return { provider: 'local', configured: info.configured, source: info.source, label: slot.ref }
  }

  /**
   * Whether a token slot can be edited from the panel's local credential form.
   * @param store - normalized store config.
   * @param kind - "read" or "write".
   * @returns true only for local slots.
   */
  function isLocalSlot(store, kind) {
    const slot = kind === 'read' ? store.readToken : store.writeToken
    return slot.provider === 'local'
  }

  /**
   * Replace the Infisical connection used by write slots.
   * @param next - normalized Infisical config, or undefined to disable.
   */
  function setInfisical(next) {
    remote = next === undefined
      ? undefined
      : createInfisicalProvider({ config: next, resolveRef: local.resolve, fetchImpl })
  }

  return { resolve, describe, isLocalSlot, local, setInfisical }
}