/**
 * Per-article conversation transcripts for the Article Studio bundle.
 *
 * The model's own context lives in its DSH Session; this store keeps the short
 * display record the caret popover renders — the user's instruction, the
 * assistant's replies, and one line per tool call. It is a derived cache, not a
 * second source of truth: losing it loses no model context, only history in the
 * popover.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Longest text kept for one entry. */
const MAX_ENTRY_CHARS = 12_000
/** Longest transcript kept for one article. */
const MAX_ENTRIES = 240

/**
 * Trim one entry to a display-safe size.
 * @param entry - candidate entry.
 * @returns the normalized entry, or undefined when it is not one.
 */
export function normalizeChatEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  const role = entry.role === 'user' || entry.role === 'assistant' || entry.role === 'tool' ? entry.role : undefined
  if (role === undefined) return undefined
  const text = typeof entry.text === 'string' ? entry.text : ''
  const clipped = text.length > MAX_ENTRY_CHARS ? `${text.slice(0, MAX_ENTRY_CHARS)}\n…（已截断）` : text
  const at = typeof entry.at === 'string' ? entry.at : new Date().toISOString()
  return {
    id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `m-${randomUUID().slice(0, 8)}`,
    role,
    text: clipped,
    at,
    ...(typeof entry.name === 'string' && entry.name !== '' ? { name: entry.name.slice(0, 60) } : {}),
    ...(role === 'tool' && typeof entry.tool === 'string' && entry.tool !== '' ? { tool: entry.tool.slice(0, 60) } : {}),
  }
}

/**
 * Create the transcript store over one directory.
 * @param options - `dir` holds one file per article; `now` supplies timestamps.
 * @returns store methods.
 */
export function createChatStore(options) {
  const dir = options.dir
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  /** articleId -> entries. */
  const cache = new Map()
  /** articleId -> pending load. */
  const loads = new Map()
  /** articleId -> serialized write chain. */
  const chains = new Map()

  const fileOf = (articleId) => join(dir, `${articleId}.json`)

  /**
   * Read one transcript from disk into the cache.
   * @param articleId - owning article.
   * @returns the entries.
   */
  async function ensure(articleId) {
    if (cache.has(articleId)) return cache.get(articleId)
    const pending = loads.get(articleId)
    if (pending !== undefined) return pending
    const load = (async () => {
      let entries = []
      try {
        const parsed = JSON.parse(await readFile(fileOf(articleId), 'utf8'))
        if (Array.isArray(parsed?.entries)) {
          entries = parsed.entries.map(normalizeChatEntry).filter((entry) => entry !== undefined).slice(-MAX_ENTRIES)
        }
      } catch {
        entries = []
      }
      cache.set(articleId, entries)
      loads.delete(articleId)
      return entries
    })()
    loads.set(articleId, load)
    return load
  }

  /**
   * Persist one transcript after the previous write of the same file settled.
   * @param articleId - owning article.
   * @param entries - entries to write.
   * @returns when the file is current.
   */
  function persist(articleId, entries) {
    const previous = chains.get(articleId) ?? Promise.resolve()
    const next = previous.then(async () => {
      await mkdir(dir, { recursive: true })
      const target = fileOf(articleId)
      const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
      await writeFile(temporary, `${JSON.stringify({ entries }, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, target)
    })
    chains.set(articleId, next.then(() => undefined, () => undefined))
    return next
  }

  return {
    /** Directory holding one transcript file per article. */
    dir,

    /**
     * The cached entries, loading the file first.
     * @param articleId - owning article.
     * @returns the transcript entries.
     */
    async read(articleId) {
      return [...(await ensure(articleId))]
    },

    /**
     * Append one entry and persist the transcript.
     * @param articleId - owning article.
     * @param entry - display entry.
     * @returns the stored entry.
     */
    async append(articleId, entry) {
      const normalized = normalizeChatEntry({ at: new Date(now()).toISOString(), ...entry })
      if (normalized === undefined) throw new Error('invalid transcript entry')
      const entries = await ensure(articleId)
      entries.push(normalized)
      while (entries.length > MAX_ENTRIES) entries.shift()
      void persist(articleId, entries).catch(() => undefined)
      return normalized
    },

    /**
     * Drop one transcript from memory and disk.
     * @param articleId - owning article.
     * @returns when cleared.
     */
    async clear(articleId) {
      cache.set(articleId, [])
      await persist(articleId, []).catch(() => undefined)
    },
  }
}