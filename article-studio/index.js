/**
 * Host half of the Article Studio bundle.
 *
 * The profile gets one writing surface and one writing partner:
 *
 * - article documents live under `<profile>/article-studio/` as plain JSON,
 *   with create/read/update/delete served to the browser over exact Fetch
 *   routes and to the model over `article_*` tools;
 * - each article owns one ordinary DSH Session whose Agent runs the `scribe`
 *   preset (a named writing identity with shell, filesystem, and web tools);
 * - the tools the Agent uses to read and rewrite the open article are
 *   registered on that Agent's own scope, so the coding sessions in the same
 *   profile never see them;
 * - replies and tool activity are mirrored into a small per-article
 *   transcript that the caret popover renders.
 *
 * Nothing here is device-global: routes, storage, and the preset all belong to
 * the profile whose bundle layer this file is part of.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  DEFAULT_STYLE,
  STYLE_PRESETS,
  articleToMarkdown,
  countWords,
  createArticleStore,
  isArticleId,
  normalizeStyle,
  parseArticle,
  stylePreset,
  summarizeArticle,
} from './lib/articles.js'
import { createChatStore } from './lib/chats.js'
import { createVersionStore } from './lib/git.js'

/** Exact Fetch routes all sit under this absolute path prefix. */
const ROUTE = '/api/article-studio'
/** Loader ids this bundle owns. */
const PLUGIN_ID = '@local/article-studio'

/** JSON Schema for one complete article style. */
const STYLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'Rendering style of the article canvas.',
  properties: {
    font: { type: 'string', enum: ['serif', 'sans', 'kai', 'mono'], description: 'serif (宋体/衬线), sans (黑体/无衬线), kai (楷体), mono (等宽).' },
    fontSize: { type: 'integer', minimum: 13, maximum: 30, description: 'Body text size in px.' },
    lineHeight: { type: 'number', minimum: 1.3, maximum: 2.6, description: 'Line height as a multiple of the font size.' },
    paragraphGap: { type: 'integer', minimum: 0, maximum: 40, description: 'Blank space between paragraphs in px.' },
    width: { type: 'integer', minimum: 520, maximum: 980, description: 'Text column width in px.' },
    align: { type: 'string', enum: ['left', 'center', 'justify'], description: 'Paragraph alignment.' },
    indent: { type: 'boolean', description: 'Indent every paragraph by two characters.' },
    theme: { type: 'string', enum: ['paper', 'sepia', 'dark'], description: 'Canvas theme: paper (white), sepia (warm), dark (night).' },
  },
  required: ['font', 'fontSize', 'lineHeight', 'paragraphGap', 'width', 'align', 'indent', 'theme'],
}

/** JSON Schema for a partial style patch (no field is required). */
const STYLE_PATCH_SCHEMA = {
  ...STYLE_SCHEMA,
  properties: { ...STYLE_SCHEMA.properties },
  required: [],
}

/** Present one article path to the model. */
const ARTICLE_ID_PARAM = {
  type: 'string',
  description: 'Article id. Omit it to use the article this conversation is currently editing.',
}

/** Resolve the profile's data directory for this plugin. */
function dataHome(ctx, configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured)
  const profile = ctx.get('profileContext')
  if (profile !== undefined && typeof profile.dir === 'string' && profile.dir !== '') {
    return join(profile.dir, 'article-studio')
  }
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh')
  return join(resolve(home), 'article-studio')
}

/** Describe a thrown value as one readable line. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Build one JSON response the browser never caches. */
function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** Build one structured failure. */
function failure(status, code, message) {
  return json({ ok: false, code, message }, status)
}

/** Parse one JSON object request body. */
async function readObjectBody(request) {
  const value = await request.json()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request body must be a JSON object')
  }
  return value
}

/** Extract the visible assistant text from one `assistant/message` event. */
function assistantText(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** Describe one tool call on a single transcript line. */
function toolCallLine(data) {
  const name = typeof data?.name === 'string' ? data.name : 'tool'
  let detail = ''
  try {
    const args = JSON.parse(typeof data?.arguments === 'string' ? data.arguments : '{}')
    if (args !== null && typeof args === 'object') {
      for (const key of ['command', 'path', 'query', 'url', 'articleId', 'find', 'title']) {
        if (typeof args[key] === 'string' && args[key].trim() !== '') {
          detail = args[key].trim().replace(/\s+/gu, ' ')
          if (detail.length > 90) detail = `${detail.slice(0, 90)}…`
          break
        }
      }
    }
  } catch {
    detail = ''
  }
  return detail === '' ? name : `${name} · ${detail}`
}

/** Validate and normalize the bundle's raw Loader config. */
function parseConfig(raw) {
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  const targets = []
  if (Array.isArray(value.pushTargets)) {
    for (const entry of value.pushTargets) {
      if (entry === null || typeof entry !== 'object') continue
      const id = typeof entry.id === 'string' ? entry.id.trim() : ''
      const url = typeof entry.url === 'string' ? entry.url.trim() : ''
      if (id === '' || url === '') continue
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
      } catch {
        continue
      }
      const headers = {}
      if (entry.headers !== null && typeof entry.headers === 'object' && !Array.isArray(entry.headers)) {
        for (const [key, header] of Object.entries(entry.headers)) {
          if (typeof header === 'string') headers[key] = header
        }
      }
      targets.push({
        id: id.slice(0, 40),
        name: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim().slice(0, 80) : id.slice(0, 40),
        url,
        method: typeof entry.method === 'string' && entry.method.toUpperCase() === 'PUT' ? 'PUT' : 'POST',
        format: entry.format === 'markdown' ? 'markdown' : 'json',
        headers,
      })
    }
  }
  return {
    dataDir: typeof value.dataDir === 'string' && value.dataDir.trim() !== '' ? value.dataDir.trim() : undefined,
    cwd: typeof value.cwd === 'string' && value.cwd.trim() !== '' ? resolve(value.cwd.trim()) : undefined,
    agentPreset: typeof value.agentPreset === 'string' && value.agentPreset.trim() !== '' ? value.agentPreset.trim() : 'scribe',
    identityPreset: typeof value.identityPreset === 'string' && value.identityPreset.trim() !== '' ? value.identityPreset.trim() : 'personal',
    identityName: typeof value.identityName === 'string' ? value.identityName.trim().slice(0, 40) : '',
    identityDataDir: typeof value.identityDataDir === 'string' && value.identityDataDir.trim() !== '' ? resolve(value.identityDataDir.trim()) : undefined,
    hiddenPresets: Array.isArray(value.hiddenPresets)
      ? value.hiddenPresets.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim())
      : ['scribe'],
    git: value.git !== false,
    gitCommitDelayMs: Number.isSafeInteger(value.gitCommitDelayMs) && value.gitCommitDelayMs >= 0 ? Math.min(value.gitCommitDelayMs, 60_000) : 2500,
    pushTimeoutMs: Number.isSafeInteger(value.pushTimeoutMs) && value.pushTimeoutMs >= 1000 ? Math.min(value.pushTimeoutMs, 120_000) : 20_000,
    allowAdHocPush: value.allowAdHocPush === true,
    pushTargets: targets,
  }
}

