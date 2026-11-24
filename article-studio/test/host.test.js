import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { apply } from '../index.js'

let root
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'article-studio-host-'))
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * A minimal Host context: enough of Cordis (get / inject / on / effect) for the
 * plugin's registration calls, and a Fetch-route table to exercise handlers.
 */
function createHost(options = {}) {
  const routes = new Map()
  const listeners = new Map()
  const tools = []
  const prompts = []
  const sessions = new Set()
  const created = []
  const liveAgents = []
  const warnings = []
  let counter = 0

  /** An Agent context that records the tools our plugin registers on it. */
  const agentCtx = () => ({
    inject: (names, callback) => {
      if (!names.includes('tools')) return { dispose: async () => {} }
      const result = callback({
        tools: { register: (definition) => { tools.push(definition); return () => {} } },
        effect: (run) => run(),
      })
      return { dispose: async () => { if (typeof result === 'function') await result() } }
    },
  })

  /** A prototype-carrying preset registry, so the hiding patch can be observed. */
  class FakePresets {
    async remoteExportList() {
      return { presets: [{ id: 'standard', isDefault: true }, { id: 'personal' }, { id: 'scribe', order: 6 }] }
    }
  }
  const agentPresets = new FakePresets()

  const sessionController = {
    async state({ sessionId }) {
      if (!sessions.has(sessionId)) throw new Error(`session ${sessionId} not found`)
      return { cursor: 0, active: false, running: false, queue: null, pendingInput: [] }
    },
    async create(request) {
      const sessionId = `session-${++counter}`
      sessions.add(sessionId)
      created.push({ ...request, sessionId })
      if (options.fireOnCreate === true) {
        // The real Session controller creates the Agent before returning, so
        // agent/created runs while the article has not recorded the Session.
        const agent = { id: sessionId, ctx: agentCtx() }
        liveAgents.push(agent)
        for (const listener of listeners.get('agent/created') ?? []) await listener({ agent })
      }
      return { sessionId, ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }) }
    },
    async prompt(request) {
      prompts.push(request)
      return { accepted: true }
    },
    cancel() {
      return { accepted: true }
    },
  }

  const baseScope = {
    get: (name) => {
      if (name === 'sessionController') return sessionController
      if (name === 'agents') return { list: () => liveAgents }
      if (name === 'agentPresets') return agentPresets
      if (name === 'connection') return { fetch: { register: (route) => { routes.set(route.path, route); return async () => {} } } }
      return undefined
    },
    on: (event, listener) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {}
    },
    effect: (run) => run(),
    logger: { warn: (message) => warnings.push(message), info: () => {} },
  }

  const ctx = {
    ...baseScope,
    inject: (names, callback) => {
      if (names.includes('connection')) {
        const result = callback({
          ...baseScope,
          connection: { fetch: { register: (route) => { routes.set(route.path, route); return async () => {} } } },
        })
        return { dispose: async () => { if (typeof result === 'function') await result() } }
      }
      if (names.includes('agentPresets')) {
        const result = callback({ ...baseScope, agentPresets })
        return { dispose: async () => { if (typeof result === 'function') await result() } }
      }
      if (names.includes('agents')) {
        const result = callback({ ...baseScope, agents: { list: () => liveAgents } })
        return { dispose: async () => { if (typeof result === 'function') await result() } }
      }
      return { dispose: async () => {} }
    },
  }

  return {
    ctx,
    routes,
    listeners,
    tools,
    prompts,
    sessions,
    created,
    liveAgents,
    agentPresets,
    warnings,
    agentCtx,
    async fire(event, ...args) {
      for (const listener of listeners.get(event) ?? []) await listener(...args)
    },
    async call(path, body = {}) {
      const route = routes.get(`/api/article-studio${path}`)
      assert.ok(route !== undefined, `route ${path} is registered`)
      const request = new Request(`http://localhost/api/article-studio${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const response = await route.fetch(request)
      return { status: response.status, body: await response.json() }
    },
  }
}

test('routes serve article CRUD, revisions, and deletion', async () => {
  const host = createHost()
  apply(host.ctx, { dataDir: join(root, 'crud'), agentPreset: 'scribe', identityName: '墨匠' })

  const empty = await host.call('/list')
  assert.equal(empty.body.ok, true)
  assert.equal(empty.body.articles.length, 0)

  const created = await host.call('/create', { title: '开篇' })
  const id = created.body.article.id
  assert.match(id, /^a-[0-9a-f]{12}$/)

  const saved = await host.call('/save', { id, rev: 1, text: '第一段。' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.article.rev, 2)

  const stale = await host.call('/save', { id, rev: 1, text: '旧稿' })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.article.text, '第一段。')

  const poll = await host.call('/poll', { id, rev: 3 })
  assert.equal(poll.body.article.text, '第一段。')
  const quiet = await host.call('/poll', { id, rev: 2 })
  assert.equal(quiet.body.article, undefined, 'an unchanged revision ships no document')

  const renamed = await host.call('/save', { id, rev: 2, title: '改名' })
  assert.equal(renamed.body.article.title, '改名')

  const removed = await host.call('/delete', { id })
  assert.equal(removed.body.deleted, true)
  assert.equal((await host.call('/list')).body.articles.length, 0)
})

test('ask creates one Session, carries caret context, and mirrors replies', async () => {
  const host = createHost()
  apply(host.ctx, { dataDir: join(root, 'ask'), agentPreset: 'scribe', identityName: '墨匠' })
  const created = await host.call('/create', { title: '杂谈', text: '开头。' })
  const id = created.body.article.id

  const first = await host.call('/ask', {
    id,
    instruction: '把开头写得更具体',
    selection: '开头。',
    before: '开头。',
    after: '',
  })
  assert.equal(first.body.ok, true)
  assert.equal(host.prompts.length, 1)
  const prompt = host.prompts[0].content[0].text
  assert.match(prompt, /把开头写得更具体/)
  assert.match(prompt, /开头。/)
  assert.match(prompt, new RegExp(id))

  const sessionId = first.body.sessionId

  const second = await host.call('/ask', { id, instruction: '再短一点' })
  assert.equal(second.body.sessionId, sessionId, 'the same article keeps one Session')

  // Two assistant events and one tool call reach the transcript.
  await host.fire('session/event', { id: sessionId }, {
    type: 'tool/call',
    data: { name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) },
  })
  await host.fire('session/event', { id: sessionId }, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '改好了。' }] } },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const polled = await host.call('/poll', { id, rev: 1 })
  const roles = polled.body.chat.map((entry) => entry.role)
  assert.deepEqual(roles, ['user', 'user', 'tool', 'assistant'])
  assert.equal(polled.body.chat[0].text.includes('把开头写得更具体'), true)
  assert.equal(polled.body.chat[1].text, '再短一点')
  assert.equal(polled.body.chat[2].text, 'bash · echo hi')
  assert.equal(polled.body.chat[3].text, '改好了。')
  assert.equal(polled.body.running, false)

  const reset = await host.call('/reset', { id })
  assert.equal(reset.body.ok, true)
  const afterReset = await host.call('/poll', { id, rev: 1 })
  assert.equal(afterReset.body.chat.length, 0)
})

test('article tools are scoped to the writing Agent and edit the open article', async () => {
  const host = createHost()
  apply(host.ctx, { dataDir: join(root, 'tools'), agentPreset: 'scribe', identityName: '墨匠' })
  const created = await host.call('/create', { title: '草稿', text: '第一段。' })
  const id = created.body.article.id
  const asked = await host.call('/ask', { id, instruction: '写长一点' })
  const sessionId = asked.body.sessionId

  await host.fire('agent/created', { agent: { id: sessionId, ctx: host.agentCtx() } })
  const names = host.tools.map((tool) => tool.name)
  assert.deepEqual(names, [
    'article_list',
    'article_read',
    'article_create',
    'article_update',
    'article_replace',
    'article_append',
    'article_style',
    'article_delete',
    'article_push',
  ])

  const read = host.tools.find((tool) => tool.name === 'article_read')
  const readValue = await read.execute({}, { agent: { id: sessionId } })
  assert.equal(readValue.articleId, id)
  assert.equal(readValue.text, '第一段。')
  assert.equal(Array.isArray(read.output.render({}, readValue)), true)

  const update = host.tools.find((tool) => tool.name === 'article_update')
  const updated = await update.execute({ text: '第一段。\n\n第二段。' }, { agent: { id: sessionId } })
  assert.equal(updated.rev, 2)
  const reread = await read.execute({}, { agent: { id: sessionId } })
  assert.match(reread.text, /第二段/)

  const replace = host.tools.find((tool) => tool.name === 'article_replace')
  const replaced = await replace.execute({ find: '第二段', replace: '第二段（改）' }, { agent: { id: sessionId } })
  assert.equal(replaced.replaced, 1)

  const style = host.tools.find((tool) => tool.name === 'article_style')
  const styled = await style.execute({ preset: 'wechat', fontSize: 20 }, { agent: { id: sessionId } })
  assert.equal(styled.style.width, 620)
  assert.equal(styled.style.fontSize, 20)

  const push = host.tools.find((tool) => tool.name === 'article_push')
  await assert.rejects(() => push.execute({}, { agent: { id: sessionId } }), /no configured push target/)
})

test('agents that are not writing sessions receive no article tools', async () => {
  const host = createHost()
  apply(host.ctx, { dataDir: join(root, 'scope'), agentPreset: 'scribe' })
  await host.call('/list')
  await host.fire('agent/created', { agent: { id: 'session-other', ctx: host.agentCtx() } })
  assert.equal(host.tools.length, 0)
})

test('article_push posts the article to a configured target', async () => {
  const received = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      received.push({ headers: request.headers, body })
      response.writeHead(202, { 'content-type': 'text/plain' })
      response.end('accepted')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const host = createHost()
    apply(host.ctx, {
      dataDir: join(root, 'push'),
      agentPreset: 'scribe',
      pushTargets: [{ id: 'blog', name: 'Blog', url: `http://127.0.0.1:${port}/publish`, format: 'json', headers: { authorization: 'Bearer test' } }],
    })
    const created = await host.call('/create', { title: '推送测试', text: '正文。' })
    const asked = await host.call('/ask', { id: created.body.article.id, instruction: '推送' })
    await host.fire('agent/created', { agent: { id: asked.body.sessionId, ctx: host.agentCtx() } })

    const push = host.tools.find((tool) => tool.name === 'article_push')
    const result = await push.execute({ target: 'blog' }, { agent: { id: asked.body.sessionId } })
    assert.equal(result.ok, true)
    assert.equal(result.status, 202)
    assert.equal(result.target, 'Blog')
    assert.equal(received.length, 1)
    assert.equal(received[0].headers.authorization, 'Bearer test')
    const payload = JSON.parse(received[0].body)
    assert.equal(payload.title, '推送测试')
    assert.match(payload.markdown, /正文。/)
    assert.equal(payload.articleId, created.body.article.id)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})


