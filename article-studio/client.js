/**
 * Browser half of the Article Studio bundle.
 *
 * The panel is a global main-panel page, so the sidebar lists it above every
 * Session row and the Conversation column steps aside while you write. The
 * writing partner has no permanent composer: pressing Ctrl/⌘+K with the caret
 * in the body opens one popover anchored at the caret, and every reply,
 * tool call, and article edit flows back through the panel's poll.
 *
 * The editor is deliberately not a controlled input. React owns the document
 * state, the browser owns the caret; remote edits replace the DOM text only
 * when there is nothing unsaved, and a conflict keeps both versions until the
 * writer chooses.
 */

window.__ModuleLoader__.load({
  id: '@local/article-studio',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'articleStudio'
    /** Main-panel key; also the sidebar panellist id. */
    const PANEL_ID = 'article-studio'
    /** Exact Fetch routes belong to the Host half. */
    const API = 'api/article-studio/'
    /** Remember the last article across reloads. */
    const LAST_KEY = 'article-studio:last'
    /** Remember the pinned writing partner (an identity id). */
    const PINNED_KEY = 'article-studio:partner'
    /** Style defaults mirror the Host document defaults. */
    const DEFAULT_STYLE = Object.freeze({
      font: 'serif',
      fontSize: 18,
      lineHeight: 1.85,
      paragraphGap: 12,
      width: 760,
      align: 'left',
      indent: false,
      theme: 'paper',
    })
    /** Style recipes offered by the toolbar; the Host owns the same names. */
    const STYLE_PRESETS = ['essay', 'blog', 'wechat', 'note', 'warm']

    // ── dictionaries ───────────────────────────────────────────────────────

    const EN = {
      panel: 'Articles',
      back: 'Back to conversation',
      newArticle: 'New article',
      untitled: 'Untitled',
      search: 'Search articles',
      clearSearch: 'Clear search',
      docNav: 'Document navigation',
      outline: 'Outline',
      outlineEmpty: 'Add headings like # Title or ## Section to build the outline.',
      outlineTop: 'Back to top',
      outlineItem: '{name}, heading level {level}',
      navToggle: 'Navigation',
      navBack: 'Back to article',
      articleList: 'Article list',
      chooseArticle: 'Choose an article from the list',
      loadingArticles: 'Loading articles…',
      openingArticle: 'Opening article…',
      creatingArticle: 'Creating article…',
      bodyLabel: 'Article body',
      noMatches: 'No article matches the search',
      justNow: 'just now',
      minutesAgo: '{n} min ago',
      hoursAgo: '{n} h ago',
      yesterday: 'yesterday',
      noArticles: 'No articles yet',
      noArticlesHint: 'Create an article to start writing. Everything autosaves to this profile.',
      createFirst: 'Create an article',
      emptyDocument: 'Start writing…',
      delete: 'Delete',
      deleteTitle: 'Delete “{title}”?',
      deleteBody: 'This removes the document and its conversation transcript. It cannot be undone.',
      cancel: 'Cancel',
      confirmDelete: 'Delete',
      insertImage: 'Insert image',
      imageHelp: 'Choose an image, paste a screenshot, or drop an image into the draft.',
      dropImage: 'Drop to insert here',
      imageUploading: 'Uploading {current} / {total}…',
      imageAdded: 'Inserted {count} image(s).',
      imageSize: 'Each image must be at most 8 MiB.',
      imageType: 'Use PNG, JPEG, WebP, or GIF images.',
      imageBatch: 'Choose up to 8 images at a time.',
      imageError: 'Could not upload the image. The draft was not changed.',
      imageMissing: 'Image could not be loaded',
      imageMoved: 'Images uploaded. The original insertion point is no longer available.',
      imagePlace: 'Insert at current caret',
      imageEditFirst: 'Return to editing to place these images.',
      imageUndo: 'Undo insertion',
      imagePreview: 'Preview image(s)',
      pastedImage: 'Pasted image',
      style: 'Style',
      preview: 'Preview',
      edit: 'Edit',
      font: 'Font',
      'font.serif': 'Serif (宋体)',
      'font.sans': 'Sans (黑体)',
      'font.kai': 'Kai (楷体)',
      'font.mono': 'Mono',
      size: 'Size',
      lineHeight: 'Line height',
      paragraphGap: 'Paragraph gap',
      paragraphGapNote: 'Preview',
      width: 'Column',
      align: 'Align',
      'align.left': 'Left',
      'align.center': 'Center',
      'align.justify': 'Justify',
      indent: 'First-line indent',
      theme: 'Canvas',
      'theme.paper': 'Paper',
      'theme.sepia': 'Sepia',
      'theme.dark': 'Night',
      preset: 'Recipe',
      'preset.essay': 'Essay',
      'preset.blog': 'Blog',
      'preset.wechat': 'WeChat',
      'preset.note': 'Note',
      'preset.warm': 'Warm',
      words: '{count} words',
      saving: 'Saving…',
      saved: 'Saved',
      unsaved: 'Unsaved changes',
      failed: 'Could not save',
      retry: 'Retry',
      conflict: 'The article changed in the conversation. Keep which version?',
      keepMine: 'Keep mine',
      keepTheirs: 'Use the new version',
      reset: 'New conversation',
      resetConfirm: 'Confirm?',
      summon: 'Ask {name}',
      send: 'Send',
      stop: 'Stop',
      close: 'Close',
      more: 'More',
      compose: 'Ask {name}: continue the draft, tighten this paragraph, restyle the page…',
      discuss: 'Discuss with {name}',
      changeBanner: '{name} edited this article: struck-through text was removed, highlighted text is new.',
      conflictShort: 'Conflict',
      emptyHint: 'Press {key} in the body to call {name}.',
      acceptChange: 'Keep',
      undoChange: 'Undo',
      historyCount: 'History {count}',
      collapse: 'Collapse',
      questionPending: 'The partner is waiting for an answer. Stop this turn or reply here; the bar cannot open the question dialog.',
      fallbackName: 'Writing assistant',
      identityPick: 'Writing partner',
      followIdentity: 'Follow the identity selected in 身份',
      noIdentities: 'No identity yet — create one under 身份.',
      versions: 'Version history',
      versionsEmpty: 'No versions yet. The next autosave writes one.',
      restore: 'Restore',
      working: 'Working…',
      polishAction: 'Polish selection',
      polishPrompt: 'Polish only the selected passage. Preserve its meaning and edit the draft directly for review.',
      draftAction: 'Draft an opening',
      draftPrompt: 'Use the title to write a short opening directly in the draft for review. If the topic is unclear, ask me first.',
      continueAction: 'Continue draft',
      continuePrompt: 'Continue in the existing style and add the new passage directly to the draft for review.',
      sendAfterSave: 'Save your latest edits before sending.',
      sending: 'Sending…',
      review: 'Review edits',
      priorChange: 'Previous change',
      nextChange: 'Next change',
      changePosition: '{current} of {total}',
      changeTotal: '{total} change(s)',
      reviewUpdated: 'New edits arrived. Review them before keeping or undoing them.',
      ready: 'Ready',
      insert: 'Insert at caret',
      replace: 'Replace selection',
      selection: '{count} characters selected',
      newChat: 'New conversation',
      approval: 'The session is waiting for a tool approval. Approve it in that chat session, or give the writing Session a full-access preset.',
      error: 'Something went wrong',
      openFailed: 'Could not open the article',
      finishDraft: 'This draft changed while loading. Save it before switching articles.',
      'shortcut': 'Ctrl/⌘+K',
    }

    const ZH = {
      panel: '文章',
      back: '返回对话',
      newArticle: '新建文章',
      untitled: '未命名文章',
      search: '搜索文章',
      clearSearch: '清空搜索',
      docNav: '文档导航',
      outline: '大纲',
      outlineEmpty: '在正文里写「# 标题」或「## 小节」，这里会自动生成目录。',
      outlineTop: '回到文首',
      outlineItem: '{name}，{level} 级标题',
      navToggle: '导航',
      navBack: '返回正文',
      articleList: '文章列表',
      chooseArticle: '从列表打开一篇文章',
      loadingArticles: '正在加载文章…',
      openingArticle: '正在打开文章…',
      creatingArticle: '正在新建文章…',
      bodyLabel: '文章正文',
      noMatches: '没有匹配的文章',
      justNow: '刚刚',
      minutesAgo: '{n} 分钟前',
      hoursAgo: '{n} 小时前',
      yesterday: '昨天',
      noArticles: '还没有文章',
      noArticlesHint: '新建一篇就能开始写；所有改动都会自动保存在这个 profile 里。',
      createFirst: '新建第一篇',
      emptyDocument: '从这里开始写…',
      delete: '删除',
      deleteTitle: '删除《{title}》？',
      deleteBody: '文章和它的对话记录都会删除，无法撤回。',
      cancel: '取消',
      confirmDelete: '删除',
      insertImage: '插图',
      imageHelp: '选择图片、粘贴截图，或把图片拖进正文。',
      dropImage: '松开鼠标，在这里插图',
      imageUploading: '正在上传 {current} / {total}…',
      imageAdded: '已插入 {count} 张图片。',
      imageSize: '单张图片不能超过 8 MiB。',
      imageType: '请选择 PNG、JPEG、WebP 或 GIF 图片。',
      imageBatch: '一次最多可插入 8 张图片。',
      imageError: '图片上传失败，正文未改动。',
      imageMissing: '图片无法加载',
      imageMoved: '图片已上传，原插入位置已变更。',
      imagePlace: '插入当前光标处',
      imageEditFirst: '回到编辑状态后可插入图片。',
      imageUndo: '撤销插图',
      imagePreview: '预览图片',
      pastedImage: '粘贴的图片',
      style: '样式',
      preview: '预览',
      edit: '编辑',
      font: '字体',
      'font.serif': '宋体',
      'font.sans': '黑体',
      'font.kai': '楷体',
      'font.mono': '等宽',
      size: '字号',
      lineHeight: '行高',
      paragraphGap: '段距',
      paragraphGapNote: '仅预览',
      width: '行宽',
      align: '对齐',
      'align.left': '左对齐',
      'align.center': '居中',
      'align.justify': '两端对齐',
      indent: '首行缩进',
      theme: '底色',
      'theme.paper': '纸白',
      'theme.sepia': '米黄',
      'theme.dark': '墨黑',
      preset: '配方',
      'preset.essay': '文章体',
      'preset.blog': '博客体',
      'preset.wechat': '公众号',
      'preset.note': '笔记体',
      'preset.warm': '暖纸',
      words: '{count} 字',
      saving: '保存中…',
      saved: '已保存',
      unsaved: '有未保存的改动',
      failed: '保存失败',
      retry: '重试',
      conflict: '对话里改动了这篇文章，保留哪一版？',
      keepMine: '保留我的',
      keepTheirs: '采用新版本',
      reset: '新会话',
      resetConfirm: '确定？',
      summon: '找{name}协作',
      send: '发送',
      stop: '停止',
      close: '关闭',
      more: '更多',
      compose: '吩咐{name}：接着写、把这段改紧、换个排版……',
      discuss: '和{name}讨论',
      changeBanner: '{name} 改了这篇文章：删除线是被删的原句，高亮是新写的内容。',
      conflictShort: '有冲突',
      emptyHint: '在正文里按 {key} 可以随时呼出{name}。',
      acceptChange: '采纳',
      undoChange: '撤销',
      historyCount: '历史 {count}',
      collapse: '收起',
      questionPending: '它在等你回答（弹层无法打开问答对话框）。可以点停止，或直接在这里补一句。',
      fallbackName: '写作助手',
      identityPick: '写作搭档',
      followIdentity: '跟随「身份」当前选择',
      noIdentities: '还没有身份，去左侧「身份」建一个。',
      versions: '版本历史',
      versionsEmpty: '还没有版本记录，下一次自动保存会生成第一条。',
      restore: '恢复',
      working: '正在处理…',
      polishAction: '润色选段',
      polishPrompt: '只润色选中的这段，保留原意。请直接修改正文，让我审阅改动。',
      draftAction: '写个开头',
      draftPrompt: '根据标题直接在正文写一小段开头，供我审阅。如果主题不明确，请先在回复里问我。',
      continueAction: '续写正文',
      continuePrompt: '沿用当前文风接着写，直接把续写段落加到正文里，供我审阅。',
      sendAfterSave: '草稿还没保存。请解决保存问题后再发送，搭档才能读到最新正文。',
      sending: '发送中…',
      review: '审阅改动',
      priorChange: '上一处改动',
      nextChange: '下一处改动',
      changePosition: '{current} / {total} 处',
      changeTotal: '共 {total} 处',
      reviewUpdated: '又收到新的改动，请先看一眼，再决定采纳或撤销。',
      ready: '就绪',
      insert: '插入光标处',
      replace: '替换选区',
      selection: '已选中 {count} 字',
      newChat: '新会话',
      approval: '这个会话正在等待工具批准。请到对应会话里批准，或给写作会话使用完全权限预设。',
      error: '出错了',
      openFailed: '打不开这篇文章',
      finishDraft: '加载时当前草稿又有改动。请先保存，再切换文章。',
      'shortcut': 'Ctrl/⌘+K',
    }

    // ── small helpers ──────────────────────────────────────────────────────

    const MESSAGES = { en: EN, zh: ZH }

    /** Fill `{name}` placeholders in one dictionary string. */
    function interpolate(text, vars) {
      if (typeof text !== 'string') return ''
      return text.replace(/\{(\w+)\}/g, (match, key) => (vars[key] === undefined ? match : String(vars[key])))
    }

    /** Describe a thrown value as one readable line. */
    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /** Same counting rule as the Host: CJK characters plus Latin word runs. */
    function charCount(text) {
      const value = typeof text === 'string' ? text.replace(ALL_IMAGE_MARKDOWN, ' ') : ''
      const cjk = value.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ?? 0
      const latin = value.match(/[A-Za-z0-9]+/gu)?.length ?? 0
      return cjk + latin
    }

    /** POST one JSON payload to a Host route; always resolve to the parsed body. */
    async function post(path, payload) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const data = await response.json().catch(() => ({}))
      if (data === null || typeof data !== 'object') return { status: response.status, data: { ok: false, message: `HTTP ${response.status}` } }
      return { status: response.status, data }
    }

    /** CSS font stacks for the four offered families. */
    const FONT_STACKS = {
      serif: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif',
      sans: '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", -apple-system, "Segoe UI", sans-serif',
      kai: '"Kaiti SC", "KaiTi", "STKaiti", "Noto Serif CJK SC", serif',
      mono: '"Sarasa Mono SC", "JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    }

    /** Canvas palettes. These are document colors, like a page or a slide. */
    const THEMES = {
      paper: { bg: '#fffdf9', fg: '#1f2328', muted: '#6b727f', border: '#e7e2d8', shadow: '0 10px 30px rgba(24, 26, 32, 0.10)', quote: '#f2efe8', code: '#f4f1ea', link: '#2f5fd0' },
      sepia: { bg: '#f6ecd9', fg: '#3b3226', muted: '#7b6a52', border: '#e3d4ba', shadow: '0 10px 30px rgba(74, 56, 28, 0.14)', quote: '#efe2cb', code: '#efe2cb', link: '#7a4f12' },
      dark: { bg: '#1b1c20', fg: '#e6e6ea', muted: '#a1a3ad', border: '#2c2e35', shadow: '0 10px 30px rgba(0, 0, 0, 0.45)', quote: '#24262c', code: '#24262c', link: '#9db8ff' },
    }

    /** Typography shared by the writing view and the reading view. */
    function typeStyle(style) {
      return {
        fontFamily: FONT_STACKS[style.font] ?? FONT_STACKS.serif,
        fontSize: `${style.fontSize}px`,
        lineHeight: String(style.lineHeight),
        textAlign: style.align === 'center' ? 'center' : style.align === 'justify' ? 'justify' : 'left',
        '--as-column': `${style.width}px`,
      }
    }

    /**
     * The editing canvas follows the shell: neutral background, theme text
     * colors, and the article's typography. The article's own paper colors are
     * a reading mode decision, so they arrive with {@link paperStyle}.
     */
    function editCanvasStyle(style) {
      return {
        ...typeStyle(style),
        '--as-page-bg': 'var(--dsw-alias-bg-base)',
        '--as-page-fg': 'var(--dsw-alias-label-primary)',
        '--as-page-muted': 'var(--dsw-alias-label-secondary)',
        '--as-page-border': 'var(--dsw-alias-border-l1)',
        '--as-page-quote': 'var(--dsw-alias-bg-layer-1)',
        '--as-page-code': 'var(--dsw-alias-bg-layer-1)',
        '--as-link': 'var(--dsw-alias-brand-primary)',
      }
    }

    /** The article's real page colors, shown in the reading view. */
    function paperStyle(style) {
      const theme = THEMES[style.theme] ?? THEMES.paper
      return {
        ...typeStyle(style),
        '--as-page-bg': theme.bg,
        '--as-page-fg': theme.fg,
        '--as-page-muted': theme.muted,
        '--as-page-border': theme.border,
        '--as-page-shadow': theme.shadow,
        '--as-page-quote': theme.quote,
        '--as-page-code': theme.code,
        '--as-link': theme.link,
        ...(style.indent ? { '--as-indent': '2em' } : {}),
      }
    }

    // ── icons ──────────────────────────────────────────────────────────────

    /** One small stroke icon drawn inline; no icon package is imported. */
    function Icon({ name, size = 14 }) {
      const paths = {
        back: ['M10 3 L5 8 L10 13'],
        plus: ['M8 3 V13', 'M3 8 H13'],
        sliders: ['M3 5 H13', 'M3 11 H13'],
        clock: ['M8 2.6 A5.4 5.4 0 1 1 7.9 2.6 Z', 'M8 5 V8.2 L10.2 9.6'],
        trash: ['M3 4.8 H13', 'M6.2 4.8 V3.2 H9.8 V4.8', 'M4.8 4.8 L5.6 13 H10.4 L11.2 4.8'],
        list: ['M3 4.5 H13', 'M3 8 H13', 'M3 11.5 H13'],
        outline: ['M3 3.5 H13', 'M6 6.5 H13', 'M6 9.5 H13', 'M3 12.5 H13'],
        picture: ['M2.5 3.2 H13.5 V12.8 H2.5 Z', 'M3 11 L6.3 7.8 L8.7 10.2 L10.2 8.7 L13.5 12'],
        doc: ['M4 2.2 H9.2 L12 5 V13.8 H4 Z', 'M9.2 2.2 V5 H12', 'M6 8 H10', 'M6 10.6 H10'],
        search: ['M7.2 12.4 A5.2 5.2 0 1 0 7.2 2 A5.2 5.2 0 0 0 7.2 12.4 Z', 'M11.2 11.2 L14 14'],
      }
      const dots = {
        sliders: [[6, 5], [10.4, 11]],
        picture: [[10.5, 6.2]],
      }
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        ...(paths[name] ?? []).map((d, index) => h('path', { key: `p${index}`, d })),
        ...(dots[name] ?? []).map(([cx, cy], index) => h('circle', { key: `c${index}`, cx, cy, r: 1.35, fill: 'currentColor', stroke: 'none' })),
      )
    }

    /** One anchored popup menu portaled above the page, closed by its backdrop. */
    function Menu(props) {
      const rect = props.rect
      const viewportWidth = window.innerWidth
      const width = Math.min(props.width ?? 220, viewportWidth - 24)
      const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
      const left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12))
      const aboveSpace = rect.top - 18
      const belowSpace = viewportHeight - rect.bottom - 18
      const below = belowSpace >= 320 || belowSpace >= aboveSpace
      const maxHeight = Math.max(32, Math.min(420, below ? belowSpace : aboveSpace))
      const position = below
        ? { left, top: rect.bottom + 6, width, maxHeight }
        : { left, bottom: viewportHeight - rect.top + 6, width, maxHeight }
      const menuRef = React.useRef(null)
      React.useEffect(() => {
        const previous = document.activeElement
        const menu = menuRef.current
        const firstControl = menu?.querySelector('button, select, input') ?? menu
        firstControl?.focus({ preventScroll: true })
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            props.onClose()
          }
        }
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('keydown', onKey)
          if ((document.activeElement === document.body || menu?.contains(document.activeElement)) && previous?.isConnected) previous.focus({ preventScroll: true })
        }
      }, [])
      return ReactDOM.createPortal(
        [
          h('div', { key: 'backdrop', className: 'as-menu-backdrop', onClick: props.onClose }),
          h('div', { key: 'menu', ref: menuRef, tabIndex: -1, className: 'as-menu', style: position, role: 'dialog', 'aria-label': props.label }, props.children),
        ],
        document.body,
      )
    }

    /** Human time for an article row: just now, minutes, hours, yesterday, date. */
    function relativeTime(iso, tr) {
      const time = Date.parse(iso)
      if (!Number.isFinite(time)) return ''
      const delta = Date.now() - time
      if (delta < 60_000) return tr('justNow')
      if (delta < 3_600_000) return tr('minutesAgo', { n: Math.max(1, Math.floor(delta / 60_000)) })
      if (delta < 86_400_000) return tr('hoursAgo', { n: Math.floor(delta / 3_600_000) })
      if (delta < 172_800_000) return tr('yesterday')
      return new Date(time).toLocaleDateString()
    }

    // ── Article images and Markdown preview ─────────────────────────────────

    const IMAGE_LIMIT = 8 * 1024 * 1024
    const IMAGE_KEY = /^[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/u
    const IMAGE_MARKDOWN = /!\[((?:\\[^\r\n]|[^\\\]\r\n])*)\]\(media\/([a-f0-9]{64}\.(?:png|jpg|gif|webp))\)/u
    const ALL_IMAGE_MARKDOWN = new RegExp(IMAGE_MARKDOWN.source, 'gu')
    const INLINE_TEXT = /`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\)/u

    function parseImage(token) {
      const match = IMAGE_MARKDOWN.exec(token)
      if (!match || match[0] !== token) return null
      return { alt: match[1].replace(/\\([^\r\n])/gu, '$1'), key: match[2] }
    }

    function imageBlock(images, text, offset) {
      const alt = (value) => value.replace(/[\x00-\x1f\x7f]/gu, ' ').replace(/[\\[\]]/gu, '\\$&')
      const before = text.slice(0, offset)
      const after = text.slice(offset)
      // Standalone Markdown blocks, without adding blank lines already present.
      const gap = (value, edge) => value === '' || (edge === 'end' ? /\n\n$/u : /^\n\n/u).test(value)
        ? '' : (edge === 'end' ? /\n$/u : /^\n/u).test(value) ? '\n' : '\n\n'
      return gap(before, 'end') + images.map((image) => `![${alt(image.alt)}](media/${image.key})`).join('\n\n') + (after ? gap(after, 'start') : '\n\n')
    }

    /**
     * True when a pending image upload belongs to the article on screen.
     * Comparing both ids directly is wrong when neither exists: the article may
     * not have loaded yet and no upload may be running, so `undefined ===
     * undefined` would claim a match and the cleanup would touch a null upload.
     */
    function uploadBelongsTo(upload, articleId) {
      return upload !== null && upload !== undefined && upload.id === articleId
    }

    function PreviewImage({ image, tr, block = false }) {
      const [failed, setFailed] = React.useState(false)
      const content = failed
        ? h('span', { className: 'as-image-missing', role: 'img', 'aria-label': [tr('imageMissing'), image.alt].filter(Boolean).join(': ') },
            tr('imageMissing'), image.alt ? ` · ${image.alt}` : '')
        : h('img', { className: 'as-preview-image', src: `${API}image?key=${image.key}`, alt: image.alt,
            loading: 'lazy', decoding: 'async', onError: () => setFailed(true) })
      return block ? h('figure', { className: 'as-image-figure' }, content) : content
    }

    /** Split one line into inline nodes: code, strong, emphasis, links. */
    function inlineNodes(text, keyPrefix, tr) {
      const pattern = new RegExp(`${IMAGE_MARKDOWN.source}|${INLINE_TEXT.source}`, 'gu')
      const nodes = []
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        const key = `${keyPrefix}-${index++}`
        const image = parseImage(token)
        if (image) nodes.push(h(PreviewImage, { key: `${key}-${image.key}`, image, tr }))
        else if (token.startsWith('`')) nodes.push(h('code', { key, className: 'as-inline-code' }, token.slice(1, -1)))
        else if (token.startsWith('**') || token.startsWith('__')) nodes.push(h('strong', { key }, token.slice(2, -2)))
        else if (token.startsWith('[')) {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
          if (link === null) nodes.push(token)
          else nodes.push(h('a', { key, href: link[2], target: '_blank', rel: 'noreferrer noopener' }, link[1]))
        } else nodes.push(h('em', { key }, token.slice(1, -1)))
        last = match.index + token.length
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u
    const RULE = /^\s*(?:---|\*\*\*|___)\s*$/u
    const QUOTE = /^\s*>/u
    const BULLET = /^\s*[-*+]\s+/u
    const NUMBERED = /^\s*\d+[.)]\s+/u
    const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/u
    const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/u

    function blockBoundary(line) {
      return line.trim() === '' || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || NUMBERED.test(line) || parseImage(line.trim()) !== null
    }

    function headingLabel(text) {
      const label = text.replace(new RegExp(`${IMAGE_MARKDOWN.source}|${INLINE_TEXT.source}`, 'gu'), (token) => {
        const image = parseImage(token)
        if (image) return image.alt
        if (token[0] === '[') return token.slice(1, token.indexOf(']'))
        const edge = token.startsWith('**') || token.startsWith('__') ? 2 : 1
        return token.slice(edge, -edge)
      }).replace(/\s+/gu, ' ').trim()
      return label || text
    }

    /** Record UTF-16 offsets in the original draft, including CRLF line endings. */
    function markdownStructure(source) {
      const lines = []
      const offsets = []
      let next = 0
      for (const newline of source.matchAll(/\r\n|\r|\n/gu)) {
        offsets.push(next)
        lines.push(source.slice(next, newline.index))
        next = newline.index + newline[0].length
      }
      offsets.push(next)
      lines.push(source.slice(next))
      const headings = []
      const byLine = new Map()
      const fences = new Map()
      const parents = []
      let paragraph = false
      for (let line = 0; line < lines.length; line += 1) {
        const value = lines[line]
        const fence = FENCE.exec(value)
        if (fence && (fence[1][0] === '~' || !fence[2].includes('`'))) {
          let end = line + 1
          const closes = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`, 'u')
          while (end < lines.length && !closes.test(lines[end])) end += 1
          fences.set(line, { end, language: fence[2].trim() })
          line = end
          paragraph = false
          continue
        }
        const atx = ATX.exec(value)
        const setext = !atx && !paragraph && !blockBoundary(value) && !/^(?: {4}|\t)/u.test(value) ? SETEXT.exec(lines[line + 1] ?? '') : null
        if (!atx && !setext) {
          paragraph = !blockBoundary(value)
          continue
        }
        const text = atx ? (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/u, '').trim() : value.trim()
        if (text) {
          const level = atx ? atx[1].length : setext[1][0] === '=' ? 1 : 2
          while (parents.length && parents[parents.length - 1] >= level) parents.pop()
          const entry = { offset: offsets[line], level, depth: parents.length, text, label: headingLabel(text), length: setext ? 2 : 1 }
          headings.push(entry)
          byLine.set(line, entry)
          parents.push(level)
        }
        if (setext) line += 1
        paragraph = false
      }
      return { lines, headings, byLine, fences }
    }

    /** Render the Markdown body using the same headings and fences as the outline. */
    function renderMarkdown(structure, tr) {
      const { lines, byLine, fences } = structure
      const blocks = []
      let index = 0
      let key = 0
      while (index < lines.length) {
        const line = lines[index]
        if (/^\s*$/.test(line)) {
          index += 1
          continue
        }
        const fence = fences.get(index)
        if (fence) {
          const body = lines.slice(index + 1, fence.end).join('\n')
          blocks.push(h('pre', { key: `b${key++}`, className: 'as-prose-code' }, h('code', { 'data-lang': fence.language || undefined }, body)))
          index = fence.end + 1
          continue
        }
        const image = parseImage(line.trim())
        if (image) {
          blocks.push(h(PreviewImage, { key: `b${key++}-${image.key}`, image, tr, block: true }))
          index += 1
          continue
        }
        const heading = byLine.get(index)
        if (heading) {
          blocks.push(h(`h${heading.level}`, { key: `b${key++}`, className: 'as-prose-heading', 'data-heading-offset': heading.offset }, inlineNodes(heading.text, `h${key}`, tr)))
          index += heading.length
          continue
        }
        if (RULE.test(line)) {
          blocks.push(h('hr', { key: `b${key++}`, className: 'as-prose-rule' }))
          index += 1
          continue
        }
        if (QUOTE.test(line)) {
          const quote = []
          while (index < lines.length && QUOTE.test(lines[index])) {
            quote.push(lines[index].replace(/^\s*>\s?/u, ''))
            index += 1
          }
          blocks.push(h('blockquote', { key: `b${key++}`, className: 'as-prose-quote' }, h('p', null, inlineNodes(quote.join(' '), `q${key}`, tr))))
          continue
        }
        if (BULLET.test(line)) {
          const items = []
          while (index < lines.length && BULLET.test(lines[index])) {
            items.push(h('li', { key: `l${key++}` }, inlineNodes(lines[index].replace(/^\s*[-*+]\s+/u, ''), `li${key}`, tr)))
            index += 1
          }
          blocks.push(h('ul', { key: `b${key++}`, className: 'as-prose-list' }, items))
          continue
        }
        if (NUMBERED.test(line)) {
          const items = []
          while (index < lines.length && NUMBERED.test(lines[index])) {
            items.push(h('li', { key: `l${key++}` }, inlineNodes(lines[index].replace(/^\s*\d+[.)]\s+/u, ''), `li${key}`, tr)))
            index += 1
          }
          blocks.push(h('ol', { key: `b${key++}`, className: 'as-prose-list' }, items))
          continue
        }
        const paragraph = []
        while (index < lines.length && !byLine.has(index) && !fences.has(index) && !blockBoundary(lines[index])) {
          paragraph.push(lines[index])
          index += 1
        }
        if (paragraph.length === 0) {
          index += 1
          continue
        }
        blocks.push(h('p', { key: `b${key++}`, className: 'as-prose-para' }, inlineNodes(paragraph.join('\n'), `p${key}`, tr)))
      }
      return blocks
    }

    // ── review diff ────────────────────────────────────────────────────────

    /** Split text into diff tokens: one CJK character, a Latin word, a whitespace run, or a symbol. */
    function tokenizeText(source) {
      return String(source ?? '').match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[A-Za-z0-9_]+|\s+|[^\s]/gu) ?? []
    }

    /**
     * Diff two texts into equal / del / ins segments so the canvas can show
     * what an Agent edit removed and added. Prefix and suffix are trimmed
     * first; a huge middle falls back to one deletion plus one insertion.
     */
    function diffSegments(before, after) {
      const left = tokenizeText(before)
      const right = tokenizeText(after)
      let start = 0
      while (start < left.length && start < right.length && left[start] === right[start]) start += 1
      let endLeft = left.length
      let endRight = right.length
      while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
        endLeft -= 1
        endRight -= 1
      }
      const a = left.slice(start, endLeft)
      const b = right.slice(start, endRight)
      const segments = []
      const push = (op, text) => {
        if (text === '') return
        const last = segments[segments.length - 1]
        if (last !== undefined && last.op === op) last.text += text
        else segments.push({ op, text })
      }
      push('equal', left.slice(0, start).join(''))
      if (a.length * b.length > 1_200_000) {
        push('del', a.join(''))
        push('ins', b.join(''))
      } else {
        const n = a.length
        const m = b.length
        const width = m + 1
        const table = new Uint32Array((n + 1) * width)
        for (let i = n - 1; i >= 0; i -= 1) {
          for (let j = m - 1; j >= 0; j -= 1) {
            table[i * width + j] = a[i] === b[j]
              ? table[(i + 1) * width + j + 1] + 1
              : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
          }
        }
        let i = 0
        let j = 0
        while (i < n && j < m) {
          if (a[i] === b[j]) {
            push('equal', a[i])
            i += 1
            j += 1
          } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
            push('del', a[i])
            i += 1
          } else {
            push('ins', b[j])
            j += 1
          }
        }
        while (i < n) {
          push('del', a[i])
          i += 1
        }
        while (j < m) {
          push('ins', b[j])
          j += 1
        }
      }
      push('equal', left.slice(endLeft).join(''))
      return segments
    }

    /** A replacement (adjacent deletion and insertion) is a single stop. */
    function reviewGroups(segments) {
      const groups = []
      for (const segment of segments) {
        const last = groups[groups.length - 1]
        if (segment.op === 'equal') groups.push({ text: segment.text })
        else if (last?.edits) last.edits.push(segment)
        else groups.push({ edits: [segment] })
      }
      return groups
    }

    /** Count changed characters on each side. */
    function diffStatsOf(segments) {
      let added = 0
      let removed = 0
      for (const segment of segments ?? []) {
        if (segment.op === 'ins') added += segment.text.length
        else if (segment.op === 'del') removed += segment.text.length
      }
      return { added, removed }
    }

    // ── caret helpers ──────────────────────────────────────────────────────

    /** Text offset of one boundary point inside a root element. */
    function offsetOf(root, node, offset) {
      const range = document.createRange()
      range.selectNodeContents(root)
      try {
        range.setEnd(node, offset)
      } catch {
        return null
      }
      return range.toString().length
    }

    /** Place a collapsed caret at one character offset inside a root element. */
    function caretAtOffset(root, offset) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
      let remaining = Math.max(0, offset)
      let node = walker.nextNode()
      while (node !== null) {
        const length = node.nodeValue?.length ?? 0
        if (remaining <= length) {
          const range = document.createRange()
          range.setStart(node, remaining)
          range.collapse(true)
          return range
        }
        remaining -= length
        node = walker.nextNode()
      }
      const range = document.createRange()
      range.selectNodeContents(root)
      range.collapse(false)
      return range
    }

    // Map source offsets without rewriting the editor or changing selection.
    // Review's deleted characters are visible but do not belong to the current source.
    function headingPositions(scroll, headings, preview) {
      if (preview) {
        const anchors = new Map(Array.from(scroll.querySelectorAll('[data-heading-offset]'), (node) => [Number(node.dataset.headingOffset), node]))
        return (index) => anchors.get(headings[index].offset)?.getBoundingClientRect().top
      }
      const editor = scroll.querySelector('.as-text, .as-diff')
      if (!editor) return () => undefined
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      const positions = []
      let index = 0
      let offset = 0
      for (let node = walker.nextNode(); node && index < headings.length; node = walker.nextNode()) {
        if (node.parentElement?.closest('del')) continue
        const end = offset + node.length
        while (index < headings.length && headings[index].offset < end) {
          positions[index] = { node, offset: headings[index].offset - offset }
          index += 1
        }
        offset = end
      }
      return (index) => {
        const anchor = positions[index]
        if (!anchor || !anchor.node.isConnected || anchor.offset >= anchor.node.length) return undefined
        const range = document.createRange()
        range.setStart(anchor.node, anchor.offset)
        const first = anchor.node.data.codePointAt(anchor.offset)
        range.setEnd(anchor.node, Math.min(anchor.node.length, anchor.offset + (first > 0xffff ? 2 : 1)))
        return range.getClientRects()[0]?.top
      }
    }

    /** Pick the last heading that passed the reading line, in document order. */
    function headingAt(headings, topAt, readingLine) {
      let start = 0
      let end = headings.length
      while (start < end) {
        const mid = (start + end) >>> 1
        const top = topAt(mid)
        if (top === undefined || top > readingLine) end = mid
        else start = mid + 1
      }
      return headings[start - 1]?.offset ?? null
    }

    /** Capture the caret, the selected text, and the surrounding text. */
    function captureCaret(editor) {
      const selection = window.getSelection()
      if (editor === null || selection === null || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
      if (!editor.contains(range.commonAncestorContainer)) return null
      const selected = selection.toString()
      let before = ''
      let after = ''
      const beforeRange = range.cloneRange()
      beforeRange.selectNodeContents(editor)
      try {
        beforeRange.setEnd(range.startContainer, range.startOffset)
        before = beforeRange.toString()
      } catch {
        before = ''
      }
      const afterRange = range.cloneRange()
      afterRange.selectNodeContents(editor)
      try {
        afterRange.setStart(range.endContainer, range.endOffset)
        after = afterRange.toString()
      } catch {
        after = ''
      }
      const rect = range.getBoundingClientRect()
      const editorRect = editor.getBoundingClientRect()
      const usable = rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0
        ? editorRect
        : rect
      return {
        range: range.cloneRange(),
        selected,
        before,
        after,
        rect: usable,
      }
    }

    /** Whether one text field is a note from the host (not a tool). */
    function isNotice(entry) {
      return entry.role === 'tool' && (entry.tool === 'error' || entry.tool === 'notice')
    }

    // ── stylesheet ─────────────────────────────────────────────────────────

    const STYLE = String.raw`
.as-panel{container-type:inline-size;position:relative;display:flex;flex-direction:column;flex:1;height:100%;min-width:0;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.as-head{display:flex;align-items:center;gap:8px;padding:10px 14px 10px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);min-height:46px}
.as-head h1{margin:0;font-size:13px;font-weight:600;letter-spacing:.01em}
.as-head .as-back{padding:5px}
.as-count{font-size:10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:1px 7px;line-height:1.5}
.as-head .as-spacer{flex:1}
.as-body{flex:1;display:flex;min-height:0}
.as-side{width:248px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base)}
.as-side-head{padding:3px 10px 8px;display:flex;align-items:center;gap:6px}
.as-nav-switch{display:flex;gap:4px;padding:10px 10px 8px}
.as-nav-switch button,.as-outline button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.as-nav-switch button{display:flex;justify-content:center;align-items:center;gap:6px;flex:1;min-width:0;min-height:32px;padding:4px 6px;border-radius:8px;font-size:12px}
.as-nav-switch button:disabled{opacity:.5;cursor:default}
.as-nav-switch button:hover:not(:disabled),.as-outline-entry:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent)}
.as-nav-switch button[aria-pressed="true"],.as-outline .as-outline-doc,.as-outline .as-outline-entry[aria-current="location"]{color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent);font-weight:600}
.as-nav-switch button:focus-visible,.as-outline button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.as-rail-pane,.as-outline{display:flex;flex:1;flex-direction:column;min-height:0}
.as-rail-pane[hidden]{display:none}
.as-outline{padding:3px 10px 8px;gap:9px}
.as-outline-doc,.as-outline-entry{display:flex;align-items:center;text-align:start;min-width:0;width:100%;gap:9px}
.as-outline .as-outline-doc{flex:none;min-height:38px;padding:8px 12px;border-radius:999px}
.as-outline-doc svg{flex:none}
.as-outline-doc span,.as-outline-entry span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-outline-list{list-style:none;overflow:auto;min-height:0;overscroll-behavior:contain;padding:0 0 8px 9px;margin:0 0 0 13px;border-inline-start:1px solid var(--dsw-alias-border-l2)}
.as-outline .as-outline-entry{min-height:32px;padding:5px 7px;padding-inline-start:calc(7px + var(--as-outline-depth,0)*10px);border-radius:7px;font-size:12.5px}
.as-outline-empty{padding:4px 11px;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.as-search{flex:1;min-width:0;display:flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);color:var(--dsw-alias-label-secondary)}
.as-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:12.5px}
.as-list{flex:1;overflow:auto;padding:0 8px 12px;display:flex;flex-direction:column;gap:2px;min-height:0}
.as-row{transition:background-color .14s ease;display:flex;align-items:center;gap:3px;padding:0 5px 0 0;border-radius:9px;flex:none}
.as-row:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent)}
.as-row-main:focus-visible,.as-row-del:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.as-btn:focus-visible,.as-iconbtn:focus-visible,.as-seg-btn:focus-visible,.as-idchip:focus-visible,.as-send:focus-visible,.as-btn-summon:focus-visible,.as-menu-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.as-row[data-active="true"]{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)}
.as-row-main{flex:1;min-width:0;display:flex;flex-direction:column;align-self:stretch;gap:4px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;text-align:left;padding:10px 8px 10px 11px;cursor:pointer}
.as-row-main>span{max-width:100%}
.as-row-title{font-size:13px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-row-preview{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.45}
.as-row-meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:8px;overflow:hidden;white-space:nowrap}
.as-row-meta span{overflow:hidden;text-overflow:ellipsis}
.as-search:focus-within{border-color:var(--dsw-alias-brand-primary)}
.as-side-head .as-iconbtn{padding:0 4px;min-height:22px}
.as-row-del{opacity:.55;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:6px;display:grid;place-items:center;width:30px;height:32px;flex:none}
.as-row:hover .as-row-del,.as-row:focus-within .as-row-del{opacity:1}
.as-btn-danger:hover{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)}
.as-new-btn{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent)}
.as-new-btn:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)}
.as-row-del:hover{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}
.as-empty-side{padding:22px 16px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.6}
.as-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.as-toolbar{display:flex;align-items:center;gap:7px;padding:9px 18px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l2)}
.as-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)}
.as-seg-btn{transition:background-color .14s ease,color .14s ease;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;padding:2px 10px;border-radius:6px;cursor:pointer}
.as-seg-btn[data-active="true"]{background:color-mix(in srgb, var(--dsw-alias-label-primary) 13%, transparent);color:var(--dsw-alias-label-primary)}
.as-div{width:1px;height:16px;background:var(--dsw-alias-border-l1);margin:0 2px}
.as-btn-compact{padding:4px 9px;font-size:11.5px;gap:5px}
.as-icononly{padding:4px 6px}
.as-head .as-listtoggle{display:none}
.as-toolbar .as-gap{flex:1}
.as-btn{transition:background-color .14s ease,border-color .14s ease,color .14s ease;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer}
.as-btn:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)}
.as-btn[data-tone="primary"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}
.as-btn[data-tone="primary"]:hover{filter:brightness(1.05)}
.as-btn:disabled{opacity:.5;cursor:default}
.as-btn-ghost{border-color:transparent;background:transparent}
.as-btn-summon{display:inline-flex;align-items:center;gap:7px;padding:4px 11px 4px 6px;border-radius:999px;border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;cursor:pointer}
.as-btn-summon:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)}
.as-btn-summon kbd{font-family:inherit;font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-bottom-width:2px;border-radius:5px;padding:0 5px;background:var(--dsw-alias-bg-base)}
.as-btn-ghost:hover{background:var(--dsw-alias-bg-layer-1)}
.as-save{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.as-save::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);opacity:.55;flex:none}
.as-save[data-state="saved"]::before{background:var(--dsw-alias-state-success-primary);opacity:1}
.as-save[data-state="saving"]::before,.as-save[data-state="unsaved"]::before{background:var(--dsw-alias-state-warn-primary);opacity:1}
.as-save[data-state="error"]::before,.as-save[data-state="conflict"]::before{background:var(--dsw-alias-state-error-primary);opacity:1}
.as-save[data-state="conflict"]{color:var(--dsw-alias-state-error-primary)}
.as-save[data-state="error"]{color:var(--dsw-alias-state-error-primary)}
.as-save[data-state="error"]{color:var(--dsw-alias-state-error-primary)}
.as-menu-backdrop{position:fixed;inset:0;z-index:93}
.as-menu{box-sizing:border-box;position:fixed;z-index:94;max-height:min(420px,calc(100vh - 40px));overflow:auto;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 18px 44px rgba(0,0,0,.32);padding:5px}
.as-menu-head{padding:5px 8px 6px;font-size:10px;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}
.as-menu-row{transition:background-color .14s ease;display:flex;align-items:center;gap:7px;width:100%;padding:6px 8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;text-align:left;cursor:pointer}
.as-menu-row:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)}
.as-menu-row[data-active="true"]{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)}
.as-menu-row .as-avatar{width:18px;height:18px;font-size:9px;border-radius:6px}
.as-menu-danger{color:var(--dsw-alias-state-error-primary)}
.as-menu-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-menu-role{font-size:10px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px}
.as-menu-mark{font-size:10px;color:var(--dsw-alias-brand-primary)}
.as-menu-empty{padding:14px 8px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.as-style-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;padding:4px 8px 8px}
.as-sfield{display:flex;flex-direction:column;gap:4px;font-size:10.5px;color:var(--dsw-alias-label-secondary);min-width:0}
.as-slabel{display:flex;align-items:center;gap:4px;overflow:hidden;white-space:nowrap}
.as-snote{opacity:.6}
.as-sfield select{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:7px;padding:3px 6px;font:inherit;font-size:11.5px;outline:0}
.as-srow{display:flex;align-items:center;gap:7px}
.as-srow input[type="range"]{flex:1;min-width:0;accent-color:var(--dsw-alias-brand-primary)}
.as-srow output{min-width:38px;text-align:right;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:10.5px}
.as-scheck{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary);padding-top:14px}
.as-scheck input{accent-color:var(--dsw-alias-brand-primary)}
.as-check{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.as-check input{accent-color:var(--dsw-alias-brand-primary)}
.as-scroll{flex:1;min-height:0;overflow:auto;padding:0;background:var(--as-page-bg);color:var(--as-page-fg)}
.as-page{width:100%;max-width:calc(var(--as-column, 760px) + 112px);margin:0 auto;padding:44px 56px 120px;box-sizing:border-box;min-height:100%}
.as-doc-title{display:block;width:100%;border:0;border-bottom:1px solid transparent;outline:0;background:transparent;color:inherit;font:inherit;font-size:1.72em;font-weight:650;line-height:1.3;letter-spacing:-.01em;margin:0 0 28px;padding:0 0 8px;transition:border-color .15s ease}
.as-doc-title-display{overflow-wrap:anywhere}
.as-doc-title:focus{border-bottom-color:var(--dsw-alias-border-l2)}
.as-doc-title::placeholder{color:var(--as-page-muted)}
.as-change-bar{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;padding:8px 18px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap}
.as-change-text{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-primary);min-width:0}
.as-review-actions{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.as-change-count{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.as-diff [data-review-active="true"]{outline:1px dashed var(--dsw-alias-brand-primary);outline-offset:3px;border-radius:3px;box-decoration-break:clone}
.as-diff{outline:0;white-space:pre-wrap;word-break:break-word;min-height:46vh}
.as-diff-del{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px;opacity:.9}
.as-diff-ins{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent);color:inherit;text-decoration:none;border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);border-radius:2px}
.as-text{outline:0;white-space:pre-wrap;word-break:break-word;min-height:46vh;caret-color:var(--as-page-fg)}
.as-text:empty::before{content:attr(data-placeholder);color:var(--as-page-muted);font-size:.85em;pointer-events:none}
.as-image-picker{min-height:32px}
.as-image-notice{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;padding:6px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px}
.as-image-notice[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}
.as-image-dismiss{margin-inline-start:auto}
.as-text[data-image-drag="true"]{position:relative;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, transparent);outline:1px dashed var(--dsw-alias-border-l2);outline-offset:6px;border-radius:5px}
.as-text[data-image-drag="true"]::after{content:attr(data-image-drop-hint);position:sticky;display:table;bottom:8px;margin:10px auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);padding:4px 10px;border-radius:8px;font:500 12px system-ui;pointer-events:none}
.as-scroll ::selection{background:var(--dsw-alias-bg-document-selection)}
.as-prose h1,.as-prose h2,.as-prose h3,.as-prose h4,.as-prose h5,.as-prose h6{margin:1.4em 0 .6em;line-height:1.35;font-weight:650}
.as-prose h1{font-size:1.6em;letter-spacing:-.01em}
.as-prose h2{font-size:1.34em}
.as-prose h3{font-size:1.16em}
.as-prose p{margin:0 0 var(--as-para-gap,12px);text-indent:var(--as-indent,0)}
.as-prose .as-prose-para:last-child{margin-bottom:0}
.as-image-figure{margin:1em 0;text-align:center}
.as-preview-image{display:inline-block;max-inline-size:100%;block-size:auto;border-radius:6px;vertical-align:middle}
.as-image-missing{display:inline-block;padding:6px 10px;color:var(--as-page-muted);border:1px solid var(--as-page-border);border-radius:6px;font-size:.8em;text-indent:0;overflow-wrap:anywhere}
.as-prose blockquote{margin:0 0 var(--as-para-gap,12px);padding:10px 16px;border-left:3px solid var(--as-page-border);background:var(--as-page-quote);border-radius:0 8px 8px 0;color:var(--as-page-muted)}
.as-prose blockquote p{margin:0;text-indent:0}
.as-prose ul,.as-prose ol{margin:0 0 var(--as-para-gap,12px);padding-left:1.6em}
.as-prose li{margin:.2em 0}
.as-prose hr{border:0;border-top:1px solid var(--as-page-border);margin:1.6em 0}
.as-prose .as-prose-code{background:var(--as-page-code);border:1px solid var(--as-page-border);border-radius:9px;padding:12px 14px;overflow:auto;font-family:${FONT_STACKS.mono};font-size:.86em;line-height:1.6}
.as-prose .as-inline-code{background:var(--as-page-code);border-radius:5px;padding:.08em .34em;font-family:${FONT_STACKS.mono};font-size:.88em}
.as-prose a{color:var(--as-link, var(--dsw-alias-brand-primary));text-decoration:none;border-bottom:1px solid color-mix(in srgb, var(--as-link, var(--dsw-alias-brand-primary)) 45%, transparent)}
.as-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;row-gap:6px;padding:9px 22px;border-top:1px solid var(--dsw-alias-border-l2);font-size:11.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base)}
.as-foot .as-gap{flex:1}
.as-running{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-brand-primary);font-size:11.5px}
.as-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:as-pulse 1.1s infinite ease-in-out}
@keyframes as-pulse{0%,100%{opacity:.25;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
.as-banner{display:flex;align-items:center;gap:10px;padding:9px 22px;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-primary);flex-wrap:wrap}
.as-banner[data-tone="error"]{background:rgba(209,67,67,.12)}
.as-error{display:flex;align-items:center;gap:12px;padding:8px 18px;color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}
.as-empty-main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:var(--dsw-alias-label-secondary);text-align:center;padding:32px}
.as-empty-icon{display:inline-flex;color:var(--dsw-alias-label-secondary);opacity:.5}
.as-empty-main h2{margin:0;font-size:16px;color:var(--dsw-alias-label-primary);font-weight:600}
.as-empty-main p{margin:0;max-width:360px;line-height:1.7;font-size:12.5px}
.as-empty-help{color:var(--dsw-alias-label-secondary);font-size:11.5px !important;opacity:.85}
.as-iconbtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:7px;padding:5px 7px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px}
.as-iconbtn:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);color:var(--dsw-alias-label-primary)}
.as-modal-backdrop{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1);display:flex;align-items:center;justify-content:center;z-index:80}
.as-modal{width:392px;max-width:calc(100vw - 32px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.35);padding:18px 20px}
.as-modal h3{margin:0 0 8px;font-size:14.5px;font-weight:600}
.as-modal p{margin:0 0 16px;font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.as-modal-actions{display:flex;justify-content:flex-end;gap:8px}
.as-pop{position:fixed;width:404px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb, var(--dsw-alias-bg-overlay) 60%, transparent);-webkit-backdrop-filter:blur(26px) saturate(1.5);backdrop-filter:blur(26px) saturate(1.5);color:var(--dsw-alias-label-primary);border:1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);border-radius:12px;box-shadow:0 22px 60px rgba(0,0,0,.42);z-index:95;overflow:hidden}
.as-pop-head{display:flex;align-items:center;gap:6px;padding:7px 8px 7px 10px}
.as-avatar{width:18px;height:18px;border-radius:6px;background:linear-gradient(140deg,#5b5bd6,#8a6cf0);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex:none}
.as-pop-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px}
.as-pop-state{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.as-pop-head .as-gap{flex:1}
.as-idchip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 3px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;max-width:190px}
.as-idchip:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);color:var(--dsw-alias-label-primary)}
.as-idchip .as-avatar{width:18px;height:18px;font-size:9px;border-radius:6px}
.as-idchip span.as-idname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-idchip .as-caret{font-size:9px;opacity:.7}
.as-pop-quote{margin:0 8px 6px;padding:4px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:10.5px;color:var(--dsw-alias-label-secondary);display:flex;gap:6px;align-items:center;min-width:0}
.as-quote-tag{flex:none;color:var(--dsw-alias-label-primary)}
.as-quote-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-pop-compose{display:flex;align-items:flex-end;gap:6px;padding:0 8px 8px}
.as-pop-compose textarea{flex:1;min-width:0;box-sizing:border-box;resize:none;border:1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);background:transparent;background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 55%, transparent);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 9px;font:inherit;font-size:12.5px;line-height:1.5;outline:0;min-height:34px;max-height:96px;overflow:auto}
.as-pop-compose textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.as-send{border:0;border-radius:8px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);font:inherit;font-size:13px;width:32px;height:32px;flex:none;cursor:pointer}
.as-send:disabled{opacity:.4;cursor:default}
.as-send-stop{font-size:10px}
.as-pop-result{border-top:1px solid var(--dsw-alias-border-l1);padding:7px 10px 8px;max-height:230px;overflow:auto;display:flex;flex-direction:column;gap:6px}
.as-line-user{font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.as-line-reply{font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.as-pop-suggestion,.as-pop-feedback{padding:0 10px 8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.as-pop-feedback[data-error="true"]{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.as-line{display:flex;align-items:flex-start;gap:5px;font-size:10.5px;color:var(--dsw-alias-label-secondary);font-family:${FONT_STACKS.mono};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.as-line b{font-weight:500;color:var(--dsw-alias-label-primary)}
.as-line[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.as-tools-line{font-family:${FONT_STACKS.mono};font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.as-approval{font-size:10.5px;line-height:1.55;color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 32%, transparent);border-radius:7px;padding:6px 8px}
.as-typing{display:flex;gap:4px;align-items:center;font-size:11px;color:var(--dsw-alias-label-secondary)}
.as-typing i{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-secondary);animation:as-bounce 1.2s infinite ease-in-out}
.as-typing i:nth-child(2){animation-delay:.15s}
.as-typing i:nth-child(3){animation-delay:.3s}
@keyframes as-bounce{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}
.as-selbub{position:fixed;z-index:94;display:inline-flex;align-items:center;gap:5px;padding:3px 9px 3px 4px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 6px 18px rgba(0,0,0,.24);font:inherit;font-size:11px;cursor:pointer}
.as-selbub:hover{background:var(--dsw-alias-bg-layer-1)}
.as-selbub .as-avatar{width:16px;height:16px;font-size:9px;border-radius:5px}
.as-history-backdrop{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1);display:flex;align-items:center;justify-content:center;z-index:85}
.as-history{width:520px;max-width:calc(100vw - 32px);max-height:min(620px,calc(100vh - 48px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden}
.as-history-head{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.as-history-head h3{margin:0;font-size:13px;font-weight:600}
.as-history-head .as-gap{flex:1}
.as-history-list{overflow:auto;padding:6px;display:flex;flex-direction:column;gap:2px;min-height:80px}
.as-version{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:7px;font-size:11.5px}
.as-version:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)}
.as-version[data-active="true"]{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent)}
.as-version-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.as-version-msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-version-time{font-size:10px;color:var(--dsw-alias-label-secondary)}
.as-version-preview{border-top:1px solid var(--dsw-alias-border-l1);padding:10px 14px;max-height:240px;overflow:auto;font-size:11.5px;line-height:1.6;white-space:pre-wrap;font-family:${FONT_STACKS.serif}}
.as-history-empty{padding:24px 14px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
body[data-ds-dark-theme] .as-pop{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 64%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);box-shadow:0 22px 60px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .as-btn:not([data-tone]):not(.as-new-btn){background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}
body[data-ds-dark-theme] .as-menu{box-shadow:0 20px 52px rgba(0,0,0,.6)}
body[data-ds-dark-theme] .as-modal,body[data-ds-dark-theme] .as-history{box-shadow:0 28px 70px rgba(0,0,0,.62)}
body[data-ds-dark-theme] .as-btn-summon{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent)}
body[data-ds-dark-theme] .as-seg-btn[data-active="true"]{background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent)}
@container (max-width: 760px){
  .as-side{width:200px}
  .as-page{padding:30px 24px 90px}
}
@container (max-width: 620px){
  .as-head .as-listtoggle{display:inline-flex;min-height:32px}
  .as-body[data-list-open="false"] .as-side{display:none}
  .as-body[data-list-open="true"] .as-main{display:none}
  .as-side{width:auto;flex:1;border:0}
  .as-outline .as-outline-entry,.as-nav-switch button{min-height:40px}
  .as-toolbar,.as-change-bar,.as-foot{padding:8px 12px}
  .as-page{padding:24px 18px 80px}
  .as-btn-summon kbd{display:none}
}
@media (max-width: 530px){
  .as-pop{box-sizing:border-box;left:12px!important;right:12px;top:auto!important;bottom:max(12px,env(safe-area-inset-bottom))!important;width:auto;max-width:none;max-height:calc(100dvh - 24px)!important}
  .as-pop-compose textarea{font-size:16px}
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){.as-pop,body[data-ds-dark-theme] .as-pop{background:var(--dsw-alias-bg-layer-2)}}
@media (prefers-reduced-motion:reduce){.as-row,.as-btn,.as-seg-btn{transition:none}.as-dot,.as-typing i{animation:none}}
`

    // ── sidebar icon ───────────────────────────────────────────────────────

    /** The sidebar glyph: a document with a pen nib, at the size the row asks. */
    function PanelIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 36 36', fill: 'none', role: 'img', 'aria-hidden': 'true' },
        h('rect', { x: 7.75, y: 4.75, width: 16.5, height: 21.5, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.7, opacity: 0.55 }),
        h('rect', { x: 11, y: 9.5, width: 9, height: 1.6, rx: 0.8, fill: 'currentColor', opacity: 0.4 }),
        h('rect', { x: 11, y: 13.4, width: 7, height: 1.6, rx: 0.8, fill: 'currentColor', opacity: 0.3 }),
        h('rect', { x: 11, y: 17.3, width: 5, height: 1.6, rx: 0.8, fill: 'currentColor', opacity: 0.22 }),
        h('path', { d: 'M18.4 30.4 L16.9 25.9 L24.4 18.4 L27.9 21.9 L20.4 29.4 Z', fill: 'currentColor', opacity: 0.95 }),
      )
    }

    // ── panel component ────────────────────────────────────────────────────

    /**
     * The whole Article Studio page: list, editor, style bar, and the caret
     * popover it owns.
     */
    function ArticleOutline({ tr, title, headings, active, onJump }) {
      const label = title || tr('untitled')
      const listRef = React.useRef(null)
      React.useEffect(() => {
        const list = listRef.current
        const current = list?.querySelector('[aria-current="location"]')
        if (!list || !current || list.clientHeight === 0) return
        const row = current.getBoundingClientRect()
        const visible = list.getBoundingClientRect()
        if (row.top < visible.top) list.scrollTop += row.top - visible.top
        else if (row.bottom > visible.bottom) list.scrollTop += row.bottom - visible.bottom
      }, [active])
      return h('nav', { className: 'as-outline', 'aria-label': tr('outline') },
        h('button', {
          type: 'button', className: 'as-outline-doc', title: label,
          'aria-label': `${label} · ${tr('outlineTop')}`, 'aria-current': active === null ? 'location' : undefined,
          onClick: () => onJump(null),
        }, h(Icon, { name: 'doc', size: 16 }), h('span', null, label)),
        headings.length === 0
          ? h('p', { className: 'as-outline-empty' }, tr('outlineEmpty'))
          : h('ol', { className: 'as-outline-list', ref: listRef, role: 'list' }, headings.map((heading) => h('li', { key: heading.offset },
              h('button', {
                type: 'button', className: 'as-outline-entry', title: heading.label,
                style: { '--as-outline-depth': Math.min(heading.depth, 4) },
                'aria-label': tr('outlineItem', { name: heading.label, level: heading.level }),
                'aria-current': active === heading.offset ? 'location' : undefined,
                onClick: () => onJump(heading.offset),
              }, h('span', null, heading.label)),
            ))),
      )
    }

    function Panel(props) {
      const ctx = props.stopContext
      const tr = props.tr
      const [roster, setRoster] = React.useState({ articles: [], identity: { name: '' }, sessionIds: [], stylePresets: [] })
      const [doc, setDoc] = React.useState(null)
      const [text, setText] = React.useState('')
      const [title, setTitle] = React.useState('')
      const [style, setStyle] = React.useState(DEFAULT_STYLE)
      const [dirty, setDirty] = React.useState(false)
      const [status, setStatus] = React.useState('idle')
      const [error, setError] = React.useState('')
      const [conflict, setConflict] = React.useState(null)
      const [preview, setPreview] = React.useState(false)
      const [imageTask, setImageTask] = React.useState(null)
      const [imageDrag, setImageDrag] = React.useState(false)
      const imageInputRef = React.useRef(null)
      const imageAnchorRef = React.useRef(null)
      const uploadRef = React.useRef(null)
      const [styleMenu, setStyleMenu] = React.useState(null)
      const [overflowMenu, setOverflowMenu] = React.useState(null)
      const [search, setSearch] = React.useState('')
      const [pendingDelete, setPendingDelete] = React.useState(null)
      const [chat, setChat] = React.useState({ entries: [], running: false, pendingInput: [] })
      const [popover, setPopover] = React.useState(null)
      const [resetArmed, setResetArmed] = React.useState(false)
      const [panelWidth, setPanelWidth] = React.useState(typeof window === 'undefined' ? 1200 : window.innerWidth)
      /** 'loading' | 'ready' | 'error' for the first roster read. */
      const [loadState, setLoadState] = React.useState('loading')
      /** The active Personal Agent identity, when that plugin is installed. */
      const [identity, setIdentity] = React.useState(null)
      const [identities, setIdentities] = React.useState([])
      /** A pinned writing partner (identity id) chosen from the footer. */
      const [pinnedId, setPinnedId] = React.useState(() => {
        try {
          return window.localStorage.getItem(PINNED_KEY)
        } catch {
          return null
        }
      })
      const [identityMenu, setIdentityMenu] = React.useState(null)
      /** The rail switches between the document library and the current outline. */
      const [sideOpen, setSideOpen] = React.useState(false)
      const [sideMode, setSideMode] = React.useState('articles')
      const [activeHeading, setActiveHeading] = React.useState(null)
      const [outlineJump, setOutlineJump] = React.useState(null)
      const pinnedHeading = React.useRef(null)
      const [navigation, setNavigation] = React.useState(null)
      const navigationRef = React.useRef(false)
      const searchRef = React.useRef(null)
      const titleFocusRef = React.useRef(null)
      /** A mouse selection inside the canvas, with its anchor rect. */
      const [selectionTip, setSelectionTip] = React.useState(null)
      const [reviewPending, setReviewPending] = React.useState(false)
      const reviewPendingRef = React.useRef(false)
      const [reviewPosition, setReviewPosition] = React.useState(null)
      const [historyOpen, setHistoryOpen] = React.useState(false)
      const [versions, setVersions] = React.useState([])
      const [versionsLoading, setVersionsLoading] = React.useState(false)
      const [versionPreview, setVersionPreview] = React.useState(null)

      const editorRef = React.useRef(null)
      const titleInputRef = React.useRef(null)
      const scrollRef = React.useRef(null)
      const docRef = React.useRef(null)
      const revRef = React.useRef(0)
      const textRef = React.useRef('')
      const titleRef = React.useRef('')
      const styleRef = React.useRef(DEFAULT_STYLE)
      const dirtyRef = React.useRef(false)
      const saveTimer = React.useRef(null)
      const rangeRef = React.useRef(null)
      const pollingRef = React.useRef(false)
      const mountedRef = React.useRef(true)
      const resetTimer = React.useRef(null)
      /** Edit generation: a late save must not clear a newer unsaved change. */
      const editSeq = React.useRef(0)
      /** Save responses are serialized so an older one cannot win. */
      const saveQueue = React.useRef(Promise.resolve())
      /** Saves queued but not yet settled; the poll does not race them. */
      const pendingSaves = React.useRef(0)
      /** Whether an unresolved revision conflict is on screen. */
      const conflictRef = React.useRef(false)

      React.useEffect(() => () => {
        mountedRef.current = false
        if (saveTimer.current !== null) {
          clearTimeout(saveTimer.current)
          saveTimer.current = null
        }
        if (resetTimer.current !== null) clearTimeout(resetTimer.current)
        // Leaving the page must not drop the last keystrokes: a revision-checked
        // save cannot overwrite an agent edit that arrived meanwhile.
        const current = docRef.current
        if (dirtyRef.current && current !== null && !conflictRef.current) {
          void post('save', {
            id: current.id,
            rev: revRef.current,
            title: titleRef.current,
            text: textRef.current,
            style: styleRef.current,
          }).catch(() => undefined)
        }
      }, [])

      React.useEffect(() => {
        const onResize = () => setPanelWidth(window.innerWidth)
        const onBlur = () => {
          if (dirtyRef.current) void saveNow()
        }
        window.addEventListener('resize', onResize)
        window.addEventListener('blur', onBlur)
        return () => {
          window.removeEventListener('resize', onResize)
          window.removeEventListener('blur', onBlur)
        }
      }, [])

      const setPinned = (id) => {
        setPinnedId(id)
        try {
          if (id === null) window.localStorage.removeItem(PINNED_KEY)
          else window.localStorage.setItem(PINNED_KEY, id)
        } catch {
          // A storage failure only loses the pin for this page.
        }
      }

      const setDirtyFlag = (value) => {
        dirtyRef.current = value
        setDirty(value)
      }
      const setTextValue = (value) => {
        textRef.current = value
        setText(value)
      }
      const setTitleValue = (value) => {
        titleRef.current = value
        setTitle(value)
      }
      const setStyleValue = (value) => {
        styleRef.current = value
        setStyle(value)
      }

      /** Put text into the editable canvas without disturbing an ordinary caret. */
      const writeEditor = (value, preserveCaret) => {
        const editor = editorRef.current
        setTextValue(value)
        if (editor === null) return
        if (editor.textContent === value) return
        let offset = null
        if (preserveCaret && document.activeElement === editor) {
          const selection = window.getSelection()
          if (selection !== null && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0)
            if (editor.contains(range.commonAncestorContainer)) offset = offsetOf(editor, range.startContainer, range.startOffset)
          }
        }
        editor.textContent = value
        if (offset !== null) {
          const range = caretAtOffset(editor, offset)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
      }

      /** Adopt one server document as the current state. */
      const applyDoc = (article, options = {}) => {
        const switching = docRef.current?.id !== article.id
        docRef.current = article
        revRef.current = article.rev
        setDoc(article)
        setTitleValue(article.title)
        setStyleValue(article.style)
        writeEditor(article.text, options.preserveCaret === true)
        setDirtyFlag(false)
        setStatus('saved')
        conflictRef.current = false
        if (switching) {
          setActiveHeading(null)
          setSideMode(markdownStructure(article.text).headings.length ? 'outline' : 'articles')
          pinnedHeading.current = null
          if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
        }
        setConflict(null)
        setError('')
        if (options.keepChat !== true) {
          setChat({ entries: [], running: false, pendingInput: [] })
        }
        try {
          window.localStorage.setItem(LAST_KEY, article.id)
        } catch {
          // Storage may be unavailable; selection still works for this page.
        }
      }

      /** Adopt whatever roster fields a route returned. */
      const applyRoster = (data) => {
        if (!data || !Array.isArray(data.articles)) return
        setRoster({
          articles: data.articles,
          identity: data.identity ?? { name: '' },
          sessionIds: Array.isArray(data.sessionIds) ? data.sessionIds : [],
          stylePresets: Array.isArray(data.stylePresets) ? data.stylePresets : STYLE_PRESETS,
        })
        if (typeof props.onSessions === 'function') props.onSessions(data.sessionIds ?? [])
      }

      // Serialize opening/creating. Never replace the canvas with a response
      // that arrived after the user started typing again.
      const navigate = async (kind, id) => {
        if (navigationRef.current) return
        if (kind === 'read' && docRef.current?.id === id) {
          setSideOpen(false)
          return
        }
        navigationRef.current = true
        setNavigation(kind)
        setError('')
        try {
          if (dirtyRef.current) await saveNow()
          if (dirtyRef.current || !mountedRef.current) return
          const { data } = await post(kind, kind === 'read' ? { id } : {})
          if (!mountedRef.current) return
          if (!data.ok) {
            setError(data.message ?? tr(kind === 'read' ? 'openFailed' : 'error'))
            return
          }
          applyRoster(data)
          if (dirtyRef.current) {
            // The new article still appears in the list; don't discard the current draft.
            setError(tr('finishDraft'))
            return
          }
          if (kind === 'create') {
            titleFocusRef.current = data.article.id
            setSearch('')
          }
          setPreview(false)
          setSideOpen(false)
          applyDoc(data.article)
          void refreshChat().catch(() => undefined)
        } catch (failure) {
          if (mountedRef.current) setError(messageOf(failure))
        } finally {
          navigationRef.current = false
          if (mountedRef.current) setNavigation(null)
        }
      }

      const openArticle = (id) => navigate('read', id)
      const createArticle = () => navigate('create')

      React.useEffect(() => {
        if (doc === null || titleFocusRef.current !== doc.id) return
        titleFocusRef.current = null
        titleInputRef.current?.focus()
        titleInputRef.current?.select()
      }, [doc?.id])

      // The writing partner is the identity the user is using in 身份, not a
      // separate agent: its id, name, and home come from that plugin's state.
      const loadIdentity = async () => {
        try {
          const response = await fetch('api/personal-agent/state', { cache: 'no-store' })
          const data = await response.json()
          // The Personal Agent state payload carries no `ok` flag.
          if (data === null || typeof data !== 'object' || !Array.isArray(data.identities)) return
          setIdentities(data.identities)
          if (data.identities.length === 0) return
          let activeId = null
          try {
            activeId = window.localStorage.getItem('pagent-active-identity')
          } catch {
            activeId = null
          }
          const active = data.identities.find((entry) => entry.id === activeId) ?? data.identities[0]
          setIdentity({
            id: active.id,
            name: active.name,
            workspaceId: active.home?.workspaceId ?? undefined,
            avatar: active.avatar,
            accent: active.accent,
          })
        } catch {
          // Personal Agent is optional; the fallback partner still works.
        }
      }

      React.useEffect(() => {
        void loadIdentity()
      }, [])

      React.useEffect(() => {
        if (pinnedId === null || identities.length === 0) return
        if (identities.some((entry) => entry.id === pinnedId)) return
        setPinned(null)
      }, [identities, pinnedId])

      const loadRoster = async () => {
        setLoadState('loading')
        try {
          const { data } = await post('list')
          if (!data.ok) {
            setLoadState('error')
            setError(data.message ?? tr('error'))
            return
          }
          setLoadState('ready')
          applyRoster(data)
          let last = null
          try {
            last = window.localStorage.getItem(LAST_KEY)
          } catch {
            last = null
          }
          const target = data.articles.find((article) => article.id === last) ?? data.articles[0]
          if (target !== undefined) await openArticle(target.id)
        } catch (failure) {
          setLoadState('error')
          setError(messageOf(failure))
        }
      }

      React.useEffect(() => {
        void loadRoster()
      }, [])

      // Snapshot the selection before the composer steals focus, in every canvas mode.
      React.useEffect(() => {
        const update = () => {
          const selection = window.getSelection()
          const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : null
          const root = scrollRef.current
          const body = root?.querySelector('.as-text, .as-prose, .as-diff')
          if (!range || !body?.contains(range.commonAncestorContainer) || range.collapsed) return setSelectionTip(null)
          const text = range.toString().trim()
          const rect = range.getBoundingClientRect()
          const bounds = root.getBoundingClientRect()
          if (!text || (rect.width === 0 && rect.height === 0) || rect.bottom < bounds.top || rect.top > bounds.bottom) return setSelectionTip(null)
          const context = body === editorRef.current ? captureCaret(body) : null
          setSelectionTip({ rect, text, before: context?.before, after: context?.after })
        }
        document.addEventListener('selectionchange', update)
        window.addEventListener('resize', update)
        document.addEventListener('scroll', update, true)
        return () => {
          document.removeEventListener('selectionchange', update)
          window.removeEventListener('resize', update)
          document.removeEventListener('scroll', update, true)
        }
      }, [doc?.id, preview])

      // An Agent edit switches the canvas to the review view automatically.
      React.useEffect(() => {
        if (doc?.pendingChange !== undefined) setPreview(false)
      }, [doc?.pendingChange?.at])

      // A popover belongs to one article; switching or deleting it closes it.
      React.useEffect(() => {
        setPopover(null)
        setIdentityMenu(null)
        setStyleMenu(null)
        setOverflowMenu(null)
        setSelectionTip(null)
        rangeRef.current = null
        setImageTask(null)
        setImageDrag(false)
        imageAnchorRef.current = null
        return () => {
          const upload = uploadRef.current
          if (uploadBelongsTo(upload, doc?.id)) {
            uploadRef.current = null
            upload.controller.abort()
          }
        }
      }, [doc?.id])

      React.useEffect(() => {
        if (pendingDelete === null && !historyOpen) return
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          setPendingDelete(null)
          setHistoryOpen(false)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [pendingDelete, historyOpen])

      // The editable canvas remounts on article changes and when preview is
      // left; put the current text back without touching a live caret.
      React.useEffect(() => {
        if (preview) return
        const editor = editorRef.current
        if (editor !== null && editor.textContent !== textRef.current) editor.textContent = textRef.current
      }, [preview, doc?.id, doc?.rev, doc?.pendingChange === undefined ? '' : doc.pendingChange.at])

      // One poll covers the list, the open document, the transcript, and the
      // Session status; it pauses while the tab is hidden.
      React.useEffect(() => {
        const timer = setInterval(async () => {
          if (pollingRef.current) return
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
          const current = docRef.current
          if (current === null) return
          pollingRef.current = true
          try {
            const { data } = await post('poll', { id: current.id, rev: revRef.current })
            if (!mountedRef.current || !data.ok || docRef.current?.id !== current.id) return
            applyRoster(data)
            setChat({ entries: data.chat ?? [], running: data.running === true, pendingInput: data.pendingInput ?? [] })
            const remote = data.article
            if (remote === undefined || remote.id !== docRef.current?.id || remote.rev <= revRef.current) return
            // Our own save may still be in flight; the next poll settles it.
            if (pendingSaves.current > 0) return
            if (dirtyRef.current) {
              conflictRef.current = true
              setConflict({ remote })
              setStatus('conflict')
            } else {
              applyDoc(remote, { preserveCaret: true, keepChat: true })
            }
          } catch {
            // A transient network failure keeps the last good state.
          } finally {
            pollingRef.current = false
          }
        }, 1500)
        return () => clearInterval(timer)
      }, [])

      const scheduleSave = () => {
        if (saveTimer.current !== null) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null
          void saveNow()
        }, 700)
      }

      /** One save against the current snapshot. Runs only from the queue. */
      const performSave = async () => {
        const current = docRef.current
        if (current === null || !dirtyRef.current || conflictRef.current) return
        if (saveTimer.current !== null) {
          clearTimeout(saveTimer.current)
          saveTimer.current = null
        }
        const articleId = current.id
        const generation = editSeq.current
        setStatus('saving')
        try {
          const { status: httpStatus, data } = await post('save', {
            id: articleId,
            rev: revRef.current,
            title: titleRef.current,
            text: textRef.current,
            style: styleRef.current,
          })
          if (!mountedRef.current || docRef.current?.id !== articleId) return
          if (data.ok) {
            if (data.article.rev >= revRef.current) {
              docRef.current = data.article
              revRef.current = data.article.rev
              setDoc(data.article)
            }
            applyRoster(data)
            setError('')
            if (editSeq.current === generation) {
              setDirtyFlag(false)
              setStatus('saved')
            } else {
              setStatus('unsaved')
              scheduleSave()
            }
            return
          }
          if (httpStatus === 409 && data.article !== undefined) {
            conflictRef.current = true
            setConflict({ remote: data.article })
            setStatus('conflict')
            return
          }
          setStatus('error')
          setError(data.message ?? tr('failed'))
        } catch (failure) {
          if (!mountedRef.current) return
          setStatus('error')
          setError(messageOf(failure))
        }
      }

      /** Queue one save; the returned promise settles after every queued save. */
      const saveNow = () => {
        pendingSaves.current += 1
        const run = saveQueue.current.then(performSave, performSave)
        saveQueue.current = run.then(() => undefined, () => undefined)
        return run.finally(() => {
          pendingSaves.current = Math.max(0, pendingSaves.current - 1)
        })
      }

      const onEditorInput = () => {
        const editor = editorRef.current
        if (editor === null) return
        editSeq.current += 1
        setTextValue(editor.textContent ?? '')
        rememberSelection()
        setDirtyFlag(true)
        setStatus('unsaved')
        scheduleSave()
      }

      const onTitleChange = (event) => {
        editSeq.current += 1
        setTitleValue(event.target.value)
        setDirtyFlag(true)
        setStatus('unsaved')
        scheduleSave()
      }

      const changeStyle = (patch) => {
        editSeq.current += 1
        const next = { ...styleRef.current, ...patch }
        setStyleValue(next)
        setDirtyFlag(true)
        setStatus('unsaved')
        scheduleSave()
      }

      const applyRecipe = (name) => {
        const recipe = {
          essay: { font: 'serif', fontSize: 19, lineHeight: 2, paragraphGap: 16, width: 680, align: 'justify', indent: true, theme: 'paper' },
          blog: { font: 'sans', fontSize: 17, lineHeight: 1.85, paragraphGap: 14, width: 720, align: 'left', indent: false, theme: 'paper' },
          wechat: { font: 'sans', fontSize: 17, lineHeight: 1.9, paragraphGap: 20, width: 620, align: 'left', indent: false, theme: 'paper' },
          note: { font: 'sans', fontSize: 15, lineHeight: 1.7, paragraphGap: 10, width: 820, align: 'left', indent: false, theme: 'dark' },
          warm: { font: 'kai', fontSize: 18, lineHeight: 1.9, paragraphGap: 14, width: 700, align: 'left', indent: true, theme: 'sepia' },
        }[name]
        if (recipe === undefined) return
        changeStyle(recipe)
      }

      const deleteArticle = async () => {
        const target = pendingDelete
        setPendingDelete(null)
        if (target === null) return
        let data
        try {
          ;({ data } = await post('delete', { id: target.id }))
        } catch (failure) {
          setError(messageOf(failure))
          return
        }
        if (!data.ok) {
          setError(data.message ?? tr('failed'))
          return
        }
        applyRoster(data)
        if (docRef.current?.id === target.id) {
          clearTimeout(saveTimer.current)
          saveTimer.current = null
          setDirtyFlag(false)
          conflictRef.current = false
          setConflict(null)
          const next = data.articles[0]
          if (next !== undefined) await openArticle(next.id)
          else {
            docRef.current = null
            setDoc(null)
            setTextValue('')
            setTitleValue('')
            setChat({ entries: [], running: false, pendingInput: [] })
          }
        }
      }

      const resolveConflict = async (choice) => {
        const current = docRef.current
        if (current === null || conflict === null) return
        if (choice === 'theirs') {
          applyDoc(conflict.remote, { preserveCaret: true, keepChat: true })
          return
        }
        conflictRef.current = false
        setConflict(null)
        // Forced save: no revision check, the writer's text wins.
        try {
          const { data } = await post('save', {
            id: current.id,
            title: titleRef.current,
            text: textRef.current,
            style: styleRef.current,
          })
          if (data.ok) applyDoc(data.article, { keepChat: true })
          else {
            setStatus('error')
            setError(data.message ?? tr('failed'))
          }
        } catch (failure) {
          setStatus('error')
          setError(messageOf(failure))
        }
      }

      // ── agent popover plumbing ───────────────────────────────────────────

      const rememberSelection = () => {
        const editor = editorRef.current
        const captured = captureCaret(editor)
        if (captured !== null) rangeRef.current = captured.range
      }

      const openAgent = (tip, opener) => {
        const current = docRef.current
        if (current === null) return
        const caret = tip ?? captureCaret(editorRef.current)
        const selection = tip?.text ?? caret?.range?.toString() ?? ''
        const before = caret?.before?.slice(-700) ?? ''
        const after = caret?.after?.slice(0, 300) ?? ''
        const bounds = scrollRef.current?.getBoundingClientRect()
        const rect = caret?.rect ?? (bounds ? { left: bounds.left + 24, top: bounds.top + 8, bottom: bounds.top + 16 } : null)
        void loadIdentity()
        setPopover({ rect, selection, before, after, id: current.id, opener })
        setSelectionTip(null)
        setResetArmed(false)
      }

      const closeAgent = (restoreFocus = true) => {
        setPopover(null)
        if (restoreFocus && popover?.opener?.isConnected) popover.opener.focus({ preventScroll: true })
      }

      const refreshChat = async () => {
        const current = docRef.current
        if (current === null) return
        const { data } = await post('poll', { id: current.id, rev: revRef.current })
        if (!data.ok || !mountedRef.current || docRef.current?.id !== current.id) return
        applyRoster(data)
        setChat({ entries: data.chat ?? [], running: data.running === true, pendingInput: data.pendingInput ?? [] })
        if (data.article !== undefined && data.article.rev > revRef.current && pendingSaves.current === 0) {
          if (dirtyRef.current) {
            conflictRef.current = true
            setConflict({ remote: data.article })
            setStatus('conflict')
          } else applyDoc(data.article, { preserveCaret: true, keepChat: true })
        }
      }

      const sendInstruction = async (instruction, context) => {
        if (context.id !== docRef.current?.id || navigationRef.current) return tr('openFailed')
        try {
          if (dirtyRef.current) await saveNow()
          if (context.id !== docRef.current?.id || navigationRef.current) return tr('openFailed')
          if (dirtyRef.current || conflictRef.current) return tr('sendAfterSave')
          const { data } = await post('ask', {
            id: context.id,
            instruction,
            selection: context.selection,
            before: context.before,
            after: context.after,
            ...(partner === null ? {} : { identity: { id: partner.id, name: partner.name, workspaceId: partner.home?.workspaceId ?? partner.workspaceId } }),
          })
          if (!data.ok) return data.message ?? tr('error')
          if (mountedRef.current && docRef.current?.id === context.id) {
            applyRoster(data)
            void refreshChat().catch(() => undefined)
          }
          return null
        } catch (failure) {
          return messageOf(failure)
        }
      }

      const stopAgent = async () => {
        const current = docRef.current
        if (current === null) return
        try {
          await post('stop', { id: current.id })
          void refreshChat()
        } catch (failure) {
          setError(messageOf(failure))
        }
      }

      const resetConversation = async () => {
        const current = docRef.current
        if (current === null) return
        try {
          await post('reset', { id: current.id })
          setChat({ entries: [], running: false, pendingInput: [] })
          setResetArmed(false)
        } catch (failure) {
          setError(messageOf(failure))
        }
      }

      const decideReview = async (action) => {
        const current = docRef.current
        if (!current?.pendingChange || reviewPendingRef.current || dirtyRef.current || conflictRef.current) return
        reviewPendingRef.current = true
        setReviewPending(true)
        setError('')
        try {
          const { status: code, data } = await post(action, { id: current.id, rev: current.rev })
          if (!mountedRef.current || docRef.current?.id !== current.id) return
          if (data.ok || code === 409) {
            applyRoster(data)
            if (data.article && data.article.rev >= revRef.current) {
              if (dirtyRef.current) {
                conflictRef.current = true
                setConflict({ remote: data.article })
                setStatus('conflict')
              } else applyDoc(data.article, { keepChat: true })
            }
            if (code === 409) setError(tr('reviewUpdated'))
          } else setError(data.message ?? tr('error'))
        } catch (failure) {
          if (mountedRef.current) setError(messageOf(failure))
        } finally {
          reviewPendingRef.current = false
          if (mountedRef.current) setReviewPending(false)
        }
      }

      const openHistory = async () => {
        setPopover(null)
        setOverflowMenu(null)
        const current = docRef.current
        if (current === null) return
        setHistoryOpen(true)
        setVersions([])
        setVersionPreview(null)
        setVersionsLoading(true)
        try {
          const { data } = await post('versions', { id: current.id })
          if (!data.ok) {
            setError(data.message ?? tr('error'))
            return
          }
          setVersions(data.versions ?? [])
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setVersionsLoading(false)
        }
      }

      const previewVersion = async (sha) => {
        const current = docRef.current
        if (current === null) return
        try {
          const { data } = await post('version', { id: current.id, sha })
          if (data.ok) setVersionPreview({ sha, ...data.version })
        } catch (failure) {
          setError(messageOf(failure))
        }
      }

      const restoreVersion = async (sha) => {
        const current = docRef.current
        if (current === null) return
        if (dirtyRef.current) {
          await saveNow()
          if (dirtyRef.current) return
        }
        try {
          const { data } = await post('restore', { id: current.id, sha })
          if (!data.ok) {
            setError(data.message ?? tr('error'))
            return
          }
          applyRoster(data)
          applyDoc(data.article, { keepChat: true })
          setHistoryOpen(false)
        } catch (failure) {
          setError(messageOf(failure))
        }
      }

      const insertAtCaret = (value, replaceSelection, at = null) => {
        const editor = editorRef.current
        if (editor === null) return false
        let range = at
        const live = window.getSelection()
        if (range === null && live !== null && live.rangeCount > 0 && editor.contains(live.getRangeAt(0).commonAncestorContainer)) {
          range = live.getRangeAt(0).cloneRange()
        }
        if (range === null && rangeRef.current !== null && editor.contains(rangeRef.current.commonAncestorContainer)) {
          range = rangeRef.current
        }
        if (range === null) range = caretAtOffset(editor, editor.textContent?.length ?? 0)
        editor.focus()
        const selection = window.getSelection()
        if (selection === null) return false
        selection.removeAllRanges()
        selection.addRange(range)
        if (replaceSelection) range.deleteContents()
        const node = document.createTextNode(value)
        range.insertNode(node)
        const afterRange = document.createRange()
        afterRange.setStartAfter(node)
        afterRange.collapse(true)
        selection.removeAllRanges()
        selection.addRange(afterRange)
        rangeRef.current = afterRange.cloneRange()
        editSeq.current += 1
        setTextValue(editor.textContent ?? '')
        setDirtyFlag(true)
        setStatus('unsaved')
        scheduleSave()
        return true
      }

      const imageTarget = (point) => {
        const editor = editorRef.current
        const current = docRef.current
        if (!editor || !current || current.pendingChange || conflictRef.current) return null
        const body = textRef.current
        let offset = null
        if (point) {
          const { clientX: x, clientY: y } = point
          const caret = document.caretPositionFromPoint?.(x, y)
          const range = caret ? null : document.caretRangeFromPoint?.(x, y)
          const node = caret?.offsetNode ?? range?.startContainer
          if (node && editor.contains(node)) offset = offsetOf(editor, node, caret?.offset ?? range.startOffset)
        } else {
          const live = window.getSelection()
          const possible = [live?.rangeCount > 0 ? live.getRangeAt(0) : null, rangeRef.current]
          const range = possible.find((range) => range && editor.contains(range.commonAncestorContainer))
          if (range) offset = offsetOf(editor, range.endContainer, range.endOffset)
        }
        return { id: current.id, body, offset: point && offset === null && body !== '' ? null : Math.min(body.length, offset ?? body.length) }
      }

      const placeImages = (images, target) => {
        if (!target || target.offset === null || target.id !== docRef.current?.id || docRef.current?.pendingChange || conflictRef.current || textRef.current !== target.body) return false
        const editor = editorRef.current
        if (!editor) return false
        const markdown = imageBlock(images, target.body, target.offset)
        if (!insertAtCaret(markdown, false, caretAtOffset(editor, target.offset))) return false
        setImageTask({ kind: 'added', count: images.length, before: target.body, after: textRef.current, offset: target.offset })
        return true
      }

      const undoImageInsertion = () => {
        if (imageTask?.kind !== 'added' || textRef.current !== imageTask.after || !editorRef.current || docRef.current?.pendingChange || conflictRef.current) return
        writeEditor(imageTask.before, false)
        const editor = editorRef.current
        editor.focus()
        const caret = caretAtOffset(editor, imageTask.offset)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(caret)
        rangeRef.current = caret
        editSeq.current += 1
        setDirtyFlag(true)
        setStatus('unsaved')
        scheduleSave()
        setImageTask(null)
      }

      const uploadImages = async (files, target) => {
        if (!target || target.id !== docRef.current?.id || uploadRef.current || files.length === 0) return
        const matchesType = (file) => /^(image\/(png|jpeg|webp|gif))$/iu.test(file.type) || /\.(png|jpe?g|webp|gif)$/iu.test(file.name)
        const invalid = files.length > 8 ? 'imageBatch' : files.some((file) => file.size > IMAGE_LIMIT) ? 'imageSize'
          : files.some((file) => !matchesType(file) || file.size === 0) ? 'imageType' : null
        if (invalid) {
          setImageTask({ kind: 'error', reason: invalid })
          return
        }
        const controller = new AbortController()
        const upload = { id: target.id, controller }
        uploadRef.current = upload
        let reason = 'imageError'
        try {
          const images = []
          for (const [index, file] of files.entries()) {
            setImageTask({ kind: 'uploading', current: index + 1, total: files.length })
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
            const response = await fetch(`${API}image-upload?article=${encodeURIComponent(target.id)}`, {
              method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file, signal,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok || typeof data?.key !== 'string' || !IMAGE_KEY.test(data.key)) {
              reason = response.status === 413 ? 'imageSize' : response.status === 415 ? 'imageType' : 'imageError'
              throw new Error('image upload rejected')
            }
            const alt = file.name.replace(/\.[^.]+$/u, '').trim().slice(0, 160) || tr('pastedImage')
            images.push({ key: data.key, alt })
          }
          if (uploadRef.current !== upload || docRef.current?.id !== target.id) return
          if (!placeImages(images, target)) setImageTask({ kind: 'ready', images })
        } catch {
          if (uploadRef.current === upload && docRef.current?.id === target.id) {
            setImageTask({ kind: 'error', reason, ...(reason === 'imageError' ? { files, target } : {}) })
          }
        } finally {
          if (uploadRef.current === upload) uploadRef.current = null
        }
      }

      const canInsertImage = doc !== null && !preview && !doc.pendingChange && conflict === null
      const hasDraggedImage = (transfer) => Array.from(transfer?.items ?? []).some((item) => item.kind === 'file' && (!item.type || item.type.startsWith('image/')))
      const transferFiles = (transfer) => {
        const files = Array.from(transfer?.files ?? [])
        return files.length ? files : Array.from(transfer?.items ?? []).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean)
      }

      const filtered = roster.articles.filter((article) => {
        if (search.trim() === '') return true
        const needle = search.trim().toLowerCase()
        return article.title.toLowerCase().includes(needle) || (article.preview ?? '').toLowerCase().includes(needle)
      })
      const change = doc?.pendingChange ?? null
      const changeDiff = React.useMemo(
        () => (change === null ? null : diffSegments(change.before, text)),
        [change?.before, text],
      )
      const groups = React.useMemo(() => reviewGroups(changeDiff ?? []), [changeDiff])
      const changeCount = groups.filter((group) => group.edits).length
      const activeChange = reviewPosition?.change === change && reviewPosition?.id === doc?.id ? reviewPosition.index : -1
      const moveReview = (direction) => {
        if (changeCount === 0) return
        const from = activeChange < 0 ? (direction > 0 ? -1 : 0) : activeChange
        setReviewPosition({ id: doc.id, change, index: (from + direction + changeCount) % changeCount })
        setPreview(false)
      }
      React.useEffect(() => {
        if (preview || activeChange < 0) return
        scrollRef.current?.querySelector('[data-review-active="true"]')?.scrollIntoView({ block: 'center', inline: 'nearest' })
      }, [activeChange, preview])
      const structure = React.useMemo(() => markdownStructure(text), [text])
      const headings = structure.headings
      const showOutline = doc !== null && sideMode === 'outline'
      const articleId = doc?.id
      const reviewing = change !== null
      const jumpToHeading = (offset) => {
        if (!articleId) return
        setOutlineJump({ articleId, offset, focusCanvas: sideOpen })
        setSideOpen(false)
      }
      const switchCanvas = (nextPreview) => {
        if (nextPreview !== preview && activeHeading !== null) jumpToHeading(activeHeading)
        setPreview(nextPreview)
      }

      React.useEffect(() => {
        if (!outlineJump || outlineJump.articleId !== articleId) return
        // A compact rail hides the canvas. Wait for the new layout before measuring.
        const frame = requestAnimationFrame(() => {
          const scroll = scrollRef.current
          if (!scroll || !scroll.clientHeight || docRef.current?.id !== outlineJump.articleId) return
          if (outlineJump.focusCanvas) scroll.focus({ preventScroll: true })
          const offset = outlineJump.offset
          if (offset === null) scroll.scrollTop = 0
          else {
            const index = headings.findIndex((heading) => heading.offset === offset)
            if (index < 0) return
            const top = headingPositions(scroll, headings, preview)(index)
            if (top === undefined) return
            scroll.scrollTop += top - scroll.getBoundingClientRect().top - 24
          }
          pinnedHeading.current = { offset, top: scroll.scrollTop }
          setActiveHeading(offset)
        })
        return () => cancelAnimationFrame(frame)
      }, [outlineJump])

      React.useEffect(() => {
        const scroll = scrollRef.current
        if (!scroll) return
        pinnedHeading.current = null
        let frame = null
        let topAt = null
        const sync = () => {
          frame = null
          if (!scroll.clientHeight) return
          const pinned = pinnedHeading.current
          if (pinned && Math.abs(pinned.top - scroll.scrollTop) < 1) return
          pinnedHeading.current = null
          topAt ??= headingPositions(scroll, headings, preview)
          const bottom = scroll.scrollTop > 0 && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2
          const current = bottom ? headings[headings.length - 1]?.offset ?? null : headingAt(headings, topAt, scroll.getBoundingClientRect().top + 44)
          setActiveHeading(current)
        }
        const schedule = () => {
          if (frame === null) frame = requestAnimationFrame(sync)
        }
        const resize = () => {
          topAt = null
          schedule()
        }
        scroll.addEventListener('scroll', schedule, { passive: true })
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
        const page = scroll.querySelector('.as-page')
        if (observer && page) observer.observe(page)
        observer?.observe(scroll)
        schedule()
        return () => {
          scroll.removeEventListener('scroll', schedule)
          observer?.disconnect()
          if (frame !== null) cancelAnimationFrame(frame)
        }
      }, [articleId, headings, preview, reviewing, sideOpen])

      const canvas = preview ? paperStyle(style) : editCanvasStyle(style)
      const wordCount = charCount(text)
      const pinned = pinnedId === null ? null : identities.find((entry) => entry.id === pinnedId) ?? null
      const partner = pinned ?? identity
      const identityName = partner?.name || roster.identity?.name || tr('fallbackName')
      const partnerId = partner?.id ?? null
      const statusText = status === 'saving'
        ? tr('saving')
        : status === 'saved'
          ? tr('saved')
          : status === 'unsaved'
            ? tr('unsaved')
            : status === 'error'
              ? tr('failed')
              : status === 'conflict'
                ? tr('conflictShort')
                : ''

      return h(
        'div',
        {
          className: 'as-panel',
          'data-plugin': 'article-studio',
          onKeyDown: (event) => {
            const primary = event.metaKey || event.ctrlKey
            if (primary && !event.altKey && (event.key === 's' || event.key === 'S')) {
              event.preventDefault()
              void saveNow()
            }
          },
        },
        h(
          'header',
          { className: 'as-head' },
          h(
            'button',
            {
              type: 'button',
              className: 'as-iconbtn as-back',
              onClick: () => ctx?.get?.('layout')?.selectPanel?.(null),
              title: tr('back'),
              'aria-label': tr('back'),
            },
            h(Icon, { name: 'back', size: 15 }),
          ),
          h('h1', null, tr('panel')),
          roster.articles.length > 0 ? h('span', { className: 'as-count' }, String(roster.articles.length)) : null,
          h('button', {
            type: 'button', className: 'as-btn as-listtoggle',
            'aria-expanded': sideOpen, 'aria-controls': 'as-document-navigation',
            onClick: () => setSideOpen(!sideOpen),
          }, h(Icon, { name: sideOpen ? 'back' : 'list', size: 14 }), tr(sideOpen ? 'navBack' : 'navToggle')),
          h('span', { className: 'as-spacer' }),
          h(
            'button',
            { type: 'button', className: 'as-btn as-btn-compact as-new-btn', onClick: createArticle, disabled: navigation !== null || loadState === 'loading' },
            h(Icon, { name: 'plus', size: 12 }),
            h('span', null, tr(navigation === 'create' ? 'creatingArticle' : 'newArticle')),
          ),
        ),
        error !== '' ? h('div', { className: 'as-error', role: 'alert' },
          h('span', null, error),
          status === 'error' && dirty && conflict === null ? h('button', { type: 'button', className: 'as-btn', onClick: () => void saveNow() }, tr('retry')) : null,
        ) : null,
        conflict !== null
          ? h(
              'div',
              { className: 'as-banner' },
              h('span', null, tr('conflict')),
              h('span', { className: 'as-gap' }),
              h('button', { type: 'button', className: 'as-btn', onClick: () => void resolveConflict('mine') }, tr('keepMine')),
              h('button', { type: 'button', className: 'as-btn', onClick: () => void resolveConflict('theirs') }, tr('keepTheirs')),
            )
          : null,
        h(
          'div',
          { className: 'as-body', 'data-list-open': sideOpen },
          h(
            'aside',
            { className: 'as-side', id: 'as-document-navigation', 'aria-label': tr('docNav') },
            h('div', { className: 'as-nav-switch', role: 'group', 'aria-label': tr('docNav') },
              h('button', { type: 'button', 'aria-pressed': !showOutline, onClick: () => setSideMode('articles') },
                h(Icon, { name: 'list', size: 14 }), tr('panel')),
              h('button', { type: 'button', 'aria-pressed': showOutline, disabled: doc === null, onClick: () => setSideMode('outline') },
                h(Icon, { name: 'outline', size: 14 }), tr('outline')),
            ),
            h('div', { className: 'as-rail-pane', hidden: showOutline },
              h(
                'div',
                { className: 'as-side-head' },
                h(
                  'div',
                  { className: 'as-search' },
                  h(Icon, { name: 'search', size: 12 }),
                  h('input', {
                    ref: searchRef,
                    value: search,
                    onChange: (event) => setSearch(event.target.value),
                    onKeyDown: (event) => {
                      if (event.isComposing || event.keyCode === 229) return
                      if (event.key === 'Escape' && search !== '') {
                        event.preventDefault()
                        setSearch('')
                      } else if (event.key === 'Enter' && filtered[0]) {
                        event.preventDefault()
                        void openArticle(filtered[0].id)
                      }
                    },
                    placeholder: tr('search'),
                    'aria-label': tr('search'),
                  }),
                  search !== '' ? h('button', {
                    type: 'button', className: 'as-iconbtn', 'aria-label': tr('clearSearch'), title: tr('clearSearch'),
                    onClick: () => { setSearch(''); searchRef.current?.focus() },
                  }, '×') : null,
                ),
              ),
              loadState === 'loading'
                ? h('div', { className: 'as-empty-side', role: 'status' }, tr('loadingArticles'))
                : filtered.length === 0
                  ? h('div', { className: 'as-empty-side' }, tr(roster.articles.length === 0 ? 'noArticles' : 'noMatches'))
                  : h(
                      'div',
                      { className: 'as-list', role: 'list', 'aria-busy': navigation === 'read' },
                      filtered.map((article) => {
                        const label = article.title || tr('untitled')
                        return h(
                          'div',
                          { key: article.id, role: 'listitem', className: 'as-row', 'data-active': doc?.id === article.id },
                          h(
                            'button',
                            {
                              type: 'button', className: 'as-row-main',
                              'aria-current': doc?.id === article.id ? 'true' : undefined,
                              disabled: navigation !== null,
                              onClick: () => void openArticle(article.id),
                            },
                            h('span', { className: 'as-row-title' }, label),
                            article.preview ? h('span', { className: 'as-row-preview' }, article.preview) : null,
                            h('span', { className: 'as-row-meta' }, tr('words', { count: article.chars }), h('span', null, relativeTime(article.updatedAt, tr))),
                          ),
                          h('button', {
                            type: 'button', className: 'as-row-del', title: tr('delete'),
                            'aria-label': tr('deleteTitle', { title: label }), disabled: navigation !== null,
                            onClick: () => setPendingDelete(article),
                          }, h(Icon, { name: 'trash', size: 14 })),
                        )
                      }),
                    ),
            ),
            showOutline ? h(ArticleOutline, { tr, title, headings, active: activeHeading, onJump: jumpToHeading }) : null,
          ),
          h(
            'section',
            { className: 'as-main' },
            doc === null && (loadState === 'loading' || navigation !== null)
              ? h('div', { className: 'as-empty-main', role: 'status' }, tr(navigation === 'create' ? 'creatingArticle' : navigation === 'read' ? 'openingArticle' : 'loadingArticles'))
              : doc === null
              ? h(
                  'div',
                  { className: 'as-empty-main' },
                  h('span', { className: 'as-empty-icon', 'aria-hidden': 'true' }, h(Icon, { name: 'doc', size: 40 })),
                  h('h2', null, loadState === 'error' ? tr('error') : tr(roster.articles.length ? 'chooseArticle' : 'noArticles')),
                  loadState === 'error' || roster.articles.length === 0 ? h('p', null, loadState === 'error' ? error : tr('noArticlesHint')) : null,
                  loadState === 'error' ? null : h('p', { className: 'as-empty-help' }, tr('emptyHint', { key: tr('shortcut'), name: identityName })),
                  loadState === 'error'
                    ? h('button', { type: 'button', className: 'as-btn', onClick: () => void loadRoster() }, tr('retry'))
                    : roster.articles.length === 0 ? h('button', { type: 'button', className: 'as-btn as-new-btn', onClick: createArticle }, tr('createFirst')) : null,
                )
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'as-toolbar' },
                    h(
                      'div',
                      { className: 'as-seg', role: 'group' },
                      h(
                        'button',
                        { type: 'button', className: 'as-seg-btn', 'data-active': !preview, 'aria-pressed': !preview, onClick: () => switchCanvas(false) },
                        tr(change === null ? 'edit' : 'review'),
                      ),
                      h(
                        'button',
                        { type: 'button', className: 'as-seg-btn', 'data-active': preview, 'aria-pressed': preview, onClick: () => switchCanvas(true) },
                        tr('preview'),
                      ),
                    ),
                    h('span', { className: 'as-div' }),
                    !preview && !change ? h('button', {
                      type: 'button', className: 'as-btn as-btn-compact as-image-picker',
                      disabled: !canInsertImage || imageTask?.kind === 'uploading', title: tr('imageHelp'),
                      onClick: () => {
                        imageAnchorRef.current = imageTarget()
                        if (imageAnchorRef.current) imageInputRef.current?.click()
                      },
                    }, h(Icon, { name: 'picture', size: 14 }), tr('insertImage')) : null,
                    h('input', {
                      ref: imageInputRef, type: 'file', hidden: true, multiple: true,
                      accept: 'image/png,image/jpeg,image/webp,image/gif',
                      onChange: (event) => {
                        const files = Array.from(event.currentTarget.files ?? [])
                        event.currentTarget.value = ''
                        const target = imageAnchorRef.current
                        imageAnchorRef.current = null
                        void uploadImages(files, target)
                      },
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'as-btn as-btn-compact',
                        'aria-expanded': styleMenu !== null, 'aria-haspopup': 'dialog',
                        title: tr('style'),
                        onClick: (event) => setStyleMenu(styleMenu === null ? { rect: event.currentTarget.getBoundingClientRect() } : null),
                      },
                      h(Icon, { name: 'sliders', size: 13 }),
                      h('span', null, tr('style')),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'as-iconbtn as-icononly',
                        title: tr('more'),
                        'aria-label': tr('more'), 'aria-expanded': overflowMenu !== null, 'aria-haspopup': 'dialog',
                        onClick: (event) => setOverflowMenu({ rect: event.currentTarget.getBoundingClientRect() }),
                      },
                      '⋯',
                    ),
                    h('span', { className: 'as-gap' }),
                    h('span', { className: 'as-save', 'data-state': status, role: 'status' }, navigation === 'read' ? tr('openingArticle') : statusText),
                  ),
                  imageTask !== null ? h('div', { className: 'as-image-notice', 'data-kind': imageTask.kind },
                    h('span', { role: imageTask.kind === 'error' ? 'alert' : 'status' },
                      tr(imageTask.kind === 'error' ? imageTask.reason : imageTask.kind === 'added' ? 'imageAdded' : imageTask.kind === 'ready' ? 'imageMoved' : 'imageUploading', imageTask)),
                    imageTask.kind === 'added' && !preview ? h('button', {
                      type: 'button', className: 'as-btn as-btn-compact', onClick: () => setPreview(true),
                    }, tr('imagePreview')) : null,
                    imageTask.kind === 'added' && text === imageTask.after && canInsertImage ? h('button', {
                      type: 'button', className: 'as-btn as-btn-compact', onClick: undoImageInsertion,
                    }, tr('imageUndo')) : null,
                    imageTask.kind === 'ready' && canInsertImage ? h('button', {
                      type: 'button', className: 'as-btn as-btn-compact', onClick: () => placeImages(imageTask.images, imageTarget()),
                    }, tr('imagePlace')) : null,
                    imageTask.kind === 'ready' && !canInsertImage ? h('span', null, tr('imageEditFirst')) : null,
                    imageTask.kind === 'error' && imageTask.files && canInsertImage ? h('button', {
                      type: 'button', className: 'as-btn as-btn-compact', onClick: () => void uploadImages(imageTask.files, imageTask.target),
                    }, tr('retry')) : null,
                    imageTask.kind !== 'uploading' ? h('button', {
                      type: 'button', className: 'as-iconbtn as-image-dismiss', 'aria-label': tr('close'), onClick: () => setImageTask(null),
                    }, '×') : null,
                  ) : null,
                  change !== null
                    ? h(
                        'div',
                        { className: 'as-change-bar', role: 'group', 'aria-label': tr('review') },
                        h('span', { className: 'as-change-text' }, tr('changeBanner', { name: change.name || identityName })),
                        h('div', { className: 'as-review-actions' },
                          changeCount > 0 ? h(React.Fragment, null,
                            h('button', { type: 'button', className: 'as-iconbtn', title: tr('priorChange'), 'aria-label': tr('priorChange'), onClick: () => moveReview(-1) }, '↑'),
                            h('span', { className: 'as-change-count', role: 'status' }, tr(activeChange < 0 ? 'changeTotal' : 'changePosition', { current: activeChange + 1, total: changeCount })),
                            h('button', { type: 'button', className: 'as-iconbtn', title: tr('nextChange'), 'aria-label': tr('nextChange'), onClick: () => moveReview(1) }, '↓'),
                          ) : null,
                          h('button', { type: 'button', className: 'as-btn as-new-btn', disabled: dirty || reviewPending || conflict !== null, onClick: () => void decideReview('accept') }, tr('acceptChange')),
                          h('button', { type: 'button', className: 'as-btn as-btn-ghost', disabled: dirty || reviewPending || conflict !== null, onClick: () => void decideReview('undo') }, tr('undoChange')),
                        ),
                      )
                    : null,
                  h(
                    'div',
                    {
                      ref: scrollRef, tabIndex: -1, className: 'as-scroll', style: canvas, 'data-mode': preview ? 'preview' : 'edit',
                      onDragOver: (event) => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault() },
                      onDrop: (event) => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault() },
                    },
                    h(
                      'div',
                      {
                        className: 'as-page',
                        onClick: (event) => {
                          if (preview) return
                          const editor = editorRef.current
                          if (editor === null || editor.contains(event.target)) return
                          if (typeof event.target.closest === 'function' && event.target.closest('input, textarea, a, button')) return
                          editor.focus()
                          const range = caretAtOffset(editor, editor.textContent?.length ?? 0)
                          const selection = window.getSelection()
                          selection?.removeAllRanges()
                          selection?.addRange(range)
                        },
                      },
                      preview ? h('h2', { className: 'as-doc-title as-doc-title-display' }, title || tr('untitled')) : h('input', {
                        ref: titleInputRef,
                        className: 'as-doc-title',
                        value: title,
                        readOnly: reviewPending,
                        placeholder: tr('untitled'),
                        'aria-label': tr('untitled'),
                        onChange: onTitleChange,
                        onKeyDown: (event) => {
                          if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
                            event.preventDefault()
                            editorRef.current?.focus()
                          }
                        },
                        onBlur: () => {
                          if (dirtyRef.current) void saveNow()
                        },
                      }),
                      change !== null && !preview
                        ? h(
                            'div',
                            { className: 'as-diff', role: 'document', 'aria-label': tr('review') },
                            (() => {
                              let editIndex = 0
                              return groups.map((group, index) => group.edits ? h('span', {
                                key: index,
                                'data-review-active': editIndex++ === activeChange,
                              }, group.edits.map((segment, i) => h(segment.op === 'del' ? 'del' : 'ins', {
                                key: i, className: segment.op === 'del' ? 'as-diff-del' : 'as-diff-ins',
                              }, segment.text))) : group.text)
                            })(),
                          )
                        : preview
                        ? h(
                            'div',
                            { className: 'as-prose', style: { '--as-para-gap': `${style.paragraphGap}px` } },
                            ...renderMarkdown(structure, tr),
                          )
                        : h('div', {
                            ref: editorRef,
                            className: 'as-text',
                            contentEditable: true,
                            suppressContentEditableWarning: true,
                            spellCheck: false,
                            role: 'textbox',
                            'aria-multiline': 'true',
                            'aria-label': tr('bodyLabel'),
                            'data-placeholder': `${tr('emptyDocument')}\n${tr('imageHelp')}`,
                            'data-image-drag': imageDrag,
                            'data-image-drop-hint': tr('dropImage'),
                            onInput: onEditorInput,
                            onKeyUp: rememberSelection,
                            onMouseUp: rememberSelection,
                            onBlur: () => {
                              if (dirtyRef.current) void saveNow()
                            },
                            onPaste: (event) => {
                              event.preventDefault()
                              const files = transferFiles(event.clipboardData).filter((file) => file.type.startsWith('image/'))
                              if (files.length > 0) {
                                void uploadImages(files, imageTarget())
                                return
                              }
                              const pasted = event.clipboardData?.getData('text/plain') ?? ''
                              if (pasted !== '') insertAtCaret(pasted, true)
                            },
                            onDragOver: (event) => {
                              if (!canInsertImage || !hasDraggedImage(event.dataTransfer) || uploadRef.current) return
                              event.preventDefault()
                              event.dataTransfer.dropEffect = 'copy'
                              setImageDrag(true)
                            },
                            onDragLeave: (event) => {
                              if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) setImageDrag(false)
                            },
                            onDrop: (event) => {
                              event.preventDefault()
                              setImageDrag(false)
                              const files = transferFiles(event.dataTransfer)
                              if (files.length > 0) {
                                void uploadImages(files, imageTarget(event))
                                return
                              }
                              const dropped = event.dataTransfer?.getData('text/plain') ?? ''
                              if (dropped !== '') insertAtCaret(dropped, true)
                            },
                            onKeyDown: (event) => {
                              const primary = event.metaKey || event.ctrlKey
                              if (primary && !event.altKey && (event.key === 'k' || event.key === 'K')) {
                                event.preventDefault()
                                event.stopPropagation()
                                openAgent(selectionTip, event.currentTarget)
                                return
                              }
                              if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
                                event.preventDefault()
                                insertAtCaret('\n', true)
                              }
                            },
                          }),
                    ),
                  ),
                  h(
                    'footer',
                    { className: 'as-foot' },
                    h('span', null, tr('words', { count: wordCount })),
                    h('span', { className: 'as-gap' }),
                    chat.running
                      ? h('span', { className: 'as-running' }, h('span', { className: 'as-dot' }), tr('working'))
                      : null,
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'as-idchip',
                        title: tr('identityPick'),
                        'aria-label': `${tr('identityPick')} · ${identityName}`,
                        'aria-expanded': identityMenu !== null, 'aria-haspopup': 'dialog',
                        onClick: (event) => setIdentityMenu({ rect: event.currentTarget.getBoundingClientRect() }),
                      },
                      h('span', { className: 'as-avatar', 'aria-hidden': 'true' }, identityName.slice(0, 1)),
                      h('span', { className: 'as-idname' }, identityName),
                      h('span', { className: 'as-caret', 'aria-hidden': 'true' }, '▾'),
                    ),
                    h(
                      'button',
                      { type: 'button', className: 'as-btn-summon', onClick: (event) => openAgent(selectionTip, event.currentTarget), title: tr('summon', { name: identityName }) },
                      h('kbd', null, tr('shortcut')),
                      h('span', null, tr('summon', { name: identityName })),
                    ),
                  ),
                ),
          ),
        ),
        popover !== null && doc !== null
          ? h(AgentPopover, {
              key: doc.id,
              rect: popover.rect,
              width: panelWidth,
              tr,
              identityName,
              chat,
              selectionText: popover.selection,
              quickAction: popover.selection ? 'polish' : text.trim() ? 'continue' : 'draft',
              resetArmed,
              setResetArmed,
              onSend: (instruction) => sendInstruction(instruction, popover),
              onStop: stopAgent,
              onClose: closeAgent,
              onReset: resetConversation,
            })
          : null,
        styleMenu !== null && doc !== null
          ? h(
              Menu,
              { rect: styleMenu.rect, width: 396, label: tr('style'), onClose: () => setStyleMenu(null) },
              h('div', { className: 'as-menu-head' }, tr('style')),
              h(
                'div',
                { className: 'as-style-grid' },
                h(
                  'label',
                  { className: 'as-sfield' },
                  h('span', { className: 'as-slabel' }, tr('preset')),
                  h(
                    'select',
                    { defaultValue: '', onChange: (event) => { if (event.target.value !== '') applyRecipe(event.target.value); event.target.value = '' } },
                    h('option', { value: '' }, '—'),
                    STYLE_PRESETS.map((name) => h('option', { key: name, value: name }, tr(`preset.${name}`))),
                  ),
                ),
                h(
                  'label',
                  { className: 'as-sfield' },
                  h('span', { className: 'as-slabel' }, tr('font')),
                  h(
                    'select',
                    { value: style.font, onChange: (event) => changeStyle({ font: event.target.value }) },
                    ['serif', 'sans', 'kai', 'mono'].map((font) => h('option', { key: font, value: font }, tr(`font.${font}`))),
                  ),
                ),
                h(
                  'label',
                  { className: 'as-sfield' },
                  h('span', { className: 'as-slabel' }, tr('size')),
                  h(
                    'span',
                    { className: 'as-srow' },
                    h('input', { type: 'range', min: 13, max: 30, step: 1, value: style.fontSize, onChange: (event) => changeStyle({ fontSize: Number(event.target.value) }) }),
                    h('output', null, `${style.fontSize}px`),
                  ),
                ),
                h(
                  'label',
                  { className: 'as-sfield' },
                  h('span', { className: 'as-slabel' }, tr('lineHeight')),
                  h(
                    'span',
                    { className: 'as-srow' },
                    h('input', { type: 'range', min: 1.3, max: 2.6, step: 0.05, value: style.lineHeight, onChange: (event) => changeStyle({ lineHeight: Number(event.target.value) }) }),
                    h('output', null, style.lineHeight.toFixed(2)),
                  ),
                ),
                h(
                  'label',
                  { className: 'as-sfield' },
                  h('span', { className: 'as-slabel' }, tr('paragraphGap'), h('span', { className: 'as-snote' }, `(${tr('paragraphGapNote')})`)),
                  h(
                    'span',
                    { className: 'as-srow' },
                    h('input', { type: 'range', min: 0, max: 40, step: 1, value: style.paragraphGap, onChange: (event) => changeStyle({ paragraphGap: Number(event.target.value) }) }),
                    h('output', null, `${style.paragraphGap}px`),
                  ),
                ),
                h(
                  'label',
                  { className: 'as-sfield' },
                  h('span', { className: 'as-slabel' }, tr('width')),
                  h(
                    'span',
                    { className: 'as-srow' },
                    h('input', { type: 'range', min: 520, max: 980, step: 10, value: style.width, onChange: (event) => changeStyle({ width: Number(event.target.value) }) }),
                    h('output', null, `${style.width}px`),
                  ),
                ),
                h(
                  'label',
                  { className: 'as-sfield' },
                  h('span', { className: 'as-slabel' }, tr('align')),
                  h(
                    'select',
                    { value: style.align, onChange: (event) => changeStyle({ align: event.target.value }) },
                    ['left', 'center', 'justify'].map((align) => h('option', { key: align, value: align }, tr(`align.${align}`))),
                  ),
                ),
                h(
                  'label',
                  { className: 'as-sfield' },
                  h('span', { className: 'as-slabel' }, tr('theme'), h('span', { className: 'as-snote' }, `(${tr('paragraphGapNote')})`)),
                  h(
                    'select',
                    { value: style.theme, onChange: (event) => changeStyle({ theme: event.target.value }) },
                    ['paper', 'sepia', 'dark'].map((theme) => h('option', { key: theme, value: theme }, tr(`theme.${theme}`))),
                  ),
                ),
                h(
                  'label',
                  { className: 'as-scheck' },
                  h('input', { type: 'checkbox', checked: style.indent, onChange: (event) => changeStyle({ indent: event.target.checked }) }),
                  tr('indent'),
                ),
              ),
            )
          : null,
        overflowMenu !== null && doc !== null
          ? h(
              Menu,
              { rect: overflowMenu.rect, width: 188, label: tr('more'), onClose: () => setOverflowMenu(null) },
              roster.git === false
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'as-menu-row',
                      onClick: () => {
                        setOverflowMenu(null)
                        void openHistory()
                      },
                    },
                    h(Icon, { name: 'clock', size: 13 }),
                    h('span', { className: 'as-menu-name' }, tr('versions')),
                  ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'as-menu-row as-menu-danger',
                  onClick: () => {
                    setOverflowMenu(null)
                    setPopover(null)
                    setPendingDelete({ id: doc.id, title: titleRef.current })
                  },
                },
                h(Icon, { name: 'trash', size: 13 }),
                h('span', { className: 'as-menu-name' }, tr('delete')),
              ),
            )
          : null,
        identityMenu !== null
          ? h(
              Menu,
              { rect: identityMenu.rect, width: 232, label: tr('identityPick'), onClose: () => setIdentityMenu(null) },
              h('div', { className: 'as-menu-head' }, tr('identityPick')),
              identities.map((entry) =>
                h(
                  'button',
                  {
                    key: entry.id,
                    type: 'button',
                    className: 'as-menu-row',
                    'data-active': partnerId === entry.id ? 'true' : 'false',
                    onClick: () => {
                      setPinned(entry.id)
                      setIdentityMenu(null)
                    },
                  },
                  h('span', { className: 'as-avatar', 'aria-hidden': 'true' }, String(entry.name ?? '?').slice(0, 1)),
                  h('span', { className: 'as-menu-name' }, entry.name ?? entry.id),
                  entry.role ? h('span', { className: 'as-menu-role' }, entry.role) : null,
                  partnerId === entry.id ? h('span', { className: 'as-menu-mark' }, '✓') : null,
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'as-menu-row',
                  'data-active': pinnedId === null ? 'true' : 'false',
                  onClick: () => {
                    setPinned(null)
                    setIdentityMenu(null)
                  },
                },
                h('span', { className: 'as-menu-name' }, tr('followIdentity')),
                pinnedId === null ? h('span', { className: 'as-menu-mark' }, '✓') : null,
              ),
              identities.length === 0 ? h('div', { className: 'as-menu-empty' }, tr('noIdentities')) : null,
            )
          : null,
        selectionTip !== null && popover === null && doc !== null && !sideOpen && pendingDelete === null && !historyOpen && styleMenu === null && overflowMenu === null && identityMenu === null
          ? ReactDOM.createPortal(
              h(
                'button',
                {
                  type: 'button',
                  className: 'as-selbub',
                  title: tr('discuss', { name: identityName }),
                  style: {
                    left: Math.max(8, Math.min(selectionTip.rect.left, (typeof window === 'undefined' ? 1200 : window.innerWidth) - 176)),
                    top: Math.max(8, selectionTip.rect.top - 34),
                  },
                  onMouseDown: (event) => event.preventDefault(),
                  onClick: () => openAgent(selectionTip, scrollRef.current),
                },
                h('span', { className: 'as-avatar', 'aria-hidden': 'true' }, identityName.slice(0, 1)),
                h('span', null, tr('discuss', { name: identityName })),
              ),
              document.body,
            )
          : null,
        historyOpen
          ? ReactDOM.createPortal(
              h(
              'div',
              { className: 'as-history-backdrop', onClick: () => setHistoryOpen(false) },
              h(
                'div',
                { className: 'as-history', role: 'dialog', 'aria-modal': 'true', onClick: (event) => event.stopPropagation() },
                h(
                  'div',
                  { className: 'as-history-head' },
                  h('h3', null, tr('versions')),
                  h('span', { className: 'as-gap' }),
                  h('button', { type: 'button', className: 'as-iconbtn', title: tr('close'), 'aria-label': tr('close'), onClick: () => setHistoryOpen(false) }, '✕'),
                ),
                h(
                  'div',
                  { className: 'as-history-list' },
                  versionsLoading
                    ? h('div', { className: 'as-history-empty' }, '…')
                    : versions.length === 0
                      ? h('div', { className: 'as-history-empty' }, tr('versionsEmpty'))
                      : versions.map((version) =>
                          h(
                            'div',
                            { key: version.sha, className: 'as-version', 'data-active': versionPreview?.sha === version.sha ? 'true' : 'false' },
                            h(
                              'div',
                              { className: 'as-version-main', style: { cursor: 'pointer' }, onClick: () => void previewVersion(version.sha) },
                              h('span', { className: 'as-version-msg' }, version.message),
                              h('span', { className: 'as-version-time' }, relativeTime(version.at, tr)),
                            ),
                            h('button', { type: 'button', className: 'as-btn', onClick: () => void restoreVersion(version.sha) }, tr('restore')),
                          ),
                        ),
                ),
                versionPreview !== null
                  ? h(
                      'div',
                      { className: 'as-version-preview' },
                      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, versionPreview.title || tr('untitled')),
                      versionPreview.text,
                    )
                  : null,
              ),
            ),
              document.body,
            )
          : null,
        pendingDelete !== null
          ? ReactDOM.createPortal(
              h(
              'div',
              { className: 'as-modal-backdrop', onClick: () => setPendingDelete(null) },
              h(
                'div',
                {
                  className: 'as-modal',
                  role: 'alertdialog',
                  'aria-modal': 'true',
                  onClick: (event) => event.stopPropagation(),
                  onKeyDown: (event) => {
                    if (event.key === 'Escape') setPendingDelete(null)
                  },
                },
                h('h3', null, tr('deleteTitle', { title: pendingDelete.title === '' ? tr('untitled') : pendingDelete.title })),
                h('p', null, tr('deleteBody')),
                h(
                  'div',
                  { className: 'as-modal-actions' },
                  h('button', { type: 'button', className: 'as-btn', autoFocus: true, onClick: () => setPendingDelete(null) }, tr('cancel')),
                  h('button', { type: 'button', className: 'as-btn', 'data-tone': 'primary', onClick: () => void deleteArticle() }, tr('confirmDelete')),
                ),
              ),
            ),
              document.body,
            )
          : null,
      )
    }

    /** The caret-anchored writing partner surface. */
    /**
     * The caret-anchored writing partner: a slim command bar that turns into a
     * one-exchange conversation. Older turns stay behind a history toggle.
     */
    function AgentPopover(props) {
      const tr = props.tr
      const [input, setInput] = React.useState('')
      const [sendError, setSendError] = React.useState('')
      const [sending, setSending] = React.useState(false)
      const [showHistory, setShowHistory] = React.useState(false)
      const inputRef = React.useRef(null)
      const resultRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const entries = props.chat.entries ?? []

      React.useEffect(() => {
        const onDown = (event) => {
          const node = panelRef.current
          if (node !== null && !node.contains(event.target)) props.onClose(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [])

      const lastOf = (role) => {
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          if (entries[index].role === role) return entries[index]
          if (role === 'assistant' && entries[index].role === 'user') return null
        }
        return null
      }
      const lastAssistant = React.useMemo(() => lastOf('assistant'), [entries])
      const lastUser = React.useMemo(() => lastOf('user'), [entries])
      const toolNames = React.useMemo(() => {
        let start = 0
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          if (entries[index].role === 'user') {
            start = index
            break
          }
        }
        const names = []
        for (let index = start; index < entries.length; index += 1) {
          const entry = entries[index]
          if (entry.role !== 'tool' || isNotice(entry)) continue
          const name = entry.name ?? entry.tool ?? 'tool'
          if (!names.includes(name)) names.push(name)
        }
        return names
      }, [entries])

      React.useEffect(() => {
        inputRef.current?.focus()
      }, [])

      React.useEffect(() => {
        const node = resultRef.current
        if (node === null) return
        node.scrollTop = node.scrollHeight
      }, [entries.length, props.chat.running, showHistory])

      // Grow the input with its content, up to three lines.
      React.useEffect(() => {
        const node = inputRef.current
        if (node === null) return
        node.style.height = 'auto'
        node.style.height = `${Math.min(node.scrollHeight, 96)}px`
      }, [input])

      const send = async () => {
        const value = input.trim()
        if (value === '' || sending || props.chat.running) return
        setSending(true)
        setSendError('')
        try {
          const failure = await props.onSend(value)
          if (failure !== null) setSendError(failure)
          else setInput('')
        } finally {
          setSending(false)
          inputRef.current?.focus()
        }
      }

      const rect = props.rect ?? { left: 40, top: 40, bottom: 60, width: 0, height: 0 }
      const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
      const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
      const width = Math.min(404, Math.max(268, props.width - 24))
      const spaceBelow = viewportHeight - rect.bottom - 16
      const spaceAbove = rect.top - 16
      const above = spaceBelow < 300 && spaceAbove > spaceBelow
      const left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12))
      const maxHeight = Math.max(180, Math.min(520, above ? spaceAbove : spaceBelow))
      const position = above
        ? { left, bottom: viewportHeight - rect.top + 10, maxHeight }
        : { left, top: Math.min(rect.bottom + 10, viewportHeight - 120), maxHeight }

      const showResult = showHistory || props.chat.running || lastAssistant !== null || toolNames.length > 0 || (props.chat.pendingInput?.length ?? 0) > 0

      const rowOf = (entry) => {
        if (entry.role === 'tool') {
          return h(
            'div',
            { key: entry.id, className: 'as-line', 'data-tone': isNotice(entry) ? 'error' : undefined, title: entry.text },
            h('b', null, isNotice(entry) ? 'note' : entry.name ?? entry.tool ?? 'tool'),
            h('span', null, entry.text),
          )
        }
        if (entry.role === 'user') {
          return h('div', { key: entry.id, className: 'as-line-user' }, entry.text)
        }
        return h('div', { key: entry.id, className: 'as-line-reply' }, entry.text)
      }

      const node = h(
        'div',
        {
          ref: panelRef,
          className: 'as-pop',
          style: position,
          role: 'dialog',
          'aria-label': props.identityName,
          onKeyDown: (event) => {
            if (event.key === 'Escape') props.onClose()
          },
        },
        h(
          'div',
          { className: 'as-pop-head' },
          h('span', { className: 'as-avatar', 'aria-hidden': 'true' }, props.identityName.slice(0, 1)),
          h('span', { className: 'as-pop-name' }, props.identityName),
          props.chat.running
            ? h('span', { className: 'as-pop-state as-running' }, h('span', { className: 'as-dot' }), tr('working'))
            : h('span', { className: 'as-pop-state' }, tr('ready')),
          h('span', { className: 'as-gap' }),
          entries.length > 1
            ? h(
                'button',
                { type: 'button', className: 'as-iconbtn', 'aria-pressed': showHistory, onClick: () => setShowHistory((value) => !value) },
                showHistory ? tr('collapse') : tr('historyCount', { count: entries.length }),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'as-iconbtn',
              title: tr('newChat'),
              onClick: () => {
                if (entries.length === 0) return
                if (props.resetArmed) props.onReset()
                else {
                  props.setResetArmed(true)
                  setTimeout(() => props.setResetArmed(false), 2600)
                }
              },
            },
            props.resetArmed ? tr('resetConfirm') : tr('reset'),
          ),
          h('button', { type: 'button', className: 'as-iconbtn', title: tr('close'), 'aria-label': tr('close'), onClick: () => props.onClose() }, '✕'),
        ),
        props.selectionText !== ''
          ? h(
              'div',
              { className: 'as-pop-quote' },
              h('span', { className: 'as-quote-tag' }, tr('selection', { count: Array.from(props.selectionText).length })),
              props.selectionText ? h('span', { className: 'as-quote-text' }, props.selectionText) : null,
            )
          : null,
        h(
          'div',
          { className: 'as-pop-compose' },
          h('textarea', {
            ref: inputRef,
            value: input,
            rows: 1,
            placeholder: tr('compose', { name: props.identityName }),
            'aria-label': tr('compose', { name: props.identityName }),
            readOnly: sending,
            onChange: (event) => { setInput(event.target.value); setSendError('') },
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                void send()
              }
            },
          }),
          props.chat.running
            ? h('button', { type: 'button', className: 'as-send as-send-stop', title: tr('stop'), 'aria-label': tr('stop'), onClick: props.onStop }, '■')
            : h('button', { type: 'button', className: 'as-send', title: tr('send'), 'aria-label': tr('send'), disabled: input.trim() === '' || sending, onClick: () => void send() }, '↑'),
        ),
        sendError ? h('div', { className: 'as-pop-feedback', 'data-error': true, role: 'alert' }, sendError) : null,
        sending ? h('div', { className: 'as-pop-feedback', role: 'status' }, tr('sending')) : null,
        !sending && !props.chat.running && !input && (lastUser === null || props.quickAction === 'polish')
          ? h('div', { className: 'as-pop-suggestion' }, h('button', {
            type: 'button', className: 'as-btn',
            onClick: () => {
              setInput(tr(`${props.quickAction}Prompt`))
              setSendError('')
              inputRef.current?.focus()
            },
          }, tr(`${props.quickAction}Action`))) : null,
        showResult
          ? h(
              'div',
              { className: 'as-pop-result', ref: resultRef },
              showHistory
                ? entries.map(rowOf)
                : [
                    lastUser !== null && !props.chat.running
                      ? h('div', { key: 'last-user', className: 'as-line-user' }, lastUser.text)
                      : null,
                    lastAssistant !== null
                      ? h(
                          'div',
                          { key: 'last-reply', className: 'as-line-reply' },
                          lastAssistant.text,
                        )
                      : null,
                    props.chat.running ? h('div', { key: 'typing', className: 'as-typing' }, h('i'), h('i'), h('i')) : null,
                    toolNames.length > 0
                      ? h('div', { key: 'tools', className: 'as-tools-line', title: toolNames.join(' · ') }, `⚙ ${toolNames.join(' · ')}`)
                      : null,
                  ],
              (props.chat.pendingInput ?? []).includes('approval') ? h('div', { className: 'as-approval' }, tr('approval')) : null,
              (props.chat.pendingInput ?? []).includes('question') ? h('div', { className: 'as-approval' }, tr('questionPending')) : null,
            )
          : null,
      )
      return ReactDOM.createPortal(node, document.body)
    }

    /** Module-level hidden-Session stylesheet, shared by every mounted page. */
    let hiddenTag = null
    let hiddenIds = []

    /** Hide the writing Sessions from the sidebar list; the page remains the surface. */
    function setHiddenSessions(ids) {
      if (typeof document === 'undefined') return
      const next = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
      if (next.length === hiddenIds.length && next.every((id, index) => id === hiddenIds[index])) return
      hiddenIds = next
      if (hiddenTag === null) {
        hiddenTag = document.createElement('style')
        hiddenTag.dataset.plugin = '@local/article-studio'
        hiddenTag.dataset.pluginCss = 'article-studio/hidden-sessions.css'
        document.head.appendChild(hiddenTag)
      }
      const escape = (value) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'))
      hiddenTag.textContent = next.map((id) => `[data-row-key="session:${escape(id)}"]{display:none!important}`).join('\n')
    }

    /** Client entry: dictionaries, styles, the panel, and its sidebar row. */
    return {
      inject: ['slots', 'locale'],
      /** Pure review-diff helpers, exported for the node test suite. */
      __diff: { diffSegments, diffStatsOf, tokenizeText, reviewGroups },
      __images: { imageBlock, parseImage, uploadBelongsTo },
      __outline: { markdownStructure, headingAt },
      apply(ctx) {
        const translate = ctx.locale.bind(NS)
        const tr = (key, vars = {}) => interpolate(translate(key) ?? key, vars)
        ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'article-studio: dictionaries')

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/article-studio'
          tag.dataset.pluginCss = 'article-studio/panel.css'
          tag.textContent = STYLE
          document.head.appendChild(tag)
          return () => {
            tag.remove()
            hiddenTag?.remove()
            hiddenTag = null
            hiddenIds = []
          }
        }, 'article-studio: styles')

        // Hide writer Sessions before the page is opened as well.
        void (async () => {
          try {
            const response = await fetch(`${API}list`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            })
            const data = await response.json()
            if (data?.ok === true) setHiddenSessions(data.sessionIds)
          } catch {
            // The panel retries when it mounts.
          }
        })()

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: PANEL_ID, locale: NS },
            (slotProps) => h(Panel, { ...slotProps, tr, stopContext: ctx, onSessions: setHiddenSessions }),
          ),
        )

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => tr('panel'), locale: NS },
            PanelIcon,
          ),
        )
      },
    }
  },
})