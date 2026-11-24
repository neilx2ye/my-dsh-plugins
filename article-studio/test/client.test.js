import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const SOURCE = await readFile(join(import.meta.dirname, '..', 'client.js'), 'utf8')

/**
 * Evaluate the browser bundle against a tiny DOM stub and return what its
 * factory produced, plus the slots it registered into during `apply`.
 */
function loadBundle() {
  let definition
  const registrations = []
  const styles = []
  const created = []

  const document = {
    head: { appendChild: (node) => created.push(node) },
    body: {},
    createElement: (tag) => {
      const node = {
        tag,
        dataset: {},
        textContent: '',
        remove() {
          const index = created.indexOf(node)
          if (index >= 0) created.splice(index, 1)
        },
      }
      return node
    },
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  }

  const window = {
    __ModuleLoader__: {
      load: (input) => {
        definition = input
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1280,
    innerHeight: 900,
    localStorage: { getItem: () => null, setItem: () => {} },
  }

  const sandbox = {
    window,
    document,
    console,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, articles: [], sessionIds: [], identity: { name: '墨匠' } }) }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    CSS: { escape: (value) => value },
    localStorage: window.localStorage,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(SOURCE, sandbox, { filename: 'client.js' })
  return { definition, registrations, created, window, document }
}

test('the bundle registers a factory with the package id', () => {
  const { definition } = loadBundle()
  assert.ok(definition !== undefined, 'window.__ModuleLoader__.load was called')
  assert.equal(definition.id, '@local/article-studio')
  assert.equal(typeof definition.factory, 'function')
})

test('apply registers dictionaries, styles, the panel, and the sidebar row', async () => {
  const { definition, registrations, created, document } = loadBundle()

  const plugin = definition.factory((name) => {
    if (name === 'react') {
      return {
        createElement: () => null,
        Fragment: 'Fragment',
        useState: () => [undefined, () => {}],
        useRef: () => ({ current: null }),
        useEffect: () => {},
        useMemo: () => null,
      }
    }
    if (name === 'react-dom') return { createPortal: () => null }
    throw new Error(`unexpected import ${name}`)
  })

  assert.equal(typeof plugin.apply, 'function')
  assert.equal(Array.from(plugin.inject).join(','), 'slots,locale')

  const effects = []
  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: () => () => {},
    },
    get: () => undefined,
    effect: (run, label) => {
      const dispose = run()
      effects.push({ label, dispose })
    },
    slots: {
      inject: (slot, callback) => {
        callback()
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  plugin.apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 20))

  const main = registrations.find((entry) => entry.options.name === 'main')
  assert.ok(main !== undefined, 'the panel registers into main')
  assert.equal(main.options.key, 'article-studio')
  assert.equal(typeof main.component, 'function')

  const row = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  assert.ok(row !== undefined, 'the sidebar row registers')
  assert.equal(row.options.id, 'article-studio')
  assert.equal(row.options.order, 5)
  assert.equal(row.options.label(), 'panel')

  assert.ok(created.some((node) => node.dataset.pluginCss === 'article-studio/panel.css'), 'the panel stylesheet is mounted')

  // Disposal removes the stylesheet it added.
  for (const effect of effects) if (typeof effect.dispose === 'function') effect.dispose()
  assert.equal(created.length, 0)
  assert.ok(document.head !== undefined)
})