test('article tools reach a Session created before the article records it', async () => {
  const host = createHost({ fireOnCreate: true })
  apply(host.ctx, { dataDir: join(root, 'create-order'), agentPreset: 'scribe' })
  const created = await host.call('/create', { title: '先建会话', text: '正文。' })
  const asked = await host.call('/ask', { id: created.body.article.id, instruction: '改一下' })
  const names = host.tools.map((tool) => tool.name)
  assert.ok(names.includes('article_read'), 'tools are installed after the article binds the Session')
  const read = host.tools.find((tool) => tool.name === 'article_read')
  const value = await read.execute({ articleId: created.body.article.id }, { agent: { id: asked.body.sessionId } })
  assert.equal(value.text, '正文。')
})


test('the writing Session runs as the active Personal Agent identity', async () => {
  const host = createHost()
  apply(host.ctx, {
    dataDir: join(root, 'identity'),
    identityDataDir: join(root, 'identity-data'),
    agentPreset: 'scribe',
    identityPreset: 'personal',
  })
  const createdArticle = await host.call('/create', { title: '身份稿', text: '正文' })
  const id = createdArticle.body.article.id

  const first = await host.call('/ask', { id, instruction: '改一下', identity: { id: 'neil', name: 'Neil' } })
  assert.equal(first.body.ok, true)
  assert.equal(host.created.length, 1)
  assert.equal(host.created[0].agentPreset, 'personal')
  assert.match(host.created[0].cwd, /identities[\\/]neil[\\/]home$/)

  const listed = (await host.call('/poll', { id, rev: 1 })).body.articles.find((entry) => entry.id === id)
  assert.equal(listed.identityName, 'Neil')

  const second = await host.call('/ask', { id, instruction: '再改一下', identity: { id: 'neil', name: 'Neil' } })
  assert.equal(second.body.sessionId, first.body.sessionId, 'the same identity keeps the Session')

  const switched = await host.call('/ask', { id, instruction: '换个人', identity: { id: 'ada', name: 'Ada' } })
  assert.notEqual(switched.body.sessionId, first.body.sessionId, 'a different identity starts a new Session')
  assert.equal(host.created.at(-1).agentPreset, 'personal')
  const chat = (await host.call('/poll', { id, rev: 1 })).body.chat
  assert.ok(chat.some((entry) => entry.tool === 'notice' && entry.text.includes('Ada')), 'the switch is recorded')
})

