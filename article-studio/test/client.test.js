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
  const { diffSegments, diffStatsOf } = plugin.__diff

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
