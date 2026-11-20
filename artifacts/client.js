/**
 * Browser half of the artifact canvas.
 *
 * Three surfaces share one small client-side cache:
 *
 * - a transcript card, keyed to `artifact_create` / `artifact_update` results,
 *   that previews the document and opens it;
 * - a canvas tab that renders the current version (sandboxed iframe for HTML,
 *   inline SVG, Markdown, a local chart renderer, Mermaid, or code), switches
 *   between preview / source / edit, and walks the version history;
 * - a gallery tab listing the artifacts of the chat or of the whole project.
 *
 * Rendering is deliberately local: charts are drawn as SVG here, Mermaid is
 * loaded lazily inside its own sandboxed frame, and nothing from an artifact is
 * ever injected into the Harness document itself.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-artifacts',
  factory(require) {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'dshArtifacts';
    /** Keyed tab type that renders one artifact. */
    const ARTIFACT_TAB_ID = '@local/dsh-artifacts/artifact';
    /** Kind opened through the right Sidebar controller. */
    const ARTIFACT_KIND = 'dshArtifact';
    /** Keyed tab type that lists the project's artifacts. */
    const GALLERY_TAB_ID = '@local/dsh-artifacts/gallery';
    /** Kind of the gallery page. */
    const GALLERY_KIND = 'dshArtifactsGallery';
    /** Wire tools that get the inline card. */
    const CARD_TOOLS = ['artifact_create', 'artifact_update'];
    /** Version files rendered as code rather than previewed. */
    const SOURCE_TYPES = new Set(['code']);
    /** Types whose card needs the text, not just the raw URL. */
    const TEXT_PREVIEW_TYPES = new Set(['markdown', 'code', 'chart', 'mermaid']);
    /** Rendered code lines kept in the DOM before truncating. */
    const CODE_LINE_LIMIT = 4000;

    /** English dictionary. */
    const EN = {
      'tab.artifact': 'Artifact',
      'tab.gallery': 'Artifacts',
      'add.title': 'Artifacts',
      'add.description': 'Pages, diagrams, charts, documents, and code',
      'header.title': 'Artifacts',
      'gallery.title': 'Artifacts',
      'gallery.subtitle': 'Documents the assistant built in this project.',
      'gallery.session': 'This chat',
      'gallery.project': 'This project',
      'gallery.empty.title': 'No artifacts yet',
      'gallery.empty.body': 'Ask the assistant for an interactive page, a diagram, a chart, or a formatted document and it will appear here.',
      'gallery.empty.project': 'This project has no artifacts yet.',
      'gallery.count': '{count} artifact(s)',
      'gallery.updated': 'Updated {time}',
      'gallery.open': 'Open',
      'gallery.loading': 'Reading artifacts…',
      'canvas.preview': 'Preview',
      'canvas.code': 'Source',
      'canvas.edit': 'Edit',
      'canvas.save': 'Save',
      'canvas.saving': 'Saving…',
      'canvas.cancel': 'Cancel',
      'canvas.copy': 'Copy',
      'canvas.copied': 'Copied',
      'canvas.download': 'Download',
      'canvas.refresh': 'Reload',
      'canvas.rename': 'Rename',
      'canvas.delete': 'Delete',
      'canvas.deleteConfirm': 'Delete this artifact and every version?',
      'canvas.confirm': 'Delete',
      'canvas.restore': 'Restore this version',
      'canvas.version': 'Version',
      'canvas.current': 'current',
      'canvas.loading': 'Loading…',
      'canvas.missing': 'This artifact no longer exists.',
      'canvas.bytes': '{bytes} bytes',
      'canvas.saved': 'Saved v{version}.',
      'canvas.restored': 'Restored v{version}.',
      'canvas.deleted': 'Deleted.',
      'canvas.dismiss': 'Dismiss',
      'time.justNow': 'Just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',
      'canvas.editHint': 'Editing v{version}. Saving stores a new version; the previous one stays recoverable.',
      'canvas.viewingOld': 'Viewing v{version}; the latest is v{current}.',
      'card.open': 'Open canvas',
      'card.creating': 'Preparing artifact…',
      'card.updating': 'Updating artifact…',
      'card.failed': 'Artifact failed',
      'card.version': 'v{version}',
      'error.load': 'Could not load: {message}',
      'error.save': 'Could not save: {message}',
      'error.copy': 'Could not copy: {message}',
      'error.rename': 'Could not rename: {message}',
      'error.delete': 'Could not delete: {message}',
      'md.copy': 'Copy',
      'md.copied': 'Copied',
      'md.code': 'Code',
      'md.wrap': 'Wrap',
      'md.unwrap': 'No wrap',
      'md.footnotes': 'Footnotes',
      'type.html': 'HTML',
      'type.svg': 'SVG',
      'type.markdown': 'Markdown',
      'type.mermaid': 'Mermaid',
      'type.chart': 'Chart',
      'type.code': 'Code',
    };

    /** Simplified Chinese dictionary. */
    const ZH = {
      'tab.artifact': '画布',
      'tab.gallery': '画布',
      'add.title': '画布',
      'add.description': '网页、图示、图表、文档与代码',
      'header.title': '画布',
      'gallery.title': '画布',
      'gallery.subtitle': '助手在这个项目里生成的可视化内容。',
      'gallery.session': '本次对话',
      'gallery.project': '整个项目',
      'gallery.empty.title': '还没有画布内容',
      'gallery.empty.body': '让助手做一个交互网页、图示、图表或排版文档，内容会出现在这里。',
      'gallery.empty.project': '这个项目还没有画布内容。',
      'gallery.count': '共 {count} 项',
      'gallery.updated': '更新于 {time}',
      'gallery.open': '打开',
      'gallery.loading': '正在读取画布…',
      'canvas.preview': '预览',
      'canvas.code': '源码',
      'canvas.edit': '编辑',
      'canvas.save': '保存',
      'canvas.saving': '保存中…',
      'canvas.cancel': '取消',
      'canvas.copy': '复制',
      'canvas.copied': '已复制',
      'canvas.download': '下载',
      'canvas.refresh': '重新加载',
      'canvas.rename': '重命名',
      'canvas.delete': '删除',
      'canvas.deleteConfirm': '删除这一项及其全部历史版本？',
      'canvas.confirm': '删除',
      'canvas.restore': '恢复此版本',
      'canvas.version': '版本',
      'canvas.current': '当前',
      'canvas.loading': '加载中…',
      'canvas.missing': '这一项已不存在。',
      'canvas.bytes': '{bytes} 字节',
      'canvas.saved': '已保存 v{version}。',
      'canvas.restored': '已恢复 v{version}。',
      'canvas.deleted': '已删除。',
      'canvas.dismiss': '关闭',
      'time.justNow': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
      'canvas.editHint': '正在编辑 v{version}。保存会生成新版本，旧版本仍可恢复。',
      'canvas.viewingOld': '正在查看 v{version}，最新为 v{current}。',
      'card.open': '打开画布',
      'card.creating': '正在准备画布…',
      'card.updating': '正在更新画布…',
      'card.failed': '画布生成失败',
      'card.version': 'v{version}',
      'error.load': '加载失败：{message}',
      'error.save': '保存失败：{message}',
      'error.copy': '复制失败：{message}',
      'error.rename': '重命名失败：{message}',
      'error.delete': '删除失败：{message}',
      'md.copy': '复制',
      'md.copied': '已复制',
      'md.code': '代码',
      'md.wrap': '自动换行',
      'md.unwrap': '不换行',
      'md.footnotes': '脚注',
      'type.html': 'HTML',
      'type.svg': 'SVG',
      'type.markdown': 'Markdown',
      'type.mermaid': 'Mermaid',
      'type.chart': '图表',
      'type.code': '代码',
    };

    /** Colors used by the local chart renderer, readable on both themes. */
    const CHART_COLORS = ['#4c8dff', '#f5a524', '#2fb36b', '#e5534b', '#a371f7', '#22a8b8', '#d16ba5', '#8a8f98'];

    const STYLE = `
:root{--dsa-accent:#5b8cff}
.dsa-turn-list{display:flex;flex-direction:column;gap:10px;margin:6px 0}

/* ---------------------------------------------------------------- cards */
.dsa-card{--dsa-accent:#5b8cff;position:relative;box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:680px;margin:4px 0;border:.5px solid var(--dsw-alias-border-l2,#3a3d44);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#17191d);color:var(--dsw-alias-label-primary,#e7e8ea);overflow:hidden;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.dsa-card:hover{border-color:color-mix(in srgb,var(--dsa-accent) 52%,var(--dsw-alias-border-l2,#3a3d44));box-shadow:0 10px 28px rgba(0,0,0,.22);transform:translateY(-1px)}
.dsa-card[data-type="svg"]{--dsa-accent:#a371f7}
.dsa-card[data-type="markdown"]{--dsa-accent:#41b883}
.dsa-card[data-type="mermaid"]{--dsa-accent:#2bb3c0}
.dsa-card[data-type="chart"]{--dsa-accent:#f2a93b}
.dsa-card[data-type="code"]{--dsa-accent:#8b93a1}
.dsa-card[data-state="error"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f85149) 45%,var(--dsw-alias-border-l2,#3a3d44))}
.dsa-card-head{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:9px 10px 9px 11px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsa-card-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:-2px;border-radius:14px}
.dsa-card-icon{display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:9px;color:var(--dsa-accent);background:color-mix(in srgb,var(--dsa-accent) 14%,transparent);border:.5px solid color-mix(in srgb,var(--dsa-accent) 30%,transparent)}
.dsa-card-headtext{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.dsa-card-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:19px;letter-spacing:-.006em;color:var(--dsw-alias-label-primary,#e7e8ea)}
.dsa-card-sub{display:flex;align-items:center;gap:6px;min-width:0;font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b9098);white-space:nowrap}
.dsa-dot{width:5px;height:5px;border-radius:50%;background:var(--dsa-accent);flex:none}
.dsa-sep{width:2px;height:2px;border-radius:1px;background:currentColor;opacity:.45;flex:none}
.dsa-open{margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2,#3a3d44);background:var(--dsw-alias-bg-layer-2,#202329);color:var(--dsw-alias-label-secondary,#9aa0a8);font-size:11.5px;font-weight:500;line-height:1;white-space:nowrap;transition:color .14s,background-color .14s,border-color .14s}
.dsa-card:hover .dsa-open{color:var(--dsa-accent);border-color:color-mix(in srgb,var(--dsa-accent) 40%,var(--dsw-alias-border-l2,#3a3d44));background:color-mix(in srgb,var(--dsa-accent) 10%,var(--dsw-alias-bg-layer-2,#202329))}

/* preview stage */
.dsa-stage{position:relative;box-sizing:border-box;height:212px;margin:0 10px 10px;border-radius:10px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l1,#2c2f35);background:var(--dsw-alias-bg-layer-2,#202329)}
.dsa-stage[data-tone="paper"]{display:flex;padding:9px;background:linear-gradient(150deg,color-mix(in srgb,var(--dsa-accent) 9%,var(--dsw-alias-bg-layer-2,#202329)),var(--dsw-alias-bg-layer-2,#202329) 62%)}
.dsa-stage[data-tone="theme"]{background-color:var(--dsw-alias-bg-layer-2,#202329);background-image:radial-gradient(color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b9098) 26%,transparent) 1px,transparent 1px);background-size:12px 12px;background-position:center}
.dsa-stage[data-kind="markdown"]{padding:14px 16px;background-image:none}
.dsa-stage[data-kind="code"]{background-image:none;background:var(--dsw-alias-markdown-code-block,#0e1013)}
.dsa-paper{position:relative;flex:1;min-width:0;border-radius:7px;overflow:hidden;background:#fff;box-shadow:0 8px 22px rgba(0,0,0,.26),0 0 0 .5px rgba(0,0,0,.1)}
.dsa-paper-frame{position:absolute;top:0;left:0;width:400%;height:400%;border:0;transform:scale(.25);transform-origin:0 0;pointer-events:none;background:#fff}
.dsa-paper-img{display:block;width:100%;height:100%;object-fit:contain;padding:12px;box-sizing:border-box;background:#fff}
.dsa-md-preview{height:100%;overflow:hidden;font-size:12px;line-height:1.62;color:var(--dsw-alias-label-primary,#e7e8ea);-webkit-mask-image:linear-gradient(#000 72%,transparent);mask-image:linear-gradient(#000 72%,transparent)}
.dsa-md-preview h1,.dsa-md-preview h2,.dsa-md-preview h3{margin:.5em 0 .35em;line-height:1.3}
.dsa-md-preview h1{font-size:18px}
.dsa-md-preview h2{font-size:15px}
.dsa-md-preview p,.dsa-md-preview ul,.dsa-md-preview ol{margin:.4em 0}
.dsa-code-snippet{margin:0;padding:11px 13px;height:100%;box-sizing:border-box;overflow:hidden;font:11px/1.65 var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);white-space:pre;color:var(--dsw-alias-label-secondary,#b3b8c0);background:transparent}
.dsa-card-error{padding:9px 12px;color:var(--dsw-alias-state-error-primary,#f85149);font:11.5px/1.55 var(--ds-font-family-code,ui-monospace,monospace);white-space:pre-wrap;max-height:150px;overflow:auto;border-top:.5px solid var(--dsw-alias-border-l3,#2c2f35)}
.dsa-spin{flex:none;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,#3a3d44);border-top-color:var(--dsw-alias-brand-primary,#4c8dff);border-radius:50%;animation:dsa-rotate .8s linear infinite}
@keyframes dsa-rotate{to{transform:rotate(360deg)}}

/* ---------------------------------------------------------------- canvas */
.dsa-canvas{--dsa-accent:#5b8cff;box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#111317);color:var(--dsw-alias-label-primary,#e7e8ea);font-size:13px;font-family:var(--dsw-font-family,inherit)}
.dsa-canvas[data-type="svg"]{--dsa-accent:#a371f7}
.dsa-canvas[data-type="markdown"]{--dsa-accent:#41b883}
.dsa-canvas[data-type="mermaid"]{--dsa-accent:#2bb3c0}
.dsa-canvas[data-type="chart"]{--dsa-accent:#f2a93b}
.dsa-canvas[data-type="code"]{--dsa-accent:#8b93a1}
.dsa-bar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:9px 11px;border-bottom:.5px solid var(--dsw-alias-border-l3,#2c2f35);background:var(--dsw-alias-bg-layer-1,#17191d)}
.dsa-bar-icon{display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:9px;color:var(--dsa-accent);background:color-mix(in srgb,var(--dsa-accent) 13%,transparent);border:.5px solid color-mix(in srgb,var(--dsa-accent) 26%,transparent)}
.dsa-bar-titles{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.dsa-bar-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:13px;line-height:18px;letter-spacing:-.006em;background:none;border:0;color:inherit;padding:0;text-align:left;font-family:inherit}
.dsa-bar-title:not(:disabled){cursor:pointer}
.dsa-bar-title:not(:disabled):hover{color:var(--dsa-accent)}
.dsa-bar-sub{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b9098)}
.dsa-tools{display:flex;align-items:center;flex-wrap:wrap;gap:4px;flex:none}
.dsa-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;padding:0 9px;border:.5px solid transparent;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary,#9aa0a8);font:inherit;font-size:11.5px;line-height:1;cursor:pointer;white-space:nowrap;transition:background-color .12s,color .12s,border-color .12s}
.dsa-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.13));color:var(--dsw-alias-label-primary,#e7e8ea)}
.dsa-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:-2px}
.dsa-btn:disabled{opacity:.4;cursor:default}
.dsa-btn[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3,#2a2e35);color:var(--dsw-alias-label-primary,#e7e8ea);border-color:var(--dsw-alias-border-l2,#3a3d44)}
.dsa-btn.dsa-danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary,#f85149);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f85149) 13%,transparent)}
.dsa-btn.dsa-primary{background:var(--dsa-accent);color:#fff;border-color:transparent;font-weight:600}
.dsa-btn.dsa-primary:hover:not(:disabled){filter:brightness(1.08);background:var(--dsa-accent);color:#fff}
.dsa-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#202329);border:.5px solid var(--dsw-alias-border-l2,#3a3d44)}
.dsa-seg .dsa-btn{height:22px;padding:0 8px;font-size:11px;border-radius:6px}
.dsa-seg .dsa-btn[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1,#17191d);box-shadow:0 1px 2px rgba(0,0,0,.25);border-color:var(--dsw-alias-border-l2,#3a3d44)}
.dsa-select{appearance:none;height:28px;max-width:118px;border:.5px solid var(--dsw-alias-border-l2,#3a3d44);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#202329);color:var(--dsw-alias-label-secondary,#9aa0a8);padding:0 7px;font:inherit;font-size:11px;cursor:pointer}
.dsa-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:1px}
.dsa-body{flex:1;min-height:0;position:relative;background:var(--dsw-alias-bg-base,#111317)}
.dsa-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent}
.dsa-sheetwrap{position:absolute;inset:0;display:flex;padding:16px;box-sizing:border-box;background-color:var(--dsw-alias-bg-base,#111317);background-image:radial-gradient(color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b9098) 24%,transparent) 1px,transparent 1px);background-size:15px 15px;background-position:center}
.dsa-sheet{position:relative;flex:1;min-width:0;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 14px 38px rgba(0,0,0,.34),0 0 0 .5px rgba(0,0,0,.12)}
.dsa-sheet-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
.dsa-sheet-svg{display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.dsa-sheet-img{max-width:100%;max-height:100%;object-fit:contain}
.dsa-gridstage{position:absolute;inset:0;box-sizing:border-box;padding:18px;background-color:var(--dsw-alias-bg-base,#111317);background-image:radial-gradient(color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b9098) 24%,transparent) 1px,transparent 1px);background-size:15px 15px;background-position:center}
.dsa-figure{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box}
.dsa-figure-card{position:relative;box-sizing:border-box;width:min(100%,980px);border:.5px solid var(--dsw-alias-border-l2,#3a3d44);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#17191d);box-shadow:0 18px 44px rgba(0,0,0,.3);padding:18px 22px;overflow:hidden}
.dsa-mermaid-card{position:relative;box-sizing:border-box;max-width:100%;max-height:100%;border:.5px solid var(--dsw-alias-border-l2,#3a3d44);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#17191d);box-shadow:0 18px 44px rgba(0,0,0,.3);overflow:hidden;transition:width .18s ease,height .18s ease}
.dsa-scroll{position:absolute;inset:0;overflow:auto;padding:18px;box-sizing:border-box;scrollbar-width:thin}
.dsa-md{max-width:820px;margin:0 auto;font-size:14px;line-height:1.72;color:var(--dsw-alias-label-primary,#e7e8ea)}
.dsa-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;height:100%;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary,#9aa0a8);font-size:12.5px;line-height:1.6}
.dsa-center b{color:var(--dsw-alias-label-primary,#e7e8ea);font-size:13px}
.dsa-center svg{opacity:.6}
.dsa-code{min-height:100%;margin:0;padding:12px 0;font:12px/1.68 var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);background:var(--dsw-alias-markdown-code-block,#0e1013);color:var(--dsw-alias-label-primary,#dfe3e8)}
.dsa-code-line{display:flex;min-width:max-content;padding-right:18px}
.dsa-code-no{flex:none;width:52px;padding-right:14px;text-align:right;color:var(--dsw-alias-label-tertiary,#666c76);user-select:none}
.dsa-code-text{white-space:pre;tab-size:2}
.dsa-editor{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#111317)}
.dsa-editor textarea{flex:1;min-height:0;width:100%;box-sizing:border-box;border:0;outline:0;resize:none;padding:14px 16px;background:var(--dsw-alias-markdown-code-block,#0e1013);color:var(--dsw-alias-label-primary,#dfe3e8);font:12px/1.68 var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);tab-size:2}
.dsa-editor-bar{flex:none;display:flex;align-items:center;gap:8px;padding:7px 11px;border-top:.5px solid var(--dsw-alias-border-l3,#2c2f35);background:var(--dsw-alias-bg-layer-1,#17191d);font-size:11px;color:var(--dsw-alias-label-tertiary,#8b9098)}
.dsa-editor-bar span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsa-notice{flex:none;display:flex;align-items:center;gap:8px;padding:6px 11px;border-bottom:.5px solid var(--dsw-alias-border-l3,#2c2f35);background:color-mix(in srgb,var(--dsa-accent) 12%,var(--dsw-alias-bg-layer-2,#202329));color:var(--dsw-alias-label-secondary,#b6bcc5);font-size:11.5px;line-height:1.5}
.dsa-notice[data-kind="error"]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f85149) 13%,var(--dsw-alias-bg-layer-2,#202329));color:var(--dsw-alias-state-error-primary,#f85149)}
.dsa-notice .dsa-btn{height:22px;padding:0 6px;font-size:11px}
.dsa-foot{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:7px 11px;border-top:.5px solid var(--dsw-alias-border-l3,#2c2f35);background:var(--dsw-alias-bg-layer-1,#17191d);font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b9098)}
.dsa-foot .dsa-grow{flex:1;min-width:4px}
.dsa-nameinput{box-sizing:border-box;width:100%;height:24px;border:1px solid var(--dsa-accent);border-radius:6px;background:var(--dsw-alias-bg-layer-2,#202329);color:var(--dsw-alias-label-primary,#e7e8ea);padding:0 6px;font:inherit;font-size:13px;font-weight:600;outline:0}
.dsa-tab-title{display:inline-flex;align-items:center;gap:6px;min-width:0}
.dsa-tab-title span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* --------------------------------------------------------------- gallery */
.dsa-gallery{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#111317);color:var(--dsw-alias-label-primary,#e7e8ea);font-family:var(--dsw-font-family,inherit)}
.dsa-gallery-head{flex:none;display:flex;align-items:flex-start;flex-wrap:wrap;gap:10px;padding:14px 16px 12px;border-bottom:.5px solid var(--dsw-alias-border-l3,#2c2f35);background:var(--dsw-alias-bg-layer-1,#17191d)}
.dsa-gallery-headtext{flex:1;min-width:150px}
.dsa-gallery-title{font-size:15px;font-weight:600;line-height:21px;letter-spacing:-.01em}
.dsa-gallery-sub{margin-top:2px;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b9098)}
.dsa-gallery-body{flex:1;min-height:0;overflow:auto;padding:16px;scrollbar-width:thin}
.dsa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px}
.dsa-tile{--dsa-accent:#5b8cff;display:flex;flex-direction:column;min-width:0;border:.5px solid var(--dsw-alias-border-l2,#3a3d44);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#17191d);overflow:hidden;cursor:pointer;text-align:left;padding:0;color:inherit;font:inherit;transition:border-color .15s,transform .15s,box-shadow .15s}
.dsa-tile[data-type="svg"]{--dsa-accent:#a371f7}
.dsa-tile[data-type="markdown"]{--dsa-accent:#41b883}
.dsa-tile[data-type="mermaid"]{--dsa-accent:#2bb3c0}
.dsa-tile[data-type="chart"]{--dsa-accent:#f2a93b}
.dsa-tile[data-type="code"]{--dsa-accent:#8b93a1}
.dsa-tile:hover{border-color:color-mix(in srgb,var(--dsa-accent) 50%,var(--dsw-alias-border-l2,#3a3d44));transform:translateY(-2px);box-shadow:0 12px 26px rgba(0,0,0,.24)}
.dsa-tile:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:-2px}
.dsa-tile-art{position:relative;height:112px;overflow:hidden;background:linear-gradient(145deg,color-mix(in srgb,var(--dsa-accent) 16%,var(--dsw-alias-bg-layer-2,#202329)),var(--dsw-alias-bg-layer-2,#202329));border-bottom:.5px solid var(--dsw-alias-border-l1,#2c2f35)}
.dsa-tile-frame{position:absolute;top:0;left:0;width:300%;height:300%;border:0;transform:scale(.3333);transform-origin:0 0;pointer-events:none;background:#fff}
.dsa-tile-img{position:absolute;inset:10px;width:calc(100% - 20px);height:calc(100% - 20px);object-fit:contain;border-radius:6px;background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25)}
.dsa-tile-glyph{position:absolute;inset:0;display:grid;place-items:center;color:var(--dsa-accent)}
.dsa-tile-glyph:before{content:"";position:absolute;width:58px;height:58px;border-radius:50%;background:color-mix(in srgb,var(--dsa-accent) 13%,transparent);border:.5px solid color-mix(in srgb,var(--dsa-accent) 25%,transparent)}
.dsa-tile-glyph svg{position:relative}
.dsa-tile-text{padding:9px 11px 10px;min-width:0}
.dsa-tile-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;line-height:17px;letter-spacing:-.005em}
.dsa-tile-meta{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#8b9098);min-width:0;white-space:nowrap}
.dsa-tile-meta .dsa-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:right}
.dsa-count{display:inline-flex;align-items:center;height:20px;margin-bottom:10px;padding:0 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2,#3a3d44);background:var(--dsw-alias-bg-layer-1,#17191d);color:var(--dsw-alias-label-tertiary,#8b9098);font-size:10.5px;line-height:1}
.dsa-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;min-height:260px;padding:28px;text-align:center;color:var(--dsw-alias-label-secondary,#9aa0a8)}
.dsa-empty-icon{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;color:var(--dsw-alias-brand-primary,#4c8dff);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c8dff) 12%,transparent);border:.5px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4c8dff) 25%,transparent)}
.dsa-empty b{color:var(--dsw-alias-label-primary,#e7e8ea);font-size:13.5px}
.dsa-empty p{max-width:360px;margin:0;font-size:12px;line-height:1.65}
.dsa-headerbtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa0a8);font:inherit;font-size:12px;cursor:pointer;transition:background-color .12s,color .12s}
.dsa-headerbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#e7e8ea)}
.dsa-headerbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:1px}
.dsa-headerbtn .lbl{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsa-mermaid-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent}

@media (max-width:640px){
  .dsa-card{max-width:100%}
  .dsa-stage{height:176px}
  .dsa-bar{padding:8px}
  .dsa-btn{padding:0 6px}
  .dsa-sheetwrap,.dsa-gridstage{padding:10px}
  .dsa-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .dsa-tile-art{height:108px}
}
@media (prefers-reduced-motion:reduce){
  .dsa-card,.dsa-tile,.dsa-open,.dsa-btn{transition:none}
  .dsa-spin{animation:none}
}
`;

    // ------------------------------------------------------------- utilities

    /**
     * Fill `{name}` placeholders in one dictionary string.
     * @param text - dictionary value.
     * @param vars - replacement values.
     * @returns the filled string.
     */
    function interpolate(text, vars) {
      if (typeof text !== 'string' || vars === undefined || vars === null) return text;
      return text.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : match));
    }

    /**
     * Translate one key with optional placeholders.
     * @param t - namespace translator.
     * @param key - dictionary key.
     * @param vars - replacement values.
     * @returns the translated string.
     */
    function tr(t, key, vars) {
      return interpolate(t(key), vars);
    }

    /**
     * Read a field from a lazy tool-argument view without ever throwing.
     * @param args - ToolArgs reader, possibly absent.
     * @param name - field name.
     * @returns the value, or an empty string.
     */
    function argText(args, name) {
      try {
        const value = args?.text?.(name);
        return typeof value === 'string' ? value : '';
      } catch {
        return '';
      }
    }

    /**
     * Document-relative API URL.
     * @param route - route name under the plugin's API prefix.
     * @param query - query parameters.
     * @returns the URL.
     */
    function api(route, query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
      }
      const suffix = params.toString();
      return `api/dsh-artifacts/${route}${suffix === '' ? '' : `?${suffix}`}`;
    }

    /**
     * Raw document URL used by iframes and image previews.
     * @param sessionId - owning chat.
     * @param artifact - descriptor.
     * @param version - exact version, or current.
     * @param download - whether the browser should save the file.
     * @returns the URL.
     */
    function rawUrl(sessionId, artifact, version, download = false) {
      return api('raw', {
        sessionId,
        id: artifact.id,
        version,
        download: download ? '1' : '',
      });
    }

    /**
     * Fetch JSON without throwing on a non-2xx status.
     * @param url - request URL.
     * @param init - fetch options.
     * @returns status plus parsed body.
     */
    async function requestJson(url, init) {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, data };
    }

    /**
     * Extract a readable message from a failed JSON response.
     * @param result - request outcome.
     * @param fallback - prefix used when the body carries no message.
     * @returns the message.
     */
    function failureMessage(result, fallback) {
      const message = result?.data?.message;
      return typeof message === 'string' && message !== '' ? message : `${fallback} (HTTP ${result?.status ?? '?'})`;
    }

    /**
     * Resolve one CSS custom property to a concrete color through a probe node.
     * @param name - token name.
     * @param fallback - value used when the token is absent.
     * @returns a computed color.
     */
    function cssColor(name, fallback) {
      const probe = document.createElement('span');
      probe.style.background = `var(${name}, ${fallback})`;
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color === '' ? fallback : color;
    }

    /**
     * Whether the application currently renders the dark theme.
     * @returns whether dark mode is on.
     */
    function isDark() {
      return (
        document.body?.hasAttribute('data-ds-dark-theme') === true ||
        document.documentElement.hasAttribute('data-ds-dark-theme')
      );
    }

    /**
     * Re-render when the application theme flips. Artifact frames and SVG
     * snapshots embed the theme at creation time, so they need a nudge.
     * @returns a counter that changes on every theme switch.
     */
    function useThemeTick() {
      const [tick, setTick] = React.useState(0);
      React.useEffect(() => {
        const bump = () => setTick((value) => value + 1);
        const observer = new MutationObserver(bump);
        if (document.body !== null) {
          observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
        }
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-theme-source'] });
        return () => observer.disconnect();
      }, []);
      return tick;
    }

    /**
     * Format a byte count.
     * @param bytes - size.
     * @returns a compact label.
     */
    function bytesLabel(bytes) {
      if (typeof bytes !== 'number' || bytes < 1024) return `${bytes ?? 0} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Format an ISO timestamp for the current locale.
     * @param iso - timestamp.
     * @returns a short label.
     */
    function timeLabel(iso, t) {
      const value = Date.parse(iso);
      if (Number.isNaN(value)) return '';
      const age = Date.now() - value;
      if (t !== undefined && age >= 0) {
        if (age < 60_000) return t('time.justNow');
        if (age < 3_600_000) return interpolate(t('time.minutes'), { n: Math.max(1, Math.round(age / 60_000)) });
        if (age < 86_400_000) return interpolate(t('time.hours'), { n: Math.max(1, Math.round(age / 3_600_000)) });
        if (age < 7 * 86_400_000) return interpolate(t('time.days'), { n: Math.max(1, Math.round(age / 86_400_000)) });
      }
      return new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    /**
     * Markdown chrome copy for the shared renderer.
     * @param t - namespace translator.
     * @returns the labels object.
     */
    function markdownLabels(t) {
      return {
        code: {
          copyLabel: tr(t, 'md.copy'),
          copiedLabel: tr(t, 'md.copied'),
          toolbarLabels: {
            codeLabel: tr(t, 'md.code'),
            wrapLabel: tr(t, 'md.wrap'),
            unwrapLabel: tr(t, 'md.unwrap'),
          },
        },
        footnotes: tr(t, 'md.footnotes'),
      };
    }

    // ------------------------------------------------------------- shared bus

    /**
     * Cross-surface notification + title cache.
     *
     * The card, the canvas and the gallery are separate slot entries with no
     * parent in common, so a tiny module-level channel is what lets one of
     * them tell the others that an artifact gained a version or a title.
     */
    const bus = {
      listeners: new Map(),
      titles: new Map(),
      /** @param id - artifact id. @param title - display title. */
      setTitle(id, title) {
        if (typeof id !== 'string' || id === '' || typeof title !== 'string' || title === '') return;
        // Idempotent on purpose: every data hook announces its title here, and
        // each hook also listens for invalidations. Emitting an unchanged title
        // would make a fetch invalidate itself forever.
        if (this.titles.get(id) === title) return;
        this.titles.set(id, title);
        this.emit(id);
      },
      /** @param id - artifact id. */
      emit(id) {
        const set = this.listeners.get(id);
        if (set === undefined) return;
        for (const listener of [...set]) {
          try {
            listener();
          } catch {}
        }
      },
      /**
       * @param id - artifact id.
       * @param listener - invalidation callback.
       * @returns unsubscribe.
       */
      on(id, listener) {
        let set = this.listeners.get(id);
        if (set === undefined) {
          set = new Set();
          this.listeners.set(id, set);
        }
        set.add(listener);
        return () => {
          set.delete(listener);
          if (set.size === 0) this.listeners.delete(id);
        };
      },
    };

    /** Gallery component filled in by `apply`; the canvas falls back to it. */
    let GalleryComponent = null;

    /** LocalStorage key remembering which artifact each canvas tab last showed. */
    const LAST_ARTIFACT_KEY = 'dsh-artifacts:last';

    /**
     * Read one tab's last artifact. The Sidebar keeps a tab's layout record but
     * not the navigation parameters its opener passed, so the canvas has to
     * remember its own subject to survive a page reload.
     * @param sessionId - owning chat.
     * @param tabId - tab identity.
     * @returns the artifact id, or an empty string.
     */
    function lastArtifactFor(sessionId, tabId) {
      if (typeof tabId !== 'string' || tabId === '') return '';
      try {
        const table = JSON.parse(window.localStorage.getItem(LAST_ARTIFACT_KEY) ?? '{}');
        if (table === null || typeof table !== 'object') return '';
        const value = table[`${sessionId}:${tabId}`];
        return typeof value === 'string' ? value : '';
      } catch {
        return '';
      }
    }

    /**
     * Remember one tab's artifact for the next reload.
     * @param sessionId - owning chat.
     * @param tabId - tab identity.
     * @param id - artifact id.
     */
    function rememberArtifact(sessionId, tabId, id) {
      if (typeof tabId !== 'string' || tabId === '' || typeof id !== 'string' || id === '') return;
      try {
        const table = JSON.parse(window.localStorage.getItem(LAST_ARTIFACT_KEY) ?? '{}');
        const next = table !== null && typeof table === 'object' ? table : {};
        next[`${sessionId}:${tabId}`] = id;
        window.localStorage.setItem(LAST_ARTIFACT_KEY, JSON.stringify(next));
      } catch {}
    }

    // ------------------------------------------------------------ data hooks

    /**
     * Load one artifact version and follow cross-surface invalidations.
     * @param sessionId - owning chat.
     * @param id - artifact id, or empty to stay idle.
     * @param version - exact version, or undefined for current.
     * @returns `{ loading, data, error, reload }`.
     */
    function useArtifactVersion(sessionId, id, version) {
      const [state, setState] = React.useState({ loading: id !== '', data: null, error: null });
      const [nonce, setNonce] = React.useState(0);

      React.useEffect(() => {
        if (id === '') return undefined;
        return bus.on(id, () => setNonce((value) => value + 1));
      }, [id]);

      React.useEffect(() => {
        if (id === '') {
          setState({ loading: false, data: null, error: null });
          return undefined;
        }
        let alive = true;
        setState((current) => ({ ...current, loading: true, error: null }));
        (async () => {
          try {
            const result = await requestJson(api('content', { sessionId, id, version }));
            if (!alive) return;
            if (!result.ok || result.data === null || typeof result.data.content !== 'string') {
              throw new Error(failureMessage(result, 'Could not load artifact'));
            }
            bus.setTitle(id, result.data.artifact.title);
            setState({ loading: false, data: result.data, error: null });
          } catch (error) {
            if (alive) setState({ loading: false, data: null, error: error instanceof Error ? error.message : String(error) });
          }
        })();
        return () => {
          alive = false;
        };
      }, [sessionId, id, version, nonce]);

      const reload = React.useCallback(() => setNonce((value) => value + 1), []);
      return { ...state, reload };
    }

    /**
     * Load one artifact's metadata only (no content), for a tab chip title.
     * @param sessionId - owning chat.
     * @param id - artifact id, or empty to stay idle.
     * @returns the descriptor, or null while unavailable.
     */
    function useArtifactMeta(sessionId, id) {
      const [artifact, setArtifact] = React.useState(null);
      React.useEffect(() => {
        if (id === '') {
          setArtifact(null);
          return undefined;
        }
        let alive = true;
        (async () => {
          try {
            const result = await requestJson(api('meta', { sessionId, id }));
            if (alive && result.ok && result.data?.artifact !== undefined) {
              setArtifact(result.data.artifact);
              bus.setTitle(id, result.data.artifact.title);
            }
          } catch {}
        })();
        return () => {
          alive = false;
        };
      }, [sessionId, id]);
      return artifact;
    }

    /**
     * List artifacts visible to a chat.
     * @param sessionId - owning chat.
     * @param scope - `session` or `project`.
     * @param revision - external invalidation counter.
     * @returns `{ loading, artifacts, error, reload }`.
     */
    function useArtifactList(sessionId, scope, revision) {
      const [state, setState] = React.useState({ loading: true, artifacts: [], error: null });
      const [nonce, setNonce] = React.useState(0);

      React.useEffect(() => {
        let alive = true;
        setState((current) => ({ ...current, loading: true, error: null }));
        (async () => {
          try {
            const result = await requestJson(api('list', { sessionId, scope }));
            if (!alive) return;
            if (!result.ok || !Array.isArray(result.data?.artifacts)) {
              throw new Error(failureMessage(result, 'Could not list artifacts'));
            }
            for (const artifact of result.data.artifacts) bus.setTitle(artifact.id, artifact.title);
            setState({ loading: false, artifacts: result.data.artifacts, error: null });
          } catch (error) {
            if (alive) setState({ loading: false, artifacts: [], error: error instanceof Error ? error.message : String(error) });
          }
        })();
        return () => {
          alive = false;
        };
      }, [sessionId, scope, nonce, revision]);

      const reload = React.useCallback(() => setNonce((value) => value + 1), []);
      return { ...state, reload };
    }

    // --------------------------------------------------------------- previews

    /**
     * Small type glyph.
     * @param props.type - artifact type.
     * @param props.size - pixel size.
     * @returns the icon element.
     */
    function TypeGlyph({ type, size = 15 }) {
      const common = {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      };
      if (type === 'html') {
        return h(
          'svg',
          common,
          h('path', { d: 'M8.5 8 4.5 12l4 4' }),
          h('path', { d: 'M15.5 8l4 4-4 4' }),
          h('path', { d: 'M13.4 5.8 10.6 18.2' }),
        );
      }
      if (type === 'svg') {
        return h(
          'svg',
          common,
          h('path', { d: 'M4 18.5c3.6-9.5 12.4-9.5 16 0' }),
          h('circle', { cx: 4, cy: 18.5, r: 1.7 }),
          h('circle', { cx: 20, cy: 18.5, r: 1.7 }),
          h('rect', { x: 9.8, y: 4.4, width: 4.4, height: 4.4, rx: 1.2 }),
          h('path', { d: 'M12 8.8v2.2' }),
        );
      }
      if (type === 'markdown') {
        return h(
          'svg',
          common,
          h('path', { d: 'M4.5 17V7.5l4 5 4-5V17' }),
          h('path', { d: 'M17 7.5V15' }),
          h('path', { d: 'M14.8 12.8 17 15l2.2-2.2' }),
        );
      }
      if (type === 'mermaid') {
        return h(
          'svg',
          common,
          h('rect', { x: 3, y: 4, width: 5.5, height: 5.5, rx: 1.2 }),
          h('rect', { x: 15.5, y: 14.5, width: 5.5, height: 5.5, rx: 1.2 }),
          h('rect', { x: 3, y: 14.5, width: 5.5, height: 5.5, rx: 1.2 }),
          h('path', { d: 'M8.5 6.8h3.7a3 3 0 0 1 3 3v5.2' }),
          h('path', { d: 'M13.6 13.4l1.6 1.8 1.6-1.8' }),
          h('path', { d: 'M8.5 17.2h4' }),
        );
      }
      if (type === 'chart') {
        return h(
          'svg',
          common,
          h('path', { d: 'M4 20h16' }),
          h('path', { d: 'M7 20v-6' }),
          h('path', { d: 'M12 20V7' }),
          h('path', { d: 'M17 20v-9' }),
        );
      }
      return h(
        'svg',
        common,
        h('path', { d: 'M9 6.5 4.5 12 9 17.5' }),
        h('path', { d: 'M15 6.5 19.5 12 15 17.5' }),
      );
    }

    /**
     * Sandboxed live preview of an HTML artifact.
     * @param props.sessionId - owning chat.
     * @param props.artifact - descriptor.
     * @param props.version - exact version.
     * @param props.interactive - fill the parent and accept input.
     * @returns the frame element.
     */
    function HtmlFrame({ sessionId, artifact, version, interactive = false }) {
      return h('iframe', {
        className: interactive ? 'dsa-frame' : 'dsa-paper-frame',
        src: rawUrl(sessionId, artifact, version),
        title: artifact.title,
        sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-downloads',
        referrerPolicy: 'no-referrer',
        loading: 'lazy',
      });
    }

    /**
     * Cart one chart specification into a forgiving shape.
     * @param text - artifact JSON.
     * @returns the normalized spec, or undefined when unusable.
     */
    function parseChart(text) {
      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        return undefined;
      }
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
      const kind = ['bar', 'line', 'area', 'pie', 'donut'].includes(raw.kind) ? raw.kind : 'bar';
      const labels = Array.isArray(raw.labels) ? raw.labels.map((label) => String(label)) : [];
      const series = Array.isArray(raw.series)
        ? raw.series
            .filter((item) => item !== null && typeof item === 'object' && Array.isArray(item.values))
            .map((item) => ({
              name: typeof item.name === 'string' ? item.name : '',
              values: item.values.map((value) => {
                const number = Number(value);
                return Number.isFinite(number) ? number : 0;
              }),
            }))
        : [];
      if (labels.length === 0 || series.length === 0) return undefined;
      return {
        kind,
        labels,
        series,
        title: typeof raw.title === 'string' ? raw.title : '',
        unit: typeof raw.unit === 'string' ? raw.unit : '',
        stacked: raw.stacked === true,
      };
    }

    /**
     * Round a maximum up to a readable axis bound.
     * @param value - raw maximum.
     * @returns a bound that divides into clean ticks.
     */
    function niceMax(value) {
      if (!Number.isFinite(value) || value <= 0) return 1;
      const power = 10 ** Math.floor(Math.log10(value));
      const scaled = value / power;
      const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
      return step * power;
    }

    /**
     * Format one axis value compactly.
     * @param value - numeric value.
     * @returns the label.
     */
    function axisNumber(value) {
      const absolute = Math.abs(value);
      if (absolute >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
      if (absolute >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
      if (absolute >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(1);
    }

    /**
     * Truncate one category label.
     * @param label - raw label.
     * @returns at most 12 characters.
     */
    function shortLabel(label) {
      const text = String(label);
      return text.length > 12 ? `${text.slice(0, 11)}…` : text;
    }

    /**
     * Local SVG chart renderer: bar, line, area, pie, and donut.
     * @param props.spec - normalized chart spec.
     * @param props.compact - draw at card size.
     * @returns the chart element.
     */
    function ChartView({ spec, compact = false }) {
      const width = 820;
      const height = 460;
      const margins = {
        left: 62,
        right: 24,
        top: spec.title === '' ? 42 : 64,
        bottom: 46,
      };
      const plotWidth = Math.max(40, width - margins.left - margins.right);
      const plotHeight = Math.max(40, height - margins.top - margins.bottom);
      const pie = spec.kind === 'pie' || spec.kind === 'donut';

      const legend = spec.series.slice(0, 8).map((item, index) =>
        h(
          'g',
          { key: `legend-${index}`, transform: `translate(${margins.left + index * 118}, ${spec.title === '' ? 14 : 44})` },
          h('rect', { width: 10, height: 10, rx: 2.5, fill: CHART_COLORS[index % CHART_COLORS.length] }),
          h(
            'text',
            { x: 15, y: 9, fontSize: 11.5, fill: 'currentColor', opacity: 0.78 },
            shortLabel(item.name === '' ? `#${index + 1}` : item.name),
          ),
        ),
      );

      if (pie) {
        const values = spec.series[0].values;
        const total = values.slice(0, spec.labels.length).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
        const cx = width / 2;
        const cy = margins.top + plotHeight / 2 + 8;
        const radius = Math.min(plotWidth, plotHeight) / 2 - 12;
        const inner = spec.kind === 'donut' ? radius * 0.58 : 0;
        let angle = -Math.PI / 2;
        const slices = values.slice(0, spec.labels.length).map((value, index) => {
          const portion = Math.max(0, value) / total;
          const sweep = portion * Math.PI * 2;
          const start = angle;
          const end = angle + sweep;
          angle = end;
          const large = sweep > Math.PI ? 1 : 0;
          const outerStart = [cx + radius * Math.cos(start), cy + radius * Math.sin(start)];
          const outerEnd = [cx + radius * Math.cos(end), cy + radius * Math.sin(end)];
          const innerEnd = [cx + inner * Math.cos(end), cy + inner * Math.sin(end)];
          const innerStart = [cx + inner * Math.cos(start), cy + inner * Math.sin(start)];
          const path =
            inner > 0
              ? `M ${outerStart[0]} ${outerStart[1]} A ${radius} ${radius} 0 ${large} 1 ${outerEnd[0]} ${outerEnd[1]} L ${innerEnd[0]} ${innerEnd[1]} A ${inner} ${inner} 0 ${large} 0 ${innerStart[0]} ${innerStart[1]} Z`
              : `M ${cx} ${cy} L ${outerStart[0]} ${outerStart[1]} A ${radius} ${radius} 0 ${large} 1 ${outerEnd[0]} ${outerEnd[1]} Z`;
          return { path, index, portion, value };
        });
        return h(
          'svg',
          {
            viewBox: `0 0 ${width} ${height}`,
            className: 'dsa-chart',
            role: 'img',
            'aria-label': spec.title || 'Chart',
            style: compact ? { width: '100%', height: '100%' } : { width: '100%', height: 'auto', maxHeight: '100%' },
          },
          spec.title === '' ? null : h('text', { x: margins.left, y: 27, fontSize: 16, fontWeight: 600, fill: 'currentColor' }, spec.title),
          slices.map((slice) =>
            h('path', {
              key: `slice-${slice.index}`,
              d: slice.path,
              fill: CHART_COLORS[slice.index % CHART_COLORS.length],
              stroke: 'var(--dsw-alias-bg-base, #111317)',
              strokeWidth: 1.5,
            }),
          ),
          h(
            'text',
            { x: cx, y: cy + 4, textAnchor: 'middle', fontSize: 16, fontWeight: 600, fill: 'currentColor', opacity: 0.88 },
            compact ? '' : `${axisNumber(total)}${spec.unit === '' ? '' : ` ${spec.unit}`}`,
          ),
        );
      }

      const stackedTotals = spec.labels.map((_, labelIndex) =>
        spec.series.reduce((sum, item) => sum + Math.max(0, item.values[labelIndex] ?? 0), 0),
      );
      const rawMax = spec.stacked
        ? Math.max(...stackedTotals, 0)
        : Math.max(...spec.series.flatMap((item) => item.values.map((value) => Math.max(0, value))), 0);
      const max = niceMax(rawMax);
      const ticks = 4;

      const xOf = (index) => {
        if (spec.labels.length === 1) return margins.left + plotWidth / 2;
        return margins.left + (plotWidth * index) / (spec.labels.length - 1);
      };
      const bandWidth = plotWidth / Math.max(1, spec.labels.length);
      const bandX = (index) => margins.left + bandWidth * index + bandWidth / 2;
      const yOf = (value) => margins.top + plotHeight - (Math.max(0, value) / max) * plotHeight;

      const grid = [];
      for (let tick = 0; tick <= ticks; tick += 1) {
        const value = (max * tick) / ticks;
        const y = yOf(value);
        grid.push(
          h('line', {
            key: `grid-${tick}`,
            x1: margins.left,
            y1: y,
            x2: margins.left + plotWidth,
            y2: y,
            stroke: 'currentColor',
            strokeOpacity: tick === 0 ? 0.32 : 0.12,
            strokeWidth: 1,
          }),
          h(
            'text',
            { key: `tick-${tick}`, x: margins.left - 10, y: y + 3.5, textAnchor: 'end', fontSize: 11, fill: 'currentColor', opacity: 0.62 },
            `${axisNumber(value)}${spec.unit === '' ? '' : spec.unit}`,
          ),
        );
      }

      const step = Math.max(1, Math.ceil(spec.labels.length / 12));
      const xLabels = spec.labels.map((label, index) =>
        index % step === 0
          ? h(
              'text',
              {
                key: `x-${index}`,
                x: spec.kind === 'bar' ? bandX(index) : xOf(index),
                y: margins.top + plotHeight + 20,
                textAnchor: 'middle',
                fontSize: 11.5,
                fill: 'currentColor',
                opacity: 0.7,
              },
              shortLabel(label),
            )
          : null,
      );

      const marks = [];
      if (spec.kind === 'bar') {
        const groups = spec.labels.length;
        const inner = bandWidth * 0.24;
        const slot = (bandWidth - inner) / (spec.stacked ? 1 : spec.series.length);
        for (let group = 0; group < groups; group += 1) {
          let stackTop = 0;
          spec.series.forEach((item, seriesIndex) => {
            const value = Math.max(0, item.values[group] ?? 0);
            if (value === 0) return;
            const x = margins.left + group * bandWidth + inner / 2 + (spec.stacked ? 0 : slot * seriesIndex);
            const y = yOf(stackTop + value);
            const barHeight = Math.max(1, yOf(stackTop) - y);
            marks.push(
              h('rect', {
                key: `bar-${group}-${seriesIndex}`,
                x,
                y,
                width: Math.max(1, slot * 0.86),
                height: barHeight,
                rx: 3,
                fill: CHART_COLORS[seriesIndex % CHART_COLORS.length],
                opacity: 0.92,
              }),
            );
            if (spec.stacked) stackTop += value;
          });
        }
      } else {
        spec.series.forEach((item, seriesIndex) => {
          const points = item.values.map((value, index) => [xOf(index), yOf(value)]);
          if (spec.kind === 'area') {
            const baseY = yOf(0);
            const path = [
              `M ${points[0][0]} ${baseY}`,
              ...points.map((point) => `L ${point[0]} ${point[1]}`),
              `L ${points[points.length - 1][0]} ${baseY}`,
              'Z',
            ].join(' ');
            marks.push(
              h('path', {
                key: `area-${seriesIndex}`,
                d: path,
                fill: CHART_COLORS[seriesIndex % CHART_COLORS.length],
                opacity: 0.18,
              }),
            );
          }
          marks.push(
            h('polyline', {
              key: `line-${seriesIndex}`,
              points: points.map((point) => point.join(',')).join(' '),
              fill: 'none',
              stroke: CHART_COLORS[seriesIndex % CHART_COLORS.length],
              strokeWidth: 2.6,
              strokeLinejoin: 'round',
              strokeLinecap: 'round',
            }),
          );
          marks.push(
            ...points.map((point, index) =>
              h('circle', {
                key: `dot-${seriesIndex}-${index}`,
                cx: point[0],
                cy: point[1],
                r: 3.2,
                fill: CHART_COLORS[seriesIndex % CHART_COLORS.length],
              }),
            ),
          );
        });
      }

      return h(
        'svg',
        {
          viewBox: `0 0 ${width} ${height}`,
          role: 'img',
          'aria-label': spec.title || 'Chart',
          style: {
            width: '100%',
            height: compact ? '100%' : 'auto',
            maxHeight: '100%',
            color: 'var(--dsw-alias-label-primary, #e7e8ea)',
          },
        },
        spec.title === '' ? null : h('text', { x: margins.left, y: 27, fontSize: 16, fontWeight: 600, fill: 'currentColor' }, spec.title),
        legend,
        grid,
        xLabels,
        marks,
      );
    }

    /**
     * Chart artifact preview with a readable failure state.
     * @param props.text - artifact JSON.
     * @param props.compact - compact rendering.
     * @returns the chart or an explanatory fallback.
     */
    function ChartArtifact({ text, compact = false }) {
      const spec = parseChart(text);
      if (spec === undefined) {
        return h(
          'div',
          {
            className: 'dsa-center',
            style: compact ? { position: 'absolute', inset: 0 } : { position: 'relative', minHeight: 240 },
          },
          h(primitives.IconWarningOutlineRegular, { size: 22 }),
          h('b', null, 'Chart spec could not be read'),
          h('p', null, 'The artifact must contain JSON with "labels" and "series[].values".'),
        );
      }
      return h(
        'div',
        {
          style: compact
            ? { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }
            : { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        },
        h(ChartView, { spec, compact }),
      );
    }

    /**
     * Mermaid preview: the diagram renders inside its own sandboxed frame so
     * the library and the SVG never touch the Harness document.
     * @param props.text - Mermaid source.
     * @param props.compact - compact rendering.
     * @returns the frame element.
     */
    function MermaidArtifact({ text, compact = false }) {
      useThemeTick();
      const frameRef = React.useRef(null);
      const [measured, setMeasured] = React.useState(null);
      React.useEffect(() => {
        const onMessage = (event) => {
          if (event.source !== frameRef.current?.contentWindow) return;
          const data = event.data;
          if (data === null || typeof data !== 'object' || data.type !== 'dsh-artifact:size') return;
          const width = Number(data.width);
          const height = Number(data.height);
          if (Number.isFinite(width) && Number.isFinite(height) && width > 20 && height > 20) {
            setMeasured({ width, height });
          }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
      }, []);
      const source = JSON.stringify(text).replace(/</g, '\\u003c');
      const dark = isDark();
      // A sandboxed frame does not reliably show its parent through a
      // transparent document, so paint the stage's own color and dot grid
      // inside the frame instead of leaving the browser's white base exposed.
      const background = compact
        ? cssColor('--dsw-alias-bg-layer-2', '#202329')
        : cssColor('--dsw-alias-bg-base', '#111317');
      const dot = dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.09)';
      const gridSize = compact ? 12 : 16;
      const document_ = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background-color:${background};background-image:radial-gradient(${dot} .7px,transparent .7px);background-size:${gridSize}px ${gridSize}px;background-position:center;font-family:ui-sans-serif,system-ui,sans-serif}
#c{display:flex;align-items:center;justify-content:center;min-height:100%;padding:${compact ? 8 : 18}px;box-sizing:border-box}
#c svg{max-width:100%;height:auto}
.err{color:${dark ? '#ff9c96' : '#b42318'};font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;padding:16px;max-width:640px;margin:auto}
</style></head><body><div id="c"></div><script type="module">
const src = ${source};
try {
  const mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
  mermaid.initialize({ startOnLoad: false, theme: ${dark ? "'dark'" : "'default'"}, securityLevel: 'strict' });
  const out = await mermaid.render('dsa-mermaid', src);
  document.getElementById('c').innerHTML = out.svg;
  const svg = document.querySelector('svg');
  const view = svg && svg.viewBox && svg.viewBox.baseVal;
  const width = view && view.width ? view.width : svg?.getBoundingClientRect().width;
  const height = view && view.height ? view.height : svg?.getBoundingClientRect().height;
  if (width && height) parent.postMessage({ type: 'dsh-artifact:size', width, height }, '*');
} catch (error) {
  const box = document.createElement('div');
  box.className = 'err';
  box.textContent = 'Mermaid could not render here (offline or invalid diagram).\\n\\n' + (error && error.message ? error.message : String(error)) + '\\n\\nSource is still available in Source mode.';
  document.body.replaceChildren(box);
}
<\/script></body></html>`;
      const frame = h('iframe', {
        ref: frameRef,
        className: compact ? 'dsa-mermaid-frame' : 'dsa-frame',
        srcDoc: document_,
        title: 'Mermaid diagram',
        sandbox: 'allow-scripts',
        referrerPolicy: 'no-referrer',
        loading: 'lazy',
        style: { background: 'transparent' },
      });
      if (compact) return frame;
      const width = measured === null ? 360 : Math.min(900, Math.max(260, measured.width + 56));
      const height = measured === null ? 220 : Math.min(620, Math.max(180, measured.height + 56));
      return h(
        'div',
        { className: 'dsa-figure' },
        h('div', { className: 'dsa-mermaid-card', style: { width, height } }, frame),
      );
    }

    /**
     * Markdown artifact body.
     * @param props.text - Markdown source.
     * @param props.t - translator.
     * @returns the rendered document.
     */
    function MarkdownArtifact({ text, t }) {
      if (primitives.MarkdownText === undefined || primitives.MarkdownText === null) {
        return h('pre', { className: 'dsa-code', style: { padding: 16 } }, text);
      }
      return h(
        'div',
        { className: 'dsa-scroll' },
        h('div', { className: 'dsa-md' }, h(primitives.MarkdownText, { text, labels: markdownLabels(t) })),
      );
    }

    /**
     * Read-only source view with line numbers.
     * @param props.text - source text.
     * @returns the code block.
     */
    function CodeArtifact({ text }) {
      const lines = React.useMemo(() => text.split('\n').slice(0, CODE_LINE_LIMIT), [text]);
      const truncated = text.split('\n').length > CODE_LINE_LIMIT;
      return h(
        'div',
        { className: 'dsa-scroll', style: { padding: 0 } },
        h(
          'div',
          { className: 'dsa-code' },
          lines.map((line, index) =>
            h(
              'div',
              { className: 'dsa-code-line', key: index },
              h('span', { className: 'dsa-code-no' }, String(index + 1)),
              h('span', { className: 'dsa-code-text' }, line === '' ? ' ' : line),
            ),
          ),
          truncated
            ? h('div', { className: 'dsa-code-line' }, h('span', { className: 'dsa-code-no' }, '…'), h('span', { className: 'dsa-code-text' }, `Truncated at ${CODE_LINE_LIMIT} lines.`))
            : null,
        ),
      );
    }

    /**
     * Render one artifact version as its natural presentation.
     * @param props.sessionId - owning chat.
     * @param props.artifact - descriptor.
     * @param props.version - version being shown.
     * @param props.content - text, when the type needs it.
     * @param props.t - translator.
     * @param props.compact - card-size rendering.
     * @returns the preview element.
     */
    function ArtifactPreview({ sessionId, artifact, version, content, t }) {
      const type = artifact.type;
      if (type === 'html') return h(HtmlFrame, { sessionId, artifact, version });
      if (type === 'svg') {
        return h('img', {
          className: 'dsa-paper-img',
          src: rawUrl(sessionId, artifact, version),
          alt: artifact.title,
        });
      }
      if (content === undefined || content === null) {
        return h('div', { className: 'dsa-center' }, h('span', { className: 'dsa-spin' }));
      }
      if (type === 'markdown') {
        return h(
          'div',
          { className: 'dsa-md-preview' },
          primitives.MarkdownText !== undefined && primitives.MarkdownText !== null
            ? h(primitives.MarkdownText, { text: content.slice(0, 8000), labels: markdownLabels(t) })
            : content.slice(0, 900),
        );
      }
      if (type === 'chart') return h(ChartArtifact, { text: content, compact: true });
      if (type === 'mermaid') return h(MermaidArtifact, { text: content, compact: true });
      return h('pre', { className: 'dsa-code-snippet' }, content.split('\n').slice(0, 14).join('\n'));
    }

    /**
     * Canvas rendering: HTML and SVG sit on a paper sheet, Markdown stays
     * native, and charts and diagrams get a dotted technical stage.
     * @param props.sessionId - owning chat.
     * @param props.artifact - descriptor.
     * @param props.version - version being shown.
     * @param props.content - text, when the type needs it.
     * @param props.t - translator.
     * @returns the preview body.
     */
    function CanvasPreview({ sessionId, artifact, version, content, t }) {
      const type = artifact.type;
      if (type === 'html') {
        return h(
          'div',
          { className: 'dsa-sheetwrap' },
          h(
            'div',
            { className: 'dsa-sheet' },
            h('iframe', {
              className: 'dsa-sheet-frame',
              src: rawUrl(sessionId, artifact, version),
              title: artifact.title,
              sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-downloads',
              referrerPolicy: 'no-referrer',
              loading: 'lazy',
            }),
          ),
        );
      }
      if (type === 'svg') {
        return h(
          'div',
          { className: 'dsa-sheetwrap' },
          h(
            'div',
            { className: 'dsa-sheet dsa-sheet-svg' },
            h('img', { className: 'dsa-sheet-img', src: rawUrl(sessionId, artifact, version), alt: artifact.title }),
          ),
        );
      }
      if (content === undefined || content === null) {
        return h('div', { className: 'dsa-center' }, h('span', { className: 'dsa-spin' }));
      }
      if (type === 'markdown') return h(MarkdownArtifact, { text: content, t });
      if (type === 'chart') {
        return h(
          'div',
          { className: 'dsa-gridstage' },
          h('div', { className: 'dsa-figure' }, h('div', { className: 'dsa-figure-card' }, h(ChartArtifact, { text: content }))),
        );
      }
      if (type === 'mermaid') {
        return h('div', { className: 'dsa-gridstage' }, h(MermaidArtifact, { text: content }));
      }
      return h(CodeArtifact, { text: content });
    }

    // ------------------------------------------------------------ open action

    /**
     * Open one artifact in the canvas tab.
     * @param ctx - client root context.
     * @param sessionId - owning chat.
     * @param id - artifact id.
     */
    function openArtifact(ctx, sessionId, id) {
      if (typeof id !== 'string' || id === '') return;
      ctx.sidebarRight.openTab(ARTIFACT_KIND, { params: { artifact: id } });
    }

    /**
     * Open the gallery tab.
     * @param ctx - client root context.
     * @param sessionId - owning chat.
     */
    function openGallery(ctx) {
      ctx.sidebarRight.openTab(GALLERY_KIND);
    }

    // --------------------------------------------------------------- tool card

    /**
     * One settled artifact card, drawn under the turn that produced it.
     *
     * Turn-tail placement is deliberate: a tool call's own cell lives inside the
     * collapsible process group, where a finished artifact would be hidden behind
     * a summary row. The turn tail sits below the closing prose instead.
     *
     * @param props.sessionId - owning chat.
     * @param props.artifact - `{ id, title, type, version }`.
     * @param props.t - translator.
     * @returns the card.
     */
    function makeArtifactResultCard(ctx) {
      return function ArtifactResultCard({ sessionId, artifact: entry, t }) {
        const needsText = TEXT_PREVIEW_TYPES.has(entry.type);
        const content = useArtifactVersion(sessionId, needsText ? entry.id : '', entry.version);
        const [opening, setOpening] = React.useState(false);
        const paper = entry.type === 'html' || entry.type === 'svg';

        React.useEffect(() => {
          bus.setTitle(entry.id, entry.title);
        }, [entry.id, entry.title]);

        const open = () => {
          setOpening(true);
          try {
            openArtifact(ctx, sessionId, entry.id);
          } finally {
            window.setTimeout(() => setOpening(false), 350);
          }
        };

        return h(
          'div',
          {
            className: 'dsa-card',
            'data-type': entry.type,
            'data-state': 'ready',
            title: entry.description === '' ? entry.title : entry.description,
          },
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-card-head',
              onClick: open,
              title: tr(t, 'card.open'),
            },
            h('span', { className: 'dsa-card-icon' }, h(TypeGlyph, { type: entry.type, size: 16 })),
            h(
              'span',
              { className: 'dsa-card-headtext' },
              h('span', { className: 'dsa-card-title' }, entry.title),
              h(
                'span',
                { className: 'dsa-card-sub' },
                h('span', { className: 'dsa-dot' }),
                h('span', null, tr(t, `type.${entry.type}`)),
                h('span', { className: 'dsa-sep' }),
                h('span', null, tr(t, 'card.version', { version: entry.version })),
              ),
            ),
            opening
              ? h('span', { className: 'dsa-spin' })
              : h(
                  'span',
                  { className: 'dsa-open' },
                  h(primitives.IconPanelLeftOutlineRegular, { size: 13 }),
                  h('span', null, tr(t, 'card.open')),
                ),
          ),
          h(
            'div',
            {
              className: 'dsa-stage',
              'data-tone': paper ? 'paper' : 'theme',
              'data-kind': entry.type,
              onClick: open,
              role: 'button',
              tabIndex: -1,
              'aria-hidden': true,
            },
            paper
              ? h(
                  'div',
                  { className: 'dsa-paper' },
                  h(ArtifactPreview, {
                    sessionId,
                    artifact: entry,
                    version: entry.version,
                    content: content.data?.content,
                    t,
                  }),
                )
              : h(ArtifactPreview, {
                  sessionId,
                  artifact: entry,
                  version: entry.version,
                  content: content.data?.content,
                  t,
                }),
          ),
          content.error !== null && needsText
            ? h('div', { className: 'dsa-card-error' }, tr(t, 'error.load', { message: content.error }))
            : null,
        );
      };
    }

    /**
     * Human label for one artifact kind.
     * @param type - artifact kind.
     * @param t - translator.
     * @returns the label.
     */
    function contentTypeLabel(type, t) {
      return t(`type.${type}`);
    }

    /**
     * Register the turn definition that collects this turn's settled artifacts.
     * @param ctx - client root context.
     * @returns the Definition handed to `ctx.uiConversation.events.register`.
     */
    function artifactTurnDefinition() {
      return {
        kind: 'dsh-artifacts',
        match: (event) => {
          if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' };
          if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' };
          if (event.type === 'tool/result' && event.surfaceOp === 'append') return { id: String(event.data.turn), role: 'update' };
          return null;
        },
        start: (_context, match) => {
          if (match.event.type !== 'turn/start') throw new Error('dsh-artifacts turn start requires turn/start');
          return { turn: match.event.data.turn, calls: new Map(), created: [] };
        },
        update: (context, match) => {
          if (match.event.type === 'tool/call') {
            const calls = new Map(context.state.calls);
            calls.set(String(match.event.data.callId), { name: match.event.data.name, seq: match.event.seq });
            return { ...context.state, calls };
          }
          if (match.event.type !== 'tool/result') return context.state;
          const call = context.state.calls.get(String(match.event.data.message.source.callId));
          if (call === undefined || !CARD_TOOLS.includes(call.name)) return context.state;
          const artifact = match.event.data.meta?.artifact;
          if (artifact === null || typeof artifact !== 'object') return context.state;
          const entry = {
            id: typeof artifact.id === 'string' ? artifact.id : '',
            title: typeof artifact.title === 'string' ? artifact.title : '',
            type: typeof artifact.type === 'string' ? artifact.type : 'html',
            version: typeof artifact.version === 'number' ? artifact.version : 1,
            description: typeof artifact.description === 'string' ? artifact.description : '',
            seq: match.event.seq,
          };
          if (entry.id === '') return context.state;
          const created = context.state.created.filter((row) => row.id !== entry.id);
          created.push(entry);
          return { ...context.state, created };
        },
        buildLocationData: (context, scope, previous) => {
          if (scope !== 'turn' || context.state === undefined) return null;
          if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.key === 'dsh-artifacts' && previous.value.created === context.state.created) {
            return previous;
          }
          return {
            kind: 'turn',
            turn: context.state.turn,
            key: 'dsh-artifacts',
            value: { created: context.state.created },
          };
        },
      };
    }

    /**
     * Turn-tail list of the artifacts this turn created or updated.
     * @param props.sessionId - owning chat.
     * @param props.turn - turn location carrying the published data.
     * @param props.seq - closing sequence.
     * @param props.t - translator.
     * @returns the list, or null when the turn made none.
     */
    function makeTurnArtifacts(ctx) {
      const Card = makeArtifactResultCard(ctx);
      return function TurnArtifacts({ sessionId, turn, seq, t }) {
        const data = turn?.data?.get?.('dsh-artifacts');
        const created = Array.isArray(data?.created) ? data.created : [];
        const visible = created.filter((entry) => typeof entry.seq !== 'number' || entry.seq <= seq);
        if (visible.length === 0) return null;
        return h(
          'div',
          { className: 'dsa-turn-list' },
          visible.map((entry) => h(Card, { key: entry.id, sessionId, artifact: entry, t })),
        );
      };
    }

    // ----------------------------------------------------------------- canvas

    /**
     * Canvas tab: one artifact with preview, source, editing, and history.
     * @param props.sessionId - owning chat.
     * @param props.t - translator.
     * @param props.useTabInfo - framework hook reading this tab's navigation.
     * @returns the canvas element.
     */
    function ArtifactTab({ sessionId, t, useTabInfo }) {
      const info = useTabInfo();
      const params = info?.tab?.navigation?.params;
      const tabId = info?.tab?.id;
      const paramId = typeof params?.artifact === 'string' ? params.artifact : '';
      const remembered = React.useMemo(
        () => (paramId !== '' ? paramId : lastArtifactFor(sessionId, tabId)),
        [paramId, sessionId, tabId],
      );
      const id = remembered;

      const [selected, setSelected] = React.useState(undefined);
      const [mode, setMode] = React.useState('preview');
      const [draft, setDraft] = React.useState('');
      const [notice, setNotice] = React.useState(null);
      const [renaming, setRenaming] = React.useState(false);
      const [nameDraft, setNameDraft] = React.useState('');
      const [confirmDelete, setConfirmDelete] = React.useState(false);
      const [busy, setBusy] = React.useState(false);

      const view = useArtifactVersion(sessionId, id, selected);
      const artifact = view.data?.artifact;
      const content = view.data?.content;
      const shownVersion = view.data?.version;

      React.useEffect(() => {
        setSelected(undefined);
        setMode('preview');
        setNotice(null);
        setConfirmDelete(false);
        setRenaming(false);
      }, [id]);

      React.useEffect(() => {
        if (paramId !== '') rememberArtifact(sessionId, tabId, paramId);
      }, [paramId, sessionId, tabId]);

      React.useEffect(() => {
        if (artifact !== undefined) {
          setNameDraft(artifact.title);
          bus.setTitle(artifact.id, artifact.title);
        }
      }, [artifact?.title, artifact?.id]);

      const showNotice = React.useCallback((kind, text) => {
        setNotice({ kind, text, at: Date.now() });
      }, []);

      React.useEffect(() => {
        if (notice === null) return undefined;
        const timer = window.setTimeout(() => setNotice(null), 5000);
        return () => window.clearTimeout(timer);
      }, [notice]);

      const startEdit = React.useCallback(() => {
        if (content === undefined) return;
        setDraft(content);
        setMode('edit');
      }, [content]);

      const save = React.useCallback(async () => {
        if (artifact === undefined || busy) return;
        setBusy(true);
        setNotice(null);
        try {
          const result = await requestJson(api('save'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, id: artifact.id, content: draft }),
          });
          if (!result.ok || result.data === null) throw new Error(failureMessage(result, 'Could not save'));
          bus.setTitle(artifact.id, result.data.artifact.title);
          setSelected(undefined);
          setMode('preview');
          view.reload();
          showNotice('ok', tr(t, 'canvas.saved', { version: result.data.artifact.version }));
        } catch (error) {
          showNotice('error', tr(t, 'error.save', { message: error instanceof Error ? error.message : String(error) }));
        } finally {
          setBusy(false);
        }
      }, [artifact, busy, draft, id, sessionId, showNotice, t, view]);

      const rename = React.useCallback(async () => {
        if (artifact === undefined) return;
        const next = nameDraft.trim();
        if (next === '' || next === artifact.title) {
          setRenaming(false);
          return;
        }
        try {
          const result = await requestJson(api('rename'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, id: artifact.id, title: next }),
          });
          if (!result.ok || result.data === null) throw new Error(failureMessage(result, 'Could not rename'));
          setRenaming(false);
          bus.setTitle(artifact.id, next);
          view.reload();
        } catch (error) {
          showNotice('error', tr(t, 'error.rename', { message: error instanceof Error ? error.message : String(error) }));
        }
      }, [artifact, nameDraft, sessionId, showNotice, t, view]);

      const remove = React.useCallback(async () => {
        if (artifact === undefined) return;
        try {
          const result = await requestJson(api('delete'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, id: artifact.id }),
          });
          if (!result.ok) throw new Error(failureMessage(result, 'Could not delete'));
          setConfirmDelete(false);
          try {
            info?.tab?.actions?.close?.();
          } catch {}
        } catch (error) {
          showNotice('error', tr(t, 'error.delete', { message: error instanceof Error ? error.message : String(error) }));
        }
      }, [artifact, sessionId, showNotice, t]);

      const restore = React.useCallback(async () => {
        if (artifact === undefined || shownVersion === undefined) return;
        try {
          const result = await requestJson(api('restore'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, id: artifact.id, version: shownVersion }),
          });
          if (!result.ok) throw new Error(failureMessage(result, 'Could not restore'));
          setSelected(undefined);
          view.reload();
          showNotice('ok', tr(t, 'canvas.restored', { version: shownVersion }));
        } catch (error) {
          showNotice('error', error instanceof Error ? error.message : String(error));
        }
      }, [artifact, sessionId, shownVersion, showNotice, view]);

      const copy = React.useCallback(async () => {
        if (content === undefined) return;
        try {
          await navigator.clipboard.writeText(content);
          showNotice('ok', tr(t, 'canvas.copied'));
        } catch (error) {
          showNotice('error', tr(t, 'error.copy', { message: error instanceof Error ? error.message : String(error) }));
        }
      }, [content, showNotice, t]);

      if (id === '') {
        return GalleryComponent === null ? null : h(GalleryComponent, { sessionId, t });
      }

      if (view.loading && artifact === undefined) {
        return h('div', { className: 'dsa-canvas' }, h('div', { className: 'dsa-center' }, h('span', { className: 'dsa-spin' }), tr(t, 'canvas.loading')));
      }

      if (view.error !== null && artifact === undefined) {
        return h(
          'div',
          { className: 'dsa-canvas' },
          h(
            'div',
            { className: 'dsa-center' },
            h(primitives.IconWarningOutlineRegular, { size: 24 }),
            h('b', null, tr(t, 'canvas.missing')),
            h('p', null, view.error),
          ),
        );
      }

      const latest = artifact?.version ?? shownVersion;
      const viewingOld = shownVersion !== undefined && latest !== undefined && shownVersion !== latest;
      const shownBytes = artifact.versions.find((record) => record.v === shownVersion)?.bytes ?? artifact.bytes;
      const showSource = SOURCE_TYPES.has(artifact.type);
      const downloadHref = artifact === undefined ? '' : rawUrl(sessionId, artifact, shownVersion, true);
      const latestDownloadHref = artifact === undefined ? '' : rawUrl(sessionId, artifact, undefined, true);

      return h(
        'div',
        { className: 'dsa-canvas', 'data-type': artifact.type },
        h(
          'div',
          { className: 'dsa-bar' },
          h('span', { className: 'dsa-bar-icon' }, h(TypeGlyph, { type: artifact.type, size: 14 })),
          h(
            'div',
            { className: 'dsa-bar-titles' },
            renaming
              ? h('input', {
                  className: 'dsa-nameinput',
                  value: nameDraft,
                  autoFocus: true,
                  onChange: (event) => setNameDraft(event.target.value),
                  onBlur: () => void rename(),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') void rename();
                    if (event.key === 'Escape') setRenaming(false);
                  },
                })
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsa-bar-title',
                    title: tr(t, 'canvas.rename'),
                    onClick: () => setRenaming(true),
                  },
                  artifact.title,
                ),
            h(
              'span',
              { className: 'dsa-bar-sub' },
              `${tr(t, `type.${artifact.type}`)}${artifact.language === '' ? '' : ` · ${artifact.language}`} · v${shownVersion}${shownVersion === latest ? ` (${tr(t, 'canvas.current')})` : ''} · ${bytesLabel(shownBytes)}`,
            ),
          ),
          h(
            'div',
            { className: 'dsa-tools' },
            artifact.versions.length > 1
              ? h(
                  'select',
                  {
                    className: 'dsa-select',
                    value: String(shownVersion),
                    title: tr(t, 'canvas.version'),
                    onChange: (event) => setSelected(Number(event.target.value)),
                  },
                  [...artifact.versions]
                    .sort((left, right) => right.v - left.v)
                    .map((record) =>
                      h('option', { key: record.v, value: String(record.v) }, `v${record.v}${record.v === latest ? ` · ${tr(t, 'canvas.current')}` : ''}`),
                    ),
                )
              : null,
            showSource
              ? h(
                  'div',
                  { className: 'dsa-seg' },
                  h(
                    'button',
                    { type: 'button', className: 'dsa-btn', 'aria-pressed': mode === 'code', onClick: () => setMode('code') },
                    tr(t, 'canvas.code'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'dsa-btn', 'aria-pressed': mode === 'edit', onClick: startEdit },
                    tr(t, 'canvas.edit'),
                  ),
                )
              : h(
                  'div',
                  { className: 'dsa-seg' },
                  h(
                    'button',
                    { type: 'button', className: 'dsa-btn', 'aria-pressed': mode === 'preview', onClick: () => setMode('preview') },
                    tr(t, 'canvas.preview'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'dsa-btn', 'aria-pressed': mode === 'code', onClick: () => setMode('code') },
                    tr(t, 'canvas.code'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'dsa-btn', 'aria-pressed': mode === 'edit', onClick: startEdit },
                    tr(t, 'canvas.edit'),
                  ),
                ),
            h(
              'button',
              { type: 'button', className: 'dsa-btn', title: tr(t, 'canvas.copy'), onClick: () => void copy(), disabled: content === undefined },
              h(primitives.IconCopyOutlineRegular, { size: 13 }),
            ),
            h(
              'a',
              {
                className: 'dsa-btn',
                href: shownVersion === latest ? latestDownloadHref : downloadHref,
                download: '',
                title: tr(t, 'canvas.download'),
              },
              h(primitives.IconDownloadOutlineRegular, { size: 13 }),
            ),
            h(
              'button',
              { type: 'button', className: 'dsa-btn', title: tr(t, 'canvas.refresh'), onClick: view.reload },
              h(primitives.IconRefreshOutlineRegular, { size: 13 }),
            ),
            confirmDelete
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'button',
                    { type: 'button', className: 'dsa-btn dsa-danger', onClick: () => void remove() },
                    tr(t, 'canvas.confirm'),
                  ),
                  h('button', { type: 'button', className: 'dsa-btn', onClick: () => setConfirmDelete(false) }, tr(t, 'canvas.cancel')),
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsa-btn dsa-danger',
                    title: tr(t, 'canvas.delete'),
                    onClick: () => setConfirmDelete(true),
                  },
                  h(primitives.IconTrashOutlineRegular, { size: 13 }),
                ),
          ),
        ),
        notice !== null
          ? h(
              'div',
              { className: 'dsa-notice', 'data-kind': notice.kind },
              h('span', { style: { flex: 1, minWidth: 0 } }, notice.text),
              h('button', { type: 'button', className: 'dsa-btn', onClick: () => setNotice(null) }, tr(t, 'canvas.dismiss')),
            )
          : null,
        viewingOld
          ? h(
              'div',
              { className: 'dsa-notice' },
              h('span', { style: { flex: 1, minWidth: 0 } }, tr(t, 'canvas.viewingOld', { version: shownVersion, current: latest })),
              h('button', { type: 'button', className: 'dsa-btn dsa-primary', onClick: () => void restore() }, tr(t, 'canvas.restore')),
            )
          : null,
        h(
          'div',
          { className: 'dsa-body' },
          mode === 'edit'
            ? h(
                'div',
                { className: 'dsa-editor' },
                h('textarea', {
                  value: draft,
                  spellCheck: false,
                  onChange: (event) => setDraft(event.target.value),
                  onKeyDown: (event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                      event.preventDefault();
                      void save();
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'dsa-editor-bar' },
                  h('span', null, tr(t, 'canvas.editHint', { version: shownVersion })),
                  h('button', { type: 'button', className: 'dsa-btn', onClick: () => setMode('preview') }, tr(t, 'canvas.cancel')),
                  h(
                    'button',
                    { type: 'button', className: 'dsa-btn dsa-primary', onClick: () => void save(), disabled: busy || draft === content },
                    busy ? tr(t, 'canvas.saving') : tr(t, 'canvas.save'),
                  ),
                ),
              )
            : mode === 'code'
              ? content === undefined
                ? h('div', { className: 'dsa-center' }, h('span', { className: 'dsa-spin' }), tr(t, 'canvas.loading'))
                : h(CodeArtifact, { text: content })
              : h(CanvasPreview, {
                  sessionId,
                  artifact,
                  version: shownVersion,
                  content,
                  t,
                }),
        ),
        h(
          'div',
          { className: 'dsa-foot' },
          h('span', { className: 'dsa-grow' }, artifact.description),
          h('span', null, `v${shownVersion} · ${bytesLabel(shownBytes)}`),
        ),
      );
    }

    /**
     * Canvas chip title, resolved from the shared title cache.
     * @param props.t - translator.
     * @param props.useTabInfo - framework hook reading this tab's navigation.
     * @returns the chip content.
     */
    function ArtifactTabTitle({ sessionId, t, useTabInfo }) {
      const info = useTabInfo();
      const params = info?.tab?.navigation?.params;
      const tabId = info?.tab?.id;
      const paramId = typeof params?.artifact === 'string' ? params.artifact : '';
      const id = paramId !== '' ? paramId : lastArtifactFor(sessionId, tabId);
      const [, force] = React.useState(0);
      const meta = useArtifactMeta(sessionId, id);

      React.useEffect(() => {
        if (id === '') return undefined;
        return bus.on(id, () => force((value) => value + 1));
      }, [id]);

      const title = bus.titles.get(id) ?? meta?.title ?? tr(t, 'tab.artifact');
      const type = meta?.type ?? 'html';
      return h('span', { className: 'dsa-tab-title' }, h(TypeGlyph, { type, size: 13 }), h('span', null, title));
    }

    // ---------------------------------------------------------------- gallery

    /**
     * One gallery tile. HTML and SVG get a live thumbnail; other kinds get a
     * type glyph so opening the gallery never fetches every document.
     * @param props.artifact - descriptor.
     * @param props.sessionId - owning chat.
     * @param props.t - translator.
     * @param props.onOpen - open callback.
     * @returns the tile.
     */
    function GalleryTile({ artifact, sessionId, t, onOpen }) {
      const type = artifact.type;
      return h(
        'div',
        {
          className: 'dsa-tile',
          'data-type': type,
          role: 'button',
          tabIndex: 0,
          onClick: onOpen,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen();
            }
          },
          title: artifact.title,
        },
        h(
          'div',
          { className: 'dsa-tile-art' },
          type === 'html'
            ? h('iframe', {
                className: 'dsa-tile-frame',
                src: rawUrl(sessionId, artifact, artifact.version),
                title: artifact.title,
                sandbox: 'allow-scripts',
                referrerPolicy: 'no-referrer',
                loading: 'lazy',
                tabIndex: -1,
              })
            : type === 'svg'
              ? h('img', { className: 'dsa-tile-img', src: rawUrl(sessionId, artifact, artifact.version), alt: artifact.title, loading: 'lazy' })
              : h('div', { className: 'dsa-tile-glyph' }, h(TypeGlyph, { type, size: 26 })),
        ),
        h(
          'div',
          { className: 'dsa-tile-text' },
          h('div', { className: 'dsa-tile-name' }, artifact.title),
          h(
            'div',
            { className: 'dsa-tile-meta' },
            h('span', { className: 'dsa-dot' }),
            h('span', null, tr(t, `type.${type}`)),
            h('span', { className: 'dsa-grow' }, timeLabel(artifact.updatedAt, t)),
          ),
        ),
      );
    }

    /**
     * Build the gallery body, shared by the gallery tab and the canvas fallback.
     * @param ctx - client root context.
     * @returns the gallery component.
     */
    function makeGallery(ctx) {
      return function GalleryBody({ sessionId, t }) {
        const [scope, setScope] = React.useState('session');
        const [revision, setRevision] = React.useState(0);
        const list = useArtifactList(sessionId, scope, revision);

        React.useEffect(() => {
          const timer = window.setInterval(() => setRevision((value) => value + 1), 20000);
          return () => window.clearInterval(timer);
        }, []);

        return h(
          'div',
          { className: 'dsa-gallery' },
          h(
            'div',
            { className: 'dsa-gallery-head' },
            h(
              'div',
              { className: 'dsa-gallery-headtext' },
              h('div', { className: 'dsa-gallery-title' }, tr(t, 'gallery.title')),
              h('div', { className: 'dsa-gallery-sub' }, tr(t, 'gallery.subtitle')),
            ),
            h(
              'div',
              { className: 'dsa-seg' },
              h(
                'button',
                { type: 'button', className: 'dsa-btn', 'aria-pressed': scope === 'session', onClick: () => setScope('session') },
                tr(t, 'gallery.session'),
              ),
              h(
                'button',
                { type: 'button', className: 'dsa-btn', 'aria-pressed': scope === 'project', onClick: () => setScope('project') },
                tr(t, 'gallery.project'),
              ),
            ),
            h(
              'button',
              { type: 'button', className: 'dsa-btn', title: tr(t, 'canvas.refresh'), onClick: list.reload },
              h(primitives.IconRefreshOutlineRegular, { size: 13 }),
            ),
          ),
          h(
            'div',
            { className: 'dsa-gallery-body' },
            list.loading && list.artifacts.length === 0
              ? h('div', { className: 'dsa-empty' }, h('span', { className: 'dsa-spin' }), tr(t, 'gallery.loading'))
              : list.error !== null
                ? h('div', { className: 'dsa-empty' }, h(primitives.IconWarningOutlineRegular, { size: 24 }), h('p', null, list.error))
                : list.artifacts.length === 0
                  ? h(
                      'div',
                      { className: 'dsa-empty' },
                      h('div', { className: 'dsa-empty-icon' }, h(primitives.IconSparkleRegular, { size: 24 })),
                      h('b', null, tr(t, 'gallery.empty.title')),
                      h('p', null, tr(t, scope === 'session' ? 'gallery.empty.body' : 'gallery.empty.project')),
                    )
                  : h(
                      React.Fragment,
                      null,
                      h(
                        'div',
                        { className: 'dsa-count' },
                        tr(t, 'gallery.count', { count: list.artifacts.length }),
                      ),
                      h(
                        'div',
                        { className: 'dsa-grid' },
                        list.artifacts.map((artifact) =>
                          h(GalleryTile, {
                            key: artifact.id,
                            artifact,
                            sessionId,
                            t,
                            onOpen: () => openArtifact(ctx, sessionId, artifact.id),
                          }),
                        ),
                      ),
                    ),
          ),
        );
      };
    }

    /**
     * Gallery chip title.
     * @param props.t - translator.
     * @returns the chip content.
     */
    function GalleryTabTitle({ t }) {
      return h('span', { className: 'dsa-tab-title' }, h(primitives.IconSparkleRegular, { size: 13 }), h('span', null, tr(t, 'tab.gallery')));
    }

    /**
     * Conversation-header entry that opens the gallery.
     * @param props.t - translator.
     * @param props.onOpen - open callback.
     * @returns the header button.
     */
    function ArtifactsHeaderButton({ t, onOpen }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsa-headerbtn',
          title: tr(t, 'header.title'),
          'aria-label': tr(t, 'header.title'),
          onClick: onOpen,
        },
        h(primitives.IconSparkleRegular, { size: 16 }),
      );
    }

    // ------------------------------------------------------------------- apply

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'uiConversation'],

      /**
       * Register dictionaries, styles, both tab types, their seats, the header
       * entry, and the transcript cards.
       * @param ctx - client root Context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'dsh-artifacts: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/dsh-artifacts/canvas.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/dsh-artifacts';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'dsh-artifacts: styles');

        const TurnArtifacts = makeTurnArtifacts(ctx);
        const GalleryBody = makeGallery(ctx);
        GalleryComponent = GalleryBody;
        const GalleryTab = function GalleryTab({ sessionId, t }) {
          return h(GalleryBody, { sessionId, t });
        };
        const t = ctx.locale.bind(NS);

        const artifactDefinition = {
          id: ARTIFACT_TAB_ID,
          kind: ARTIFACT_KIND,
          priority: 'extension',
          keepMounted: true,
          title: () => tr(t, 'tab.artifact'),
        };
        const galleryDefinition = {
          id: GALLERY_TAB_ID,
          kind: GALLERY_KIND,
          priority: 'extension',
          title: () => tr(t, 'tab.gallery'),
          guide: [
            {
              id: 'artifacts',
              order: 34,
              title: () => tr(t, 'add.title'),
              description: () => tr(t, 'add.description'),
              icon: primitives.IconSparkleRegular,
            },
          ],
        };

        ctx.effect(() => ctx.sidebarRightTabs.register(artifactDefinition), 'dsh-artifacts: artifact tab type');
        ctx.effect(() => ctx.sidebarRightTabs.register(galleryDefinition), 'dsh-artifacts: gallery tab type');

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: ARTIFACT_TAB_ID, locale: NS },
            ArtifactTab,
          ),
        );
        ctx.slots.inject('sidebar.right.pane.tab.title', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab.title', key: ARTIFACT_TAB_ID, locale: NS },
            ArtifactTabTitle,
          ),
        );
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: GALLERY_TAB_ID, locale: NS },
            GalleryTab,
          ),
        );
        ctx.slots.inject('sidebar.right.pane.tab.title', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab.title', key: GALLERY_TAB_ID, locale: NS },
            GalleryTabTitle,
          ),
        );

        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'dsh-artifacts',
              order: -6,
              locale: NS,
              inject: () => ({ onOpen: () => openGallery(ctx) }),
            },
            ArtifactsHeaderButton,
          ),
        );

        ctx.effect(() => ctx.uiConversation.events.register(artifactTurnDefinition()), 'dsh-artifacts: turn definition');
        ctx.slots.inject('conversation.chat.turnTail', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.turnTail',
              id: 'dsh-artifacts',
              order: 14,
              locale: NS,
            },
            TurnArtifacts,
          ),
        );
      },
    };
  },
});