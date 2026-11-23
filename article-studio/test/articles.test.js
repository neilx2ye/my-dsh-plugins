import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { countWords, createArticleStore, DEFAULT_STYLE, normalizeStyle, previewOf, stylePreset } from '../lib/articles.js'
import { createChatStore } from '../lib/chats.js'

let root
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'article-studio-test-'))
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})

test('style patches are clamped and enum-checked', () => {
  const style = normalizeStyle({ fontSize: 999, theme: 'neon', align: 'justify', indent: true, lineHeight: 0.2 })
  assert.equal(style.fontSize, 30)
  assert.equal(style.theme, DEFAULT_STYLE.theme)
  assert.equal(style.align, 'justify')
  assert.equal(style.lineHeight, 1.3)
  assert.equal(style.indent, true)
  assert.deepEqual(stylePreset('unknown'), undefined)
  assert.equal(stylePreset('wechat').width, 620)
})

test('word count and preview strip Markdown noise', () => {
  assert.equal(countWords('你好 world 123'), 4)
  assert.equal(previewOf('# 标题\n\n**粗体**正文', 40), '标题 粗体正文')
})

test('articles round-trip through disk with revisions', async () => {
  const store = createArticleStore({ dir: join(root, 'articles') })
  await store.load()
  const created = await store.create({ title: '第一篇', text: '开头。' })
  assert.match(created.id, /^a-[0-9a-f]{12}$/)
  assert.equal(store.list().length, 1)

  const saved = await store.update(created.id, { text: '开头。\n\n第二段。' }, created.rev)
  assert.equal(saved.ok, true)
  assert.equal(saved.article.rev, created.rev + 1)

  const stale = await store.update(created.id, { text: '旧版本' }, created.rev)
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'conflict')

  const onDisk = JSON.parse(await readFile(join(root, 'articles', `${created.id}.json`), 'utf8'))
  assert.equal(onDisk.text, '开头。\n\n第二段。')

  const withSession = await store.setSession(created.id, 'session-1')
  assert.equal(withSession.sessionId, 'session-1')
  assert.equal(withSession.rev, saved.article.rev, 'recording a Session must not bump the document revision')

  const reloaded = createArticleStore({ dir: join(root, 'articles') })
  await reloaded.load()
  assert.equal(reloaded.get(created.id)?.text, onDisk.text)

  assert.equal(await store.remove(created.id), true)
  assert.equal(store.list().length, 0)
})

test('transcripts append, cap, and clear', async () => {
  const store = createChatStore({ dir: join(root, 'chats') })
  await store.append('a-0123456789ab', { role: 'user', text: '你好' })
  await store.append('a-0123456789ab', { role: 'tool', text: 'bash · echo ok', tool: 'bash' })
  await store.append('a-0123456789ab', { role: 'assistant', text: '好的。', name: '墨匠' })
  const entries = await store.read('a-0123456789ab')
  assert.equal(entries.length, 3)
  assert.equal(entries[2].name, '墨匠')
  await store.clear('a-0123456789ab')
  assert.equal((await store.read('a-0123456789ab')).length, 0)
})