test('the review diff marks removed and added text', () => {
  const { definition } = loadBundle()
  const plugin = definition.factory((name) => (name === 'react'
    ? { createElement: () => null, Fragment: 'Fragment', useState: () => [undefined, () => {}], useRef: () => ({ current: null }), useEffect: () => {}, useMemo: () => null }
    : { createPortal: () => null }))
  const { diffSegments, diffStatsOf, reviewGroups } = plugin.__diff

  const stops = reviewGroups([
    { op: 'del', text: '原文' }, { op: 'ins', text: '新文' },
    { op: 'equal', text: '。\n\n' }, { op: 'ins', text: '新段' },
  ])
  assert.equal(stops.length, 3)
  assert.equal(stops[0].edits.length, 2, 'a replacement is a single navigation stop')
  assert.equal(stops[1].text, '。\n\n')
  assert.equal(stops[2].edits[0].text, '新段')
  const opening = reviewGroups(diffSegments('', '一个开头。'))
  assert.equal(opening.length, 1)
  assert.equal(opening[0].edits[0].op, 'ins')

  const before = '今天天气很好，我们去公园。'
  const after = '今天天气不错，我们去公园散步。'
  const segments = diffSegments(before, after)
  // Reconstruct both sides from the marks: the diff must never invent or drop text.
  assert.equal(segments.map((segment) => (segment.op === 'ins' ? '' : segment.text)).join(''), before)
  assert.equal(segments.map((segment) => (segment.op === 'del' ? '' : segment.text)).join(''), after)
  const removed = segments.filter((segment) => segment.op === 'del').map((segment) => segment.text).join('')
  const inserted = segments.filter((segment) => segment.op === 'ins').map((segment) => segment.text).join('')
  assert.ok(removed.length > 0 && inserted.length > 0)
  const stats = diffStatsOf(segments)
  assert.equal(stats.removed, removed.length)
  assert.equal(stats.added, inserted.length)

  const same = diffSegments('没有变化', '没有变化')
  assert.equal(same.map((segment) => segment.op).join(','), 'equal')
  const sameStats = diffStatsOf(same)
  assert.equal(sameStats.added, 0)
  assert.equal(sameStats.removed, 0)

  const rewritten = diffSegments('完全不同的开头。', '另一段文字。')
  assert.ok(rewritten.some((segment) => segment.op === 'del'))
  assert.ok(rewritten.some((segment) => segment.op === 'ins'))
})


test('image Markdown preserves the surrounding text and escapes alternative text', () => {
  const { definition } = loadBundle()
  const plugin = definition.factory((name) => name === 'react' ? { createElement: () => null } : { createPortal: () => null })
  const { imageBlock, parseImage } = plugin.__images
  const key = `${'a'.repeat(64)}.png`
  const block = imageBlock([{ key, alt: '照片[一]\\二' }], '前文后文', 2)
  assert.equal(`前文${block}后文`, `前文\n\n![照片\\[一\\]\\\\二](media/${key})\n\n后文`)
  assert.equal(parseImage(block.trim()).alt, '照片[一]\\二')
  assert.equal(parseImage(block.trim()).key, key)
  assert.equal(parseImage('![照片](https://example.org/file.png)'), null)
  assert.equal(parseImage('![照片](media/../config.png)'), null)
  const alreadySpaced = imageBlock([{ key, alt: '' }], 'A\n\n\n\nB', 3)
  assert.equal(alreadySpaced, `![](media/${key})`)
})


test('a pending upload matches only when both an upload and the article exist', () => {
  const { definition } = loadBundle()
  const plugin = definition.factory((name) => name === 'react' ? { createElement: () => null } : { createPortal: () => null })
  const { uploadBelongsTo } = plugin.__images
  // Opening the panel before an article loads leaves both sides absent; the
  // cleanup used to treat that as a match and crash the whole main slot.
  assert.equal(uploadBelongsTo(null, undefined), false, 'no upload and no article is not a match')
  assert.equal(uploadBelongsTo(undefined, undefined), false)
  assert.equal(uploadBelongsTo(null, 'a-1'), false)
  assert.equal(uploadBelongsTo({ id: 'a-1' }, undefined), false)
  assert.equal(uploadBelongsTo({ id: 'a-1' }, 'a-2'), false)
  assert.equal(uploadBelongsTo({ id: 'a-1' }, 'a-1'), true)
})