test('autosave mirrors articles into a git history that can be restored', async () => {
  const host = createHost()
  apply(host.ctx, { dataDir: join(root, 'git'), gitCommitDelayMs: 0, agentPreset: 'scribe' })
  const created = await host.call('/create', { title: '版本测试', text: '第一版' })
  const id = created.body.article.id

  await host.call('/save', { id, rev: 1, text: '第一版' })
  const firstList = await host.call('/versions', { id })
  assert.equal(firstList.body.ok, true)
  assert.ok(firstList.body.versions.length >= 1, 'a commit exists after autosave')

  await host.call('/save', { id, rev: 2, text: '第二版' })
  const list = (await host.call('/versions', { id })).body.versions
  assert.ok(list.length >= 2, 'the second autosave adds a commit')
  assert.match(list[0].sha, /^[0-9a-f]{40}$/)
  assert.match(list[0].message, /save: 版本测试/)

  const oldest = list[list.length - 1]
  const version = await host.call('/version', { id, sha: oldest.sha })
  assert.equal(version.body.version.text.trim(), '第一版')

  const restored = await host.call('/restore', { id, sha: oldest.sha })
  assert.equal(restored.body.ok, true)
  assert.equal(restored.body.article.text.trim(), '第一版')
  assert.ok(restored.body.article.rev > 3)
})