/**
 * Register the article model, the writing Agent's tools, and the browser routes.
 * @param ctx - Host plugin context.
 * @param rawConfig - Loader config for this row.
 */
export function apply(ctx, rawConfig) {
  const config = parseConfig(rawConfig)
  const logger = ctx.logger
  const directory = dataHome(ctx, config.dataDir)
  const versions = createVersionStore({
    dir: join(directory, 'repo'),
    delayMs: config.gitCommitDelayMs,
    enabled: config.git,
    logger,
  })
  const articles = createArticleStore({
    dir: join(directory, 'articles'),
    onChange: (article, meta) => {
      versions.schedule(article, meta)
    },
  })
  const chats = createChatStore({ dir: join(directory, 'chats') })
  /** Session id -> article id, for the tools and the event mirror. */
  const bySession = new Map()
  /** Every Session this plugin ever created, so the sidebar can hide them. */
  const ownedSessions = new Set()
  /** Per-article serialization of ask requests. */
  const locks = new Map()
  /**
   * Installs the article tools on one Agent. The `agents` injection owns the
   * implementation; Session creation calls it because `agent/created` fires
   * before the article records the new Session id.
   */
  const installFor = { agent: undefined }
  const sessionsFile = join(directory, 'sessions.json')

  ctx.effect(
    () => () => {
      versions.dispose()
      void versions.flush()
    },
    'article-studio: version history',
  )

  const ready = (async () => {
    await articles.load()
    for (const article of articles.list()) {
      if (typeof article.sessionId === 'string') bySession.set(article.sessionId, article.id)
      // Seed history for articles written before versioning was enabled.
      versions.schedule(article, { kind: 'update' })
    }
    try {
      const parsed = JSON.parse(await readFile(sessionsFile, 'utf8'))
      if (Array.isArray(parsed?.sessions)) for (const id of parsed.sessions) if (typeof id === 'string') ownedSessions.add(id)
    } catch {
      // No owned-session list yet.
    }
  })().catch((error) => logger?.warn?.(`article-studio: could not read article data: ${messageOf(error)}`))

  /**
   * Persist the owned Session list (fire and forget).
   * @returns when written.
   */
  async function writeOwnedSessions() {
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(sessionsFile, `${JSON.stringify({ sessions: [...ownedSessions] }, null, 2)}\n`, { mode: 0o600 })
    } catch (error) {
      logger?.warn?.(`article-studio: could not record Sessions: ${messageOf(error)}`)
    }
  }

  /** Find the article a Session is editing. */
  function articleOfSession(sessionId) {
    if (typeof sessionId !== 'string') return undefined
    const mapped = bySession.get(sessionId)
    if (mapped !== undefined) {
      const article = articles.get(mapped)
      if (article !== undefined) return article
      bySession.delete(sessionId)
    }
    for (const article of articles.list()) {
      if (article.sessionId === sessionId) {
        bySession.set(sessionId, article.id)
        return article
      }
    }
    return undefined
  }

  /** Resolve the article a tool call targets, defaulting to the caller's article. */
  function resolveTarget(args, exec) {
    if (isArticleId(args?.articleId)) {
      const article = articles.get(args.articleId)
      if (article === undefined) throw new Error(`article "${args.articleId}" does not exist`)
      return article
    }
    const current = articleOfSession(exec?.agent?.id)
    if (current !== undefined) return current
    throw new Error('articleId is required: this conversation is not bound to an article')
  }

  /**
   * Build the review record the canvas renders after an Agent edit. Repeated
   * edits before review keep the original baseline, so marks accumulate.
   * @param article - article before this write.
   * @param tool - tool name that made the edit.
   * @returns the pending-change record.
   */
  function changeRecord(article, tool) {
    return {
      before: typeof article.pendingChange?.before === 'string' ? article.pendingChange.before : article.text,
      at: new Date().toISOString(),
      tool,
      ...(typeof article.identityName === 'string' && article.identityName !== '' ? { name: article.identityName } : {}),
    }
  }

  // ── writing partner Session ──────────────────────────────────────────────

  /** The Personal Agent plugin's profile-local data directory. */
  function personalDataDir() {
    if (config.identityDataDir !== undefined) return config.identityDataDir
    const profile = ctx.get('profileContext')
    if (profile !== undefined && typeof profile.dir === 'string' && profile.dir !== '') {
      return join(profile.dir, 'personal-agent')
    }
    const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh')
    return join(resolve(home), 'personal-agent')
  }

  /**
   * Resolve the Personal Agent identity the client is talking as. The home is
   * taken from the identity's registered workspace first, then from the
   * plugin's documented default layout; an arbitrary client path is never
   * trusted as a working directory.
   * @param request - route body carrying `identity`.
   * @returns `{ id, name, cwd, preset }` or undefined.
   */
  function resolveIdentity(request) {
    const raw = request?.identity
    if (raw === null || typeof raw !== 'object') return undefined
    const id = typeof raw.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/iu.test(raw.id) ? raw.id : undefined
    if (id === undefined) return undefined
    const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 60) : id
    const registry = ctx.get('workspaceRegistry')
    let cwd
    if (typeof raw.workspaceId === 'string' && registry !== undefined) {
      const workspace = registry.get(raw.workspaceId)
      if (workspace !== undefined && typeof workspace.path === 'string' && workspace.path !== '') cwd = workspace.path
    }
    if (cwd === undefined) {
      cwd = id === 'default' ? join(personalDataDir(), 'home') : join(personalDataDir(), 'identities', id, 'home')
    }
    return { id, name, cwd, preset: config.identityPreset }
  }

  /** The working directory writer Sessions start in. */
  function sessionCwd() {
    if (config.cwd !== undefined) return config.cwd
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory !== undefined && typeof workingDirectory.defaultDirectory === 'string') return workingDirectory.defaultDirectory
    return process.cwd()
  }

  /**
   * Resume the article's Session, creating one on first use. When the writer
   * is a Personal Agent identity, the Session starts in that identity's home
   * with the identity preset, so the identity's persona and memory apply.
   * @param article - article being edited.
   * @param identity - resolved identity, when the client supplied one.
   * @returns the Session id.
   */
  async function ensureSession(article, identity) {
    const controller = ctx.get('sessionController')
    if (controller === undefined) throw new Error('this Host cannot start a writing Session')
    const sameIdentity = identity === undefined || article.identityId === identity.id
    if (sameIdentity && typeof article.sessionId === 'string' && article.sessionId !== '') {
      try {
        await controller.state({ sessionId: article.sessionId }, AbortSignal.timeout(5000))
        return article.sessionId
      } catch {
        // A vanished Session is replaced below.
      }
    }
    const cwd = identity?.cwd ?? sessionCwd()
    const preset = identity === undefined ? config.agentPreset : identity.preset
    let created
    try {
      created = await controller.create({ cwd, ...(preset === '' ? {} : { agentPreset: preset }) })
    } catch (error) {
      if (preset === '') throw error
      logger?.warn?.(`article-studio: preset "${preset}" could not start a Session (${messageOf(error)}); using the profile default`)
      created = await controller.create({ cwd })
    }
    const sessionId = created.sessionId
    ownedSessions.add(sessionId)
    void writeOwnedSessions()
    await articles.bind(article.id, {
      sessionId,
      identityId: identity?.id ?? null,
      identityName: identity?.name ?? null,
    })
    bySession.set(sessionId, article.id)
    // The Agent already exists: `agent/created` ran before the article
    // recorded this Session, so hand the tools to it explicitly.
    const live = ctx.get('agents')?.list?.().find((candidate) => candidate.id === sessionId)
    if (live !== undefined) installFor.agent?.(live)
    return sessionId
  }

  /**
   * Run one ask for an article after any earlier ask for the same article
   * settled, so two quick shortcuts never mint two Sessions.
   * @param articleId - article id.
   * @param operation - work to run.
   * @returns the operation result.
   */
  function withArticleLock(articleId, operation) {
    const previous = locks.get(articleId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    locks.set(articleId, next.then(() => undefined, () => undefined))
    return next
  }

  /** Compose the prompt that carries the user's caret context to the Agent. */
  function buildPrompt(article, request) {
    const selection = typeof request.selection === 'string' ? request.selection.trim() : ''
    const before = typeof request.before === 'string' ? request.before.slice(-700) : ''
    const after = typeof request.after === 'string' ? request.after.slice(0, 300) : ''
    const instruction = typeof request.instruction === 'string' ? request.instruction.trim() : ''
    const lines = [
      `【当前文章】ID: ${article.id} · 标题: ${article.title === '' ? '（未命名）' : article.title} · 字数: ${countWords(article.text)}`,
      `【当前样式】${JSON.stringify(article.style)}`,
    ]
    if (selection !== '') lines.push(`【选中文字】\n${selection.slice(0, 4000)}`)
    if (before !== '') lines.push(`【光标之前的文字】\n…${before}`)
    if (after !== '') lines.push(`【光标之后的文字】\n${after}…`)
    lines.push(`【用户的要求】\n${instruction}`)
    lines.push(
      '请按你的身份说明处理：要改标题、正文或样式时直接调用 article_* 工具（article_read 看全文，article_update 整篇重写，article_replace 局部替换，article_style 调样式），改完用一两句话说明改动；只在被问思路或建议时直接回答，不必改稿。',
    )
    return lines.join('\n\n').slice(0, 24_000)
  }

  // ── transcript mirror ────────────────────────────────────────────────────

  ctx.on('session/event', (session, event) => {
    const article = articleOfSession(session.id)
    if (article === undefined) return
    if (event.type === 'assistant/message') {
      const surfaceOp = event.surfaceOp
      if (surfaceOp !== undefined && typeof surfaceOp === 'object' && surfaceOp.op === 'replace') return
      const text = assistantText(event)
      if (text === '') return
      void chats.append(article.id, { role: 'assistant', text, name: config.identityName }).catch(() => undefined)
      return
    }
    if (event.type === 'tool/call') {
      const line = toolCallLine(event.data)
      void chats.append(article.id, { role: 'tool', text: line, tool: event.data?.name }).catch(() => undefined)
      return
    }
    if (event.type === 'turn/end') {
      const reason = event.data?.reason
      if (reason?.kind === 'error') {
        const message = typeof reason.error?.message === 'string' ? reason.error.message : '模型调用失败'
        void chats.append(article.id, { role: 'tool', text: `本轮失败：${message}`, tool: 'error' }).catch(() => undefined)
      } else if (reason?.kind === 'max-tokens') {
        void chats.append(article.id, { role: 'tool', text: '本轮达到长度上限，回复被截断。', tool: 'notice' }).catch(() => undefined)
      }
    }
  })

  // ── model tools, scoped to the writing Agent ─────────────────────────────

  /**
   * Build the article tools. Each execute resolves the calling Agent's article.
   * @returns tool definitions for `ctx.tools.register`.
   */
  function buildArticleTools() {
    /** @type {import('./lib/articles.js').Article} */
    const styleOutput = STYLE_SCHEMA
    return [
      {
        name: 'article_list',
        description: 'List every article in this profile with its id, title, word count, and last edit time. Use it to find an article the user names when this conversation is not already bound to one.',
        parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'integer' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    articleId: { type: 'string' },
                    title: { type: 'string' },
                    chars: { type: 'integer' },
                    updatedAt: { type: 'string' },
                  },
                  required: ['articleId', 'title', 'chars', 'updatedAt'],
                },
              },
            },
            required: ['count', 'items'],
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.count === 0
                ? 'No articles yet.'
                : value.items.map((item) => `${item.articleId} · ${item.title} · ${item.chars} 字`).join('\n'),
            },
          ],
        },
        execute(args, exec) {
          const list = articles.list()
          return Promise.resolve({
            count: list.length,
            items: list.map((article) => ({
              articleId: article.id,
              title: article.title,
              chars: countWords(article.text),
              updatedAt: article.updatedAt,
            })),
          })
        },
      },
      {
        name: 'article_read',
        description: 'Read one article: its title, complete Markdown body, style, and revision. Call it before rewriting so you keep the author\'s voice and know what is already there. Omit articleId to read the article this conversation is editing.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { articleId: ARTICLE_ID_PARAM },
          required: [],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              articleId: { type: 'string' },
              title: { type: 'string' },
              text: { type: 'string' },
              chars: { type: 'integer' },
              rev: { type: 'integer' },
              style: styleOutput,
            },
            required: ['articleId', 'title', 'text', 'chars', 'rev', 'style'],
          },
          render: (_args, value) => [
            { type: 'text', text: `# ${value.title || '（未命名）'}\n\n${value.text}` },
          ],
        },
        execute(args, exec) {
          const article = resolveTarget(args, exec)
          return Promise.resolve({
            articleId: article.id,
            title: article.title,
            text: article.text,
            chars: countWords(article.text),
            rev: article.rev,
            style: article.style,
          })
        },
      },
      {
        name: 'article_create',
        description: 'Create a new article and return its id. The new article does not become the open document in the editor; the user opens it from the article list.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', description: 'Article title. Defaults to 未命名文章.' },
            text: { type: 'string', description: 'Optional initial Markdown body.' },
          },
          required: ['title'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              articleId: { type: 'string' },
              title: { type: 'string' },
              rev: { type: 'integer' },
            },
            required: ['articleId', 'title', 'rev'],
          },
          render: (_args, value) => [{ type: 'text', text: `Created ${value.articleId} · ${value.title}` }],
        },
        async execute(args) {
          const article = await articles.create({ title: args.title, text: args.text })
          return { articleId: article.id, title: article.title, rev: article.rev }
        },
      },
      {
        name: 'article_update',
        description: 'Replace the article title and/or complete Markdown body. Pass only the fields you change. This is a whole-body replacement: include the unchanged paragraphs too, and never truncate the author\'s text. For a small edit prefer article_replace. The editor shows every body change as strikethrough (removed) and highlight (added) until the user keeps or undoes it.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            articleId: ARTICLE_ID_PARAM,
            title: { type: 'string', description: 'New title. Omit to keep the current one.' },
            text: { type: 'string', description: 'New complete Markdown body. Omit to keep the current body.' },
            style: { ...STYLE_PATCH_SCHEMA, description: 'Optional partial style override.' },
          },
          required: [],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              articleId: { type: 'string' },
              title: { type: 'string' },
              chars: { type: 'integer' },
              rev: { type: 'integer' },
              updatedAt: { type: 'string' },
            },
            required: ['articleId', 'title', 'chars', 'rev', 'updatedAt'],
          },
          render: (_args, value) => [{ type: 'text', text: `Saved ${value.articleId} · ${value.title} · ${value.chars} 字（rev ${value.rev}）` }],
        },
        async execute(args, exec) {
          const article = resolveTarget(args, exec)
          const patch = {}
          if (typeof args.title === 'string') patch.title = args.title
          if (typeof args.text === 'string') {
            patch.text = args.text
            if (args.text !== article.text) patch.pendingChange = changeRecord(article, 'article_update')
          }
          if (args.style !== undefined) patch.style = args.style
          const result = await articles.update(article.id, patch, article.rev)
          if (!result.ok) {
            if (result.code === 'conflict') throw new Error('the article changed while you were writing; read it again and retry')
            throw new Error(`could not save article "${article.id}"`)
          }
          return {
            articleId: result.article.id,
            title: result.article.title,
            chars: countWords(result.article.text),
            rev: result.article.rev,
            updatedAt: result.article.updatedAt,
          }
        },
      },
      {
        name: 'article_replace',
        description: 'Replace one exact piece of text in the article body. Prefer this for a local edit: quote enough surrounding text that the match is unique. Fails when the text is absent. The change is marked in the canvas as strikethrough/highlight for the user to keep or undo.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            articleId: ARTICLE_ID_PARAM,
            find: { type: 'string', description: 'Exact literal text to replace, including its punctuation and line breaks.' },
            replace: { type: 'string', description: 'Replacement text. Empty deletes the match.' },
            all: { type: 'boolean', description: 'Replace every occurrence instead of the first.' },
          },
          required: ['find', 'replace'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              articleId: { type: 'string' },
              replaced: { type: 'integer' },
              rev: { type: 'integer' },
            },
            required: ['articleId', 'replaced', 'rev'],
          },
          render: (_args, value) => [{ type: 'text', text: `Replaced ${value.replaced} occurrence(s) · rev ${value.rev}` }],
        },
        async execute(args, exec) {
          const article = resolveTarget(args, exec)
          if (typeof args.find !== 'string' || args.find === '') throw new Error('find must be a non-empty string')
          const count = article.text.split(args.find).length - 1
          if (count === 0) throw new Error(`the text was not found; read the article and quote it exactly`)
          const next = args.all === true
            ? article.text.split(args.find).join(args.replace)
            : article.text.replace(args.find, () => args.replace)
          const result = await articles.update(
            article.id,
            { text: next, pendingChange: changeRecord(article, 'article_replace') },
            article.rev,
          )
          if (!result.ok) {
            if (result.code === 'conflict') throw new Error('the article changed while you were editing; read it again and retry')
            throw new Error('could not save the article')
          }
          return { articleId: article.id, replaced: args.all === true ? count : 1, rev: result.article.rev }
        },
      },
      {
        name: 'article_append',
        description: 'Append one Markdown block to the end of the article body, separated by one blank line. Use it for continuing a draft. The addition is highlighted in the canvas for review.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            articleId: ARTICLE_ID_PARAM,
            text: { type: 'string', description: 'Markdown to append.' },
          },
          required: ['text'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              articleId: { type: 'string' },
              chars: { type: 'integer' },
              rev: { type: 'integer' },
            },
            required: ['articleId', 'chars', 'rev'],
          },
          render: (_args, value) => [{ type: 'text', text: `Appended · ${value.chars} 字 · rev ${value.rev}` }],
        },
        async execute(args, exec) {
          const article = resolveTarget(args, exec)
          const body = typeof args.text === 'string' ? args.text.trim() : ''
          if (body === '') throw new Error('text must be a non-empty string')
          const next = article.text.trim() === '' ? `${body}\n` : `${article.text.replace(/\s+$/u, '')}\n\n${body}\n`
          const result = await articles.update(
            article.id,
            { text: next, pendingChange: changeRecord(article, 'article_append') },
            article.rev,
          )
          if (!result.ok) {
            if (result.code === 'conflict') throw new Error('the article changed while you were editing; read it again and retry')
            throw new Error('could not save the article')
          }
          return { articleId: article.id, chars: countWords(result.article.text), rev: result.article.rev }
        },
      },
      {
        name: 'article_style',
        description: `Change how the article is rendered without touching its text. Apply a named recipe (${Object.keys(STYLE_PRESETS).join(', ')}) or individual fields: font, fontSize, lineHeight, paragraphGap, width, align, indent, theme. The editor updates immediately.`,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            articleId: ARTICLE_ID_PARAM,
            preset: { type: 'string', enum: Object.keys(STYLE_PRESETS), description: 'Named recipe applied before any individual field.' },
            font: STYLE_SCHEMA.properties.font,
            fontSize: STYLE_SCHEMA.properties.fontSize,
            lineHeight: STYLE_SCHEMA.properties.lineHeight,
            paragraphGap: STYLE_SCHEMA.properties.paragraphGap,
            width: STYLE_SCHEMA.properties.width,
            align: STYLE_SCHEMA.properties.align,
            indent: STYLE_SCHEMA.properties.indent,
            theme: STYLE_SCHEMA.properties.theme,
          },
          required: [],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              articleId: { type: 'string' },
              rev: { type: 'integer' },
              style: styleOutput,
            },
            required: ['articleId', 'rev', 'style'],
          },
          render: (_args, value) => [
            { type: 'text', text: `Style updated: ${value.style.font} ${value.style.fontSize}px / ${value.style.lineHeight} / ${value.style.theme}` },
          ],
        },
        async execute(args, exec) {
          const article = resolveTarget(args, exec)
          const patch = { ...args }
          delete patch.articleId
          delete patch.preset
          const base = typeof args.preset === 'string' ? (stylePreset(args.preset) ?? article.style) : article.style
          const style = normalizeStyle(patch, base)
          const result = await articles.update(article.id, { style }, article.rev)
          if (!result.ok) {
            if (result.code === 'conflict') throw new Error('the article changed while you were editing; read the article and retry')
            throw new Error('could not save the style')
          }
          return { articleId: article.id, rev: result.article.rev, style: result.article.style }
        },
      },
      {
        name: 'article_delete',
        description: 'Permanently delete one article. Only use it when the user explicitly asks to delete that article; deleting is not undoable.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            articleId: { type: 'string', description: 'Article to delete.' },
          },
          required: ['articleId'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              articleId: { type: 'string' },
              deleted: { type: 'boolean' },
            },
            required: ['articleId', 'deleted'],
          },
          render: (_args, value) => [{ type: 'text', text: value.deleted ? `Deleted ${value.articleId}` : `${value.articleId} was already absent` }],
        },
        async execute(args) {
          if (!isArticleId(args.articleId)) throw new Error('articleId must name one article')
          const deleted = await articles.remove(args.articleId)
          if (deleted) await chats.clear(args.articleId)
          return { articleId: args.articleId, deleted }
        },
      },
      {
        name: 'article_push',
        description: 'Publish the article to another platform through one configured push target (an HTTP API) and return the response status. Configure targets under this plugin\'s `pushTargets` config. For anything that is not a configured target, use bash with curl or an MCP tool instead.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            articleId: ARTICLE_ID_PARAM,
            target: { type: 'string', description: 'Configured target id.' },
            url: { type: 'string', description: 'Ad-hoc endpoint URL. Accepted only when the plugin config sets allowAdHocPush: true.' },
            title: { type: 'string', description: 'Optional title override for the published copy.' },
            format: { type: 'string', enum: ['json', 'markdown'], description: 'Request body format. Defaults to the target format, else json.' },
          },
          required: [],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean' },
              status: { type: 'integer' },
              target: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['ok', 'status', 'target', 'message'],
          },
          render: (_args, value) => [{ type: 'text', text: `${value.ok ? 'Published' : 'Push failed'} · ${value.target} · HTTP ${value.status}\n${value.message}` }],
        },
        async execute(args, exec) {
          const article = resolveTarget(args, exec)
          const target = typeof args.target === 'string' ? config.pushTargets.find((entry) => entry.id === args.target) : undefined
          if (typeof args.target === 'string' && target === undefined) {
            throw new Error(`unknown push target "${args.target}". Configured: ${config.pushTargets.map((entry) => entry.id).join(', ') || 'none'}`)
          }
          const adHoc = target === undefined && config.allowAdHocPush && typeof args.url === 'string' ? args.url.trim() : ''
          if (target === undefined && adHoc === '') {
            throw new Error(
              `no configured push target: set pushTargets in the plugin config (configured: ${config.pushTargets.map((entry) => entry.id).join(', ') || 'none'}), or enable allowAdHocPush to pass a url`,
            )
          }
          if (adHoc !== '') {
            try {
              const parsed = new URL(adHoc)
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('not http(s)')
            } catch {
              throw new Error('url must be an absolute http(s) endpoint')
            }
          }
          const url = target?.url ?? adHoc
          const format = args.format === 'markdown' || (args.format === undefined && target?.format === 'markdown') ? 'markdown' : 'json'
          const markdown = articleToMarkdown({ ...article, title: typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : article.title })
          const method = target?.method ?? 'POST'
          const headers = { ...(target?.headers ?? {}) }
          let body
          if (format === 'markdown') {
            headers['content-type'] = headers['content-type'] ?? 'text/markdown; charset=utf-8'
            body = markdown
          } else {
            headers['content-type'] = headers['content-type'] ?? 'application/json; charset=utf-8'
            body = JSON.stringify({ title: article.title, markdown, articleId: article.id, updatedAt: article.updatedAt, chars: countWords(article.text) })
          }
          let response
          try {
            response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(config.pushTimeoutMs) })
          } catch (error) {
            return { ok: false, status: 0, target: target?.name ?? url, message: messageOf(error) }
          }
          const text = (await response.text().catch(() => '')).slice(0, 1200)
          return {
            ok: response.ok,
            status: response.status,
            target: target?.name ?? url,
            message: text === '' ? response.statusText : text,
          }
        },
      },
    ]
  }

  // The fallback writing preset is an implementation detail of this panel; it
  // must not appear as a selectable mode when starting a workspace Session.
  ctx.inject(['agentPresets'], (scope) => {
    const presets = scope.agentPresets
    const prototype = presets === undefined || presets === null ? undefined : Object.getPrototypeOf(presets)
    const original = prototype?.remoteExportList
    if (typeof original !== 'function' || config.hiddenPresets.length === 0) return
    const hidden = new Set(config.hiddenPresets)
    const patched = async function rosterWithoutWritingPresets(...args) {
      const roster = await original.apply(this, args)
      if (roster === null || typeof roster !== 'object' || !Array.isArray(roster.presets)) return roster
      return { ...roster, presets: roster.presets.filter((preset) => !hidden.has(preset.id)) }
    }
    prototype.remoteExportList = patched
    return () => {
      if (prototype.remoteExportList === patched) prototype.remoteExportList = original
    }
  })

  ctx.inject(['agents'], (scope) => {
    /** agent -> injection fiber holding its tool registrations. */
    const installs = new Map()

    const install = (agent) => {
      if (installs.has(agent)) return
      if (articleOfSession(agent.id) === undefined) return
      try {
        const fiber = agent.ctx.inject(['tools', 'systemPrompt'], (scoped) => {
          for (const definition of buildArticleTools()) {
            scoped.effect(() => scoped.tools.register(definition), `article-studio: ${definition.name}`)
          }
          // The bar cannot render an interview tool, so steer the partner to
          // put choices in its reply instead of blocking on ask_user_question.
          if (scoped.systemPrompt !== undefined) {
            scoped.effect(
              () =>
                scoped.systemPrompt.section({
                  name: 'article-studio:bar',
                  order: 620,
                  text:
                    '你正通过文章编辑器的浮动指令条与用户对话：回复显示在一个很小的弹层里。'
                    + '不要调用 ask_user_question——它无法在弹层里回答；需要用户决定时，把问题和选项直接写在回复里。'
                    + '少写长篇解释，能用一两句话说明改动就够。',
                }),
              'article-studio: bar guidance',
            )
          }
        })
        installs.set(agent, fiber)
      } catch (error) {
        logger?.warn?.(`article-studio: could not register article tools for ${agent.id}: ${messageOf(error)}`)
      }
    }

    installFor.agent = install
    for (const agent of scope.agents.list()) install(agent)
    scope.on('agent/created', ({ agent }) => install(agent))
    scope.on('agent/disposed', ({ agent }) => {
      const fiber = installs.get(agent)
      if (fiber !== undefined) {
        installs.delete(agent)
        fiber.dispose().catch(() => undefined)
      }
    })
    void ready.then(() => {
      for (const agent of scope.agents.list()) install(agent)
    })
    scope.effect(
      () => () => {
        const fibers = [...installs.values()]
        installs.clear()
        for (const fiber of fibers) fiber.dispose().catch(() => undefined)
      },
      'article-studio: article tool cleanup',
    )
  })

  // ── browser routes ───────────────────────────────────────────────────────

  /** Build the payload every list-style response carries. */
  function roster() {
    return {
      articles: articles.list().map(summarizeArticle),
      identity: { name: config.identityName, preset: config.agentPreset },
      identityPreset: config.identityPreset,
      git: config.git,
      sessionIds: [...ownedSessions],
      stylePresets: Object.keys(STYLE_PRESETS),
    }
  }

  /** Read the chat state and live Session status for one article. */
  async function chatState(article) {
    const entries = await chats.read(article.id)
    const controller = ctx.get('sessionController')
    let running = false
    let pendingInput = []
    if (typeof article.sessionId === 'string' && article.sessionId !== '' && controller !== undefined) {
      try {
        const state = await controller.state({ sessionId: article.sessionId }, AbortSignal.timeout(3000))
        running = state.running === true
        pendingInput = Array.isArray(state.pendingInput) ? state.pendingInput : []
      } catch {
        running = false
      }
    }
    return {
      chat: entries,
      running,
      pendingInput,
      ...(typeof article.sessionId === 'string' ? { sessionId: article.sessionId } : {}),
    }
  }

  /**
   * Register one exact route inside the connection scope.
   * @param scope - context carrying `connection`.
   * @param path - absolute path below `/api`.
   * @param label - effect label.
   * @param handler - request handler.
   * @returns when registered.
   */
  function route(scope, path, label, handler) {
    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: `${ROUTE}${path}`,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body
            try {
              body = await readObjectBody(request)
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error))
            }
            try {
              await ready
              return await handler(body, request)
            } catch (error) {
              logger?.warn?.(`article-studio: ${label} failed: ${messageOf(error)}`)
              return failure(500, 'route-failed', messageOf(error))
            }
          },
        }),
      `article-studio: ${label}`,
    )
  }

  ctx.inject(['connection'], (scope) => {
    route(scope, '/list', 'list route', () => json({ ok: true, ...roster() }))

    route(scope, '/read', 'read route', (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const article = articles.get(body.id)
      if (article === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      return json({ ok: true, article, ...roster() })
    })

    route(scope, '/create', 'create route', async (body) => {
      const article = await articles.create({
        title: typeof body.title === 'string' ? body.title : undefined,
        text: typeof body.text === 'string' ? body.text : '',
      })
      return json({ ok: true, article, ...roster() })
    })

    route(scope, '/save', 'save route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const before = articles.get(body.id)
      if (before === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      const patch = {}
      if (typeof body.title === 'string') patch.title = body.title
      if (typeof body.text === 'string') {
        patch.text = body.text
        // Typing into the canvas is the writer moving on: the Agent's review
        // marks describe a change that is no longer the only one.
        if (body.text !== before.text) patch.pendingChange = null
      }
      if (body.style !== undefined && body.style !== null && typeof body.style === 'object') patch.style = body.style
      const expected = Number.isSafeInteger(body.rev) ? body.rev : undefined
      const result = await articles.update(body.id, patch, expected)
      if (!result.ok) {
        if (result.code === 'conflict') return json({ ok: false, code: 'conflict', message: 'the article changed elsewhere', article: result.article, ...roster() }, 409)
        return failure(404, 'not-found', `no article "${body.id}"`)
      }
      return json({ ok: true, article: result.article, ...roster() })
    })

    route(scope, '/delete', 'delete route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const articleBefore = articles.get(body.id)
      if (articleBefore !== undefined && typeof articleBefore.sessionId === 'string') {
        try {
          ctx.get('sessionController')?.cancel?.({ sessionId: articleBefore.sessionId })
        } catch {
          // A live turn that cannot be cancelled still stops at the next step.
        }
      }
      const deleted = await articles.remove(body.id)
      if (deleted) await chats.clear(body.id)
      for (const [sessionId, articleId] of bySession) if (articleId === body.id) bySession.delete(sessionId)
      return json({ ok: true, deleted, ...roster() })
    })

    route(scope, '/ask', 'ask route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const article = articles.get(body.id)
      if (article === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
      if (instruction === '') return failure(400, 'empty-instruction', 'instruction must be non-empty')
      const identity = resolveIdentity(body)
      return withArticleLock(article.id, async () => {
        const current = articles.get(article.id)
        if (current === undefined) return failure(404, 'not-found', 'the article was deleted')
        if (identity !== undefined && current.identityId !== undefined && current.identityId !== identity.id) {
          await chats.append(current.id, {
            role: 'tool',
            tool: 'notice',
            text: `已切换为身份「${identity.name}」，开始新会话。`,
          })
        }
        const selection = typeof body.selection === 'string' ? body.selection.trim() : ''
        await chats.append(current.id, {
          role: 'user',
          text: selection === '' ? instruction : `${instruction}\n\n（针对选中的 ${countWords(selection)} 字）`,
        })
        const sessionId = await ensureSession(current, identity)
        const controller = ctx.get('sessionController')
        if (controller === undefined) return failure(500, 'session-unavailable', 'this Host cannot prompt a writing Session')
        try {
          await controller.prompt(
            {
              requestId: `article-${randomUUID()}`,
              sessionId,
              mode: 'queue',
              content: [{ type: 'text', text: buildPrompt(current, { ...body, instruction }) }],
            },
            AbortSignal.timeout(30_000),
          )
        } catch (error) {
          if (String(messageOf(error)).includes('not-found')) {
            await articles.setSession(current.id, null)
            bySession.delete(sessionId)
          }
          void chats.append(current.id, { role: 'tool', text: `发送失败：${messageOf(error)}`, tool: 'error' })
          return failure(502, 'prompt-failed', messageOf(error))
        }
        return json({ ok: true, sessionId, ...roster() })
      })
    })

    route(scope, '/poll', 'poll route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const article = articles.get(body.id)
      if (article === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      const state = await chatState(article)
      const knownRev = Number.isSafeInteger(body.rev) ? body.rev : undefined
      const changed = knownRev === undefined || knownRev !== article.rev
      return json({
        ok: true,
        rev: article.rev,
        ...(changed ? { article } : {}),
        ...state,
        ...roster(),
      })
    })

    route(scope, '/versions', 'versions route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const article = articles.get(body.id)
      if (article === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      await versions.flush()
      const entries = await versions.history(body.id, 40)
      return json({ ok: true, versions: entries })
    })

    route(scope, '/version', 'version route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      if (typeof body.sha !== 'string') return failure(400, 'invalid-sha', 'sha must be a commit hash')
      await versions.flush()
      const version = await versions.readVersion(body.id, body.sha)
      if (version === undefined) return failure(404, 'not-found', 'that version does not exist')
      return json({ ok: true, version })
    })

    route(scope, '/restore', 'restore route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      if (typeof body.sha !== 'string') return failure(400, 'invalid-sha', 'sha must be a commit hash')
      const article = articles.get(body.id)
      if (article === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      await versions.flush()
      const version = await versions.readVersion(body.id, body.sha)
      if (version === undefined) return failure(404, 'not-found', 'that version does not exist')
      const patch = { text: version.text ?? article.text }
      if (typeof version.title === 'string') patch.title = version.title
      if (version.style !== undefined && version.style !== null) patch.style = version.style
      const result = await articles.update(article.id, patch)
      if (!result.ok) return failure(409, 'conflict', 'the article changed while restoring')
      await chats.append(article.id, {
        role: 'tool',
        tool: 'notice',
        text: `已恢复 ${body.sha.slice(0, 7)} 的版本。`,
      })
      return json({ ok: true, article: result.article, ...roster() })
    })

    route(scope, '/accept', 'accept route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const article = articles.get(body.id)
      if (article === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      if (article.pendingChange === undefined) return json({ ok: true, article, ...roster() })
      const next = await articles.bind(body.id, { pendingChange: null })
      return json({ ok: true, article: next, ...roster() })
    })

    route(scope, '/undo', 'undo route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const article = articles.get(body.id)
      if (article === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      if (article.pendingChange === undefined) return json({ ok: true, article, ...roster() })
      const result = await articles.update(body.id, {
        text: article.pendingChange.before,
        pendingChange: null,
      })
      if (!result.ok) return failure(409, 'conflict', 'the article changed while undoing')
      return json({ ok: true, article: result.article, ...roster() })
    })

    route(scope, '/stop', 'stop route', (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const article = articles.get(body.id)
      if (article === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      const controller = ctx.get('sessionController')
      if (controller === undefined || typeof article.sessionId !== 'string') {
        return json({ ok: true, accepted: false })
      }
      try {
        const result = controller.cancel({ sessionId: article.sessionId })
        return json({ ok: true, accepted: result?.accepted === true })
      } catch (error) {
        return failure(409, 'cancel-failed', messageOf(error))
      }
    })

    route(scope, '/reset', 'reset route', async (body) => {
      if (!isArticleId(body.id)) return failure(400, 'invalid-id', 'id must name one article')
      const article = articles.get(body.id)
      if (article === undefined) return failure(404, 'not-found', `no article "${body.id}"`)
      if (typeof article.sessionId === 'string') {
        try {
          ctx.get('sessionController')?.cancel?.({ sessionId: article.sessionId })
        } catch {
          // Best effort: the reset must not depend on a live turn.
        }
      }
      await chats.clear(article.id)
      if (typeof article.sessionId === 'string') bySession.delete(article.sessionId)
      await articles.setSession(article.id, null)
      return json({ ok: true, ...roster() })
    })
  })
}

/** Pure helpers exported for the node test suite. */
export const __internals = {
  DEFAULT_STYLE,
  parseConfig,
  buildStyles: () => ({
    default: { ...DEFAULT_STYLE },
    presets: Object.keys(STYLE_PRESETS),
  }),
  parseStoredArticle: parseArticle,
  toMarkdown: articleToMarkdown,
}