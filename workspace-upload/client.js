/**
 * Browser half of the workspace upload bundle.
 *
 * The Files page owns the workspace tree, so this bundle adds one control to
 * that page's header and makes the page itself a drop target: choose files or a
 * whole folder from the local computer (or drop either anywhere on the Files
 * page) and every file is streamed to the Host route, which writes it into the
 * Session's workspace directory under its relative path. Uploads run one file
 * at a time so the progress panel stays readable, and the tree refreshes itself
 * when the Host publishes the entries.
 */

window.__ModuleLoader__.load({
  id: '@local/workspace-upload',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'workspaceUpload';
    /** Browser-relative Host route receiving one file. */
    const UPLOAD_ROUTE = 'api/workspace-upload/file';
    /** Browser-relative Host route reporting the accepted file size. */
    const LIMITS_ROUTE = 'api/workspace-upload/limits';
    /** Browser-relative Host route creating one workspace-relative directory. */
    const DIR_ROUTE = 'api/workspace-upload/dir';
    /** Width of the progress panel. */
    const PANEL_WIDTH = 360;
    /** Distance between the control and its panel. */
    const PANEL_GAP = 6;
    /** How long a fully successful upload stays on screen. */
    const AUTO_CLOSE_MS = 5000;
    /** How long a file drag may pause before its highlight clears. */
    const DRAG_IDLE_MS = 800;

    const EN = {
      action: 'Upload to workspace',
      actionBusy: 'Uploading {done} of {total} — show progress',
      actionHideProgress: 'Hide progress',
      actionHint: 'Upload files or a folder into this workspace',
      actionDrop: 'Drop files or folders to upload into this workspace',
      pickFiles: 'Choose files…',
      pickFolder: 'Choose a folder…',
      startHint: 'You can also drop files or a folder anywhere on this page',
      scanning: 'Reading the folder…',
      foldersCreated: 'Created {count} empty folders',
      errorMkdir: 'Some folders could not be created',
      errorScan: 'The folder could not be read',
      panel: 'Uploads',
      panelClose: 'Hide the uploads panel; uploads keep running',
      hide: 'Hide',
      target: 'Saving to',
      limit: 'Up to {size} per file',
      cancel: 'Cancel uploads',
      summaryBusy: 'Uploading {done} of {total}…',
      summaryDone: '{count} files uploaded',
      summaryDoneOne: '1 file uploaded',
      summaryFailed: '{done} uploaded, {failed} failed',
      summaryFailedOne: '1 file failed',
      summaryCancelled: '{done} uploaded, {cancelled} cancelled',
      summaryCancelledOne: '1 upload cancelled',
      statusQueued: 'Waiting',
      statusUploading: '{percent}%',
      statusSaving: 'Saving to the workspace…',
      statusDone: 'Uploaded',
      statusRenamed: 'Uploaded as {name}',
      statusReplaced: 'Replaced the existing file',
      statusHidden: 'Uploaded as a hidden file; enable “show hidden” in the tree to see it',
      statusCancelled: 'Cancelled',
      errorUpload: 'The upload failed',
      errorNetwork: 'The browser could not reach DSH',
      errorTooLarge: 'This file is larger than the upload limit',
      errorRejected: 'The Host rejected this upload',
      errorUnauthorized: 'The session expired; refresh the page and try again',
      errorNoSession: 'This conversation has no readable working directory',
      errorOutside: 'That destination is outside the workspace',
      errorName: 'The Host cannot use this file name',
      errorDirectory: 'The Host could not use the destination directory',
      errorFailed: 'The upload failed; the Host reported an internal error',
    };

    const ZH = {
      action: '上传到工作区',
      actionBusy: '正在上传 {done}/{total}，查看进度',
      actionHideProgress: '隐藏进度',
      actionHint: '上传文件或文件夹到这个工作区',
      actionDrop: '松开鼠标即可上传文件或文件夹到此工作区',
      pickFiles: '选择文件…',
      pickFolder: '选择文件夹…',
      startHint: '也可以把文件或文件夹拖到本页任意位置',
      scanning: '正在读取文件夹…',
      foldersCreated: '已创建 {count} 个空文件夹',
      errorMkdir: '部分文件夹没能创建',
      errorScan: '无法读取这个文件夹',
      panel: '上传',
      panelClose: '隐藏上传面板，上传会继续',
      hide: '隐藏',
      target: '保存到',
      limit: '单个文件最大 {size}',
      cancel: '取消上传',
      summaryBusy: '正在上传第 {done} / {total} 个…',
      summaryDone: '已上传 {count} 个文件',
      summaryDoneOne: '已上传 1 个文件',
      summaryFailed: '已上传 {done} 个，失败 {failed} 个',
      summaryFailedOne: '1 个文件上传失败',
      summaryCancelled: '已上传 {done} 个，取消 {cancelled} 个',
      summaryCancelledOne: '已取消 1 个上传',
      statusQueued: '等待上传',
      statusUploading: '{percent}%',
      statusSaving: '正在保存到工作区…',
      statusDone: '已上传',
      statusRenamed: '已上传为 {name}',
      statusReplaced: '已替换同名文件',
      statusHidden: '已上传（隐藏文件，需在文件页开启「显示隐藏」才能看到）',
      statusCancelled: '已取消',
      errorUpload: '上传失败',
      errorNetwork: '浏览器无法连接 DSH',
      errorTooLarge: '文件超过上传大小上限',
      errorRejected: '服务器拒绝了这次上传',
      errorUnauthorized: '登录状态已过期，请刷新页面后重试',
      errorNoSession: '这个会话没有可读的工作目录',
      errorOutside: '目标目录不在工作区内',
      errorName: '服务器无法使用这个文件名',
      errorDirectory: '服务器无法使用目标目录',
      errorFailed: '上传失败，服务器内部错误',
    };

    const STYLE = `
.wu-root{position:relative;display:inline-flex;align-items:center;flex:none}
.wu-button{appearance:none;position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1;flex:none}
@media (hover:hover){.wu-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.wu-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));outline-offset:1px}
.wu-button[data-drag="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.wu-button svg{display:block;width:15px;height:15px}
.wu-badge{position:absolute;right:-4px;bottom:-5px;box-sizing:border-box;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:600 10px/16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;text-align:center}
.wu-pop{position:fixed;z-index:1002;box-sizing:border-box;display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 16px 42px rgba(0,0,0,.34));overflow:hidden;outline:none;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}
.wu-pop-head{display:flex;flex:none;align-items:flex-start;gap:6px;min-width:0;padding:10px 8px 9px 13px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.wu-pop-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
.wu-pop-title{margin:0;font-size:13px;font-weight:600;line-height:1.45}
.wu-pop-target{display:flex;align-items:baseline;gap:5px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}
.wu-pop-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wu-pop-limit{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}
.wu-notice{margin:0;padding:6px 13px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.45}
.wu-close{appearance:none;display:inline-flex;flex:none;align-items:center;justify-content:center;width:26px;height:26px;padding:5px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1}
@media (hover:hover){.wu-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.wu-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));outline-offset:1px}
.wu-close svg{display:block}
.wu-list{flex:1 1 auto;min-height:0;margin:0;padding:0;overflow:auto;overscroll-behavior:contain;list-style:none}
.wu-item{display:flex;flex-direction:column;gap:5px;padding:8px 13px 9px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.wu-item:first-child{border-top:0}
.wu-item-top{display:flex;align-items:baseline;gap:8px;min-width:0}
.wu-item-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:1.45}
.wu-item-size{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45;font-variant-numeric:tabular-nums}
.wu-bar{height:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.wu-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .12s linear}
.wu-bar-fill[data-saving="true"]{width:100%;animation:wu-pulse 1.1s ease-in-out infinite}
.wu-item-status{position:relative;margin:0;padding-left:10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45;overflow-wrap:anywhere}
.wu-item-status::before{content:"";position:absolute;left:1px;top:.5em;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-border-l2)}
.wu-item-status[data-state="uploading"],.wu-item-status[data-state="saving"]{color:var(--dsw-alias-label-primary)}
.wu-item-status[data-state="uploading"]::before,.wu-item-status[data-state="saving"]::before{background:var(--dsw-alias-brand-primary)}
.wu-item-status[data-state="done"]{color:var(--dsw-alias-label-primary)}
.wu-item-status[data-state="done"]::before{background:var(--dsw-alias-state-success-primary)}
.wu-item-status[data-state="error"]{color:var(--dsw-alias-label-primary)}
.wu-item-status[data-state="error"]::before{background:var(--dsw-alias-state-error-primary)}
.wu-item-status[data-state="cancelled"]::before{background:var(--dsw-alias-label-secondary)}
.wu-foot{display:flex;flex:none;align-items:center;gap:8px;padding:8px 10px 9px 13px;border-top:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.wu-summary{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}
.wu-summary[data-failed="true"]{color:var(--dsw-alias-label-primary);font-weight:500}
.wu-foot-button{appearance:none;flex:none;padding:4px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:12px;line-height:1.45;white-space:nowrap}
@media (hover:hover){.wu-foot-button:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.wu-foot-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));outline-offset:1px}
.wu-start{display:flex;flex-direction:column;gap:7px;padding:12px 13px 13px}
.wu-start-button{appearance:none;padding:7px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:12.5px;line-height:1.45;text-align:left}
@media (hover:hover){.wu-start-button:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.wu-start-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));outline-offset:1px}
.wu-start-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}
.wu-drop{position:fixed;z-index:1001;box-sizing:border-box;display:flex;align-items:center;justify-content:center;border:2px dashed var(--dsw-alias-brand-primary);border-radius:var(--dsw-radius-lg,12px);background:transparent;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent);pointer-events:none}
.wu-drop-hint{padding:8px 14px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.24));font-size:13px;line-height:1.45}
@keyframes wu-pulse{0%,100%{opacity:.45}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.wu-bar-fill{transition:none}.wu-bar-fill[data-saving="true"]{animation:none;opacity:.8}}
`;

    /**
     * The upload glyph: a tray with an arrow rising out of it.
     * @returns {object} the SVG element.
     */
    function IconUpload() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 15, height: 15, role: 'presentation', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M8 2.2v7.1M5.2 4.9 8 2.1l2.8 2.8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M2.7 9.9v2.2c0 .8.6 1.4 1.4 1.4h7.8c.8 0 1.4-.6 1.4-1.4V9.9',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
        }),
      );
    }

    /**
     * The panel's close glyph.
     * @returns {object} the SVG element.
     */
    function IconClose() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, role: 'presentation', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'm4.4 4.4 7.2 7.2M11.6 4.4l-7.2 7.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      );
    }

    /**
     * Human-readable byte size.
     * @param {number} bytes - byte count.
     * @returns {string} the formatted size.
     */
    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
      const value = bytes / 1024 ** exponent;
      const digits = exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
      return `${value.toFixed(digits)} ${units[exponent]}`;
    }

    /**
     * Parse one JSON answer without throwing.
     * @param {string} text - response text.
     * @returns {object | null} the parsed object, or null.
     */
    function parseJson(text) {
      try {
        const value = JSON.parse(text);
        return value !== null && typeof value === 'object' ? value : null;
      } catch {
        return null;
      }
    }

    /**
     * Send one file to the Host route and follow its answer.
     * @param {File} file - the file chosen in the browser.
     * @param {string} name - the name to publish, which may be a fallback for an unnamed file.
     * @param {string} sessionId - Session whose workspace receives the file.
     * @param {string} dir - workspace-relative destination directory, empty for the root.
     * @param {{ progress: (fraction: number) => void, saving: () => void, track: (xhr: XMLHttpRequest | null) => void }} hooks -
     *   upload progress, the Host receiving the last byte, and the live request for cancellation.
     * @returns {Promise<object>} the stored value, or a failure with `code` and technical `detail`.
     */
    function sendOne(file, name, sessionId, dir, hooks) {
      return new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
          if (settled) return;
          settled = true;
          hooks.track(null);
          resolve(value);
        };
        const url = new URL(UPLOAD_ROUTE, document.baseURI);
        url.searchParams.set('sessionId', sessionId);
        url.searchParams.set('name', name);
        if (dir !== '') url.searchParams.set('dir', dir);
        const xhr = new XMLHttpRequest();
        hooks.track(xhr);
        xhr.open('POST', url.href);
        xhr.setRequestHeader('content-type', 'application/octet-stream');
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) hooks.progress(Math.min(1, event.loaded / event.total));
        };
        // The browser has sent every byte; the Host is still creating the file.
        xhr.upload.onload = () => hooks.saving();
        xhr.onload = () => {
          const body = parseJson(xhr.responseText);
          if (xhr.status === 200 && body !== null && body.ok === true && body.value !== null && typeof body.value === 'object') {
            settle({ ok: true, value: body.value });
            return;
          }
          // A reverse proxy may answer 413 itself, with an HTML body.
          if (xhr.status === 413) {
            settle({ ok: false, code: 'too-large', detail: '' });
            return;
          }
          if (xhr.status === 401) {
            settle({ ok: false, code: 'unauthorized', detail: typeof body?.message === 'string' ? body.message : '' });
            return;
          }
          if (xhr.status === 403) {
            settle({ ok: false, code: 'rejected', detail: typeof body?.message === 'string' ? body.message : '' });
            return;
          }
          settle({
            ok: false,
            code: typeof body?.code === 'string' ? body.code : 'http',
            detail: typeof body?.message === 'string' ? body.message : `HTTP ${xhr.status}`,
          });
        };
        xhr.onerror = () => settle({ ok: false, code: 'network', detail: '' });
        xhr.onabort = () => settle({ ok: false, code: 'cancelled', cancelled: true, detail: '' });
        try {
          xhr.send(file);
        } catch (error) {
          settle({ ok: false, code: 'network', detail: error instanceof Error ? error.message : String(error) });
        }
      });
    }

    /**
     * Place the panel below the control, or above it when the viewport is short.
     * @param {HTMLElement} anchor - the control the panel belongs to.
     * @returns {{ top?: number, bottom?: number, left: number, width: number, maxHeight: number } | null} fixed-position style.
     */
    function panelPosition(anchor) {
      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      const width = Math.min(PANEL_WIDTH, Math.max(220, window.innerWidth - 16));
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - PANEL_GAP - 8;
      const above = rect.top - PANEL_GAP - 8;
      const openBelow = below >= 220 || below >= above;
      const space = Math.max(0, openBelow ? below : above);
      const maxHeight = Math.max(120, Math.min(360, space));
      return openBelow
        ? { top: Math.round(rect.bottom + PANEL_GAP), left: Math.round(left), width, maxHeight }
        : { bottom: Math.round(window.innerHeight - rect.top + PANEL_GAP), left: Math.round(left), width, maxHeight };
    }

    /**
     * Compare two panel styles so repeated measurements do not re-render.
     * @param {object | null} a - previous style.
     * @param {object | null} b - next style.
     * @returns {boolean} true when both place the panel identically.
     */
    function samePosition(a, b) {
      if (a === b) return true;
      if (a === null || b === null) return false;
      return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight;
    }

    /**
     * Translate one listed upload's state.
     * @param {object} item - listed upload.
     * @param {Function} t - namespace-bound translator.
     * @returns {string} the status line.
     */
    function statusText(item, t) {
      switch (item.state) {
        case 'queued':
          return t('statusQueued');
        case 'uploading':
          return t('statusUploading', { percent: Math.round(item.progress * 100) });
        case 'saving':
          return t('statusSaving');
        case 'done':
          if (item.replaced) return t('statusReplaced');
          if (item.savedAs !== '' && item.savedAs !== item.name) return t('statusRenamed', { name: item.savedAs });
          if (item.name.startsWith('.')) return t('statusHidden');
          return t('statusDone');
        case 'cancelled':
          return t('statusCancelled');
        default:
          return errorText(item, t);
      }
    }

    /**
     * Translate one failed upload's failure.
     * @param {object} item - listed upload.
     * @param {Function} t - namespace-bound translator.
     * @returns {string} the failure line.
     */
    function errorText(item, t) {
      switch (item.code) {
        case 'network':
          return t('errorNetwork');
        case 'too-large':
          return t('errorTooLarge');
        case 'unsupported-media-type':
        case 'rejected':
          return t('errorRejected');
        case 'unauthorized':
          return t('errorUnauthorized');
        case 'session-unavailable':
        case 'invalid-session':
        case 'workspace-unavailable':
        case 'working-directory-unavailable':
        case 'working-directory-failed':
          return t('errorNoSession');
        case 'path-outside-workspace':
          return t('errorOutside');
        case 'directory-failed':
        case 'invalid-directory':
          return t('errorDirectory');
        case 'request-aborted':
        case 'cancelled':
          return t('statusCancelled');
        case 'name-conflict':
        case 'name-unavailable':
        case 'directory-target':
        case 'symlink-target':
        case 'invalid-name':
          return t('errorName');
        case 'http':
          return t('errorUpload');
        default:
          return t('errorFailed');
      }
    }

    /**
     * Normalize one browser-relative path to slash-separated form.
     * @param {unknown} value - path such as `folder/sub/a.txt`.
     * @returns {string} the normalized path, empty for the workspace root.
     */
    function normalizeRelative(value) {
      const text = typeof value === 'string' ? value.replace(/\\/gu, '/') : '';
      const parts = text.split('/').filter((part) => part !== '' && part !== '.');
      const safe = [];
      for (const part of parts) {
        if (part === '..') safe.pop();
        else safe.push(part);
      }
      return safe.join('/');
    }

    /**
     * Split one workspace-relative path into its directory and file name.
     * @param {string} relative - normalized relative path.
     * @returns {{ dir: string, name: string }} the directory and the base name.
     */
    function splitUploadPath(relative) {
      const normalized = normalizeRelative(relative);
      const index = normalized.lastIndexOf('/');
      if (index < 0) return { dir: '', name: normalized };
      return { dir: normalized.slice(0, index), name: normalized.slice(index + 1) };
    }

    /**
     * Directories an upload must create explicitly because no file lives below them.
     * @param {{ label: string }[]} entries - uploads with their relative path.
     * @param {Iterable<string>} explicit - directories the drop reported, including empty ones.
     * @returns {string[]} directories to create, parents first.
     */
    function emptyDirectories(entries, explicit) {
      const all = new Set();
      for (const directory of explicit ?? []) {
        const normalized = normalizeRelative(directory);
        if (normalized !== '') all.add(normalized);
      }
      const needed = new Set();
      for (const entry of entries) {
        const parts = entry.label.split('/');
        let prefix = '';
        for (let index = 0; index < parts.length - 1; index += 1) {
          prefix = prefix === '' ? parts[index] : `${prefix}/${parts[index]}`;
          all.add(prefix);
          needed.add(prefix);
        }
      }
      return [...all].filter((directory) => !needed.has(directory)).sort();
    }

    /**
     * Read every child of one directory reader, in batches.
     * @param {object} reader - `FileSystemDirectoryReader`.
     * @returns {Promise<object[]>} all entries.
     */
    function readEntries(reader) {
      return new Promise((resolve, reject) => {
        const all = [];
        const next = () => {
          reader.readEntries((batch) => {
            if (batch.length === 0) {
              resolve(all);
              return;
            }
            all.push(...batch);
            next();
          }, reject);
        };
        next();
      });
    }

    /**
     * Collect one drop's files and directories, preserving their relative paths.
     * @param {DataTransfer | null | undefined} dataTransfer - the drop payload.
     * @returns {Promise<{ entries: { file: File, relative: string }[], directories: Set<string> }>}
     *   files with their relative path, and every directory the drop reported.
     */
    async function collectDropped(dataTransfer) {
      const out = { entries: [], directories: new Set() };
      const items = dataTransfer?.items;
      if (items === undefined || items === null || items.length === 0) {
        for (const file of Array.from(dataTransfer?.files ?? [])) {
          if (file !== null && typeof file === 'object' && typeof file.name === 'string') {
            out.entries.push({ file, relative: file.webkitRelativePath || file.name });
          }
        }
        return out;
      }
      // The item list is valid only during the event: capture entries first,
      // then walk them after the handler returns.
      const pending = [];
      for (const item of items) {
        if (item.kind !== 'file') continue;
        let entry = null;
        try {
          entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        } catch {
          entry = null;
        }
        if (entry !== null) pending.push(entry);
        else {
          const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
          if (file !== null && typeof file.name === 'string') out.entries.push({ file, relative: file.name });
        }
      }
      const walk = async (entry, prefix) => {
        if (entry.isFile === true) {
          const file = await new Promise((resolve, reject) => { entry.file(resolve, reject); });
          out.entries.push({ file, relative: `${prefix}${entry.name}` });
          return;
        }
        if (entry.isDirectory !== true) return;
        const directory = `${prefix}${entry.name}`;
        out.directories.add(directory);
        const children = await readEntries(entry.createReader());
        for (const child of children) await walk(child, `${directory}/`);
      };
      for (const entry of pending) await walk(entry, '');
      return out;
    }

    /**
     * Create one workspace-relative directory on the Host.
     * @param {string} sessionId - Session whose workspace receives the directory.
     * @param {string} directory - normalized workspace-relative directory.
     * @returns {Promise<void>} resolves once the Host created it.
     * @throws {Error} when the Host refuses the directory.
     */
    async function createDirectory(sessionId, directory) {
      const url = new URL(DIR_ROUTE, document.baseURI);
      url.searchParams.set('sessionId', sessionId);
      url.searchParams.set('dir', directory);
      const response = await fetch(url.href, { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }

    /**
     * Whether one file drag carries files.
     * @param {DragEvent} event - drag event.
     * @returns {boolean} true for a file drag.
     */
    function carriesFiles(event) {
      if (event.dataTransfer === null) return false;
      return Array.from(event.dataTransfer.types).includes('Files');
    }

    /**
     * The Files page header control and its upload panel.
     * @param {object} props - slot props: `sessionId`, `absolutePath`, and the namespace translator.
     * @returns {object} the control, its drop overlay, and the progress panel.
     */
    function UploadAction(props) {
      const { t, sessionId, absolutePath } = props;
      const [items, setItems] = React.useState([]);
      const [notice, setNotice] = React.useState(null);
      const [scanning, setScanning] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [drag, setDrag] = React.useState(false);
      const [dropRect, setDropRect] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const [position, setPosition] = React.useState(null);
      const [limit, setLimit] = React.useState(0);
      const anchorRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const inputRef = React.useRef(null);
      const dirInputRef = React.useRef(null);
      const scanningRef = React.useRef(false);
      const abortRef = React.useRef(null);
      const busyRef = React.useRef(false);
      const cancelRef = React.useRef(false);
      const aliveRef = React.useRef(true);
      const autoCloseRef = React.useRef(null);
      const panelIdRef = React.useRef('');
      if (panelIdRef.current === '') panelIdRef.current = `workspace-upload-${Math.random().toString(36).slice(2, 8)}`;
      const sessionRef = React.useRef(sessionId);
      const limitRef = React.useRef(0);
      sessionRef.current = sessionId;
      limitRef.current = limit;

      /**
       * Update one listed upload when the component is still mounted.
       * @param {string} key - listed upload identity.
       * @param {object} value - fields to replace.
       */
      const patch = React.useCallback((key, value) => {
        if (!aliveRef.current) return;
        setItems((previous) => previous.map((item) => (item.key === key ? { ...item, ...value } : item)));
      }, []);

      React.useEffect(() => {
        const input = dirInputRef.current;
        if (input !== null) {
          input.webkitdirectory = true;
          input.multiple = true;
        }
      }, []);

      // The accepted size belongs to the Host, not the browser: ask once so the
      // panel can state it and oversized files fail before sending.
      React.useEffect(() => {
        let cancelled = false;
        const url = new URL(LIMITS_ROUTE, document.baseURI);
        fetch(url.href, { credentials: 'same-origin', cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((body) => {
            if (cancelled) return;
            if (body !== null && typeof body === 'object' && Number.isFinite(body.maxUploadBytes) && body.maxUploadBytes > 0) {
              setLimit(body.maxUploadBytes);
            }
          })
          .catch(() => {});
        return () => { cancelled = true; };
      }, []);

      /**
       * Hide the panel, which does not stop uploads, and return focus to the control.
       */
      const hide = React.useCallback(() => {
        setOpen(false);
        if (panelRef.current !== null && panelRef.current.contains(document.activeElement)) {
          anchorRef.current?.focus({ preventScroll: true });
        }
      }, []);

      /**
       * Stream one batch into the workspace, creating the picked folder's shape.
       * @param {{ file: File, relative: string }[]} chosen - files with their relative path.
       * @param {Iterable<string>} [directories] - directories the picker or drop reported, empty ones included.
       */
      const start = React.useCallback(async (chosen, directories) => {
        if (busyRef.current) return;
        const files = (Array.isArray(chosen) ? chosen : []).filter((item) => item !== null && typeof item === 'object'
          && item.file !== null && typeof item.file === 'object' && typeof item.file.size === 'number');
        const stamp = Date.now().toString(36);
        const entries = files.map((item, index) => {
          const relative = normalizeRelative(item.relative ?? (typeof item.file.name === 'string' ? item.file.name : ''));
          const { dir, name } = splitUploadPath(relative);
          return {
            key: `${stamp}-${index}`,
            name: name === '' ? `file-${index + 1}` : name,
            label: relative === '' ? `file-${index + 1}` : relative,
            dir,
            size: item.file.size,
            state: 'queued',
            progress: 0,
            savedAs: '',
            replaced: false,
            code: '',
            detail: '',
          };
        });
        const createDirs = emptyDirectories(entries, directories);
        if (entries.length === 0 && createDirs.length === 0) return;
        const session = sessionRef.current;
        const accepted = limitRef.current;
        busyRef.current = true;
        cancelRef.current = false;
        abortRef.current = null;
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
        setNotice(null);
        setBusy(true);
        setOpen(true);
        setItems(entries);
        let failed = 0;
        let cancelledCount = 0;
        let renamed = 0;
        let mkdirFailed = 0;
        // The guard belongs to the transfer, not to this component: a closed tab
        // keeps uploading, and a page unload during that transfer still asks.
        const guard = (event) => {
          event.preventDefault();
          event.returnValue = '';
        };
        window.addEventListener('beforeunload', guard);
        try {
          // Folders that contain no file would otherwise be lost; the rest are
          // created by the Host when each file lands under its relative path.
          for (const directory of createDirs) {
            if (cancelRef.current) break;
            try {
              await createDirectory(session, directory);
            } catch (error) {
              mkdirFailed += 1;
            }
          }
          if (mkdirFailed > 0) {
            setNotice({ key: 'errorMkdir' });
          } else if (entries.length === 0 && createDirs.length > 0) {
            setNotice({ key: 'foldersCreated', params: { count: createDirs.length } });
          }
          for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            const file = files[index].file;
            if (cancelRef.current) {
              patch(entry.key, { state: 'cancelled' });
              cancelledCount += 1;
              continue;
            }
            if (accepted > 0 && file.size > accepted) {
              patch(entry.key, { state: 'error', code: 'too-large', detail: '' });
              failed += 1;
              continue;
            }
            patch(entry.key, { state: 'uploading', progress: 0 });
            let result;
            try {
              result = await sendOne(file, entry.name, session, entry.dir, {
                progress: (fraction) => patch(entry.key, { progress: fraction }),
                saving: () => patch(entry.key, { state: 'saving' }),
                track: (xhr) => { abortRef.current = xhr; },
              });
            } catch (error) {
              result = { ok: false, code: 'unknown', detail: error instanceof Error ? error.message : String(error) };
            }
            if (result.ok) {
              const stored = typeof result.value.name === 'string' && result.value.name !== '' ? result.value.name : entry.name;
              const replaced = result.value.replaced === true;
              if (stored !== entry.name || replaced) renamed += 1;
              patch(entry.key, { state: 'done', progress: 1, savedAs: stored, replaced });
            } else if (result.cancelled) {
              patch(entry.key, { state: 'cancelled' });
              cancelledCount += 1;
            } else {
              patch(entry.key, { state: 'error', code: result.code, detail: result.detail });
              failed += 1;
            }
          }
        } finally {
          window.removeEventListener('beforeunload', guard);
          busyRef.current = false;
          if (aliveRef.current) {
            setBusy(false);
            // A renamed, replaced, or uncreated folder needs a persistent cue, so
            // only a clean batch closes itself.
            if (failed === 0 && cancelledCount === 0 && renamed === 0 && mkdirFailed === 0) {
              autoCloseRef.current = setTimeout(() => {
                if (aliveRef.current) hide();
              }, AUTO_CLOSE_MS);
            }
          }
        }
      }, [patch, hide]);

      /**
       * Stop the current file and skip the rest of the queue.
       */
      const cancel = React.useCallback(() => {
        cancelRef.current = true;
        const xhr = abortRef.current;
        if (xhr !== null) xhr.abort();
      }, []);

      // Follow the control while the panel is open: it is fixed-position, so a
      // resize, a dock split, or a sidebar scroll would otherwise leave it behind.
      React.useEffect(() => {
        if (!open) return undefined;
        const anchor = anchorRef.current;
        if (anchor === null) return undefined;
        const update = () => {
          if (typeof anchor.checkVisibility === 'function' && !anchor.checkVisibility()) {
            hide();
            return;
          }
          const next = panelPosition(anchor);
          setPosition((previous) => (samePosition(previous, next) ? previous : next));
        };
        update();
        const page = anchor.closest('[data-files-page]');
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
        observer?.observe(page ?? anchor);
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            hide();
            return;
          }
          if (event.key !== 'Tab' || panelRef.current === null) return;
          const focusable = panelRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = document.activeElement;
          if (event.shiftKey && (active === first || active === panelRef.current)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        };
        const onPointerDown = (event) => {
          const target = event.target;
          if (panelRef.current !== null && panelRef.current.contains(target)) return;
          if (anchorRef.current !== null && anchorRef.current.contains(target)) return;
          // Another pane's Files tab owns its own panel and closes it itself.
          if (target instanceof Element && target.closest('.wu-pop') !== null) return;
          setOpen(false);
        };
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
          observer?.disconnect();
          window.removeEventListener('resize', update);
          window.removeEventListener('scroll', update, true);
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [open, hide]);

      // The panel mounts one frame after it opens; focus it then, not while it
      // is still absent, so keyboard users reach its buttons on the first batch.
      const panelMounted = open && position !== null;
      React.useEffect(() => {
        if (panelMounted) panelRef.current?.focus({ preventScroll: true });
      }, [panelMounted]);

      // Files dropped on this Files page are uploads, not attachments and not
      // navigations: the composer's own drop handler listens later on the
      // document, so this capture phase claims the event for its zone.
      React.useEffect(() => {
        let idleTimer = 0;
        const ownPage = () => anchorRef.current?.closest('[data-files-page]') ?? null;
        const inZone = (target) => {
          if (!(target instanceof Node)) return false;
          if (panelRef.current !== null && panelRef.current.contains(target)) return true;
          const page = ownPage();
          return page !== null && page.contains(target);
        };
        const clearDrag = () => {
          window.clearTimeout(idleTimer);
          setDrag(false);
        };
        const onDragEnter = (event) => {
          if (!carriesFiles(event) || !inZone(event.target)) return;
          // Claim the drag before the composer's document listener starts its
          // attachment mask for the same files.
          event.preventDefault();
          event.stopPropagation();
          setDrag(true);
        };
        const onDragOver = (event) => {
          if (!carriesFiles(event) || !inZone(event.target)) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
          setDrag(true);
          window.clearTimeout(idleTimer);
          idleTimer = window.setTimeout(() => setDrag(false), DRAG_IDLE_MS);
          const rect = ownPage()?.getBoundingClientRect();
          if (rect !== undefined && rect.width > 0 && rect.height > 0) {
            setDropRect((previous) => (
              previous !== null
              && Math.abs(previous.top - rect.top) < 2
              && Math.abs(previous.left - rect.left) < 2
              && Math.abs(previous.width - rect.width) < 2
              && Math.abs(previous.height - rect.height) < 2
                ? previous
                : { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
            ));
          }
        };
        const onDrop = (event) => {
          if (!carriesFiles(event) || !inZone(event.target)) return;
          event.preventDefault();
          event.stopPropagation();
          clearDrag();
          if (busyRef.current || scanningRef.current) return;
          const transfer = event.dataTransfer;
          setOpen(true);
          setNotice(null);
          setScanning(true);
          scanningRef.current = true;
          collectDropped(transfer)
            .then(({ entries, directories }) => {
              if (!aliveRef.current) return;
              if (entries.length === 0 && directories.size === 0) {
                setNotice({ key: 'errorScan' });
                return;
              }
              void start(entries, directories);
            })
            .catch(() => { if (aliveRef.current) setNotice({ key: 'errorScan' }); })
            .finally(() => {
              scanningRef.current = false;
              if (aliveRef.current) setScanning(false);
            });
        };
        document.addEventListener('dragenter', onDragEnter, true);
        document.addEventListener('dragover', onDragOver, true);
        document.addEventListener('drop', onDrop, true);
        document.addEventListener('dragend', clearDrag, true);
        window.addEventListener('blur', clearDrag);
        return () => {
          window.clearTimeout(idleTimer);
          document.removeEventListener('dragenter', onDragEnter, true);
          document.removeEventListener('dragover', onDragOver, true);
          document.removeEventListener('drop', onDrop, true);
          document.removeEventListener('dragend', clearDrag, true);
          window.removeEventListener('blur', clearDrag);
        };
      }, [start]);

      React.useEffect(() => {
        aliveRef.current = true;
        return () => {
          aliveRef.current = false;
          clearTimeout(autoCloseRef.current);
        };
      }, []);

      const done = items.filter((item) => item.state === 'done').length;
      const failed = items.filter((item) => item.state === 'error').length;
      const cancelledCount = items.filter((item) => item.state === 'cancelled').length;
      const settled = done + failed + cancelledCount;
      const progressDone = busy ? Math.min(settled + 1, items.length) : settled;
      const badge = busy ? `${progressDone}/${items.length}` : null;
      let summary;
      if (busy) summary = t('summaryBusy', { done: Math.min(settled + 1, items.length), total: items.length });
      else if (failed > 0) {
        summary = items.length === 1 ? t('summaryFailedOne') : t('summaryFailed', { done, failed });
      } else if (cancelledCount > 0) {
        summary = items.length === 1 ? t('summaryCancelledOne') : t('summaryCancelled', { done, cancelled: cancelledCount });
      } else {
        summary = items.length === 1 ? t('summaryDoneOne') : t('summaryDone', { count: items.length });
      }
      const triggerLabel = busy
        ? (open ? t('actionHideProgress') : t('actionBusy', { done: progressDone, total: items.length }))
        : t('action');

      const anchor = h(
        'button',
        {
          ref: anchorRef,
          type: 'button',
          className: 'wu-button',
          'aria-label': triggerLabel,
          'aria-busy': busy ? 'true' : undefined,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-controls': open ? panelIdRef.current : undefined,
          title: drag ? t('actionDrop') : busy ? triggerLabel : t('actionHint'),
          'data-drag': drag ? 'true' : 'false',
          'data-workspace-upload': 'trigger',
          onClick: () => { setOpen((value) => !value); },
        },
        h(IconUpload),
        badge === null ? null : h('span', { className: 'wu-badge', 'aria-hidden': 'true' }, badge),
      );

      const selection = h('input', {
        ref: inputRef,
        type: 'file',
        multiple: true,
        hidden: true,
        'data-workspace-upload': 'input',
        onChange: (event) => {
          const files = event.target.files;
          event.target.value = '';
          if (files === null || files.length === 0) return;
          void start(Array.from(files).map((file) => ({ file, relative: file.webkitRelativePath || file.name })), []);
        },
      });

      const directorySelection = h('input', {
        ref: dirInputRef,
        type: 'file',
        multiple: true,
        hidden: true,
        'data-workspace-upload': 'directory-input',
        onChange: (event) => {
          const files = event.target.files;
          event.target.value = '';
          if (files === null || files.length === 0) return;
          void start(Array.from(files).map((file) => ({ file, relative: file.webkitRelativePath || file.name })), []);
        },
      });

      const panel = open && position !== null
        ? ReactDOM.createPortal(
          h(
            'div',
            {
              ref: panelRef,
              id: panelIdRef.current,
              className: 'wu-pop',
              role: 'dialog',
              tabIndex: -1,
              'aria-label': t('panel'),
              'data-workspace-upload': 'panel',
              style: position,
            },
            h(
              'div',
              { className: 'wu-pop-head' },
              h(
                'div',
                { className: 'wu-pop-copy' },
                h('p', { className: 'wu-pop-title' }, t('panel')),
                h(
                  'div',
                  { className: 'wu-pop-target' },
                  h('span', null, t('target')),
                  h('span', { className: 'wu-pop-path', title: absolutePath }, absolutePath),
                ),
                limit > 0 ? h('p', { className: 'wu-pop-limit' }, t('limit', { size: formatBytes(limit) })) : null,
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'wu-close',
                  'aria-label': t('hide'),
                  title: t('panelClose'),
                  onClick: hide,
                },
                h(IconClose),
              ),
            ),
            notice === null ? null : h('p', { className: 'wu-notice' }, t(notice.key, notice.params)),
            scanning ? h('p', { className: 'wu-notice' }, t('scanning')) : null,
            !busy && !scanning
              ? h(
                'div',
                { className: 'wu-start' },
                h('button', {
                  type: 'button',
                  className: 'wu-start-button',
                  onClick: () => inputRef.current?.click(),
                }, t('pickFiles')),
                h('button', {
                  type: 'button',
                  className: 'wu-start-button',
                  onClick: () => dirInputRef.current?.click(),
                }, t('pickFolder')),
                h('p', { className: 'wu-start-hint' }, t('startHint')),
              )
              : null,
            h(
              'ul',
              { className: 'wu-list', hidden: items.length === 0 },
              items.map((item) => h(
                'li',
                { key: item.key, className: 'wu-item' },
                h(
                  'div',
                  { className: 'wu-item-top' },
                  h('span', { className: 'wu-item-name', title: item.label }, item.label),
                  h('span', { className: 'wu-item-size' }, formatBytes(item.size)),
                ),
                item.state === 'uploading' || item.state === 'saving'
                  ? h(
                    'div',
                    {
                      className: 'wu-bar',
                      role: 'progressbar',
                      'aria-label': item.name,
                      ...(item.state === 'uploading'
                        ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(item.progress * 100) }
                        : { 'aria-valuetext': t('statusSaving') }),
                    },
                    h('div', {
                      className: 'wu-bar-fill',
                      'data-saving': item.state === 'saving' ? 'true' : 'false',
                      style: item.state === 'uploading' ? { width: `${Math.round(item.progress * 100)}%` } : undefined,
                    }),
                  )
                  : null,
                h(
                  'p',
                  {
                    className: 'wu-item-status',
                    'data-state': item.state,
                    title: item.detail !== '' ? item.detail : undefined,
                  },
                  statusText(item, t),
                ),
              )),
            ),
            items.length === 0 && !busy
              ? null
              : h(
                'div',
                { className: 'wu-foot' },
                items.length > 0
                  ? h('span', { className: 'wu-summary', role: 'status', 'aria-live': 'polite', 'data-failed': String(failed > 0) }, summary)
                  : null,
                busy
                  ? h('button', { type: 'button', className: 'wu-foot-button', onClick: cancel }, t('cancel'))
                  : h('button', { type: 'button', className: 'wu-foot-button', onClick: hide }, t('hide')),
              ),
          ),
          document.body,
        )
        : null;

      const overlay = drag && dropRect !== null
        ? ReactDOM.createPortal(
          h(
            'div',
            {
              className: 'wu-drop',
              style: {
                top: Math.round(dropRect.top),
                left: Math.round(dropRect.left),
                width: Math.round(dropRect.width),
                height: Math.round(dropRect.height),
              },
              'aria-hidden': 'true',
            },
            h('span', { className: 'wu-drop-hint' }, t('actionDrop')),
          ),
          document.body,
        )
        : null;

      return h('div', { className: 'wu-root', 'data-workspace-upload': 'root' }, anchor, selection, directorySelection, panel, overlay);
    }

    return {
      inject: ['slots', 'locale'],

      // Pure helpers exposed for this plugin's own tests; not a client contract.
      __internals: { formatBytes, collectDropped, emptyDirectories, normalizeRelative, panelPosition, samePosition, splitUploadPath, statusText, errorText },

      /**
       * Register the dictionaries, the styles, and the Files header entry.
       * @param {object} ctx - Client root Context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'workspace-upload: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/workspace-upload/panel.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/workspace-upload';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'workspace-upload: styles');
        ctx.slots.inject('sidebar.right.tab.files.actions', () => ctx.slots.register(
          {
            name: 'sidebar.right.tab.files.actions',
            id: 'workspace-upload',
            order: 10,
            locale: NS,
          },
          UploadAction,
        ));
      },
    };
  },
});