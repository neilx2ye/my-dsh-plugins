/**
 * Article documents for the Article Studio bundle.
 *
 * One article is one JSON file under the plugin's profile-local data
 * directory. The store is a thin in-memory map over those files: reads are
 * served from memory, every mutation is written atomically through one
 * per-file chain so two rapid saves cannot interleave.
 *
 * The document shape is deliberately plain JSON so a later version, another
 * reader, or a hand-written script can open it:
 *
 *   { id, title, text, style, rev, createdAt, updatedAt, sessionId }
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withoutImageReferences } from './media.js'

/** Font families the editor offers; the client maps them to CSS stacks. */
export const FONT_VALUES = ['serif', 'sans', 'kai', 'mono']
/** Paragraph alignment values. */
export const ALIGN_VALUES = ['left', 'center', 'justify']
/** Document canvas themes. */
export const THEME_VALUES = ['paper', 'sepia', 'dark']

/** Style a new article starts from. */
export const DEFAULT_STYLE = Object.freeze({
  font: 'serif',
  fontSize: 18,
  lineHeight: 1.85,
  paragraphGap: 12,
  width: 760,
  align: 'left',
  indent: false,
  theme: 'paper',
})

/** Named style recipes the model and the toolbar can apply in one step. */
export const STYLE_PRESETS = Object.freeze({
  essay: Object.freeze({ font: 'serif', fontSize: 19, lineHeight: 2, paragraphGap: 16, width: 680, align: 'justify', indent: true, theme: 'paper' }),
  blog: Object.freeze({ font: 'sans', fontSize: 17, lineHeight: 1.85, paragraphGap: 14, width: 720, align: 'left', indent: false, theme: 'paper' }),
  wechat: Object.freeze({ font: 'sans', fontSize: 17, lineHeight: 1.9, paragraphGap: 20, width: 620, align: 'left', indent: false, theme: 'paper' }),
  note: Object.freeze({ font: 'sans', fontSize: 15, lineHeight: 1.7, paragraphGap: 10, width: 820, align: 'left', indent: false, theme: 'dark' }),
  warm: Object.freeze({ font: 'kai', fontSize: 18, lineHeight: 1.9, paragraphGap: 14, width: 700, align: 'left', indent: true, theme: 'sepia' }),
})

/** Stable article id shape; also the on-disk file name. */
const ARTICLE_ID = /^a-[0-9a-f]{12}$/

/** Bounds for the numeric style fields, in the order they are clamped. */
const NUMERIC_BOUNDS = Object.freeze({
  fontSize: [13, 30],
  lineHeight: [1.3, 2.6],
  paragraphGap: [0, 40],
  width: [520, 980],
})

/**
 * Whether a value names one article this plugin owns.
 * @param value - candidate id.
 * @returns true when the id is well formed.
 */
export function isArticleId(value) {
  return typeof value === 'string' && ARTICLE_ID.test(value)
}

/**
 * Mint a new article id.
 * @returns `a-` plus twelve hex characters.
 */
export function newArticleId() {
  return `a-${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

/**
 * Clamp one numeric style field.
 * @param value - candidate value.
 * @param range - `[min, max]`.
 * @param fallback - value used when the candidate is not a finite number.
 * @returns the accepted number.
 */
function clampNumber(value, range, fallback) {
  const [min, max] = range
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100))
}

/**
 * Merge a partial style over a base style, dropping unknown or invalid keys.
 * @param patch - partial style from a tool call, a config file, or the UI.
 * @param base - style to start from; defaults to {@link DEFAULT_STYLE}.
 * @returns a complete style object.
 */
export function normalizeStyle(patch, base = DEFAULT_STYLE) {
  const next = { ...DEFAULT_STYLE, ...base }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return next
  if (FONT_VALUES.includes(patch.font)) next.font = patch.font
  if (ALIGN_VALUES.includes(patch.align)) next.align = patch.align
  if (THEME_VALUES.includes(patch.theme)) next.theme = patch.theme
  if (typeof patch.indent === 'boolean') next.indent = patch.indent
  for (const [key, range] of Object.entries(NUMERIC_BOUNDS)) {
    if (patch[key] === undefined) continue
    next[key] = clampNumber(patch[key], range, next[key])
  }
  return next
}

/**
 * Resolve a named style recipe over the current style.
 * @param name - preset name.
 * @returns a complete style, or undefined when the name is unknown.
 */
export function stylePreset(name) {
  if (typeof name !== 'string') return undefined
  const entry = STYLE_PRESETS[name]
  if (entry === undefined) return undefined
  return normalizeStyle(entry, DEFAULT_STYLE)
}

/**
 * A rough writing length: CJK characters plus Latin word runs.
 * @param text - article body.
 * @returns the counted length.
 */
export function countWords(text) {
  const value = typeof text === 'string' ? withoutImageReferences(text) : ''
  const cjk = value.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ?? 0
  const latin = value.match(/[A-Za-z0-9]+/gu)?.length ?? 0
  return cjk + latin
}

/**
 * Build a one-line plain-text summary for list rows.
 * @param text - article body.
 * @param limit - maximum characters.
 * @returns the summary without Markdown control characters.
 */
export function previewOf(text, limit = 80) {
  const plain = withoutImageReferences(String(text ?? ''))
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/[*_`>~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (plain.length <= limit) return plain
  return `${plain.slice(0, limit).trimEnd()}…`
}

