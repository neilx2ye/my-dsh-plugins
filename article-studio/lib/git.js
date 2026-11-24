/**
 * Git-backed version history for Article Studio.
 *
 * The article store stays the source of truth for the editor; this module keeps
 * a readable Markdown mirror of every article in a local git repository and
 * commits autosaves. One repository per profile, one file per article, so the
 * user can inspect or push the history with ordinary git tools.
 *
 *   <dataDir>/repo/.git
 *   <dataDir>/repo/articles/<articleId>.md
 *
 * Each file carries the title, style, revision, and identity in a small
 * frontmatter block, then the Markdown body, so a commit diff reads like the
 * article's diff.
 */

import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { imageReferences } from './media.js'

const exec = promisify(execFile)

/** Longest commit list returned to one caller. */
const MAX_HISTORY = 80

/**
 * Serialize one article as the mirror file.
 * @param article - stored article.
 * @returns file text with a JSON-scalar frontmatter block.
 */
export function mirrorOf(article) {
  const lines = [
    '---',
    `id: ${JSON.stringify(article.id)}`,
    `title: ${JSON.stringify(article.title)}`,
    `updatedAt: ${JSON.stringify(article.updatedAt)}`,
    `rev: ${article.rev}`,
    `identity: ${JSON.stringify(article.identityName ?? '')}`,
    `style: ${JSON.stringify(article.style)}`,
    '---',
    '',
    article.text ?? '',
    '',
  ]
  return lines.join('\n')
}

/**
 * Parse one mirror file back into the fields a restore needs.
 * @param text - file text.
 * @returns `{ title, style, text, updatedAt, rev }` or undefined.
 */
export function parseMirror(text) {
  const source = String(text ?? '')
  if (!source.startsWith('---\n')) return { title: '', style: undefined, text: source, updatedAt: undefined, rev: undefined }
  const end = source.indexOf('\n---\n', 4)
  if (end < 0) return { title: '', style: undefined, text: source, updatedAt: undefined, rev: undefined }
  const head = source.slice(4, end)
  const body = source.slice(end + 5).replace(/^\n/u, '')
  const fields = {}
  for (const line of head.split('\n')) {
    const index = line.indexOf(': ')
    if (index < 0) continue
    fields[line.slice(0, index)] = line.slice(index + 2)
  }
  const readJson = (key) => {
    try {
      return JSON.parse(fields[key])
    } catch {
      return undefined
    }
  }
  return {
    title: readJson('title') ?? '',
    style: readJson('style'),
    text: body,
    updatedAt: readJson('updatedAt'),
    rev: Number.isSafeInteger(Number(fields.rev)) ? Number(fields.rev) : undefined,
  }
}

/**
 * Create the version store for one repository directory.
 * @param options - `dir` (repository root), `delayMs` commit debounce,
 *   `enabled` (false disables git), and `logger`.
 * @returns store methods.
 */