test('the fallback writing preset is hidden from the session roster', async () => {
  const host = createHost()
  apply(host.ctx, { dataDir: join(root, 'roster'), hiddenPresets: ['scribe'] })
  const roster = await host.agentPresets.remoteExportList()
  assert.deepEqual(roster.presets.map((preset) => preset.id), ['standard', 'personal'])
})

test('a custom hidden list replaces the default', async () => {
  const host = createHost()
  apply(host.ctx, { dataDir: join(root, 'roster-custom'), hiddenPresets: ['personal'] })
  const roster = await host.agentPresets.remoteExportList()
  assert.deepEqual(roster.presets.map((preset) => preset.id), ['standard', 'scribe'])
})


test('Agent edits leave review marks that can be kept or undone', async () => {
  const host = createHost()
  apply(host.ctx, { dataDir: join(root, 'review'), agentPreset: 'scribe' })
  const created = await host.call('/create', { title: '审阅', text: '原文第一句。' })
  const id = created.body.article.id
  const asked = await host.call('/ask', { id, instruction: '改一下' })
  await host.fire('agent/created', { agent: { id: asked.body.sessionId, ctx: host.agentCtx() } })
  const update = host.tools.find((tool) => tool.name === 'article_update')

  await update.execute({ text: '原文第一句。\n\n新增一句。' }, { agent: { id: asked.body.sessionId } })
  const marked = await host.call('/read', { id })
  assert.equal(marked.body.article.pendingChange.before, '原文第一句。')

  const kept = await host.call('/accept', { id })
  assert.equal(kept.body.article.pendingChange, undefined)
  assert.match(kept.body.article.text, /新增一句/)

  await update.execute({ text: '整篇重写。' }, { agent: { id: asked.body.sessionId } })
  const again = await host.call('/read', { id })
  assert.equal(again.body.article.pendingChange.before, kept.body.article.text)

  for (const route of ['/accept', '/undo']) {
    const stale = await host.call(route, { id, rev: marked.body.article.rev })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.article.text, '整篇重写。')
    assert.ok(stale.body.article.pendingChange)
  }
  const undone = await host.call('/undo', { id, rev: again.body.article.rev })
  assert.equal(undone.body.article.text, kept.body.article.text)
  assert.equal(undone.body.article.pendingChange, undefined)
})