/**
 * Render the article as a Markdown document.
 * @param article - stored article.
 * @returns Markdown text.
 */
export function articleToMarkdown(article) {
  const title = typeof article.title === 'string' ? article.title.trim() : ''
  const text = typeof article.text === 'string' ? article.text : ''
  const body = text.trimStart()
  const heading = title === '' ? '' : `# ${title}\n\n`
  return body.startsWith('# ') ? `${body}\n` : `${heading}${body}\n`
}

/**
 * Normalize one pending-change record kept for the review view.
 * @param raw - candidate record.
 * @returns the record, or undefined when malformed.
 */
export function normalizeChange(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  if (typeof raw.before !== 'string') return undefined
  return {
    before: raw.before,
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
    ...(typeof raw.tool === 'string' && raw.tool !== '' ? { tool: raw.tool.slice(0, 60) } : {}),
    ...(typeof raw.name === 'string' && raw.name !== '' ? { name: raw.name.slice(0, 60) } : {}),
  }
}

/**
 * Project a stored article into a list row.
 * @param article - stored article.
 * @returns summary fields the sidebar list needs.
 */
export function summarizeArticle(article) {
  return {
    id: article.id,
    title: article.title,
    preview: previewOf(article.text),
    chars: countWords(article.text),
    rev: article.rev,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    ...(typeof article.sessionId === 'string' ? { sessionId: article.sessionId } : {}),
    ...(typeof article.identityName === 'string' ? { identityName: article.identityName } : {}),
  }
}

/**
 * Make a stored article safe to hand to the browser: the document is plain
 * JSON already, so this only fills in fields an older file may lack.
 * @param raw - parsed file content.
 * @returns an article or undefined when the file is not one.
 */
export function parseArticle(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  if (!isArticleId(raw.id)) return undefined
  const now = Date.now()
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date(now).toISOString()
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '',
    text: typeof raw.text === 'string' ? raw.text : '',
    style: normalizeStyle(raw.style),
    rev: Number.isSafeInteger(raw.rev) && raw.rev > 0 ? raw.rev : 1,
    createdAt,
    updatedAt,
    ...(typeof raw.sessionId === 'string' && raw.sessionId !== '' ? { sessionId: raw.sessionId } : {}),
    ...(typeof raw.identityId === 'string' && raw.identityId !== '' ? { identityId: raw.identityId } : {}),
    ...(typeof raw.identityName === 'string' && raw.identityName !== '' ? { identityName: raw.identityName } : {}),
    ...(normalizeChange(raw.pendingChange) === undefined ? {} : { pendingChange: normalizeChange(raw.pendingChange) }),
  }
}

/**
 * Create the article store over one directory.
 * @param options - `dir` is the article directory; `now` supplies timestamps.
 * @returns store methods.
 */