export function createVersionStore(options) {
  const repo = options.dir
  const delayMs = Number.isSafeInteger(options.delayMs) && options.delayMs >= 0 ? options.delayMs : 2500
  const enabled = options.enabled !== false
  const logger = options.logger
  const articlesDir = join(repo, 'articles')
  /** articleId -> article, or null for a deletion. */
  const pending = new Map()
  let timer = null
  let ready = null
  let usable = enabled ? null : false

  /** Run one git command in the repository. */
  function git(args) {
    return exec('git', args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 })
  }

  /** Initialize the repository and its identity once. */
  async function ensure() {
    if (usable !== null) return usable
    if (ready !== null) return ready
    ready = (async () => {
      try {
        await mkdir(articlesDir, { recursive: true })
        try {
          await git(['rev-parse', '--git-dir'])
        } catch {
          await git(['init', '--quiet'])
        }
        await git(['config', 'user.name', 'Article Studio'])
        await git(['config', 'user.email', 'article-studio@localhost'])
        await git(['config', 'commit.gpgsign', 'false'])
        usable = true
      } catch (error) {
        usable = false
        logger?.warn?.(`article-studio: git history is unavailable: ${String(error)}`)
      }
      return usable
    })()
    return ready
  }

  /** Write one mirror file, or remove it for a deletion. */
  async function writeMirror(articleId, article) {
    const file = join(articlesDir, `${articleId}.md`)
    if (article === null) {
      await rm(file, { force: true })
      return
    }
    if (options.mediaDir) {
      const images = imageReferences(article.text)
      if (images.size > 0) {
        const mirrorDir = join(articlesDir, 'media')
        await mkdir(mirrorDir, { recursive: true })
        for (const key of images) {
          try {
            await copyFile(join(options.mediaDir, key), join(mirrorDir, key), constants.COPYFILE_EXCL)
          } catch (error) {
            if (error?.code !== 'ENOENT' && error?.code !== 'EEXIST') throw error
          }
        }
      }
    }
    await writeFile(file, mirrorOf(article), 'utf8')
  }

  /** Commit everything staged and report whether a commit was made. */
  async function commit(message) {
    await git(['add', '--all'])
    const { stdout } = await git(['status', '--porcelain'])
    if (stdout.trim() === '') return false
    await git(['commit', '--quiet', '--no-verify', '-m', message])
    return true
  }

  /** Describe a batch of pending changes as one commit message. */
  function messageFor(batch) {
    if (batch.length === 1) {
      const entry = batch[0]
      if (entry.article === null) return `delete: ${entry.articleId}`
      const title = entry.article.title === '' ? entry.articleId : entry.article.title
      return `save: ${title} (rev ${entry.article.rev})`
    }
    const saves = batch.filter((entry) => entry.article !== null).length
    const deletes = batch.length - saves
    const parts = []
    if (saves > 0) parts.push(`save ${saves}`)
    if (deletes > 0) parts.push(`delete ${deletes}`)
    return `autosave: ${parts.join(', ')}`
  }

  /** Write and commit every pending mirror file. */
  async function flush() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.size === 0) return false
    const batch = [...pending.entries()].map(([articleId, article]) => ({ articleId, article }))
    pending.clear()
    if (!(await ensure())) return false
    try {
      for (const entry of batch) await writeMirror(entry.articleId, entry.article)
      return await commit(messageFor(batch))
    } catch (error) {
      logger?.warn?.(`article-studio: could not commit history: ${String(error)}`)
      return false
    }
  }

  /** Queue one article change and debounce the commit. */
  function schedule(article, meta) {
    if (!usable && usable !== null) return
    const articleId = article.id
    if (!articleId) return
    pending.set(articleId, meta?.kind === 'remove' ? null : article)
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, delayMs)
  }

  return {
    /** Repository root. */
    repo,

    /** Whether git history is usable in this deployment. */
    async available() {
      return (await ensure()) === true
    },

    /** Debounced autosave commit. */
    schedule,

    /** Force a commit now (used by tests, restore, and teardown). */
    flush,

    /**
     * Commits touching one article's mirror file.
     * @param articleId - article id.
     * @param limit - maximum entries.
     * @returns newest-first commit rows.
     */
    async history(articleId, limit = 40) {
      if (!(await ensure())) return []
      const count = Math.min(Number.isSafeInteger(limit) && limit > 0 ? limit : 40, MAX_HISTORY)
      try {
        const { stdout } = await git([
          'log',
          `--max-count=${count}`,
          '--format=%H%x09%at%x09%s',
          '--',
          `articles/${articleId}.md`,
        ])
        return stdout
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => {
            const [sha, at, ...rest] = line.split('\t')
            return { sha, at: Number(at) * 1000, message: rest.join('\t') }
          })
      } catch {
        return []
      }
    },

    /**
     * Read one committed mirror file.
     * @param articleId - article id.
     * @param sha - commit hash.
     * @returns parsed mirror, or undefined when absent.
     */
    async readVersion(articleId, sha) {
      if (!(await ensure())) return undefined
      if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/iu.test(sha)) return undefined
      try {
        const { stdout } = await git(['show', `${sha}:articles/${articleId}.md`])
        return parseMirror(stdout)
      } catch {
        return undefined
      }
    },

    /** Drop any debounce timer (pending changes commit on the next flush). */
    dispose() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}