test('the first Agent draft is a visible addition and can be undone to a blank body', async () => {
  const host = createHost({ fireOnCreate: true })
  apply(host.ctx, { dataDir: join(root, 'blank-review'), agentPreset: 'scribe' })
  const { body: { article } } = await host.call('/create', { title: '空白稿' })
  const { id } = article
  const asked = await host.call('/ask', { id, instruction: '写个开头' })
  const update = host.tools.find((tool) => tool.name === 'article_update')
  await update.execute({ text: '这是一个开头。' }, { agent: { id: asked.body.sessionId } })
  const marked = (await host.call('/read', { id })).body.article
  assert.equal(marked.pendingChange.before, '')
  assert.equal(marked.text, '这是一个开头。')
  const undone = await host.call('/undo', { id, rev: marked.rev })
  assert.equal(undone.body.article.text, '')
  assert.equal(undone.body.article.pendingChange, undefined)
})


test('image routes validate uploads and retain pictures in Git-backed versions', async () => {
  const host = createHost()
  const dataDir = join(root, 'images')
  apply(host.ctx, { dataDir, agentPreset: 'scribe', gitCommitDelayMs: 60_000 })
  const { body: { article } } = await host.call('/create', { title: '图文稿', text: '第一段。' })
  const { id, rev } = article
  const prefix = 'http://localhost/api/article-studio'
  const upload = host.routes.get('/api/article-studio/image-upload')
  const read = host.routes.get('/api/article-studio/image')
  assert.deepEqual(upload.methods, ['POST'])
  assert.equal(upload.requestBody, 'streaming')
  assert.deepEqual(read.methods, ['GET'])
  const send = (body, options = {}) => upload.fetch(new Request(`${prefix}/image-upload?article=${options.id ?? id}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream', ...options.headers }, body, duplex: 'half',
  }))
  const view = (key) => read.fetch(new Request(`${prefix}/image?key=${encodeURIComponent(key)}`))
  // One real PNG, small enough to compare byte-for-byte.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f1sAAAAASUVORK5CYII=', 'base64')
  assert.equal((await send('<svg xmlns="http://www.w3.org/2000/svg" />')).status, 415)
  assert.equal((await send(png, { id: 'a-000000000000' })).status, 404)
  assert.equal((await send(png, { headers: { 'content-length': String(9 * 1024 * 1024) } })).status, 413)
  const oversized = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(5 * 1024 * 1024))
    controller.enqueue(new Uint8Array(4 * 1024 * 1024))
    controller.close()
  } })
  assert.equal((await send(oversized)).status, 413, 'stream limit applies without a Content-Length header')
  const stored = await send(png)
  assert.equal(stored.status, 201)
  const { key } = await stored.json()
  assert.match(key, /^[a-f0-9]{64}\.png$/u)
  assert.equal((await (await send(png)).json()).key, key)
  assert.equal((await view('../articles/a-000000000000.json')).status, 404)
  const served = await view(key)
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png)

  const text = `第一段。\n\n![插图\\[一\\]](media/${key})`
  const saved = (await host.call('/save', { id, rev, text })).body
  const row = saved.articles.find((item) => item.id === id)
  assert.equal(row.chars, 3)
  assert.equal(row.preview, '第一段。')
  const history = await host.call('/versions', { id })
  const sha = history.body.versions[0].sha
  assert.deepEqual(execFileSync('git', ['show', `${sha}:articles/media/${key}`], { cwd: join(dataDir, 'repo') }), png)
  await host.call('/save', { id, rev: saved.article.rev, text: '去掉插图。' })
  const restored = (await host.call('/restore', { id, sha })).body.article
  assert.equal(restored.text.trimEnd(), text)
  assert.deepEqual(Buffer.from(await (await view(key)).arrayBuffer()), png)
  await host.call('/versions', { id }) // flush the debounce before test cleanup
})
