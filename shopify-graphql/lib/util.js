/** Small, dependency-free helpers shared by the Host modules. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Hash an arbitrary UTF-8 string.
 * @param value - text to hash.
 * @returns lowercase hex sha256.
 */
export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Count the UTF-8 bytes of a string or JSON value.
 * @param value - string, object, or undefined.
 * @returns byte length.
 */
export function byteLength(value) {
  if (value === undefined) return 0
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return Buffer.byteLength(text ?? '', 'utf8')
}

/** @returns the current time as an ISO 8601 string. */
export function nowIso() {
  return new Date().toISOString()
}

/**
 * Whether a value is a plain JSON object (not an array, null, or class instance).
 * @param value - candidate.
 * @returns true for a plain object.
 */
export function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}

/**
 * Deep-copy a lossless JSON value.
 * @param value - JSON value.
 * @returns an independent copy.
 */
export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/**
 * Serialize a JSON value with sorted object keys, so equal values hash equally.
 * @param value - JSON value.
 * @returns canonical JSON text.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

/**
 * Hash a JSON value after canonicalization.
 * @param value - JSON value.
 * @returns lowercase hex sha256.
 */
export function hashJson(value) {
  return sha256(canonicalJson(value))
}

/**
 * Read a JSON file, returning a fallback when it does not exist.
 * @param file - absolute path.
 * @param fallback - value for ENOENT.
 * @returns parsed content or the fallback.
 */
export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

/**
 * Write JSON atomically (temporary sibling then rename).
 * @param file - absolute path.
 * @param value - JSON value.
 * @returns when the rename settled.
 */
export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * Append one JSON line to a file, creating its directory.
 * @param file - absolute path.
 * @param value - JSON value.
 * @returns when the append settled.
 */
export async function appendJsonLine(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const { appendFile } = await import('node:fs/promises')
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

/**
 * Truncate a string, marking the cut explicitly.
 * @param value - input text.
 * @param max - maximum characters.
 * @returns the original or a truncated marker.
 */
export function truncate(value, max) {
  if (typeof value !== 'string') return value
  if (value.length <= max) return value
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`
}

/**
 * Truncate a JSON value for storage by replacing an oversized subtree with a marker.
 * @param value - JSON value.
 * @param maxBytes - serialized size ceiling.
 * @returns the original value or a bounded replacement.
 */
export function boundJson(value, maxBytes) {
  if (value === undefined) return undefined
  const text = JSON.stringify(value)
  const bytes = Buffer.byteLength(text ?? '', 'utf8')
  if (bytes <= maxBytes) return value
  return { __truncated: true, bytes, preview: text.slice(0, Math.min(maxBytes, 8000)) }
}

/**
 * Normalize a user-supplied tool name into the `shopify_` namespace.
 * @param value - requested name.
 * @returns a safe DSH tool name.
 */
export function normalizeToolName(value) {
  const base = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const prefixed = base.startsWith('shopify_') ? base : `shopify_${base || 'tool'}`
  return prefixed.slice(0, 64)
}

/**
 * Replace every known secret in a text with a marker.
 * @param text - candidate text.
 * @param secrets - values to redact.
 * @returns safe text.
 */
export function redactText(text, secrets) {
  let result = String(text ?? '')
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 6) result = result.split(secret).join('[redacted]')
  }
  return result
}