export function createArticleStore(options) {
  const dir = options.dir
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  /** Observer for successful content mutations (create/update/remove). */
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {}
  const cache = new Map()
  /** Per-file serialized write chain. */
  const chains = new Map()

  const fileOf = (id) => join(dir, `${id}.json`)

  /**
   * Run one mutation after the previous mutation of the same file settled.
   * @param id - article id.
   * @param operation - write operation.
   * @returns the operation result.
   */
  function serialize(id, operation) {
    const previous = chains.get(id) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    chains.set(id, next.then(() => undefined, () => undefined))
    return next
  }

  /**
   * Persist one article atomically.
   * @param article - the document to write.
   * @returns when the file is in place.
   */
  async function persist(article) {
    await mkdir(dir, { recursive: true })
    const target = fileOf(article.id)
    const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
    await writeFile(temporary, `${JSON.stringify(article, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, target)
  }

  return {
    /** Directory holding the article files. */
    dir,

    /**
     * Read every article on disk into memory.
     * @returns the number of articles loaded.
     */
    async load() {
      await mkdir(dir, { recursive: true })
      const entries = await readdir(dir).catch(() => [])
      cache.clear()
      for (const name of entries) {
        if (!name.endsWith('.json')) continue
        try {
          const parsed = parseArticle(JSON.parse(await readFile(join(dir, name), 'utf8')))
          if (parsed !== undefined && `${parsed.id}.json` === name) cache.set(parsed.id, parsed)
        } catch {
          // A half-written or foreign file is skipped rather than breaking the list.
        }
      }
      return cache.size
    },

    /**
     * All articles, newest first.
     * @returns stored articles.
     */
    list() {
      // Newest first by creation: editing an article must not make its row jump
      // around while autosave updates the timestamp.
      return [...cache.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },

    /**
     * One article by id.
     * @param id - article id.
     * @returns the article or undefined.
     */
    get(id) {
      return cache.get(id)
    },

    /**
     * Create an empty article.
     * @param input - optional title and body.
     * @returns the new article.
     */
    async create(input = {}) {
      const stamp = new Date(now()).toISOString()
      const article = {
        id: newArticleId(),
        title: typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim().slice(0, 200) : '未命名文章',
        text: typeof input.text === 'string' ? input.text : '',
        style: normalizeStyle(input.style),
        rev: 1,
        createdAt: stamp,
        updatedAt: stamp,
      }
      cache.set(article.id, article)
      await serialize(article.id, () => persist(article))
      onChange(article, { kind: 'create' })
      return article
    },

    /**
     * Update one article. `expectedRev` makes the update conditional: a stale
     * caller receives the current document instead of overwriting it.
     * @param id - article id.
     * @param patch - `title`, `text`, `style`, and/or `sessionId`.
     * @param expectedRev - revision the caller last saw, when it cares.
     * @returns `{ ok, article }` or `{ ok: false, code, article }`.
     */
    async update(id, patch = {}, expectedRev) {
      const current = cache.get(id)
      if (current === undefined) return { ok: false, code: 'not-found' }
      if (expectedRev !== undefined && expectedRev !== current.rev) {
        return { ok: false, code: 'conflict', article: current }
      }
      const next = {
        ...current,
        title: typeof patch.title === 'string' ? patch.title.slice(0, 200) : current.title,
        text: typeof patch.text === 'string' ? patch.text : current.text,
        style: patch.style === undefined ? current.style : normalizeStyle(patch.style, current.style),
        updatedAt: new Date(now()).toISOString(),
        rev: current.rev + 1,
        ...(typeof patch.sessionId === 'string' ? { sessionId: patch.sessionId } : {}),
        ...(typeof patch.identityId === 'string' ? { identityId: patch.identityId } : {}),
        ...(typeof patch.identityName === 'string' ? { identityName: patch.identityName } : {}),
      }
      if (patch.sessionId === null) delete next.sessionId
      if (patch.pendingChange === null) delete next.pendingChange
      else if (patch.pendingChange !== undefined) {
        const change = normalizeChange(patch.pendingChange)
        if (change === undefined) delete next.pendingChange
        else next.pendingChange = change
      }
      cache.set(id, next)
      await serialize(id, () => persist(next))
      onChange(next, { kind: 'update' })
      return { ok: true, article: next }
    },

    /**
     * Record the Session (and the identity behind it) a conversation with this
     * article uses, without bumping the document revision the editor tracks.
     * @param id - article id.
     * @param binding - sessionId, identityId, and identityName; null clears.
     * @returns the updated article or undefined.
     */
    async bind(id, binding = {}) {
      const current = cache.get(id)
      if (current === undefined) return undefined
      const next = { ...current }
      if (binding.sessionId === null) delete next.sessionId
      else if (typeof binding.sessionId === 'string') next.sessionId = binding.sessionId
      if (binding.identityId === null) delete next.identityId
      else if (typeof binding.identityId === 'string') next.identityId = binding.identityId
      if (binding.identityName === null) delete next.identityName
      else if (typeof binding.identityName === 'string') next.identityName = binding.identityName
      if (binding.pendingChange === null) delete next.pendingChange
      cache.set(id, next)
      await serialize(id, () => persist(next))
      return next
    },

    /**
     * Record the Session a conversation with this article uses.
     * @param id - article id.
     * @param sessionId - Session id, or null to forget it.
     * @returns the updated article or undefined.
     */
    async setSession(id, sessionId) {
      return this.bind(id, { sessionId })
    },

    /**
     * Remove one article and its file.
     * @param id - article id.
     * @returns whether an article was removed.
     */
    async remove(id) {
      if (!cache.has(id)) return false
      cache.delete(id)
      await serialize(id, () => unlink(fileOf(id)).catch(() => undefined))
      onChange({ id }, { kind: 'remove' })
      return true
    },
  }
}