test('document outline uses Markdown levels and source offsets without including fenced examples', () => {
  const { definition } = loadBundle()
  const plugin = definition.factory((name) => name === 'react' ? { createElement: () => null } : { createPortal: () => null })
  const { markdownStructure, headingAt } = plugin.__outline
  const source = [
    '📝 前言', '', '# 概览 #', '   ### **重复**', '## 重复', '普通内容 # 非标题', '',
    '````markdown', '# fenced', '```', '## still fenced', '````',
    '~~~', '# also fenced', '~~~~', '', '第二章', '=====', '### [链接](https://example.org) 与 `代码`',
    '    # indented code', '> ## quote', '- ## list item', '', '末节', '---',
  ].join('\r\n')
  const { headings, byLine, fences } = markdownStructure(source)
  assert.deepEqual(Array.from(headings, (item) => item.label), ['概览', '重复', '重复', '第二章', '链接 与 代码', '末节'])
  assert.deepEqual(Array.from(headings, (item) => item.level), [1, 3, 2, 1, 3, 2])
  assert.deepEqual(Array.from(headings, (item) => item.depth), [0, 1, 1, 0, 1, 1])
  assert.equal(headings[0].offset, source.indexOf('# 概览 #'))
  assert.equal(headings[2].offset, source.indexOf('## 重复'))
  assert.notEqual(headings[1].offset, headings[2].offset, 'duplicate labels keep distinct anchors')
  assert.equal(byLine.get(16).offset, source.indexOf('第二章'))
  assert.equal(byLine.get(16).length, 2)
  assert.equal(fences.get(7).end, 11)
  assert.equal(fences.get(12).end, 14)
  assert.equal(markdownStructure('段落\n\n---\n```\n# unclosed fence').headings.length, 0)
  assert.equal(markdownStructure('####### not-a-heading\n##\n#tag').headings.length, 0)

  const y = [90, 130, 240, 300, 500, 720]
  const topAt = (index) => y[index]
  assert.equal(headingAt(headings, topAt, 60), null)
  assert.equal(headingAt(headings, topAt, 130), headings[1].offset)
  assert.equal(headingAt(headings, topAt, 299), headings[2].offset)
  assert.equal(headingAt(headings, topAt, 900), headings[5].offset)
})


test('editing existing pictures keeps exact Markdown offsets and treats each image atomically', () => {
  const { definition } = loadBundle()
  const plugin = definition.factory((name) => name === 'react' ? { createElement: () => null } : { createPortal: () => null })
  const { editorImages, affectedImageRange } = plugin.__images
  const key = `${'a'.repeat(64)}.png`
  const picture = `![有\\[说明\\]](media/${key})`
  const inline = `![](media/${key})`
  const intro = '# 前文🖋️\r\n\r\n'
  const source = [intro + picture, '', `前字${inline}后字`, '', '```md', picture, '```',
    `光标 \\${picture}`, `\`${picture}\``, `\`\` 示例 \` ${inline} \`\``, `    ${picture}`,
    '![远程](https://example.org/image.png)', '## 后文'].join('\r\n')
  const list = editorImages(source)
  assert.equal(list.length, 2)
  const [first, second] = list
  assert.equal(first.start, intro.length)
  assert.equal(first.image.alt, '有[说明]')
  assert.equal(first.source, picture)
  assert.equal(source.slice(second.start, second.end), inline)

  const removed = (start, end, action) => {
    const result = affectedImageRange(list, start, end, action)
    return result ? source.slice(...result) : null
  }
  assert.equal(removed(first.start, first.start, 'delete'), picture)
  assert.equal(removed(first.end, first.end, 'backspace'), picture)
  assert.equal(removed(first.start, first.start, 'backspace'), null)
  assert.equal(removed(first.end, first.end, 'delete'), null)
  assert.equal(removed(first.start + 1, first.end - 1, 'copy'), picture)
  const afterCut = source.slice(0, second.start) + source.slice(second.end)
  assert.ok(afterCut.includes('前字后字'))
  assert.equal(editorImages(afterCut).length, 1)
  assert.equal(removed(second.start - 1, second.end + 1, 'cut'), `字${inline}后`)
})
