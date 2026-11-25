/**
 * Per-store guardrails: a small YAML file that can forbid writes, block specific
 * mutation root fields, and set size/time limits. The file is read fresh for
 * every call; an unreadable or invalid file fails closed.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { AppError } from './errors.js'
import { hashJson } from './util.js'

/** Built-in limits used when the policy file omits them. */
export const DEFAULT_LIMITS = {
  maxDocumentBytes: 65_536,
  maxVariablesBytes: 65_536,
  approvalTimeoutMs: 600_000,
}

/** Policy keys accepted by the loader. */
const POLICY_KEYS = new Set(['readOnly', 'blockedRootFields', 'limits'])
/** Limit keys accepted by the loader. */
const LIMIT_KEYS = new Set(['maxDocumentBytes', 'maxVariablesBytes', 'approvalTimeoutMs'])

/**
 * Build the default policy object.
 * @returns a fresh policy.
 */
export function defaultPolicy() {
  return {
    readOnly: false,
    blockedRootFields: [],
    limits: { ...DEFAULT_LIMITS },
  }
}

/**
 * Resolve the policy file path for one store.
 * @param stateDir - plugin state root.
 * @param storeId - store identifier.
 * @returns absolute path.
 */
export function policyFilePath(stateDir, storeId) {
  return path.join(stateDir, 'policies', `${storeId}.yaml`)
}

/**
 * Load one store's policy, falling back to defaults when no file exists.
 * @param options - state directory and store id.
 * @returns effective policy, source path, and hash.
 */
export async function loadPolicy({ stateDir, storeId }) {
  const file = policyFilePath(stateDir, storeId)
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const policy = defaultPolicy()
      return { policy, path: file, hash: hashJson(policy), exists: false }
    }
    throw new AppError('policy_unavailable', `Store policy could not be read: ${file}`)
  }

  let document
  try {
    document = parseYaml(raw)
  } catch (error) {
    throw new AppError('policy_invalid', `Store policy is not valid YAML: ${file}`, { reason: error?.message })
  }

  const policy = validatePolicy(document, file)
  return { policy, path: file, hash: hashJson(policy), exists: true }
}

/**
 * Validate a parsed policy document with no silent key stripping.
 * @param document - parsed YAML.
 * @param file - source path for diagnostics.
 * @returns normalized policy.
 */
export function validatePolicy(document, file = 'policy.yaml') {
  if (document === null || document === undefined) return defaultPolicy()
  if (typeof document !== 'object' || Array.isArray(document)) {
    throw new AppError('policy_invalid', `Store policy must be an object: ${file}`)
  }
  for (const key of Object.keys(document)) {
    if (!POLICY_KEYS.has(key)) {
      throw new AppError('policy_invalid', `Unknown store policy key "${key}" in ${file}`)
    }
  }

  const policy = defaultPolicy()
  if (document.readOnly !== undefined) {
    if (typeof document.readOnly !== 'boolean') {
      throw new AppError('policy_invalid', `readOnly must be a boolean in ${file}`)
    }
    policy.readOnly = document.readOnly
  }
  if (document.blockedRootFields !== undefined) {
    if (!Array.isArray(document.blockedRootFields) || document.blockedRootFields.some(item => typeof item !== 'string' || item.trim() === '')) {
      throw new AppError('policy_invalid', `blockedRootFields must be an array of non-empty strings in ${file}`)
    }
    policy.blockedRootFields = [...new Set(document.blockedRootFields.map(item => item.trim()))]
  }
  if (document.limits !== undefined) {
    if (typeof document.limits !== 'object' || document.limits === null || Array.isArray(document.limits)) {
      throw new AppError('policy_invalid', `limits must be an object in ${file}`)
    }
    for (const key of Object.keys(document.limits)) {
      if (!LIMIT_KEYS.has(key)) {
        throw new AppError('policy_invalid', `Unknown limits key "${key}" in ${file}`)
      }
      const value = document.limits[key]
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new AppError('policy_invalid', `limits.${key} must be a positive integer in ${file}`)
      }
      policy.limits[key] = value
    }
  }
  return policy
}

/**
 * Check a request against a store's policy before any token is used.
 * @param policy - effective policy.
 * @param request - operation type, root fields, and serialized sizes.
 * @returns when the request is allowed.
 */
export function checkPolicy(policy, request) {
  const { operationType, rootFields, documentBytes, variablesBytes } = request
  if (policy.readOnly && operationType === 'mutation') {
    throw new AppError('policy_read_only', 'This store is read-only; mutations are disabled by its policy.')
  }
  const blocked = rootFields.filter(field => policy.blockedRootFields.includes(field))
  if (blocked.length > 0) {
    throw new AppError('policy_blocked', `Store policy blocks these root fields: ${blocked.join(', ')}.`, { blocked })
  }
  if (documentBytes > policy.limits.maxDocumentBytes) {
    throw new AppError(
      'policy_limit_document',
      `The GraphQL document is ${documentBytes} bytes; the store limit is ${policy.limits.maxDocumentBytes}.`,
    )
  }
  if (variablesBytes > policy.limits.maxVariablesBytes) {
    throw new AppError(
      'policy_limit_variables',
      `The GraphQL variables are ${variablesBytes} bytes; the store limit is ${policy.limits.maxVariablesBytes}.`,
    )
  }
}