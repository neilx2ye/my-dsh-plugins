/**
 * Browser half of the workspace upload bundle.
 *
 * The Files page owns the workspace tree, so this bundle adds one control to
 * that page's header: choose files from the local computer (or drop them on the
 * control) and each is streamed to the Host route, which writes it into the
 * Session's workspace directory. Uploads run one file at a time so the progress
 * panel stays readable, and the tree refreshes itself when the Host publishes
 * the new entries.
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
    /** Width of the progress panel. */
    const PANEL_WIDTH = 340;
    /** Distance between the control and its panel. */
    const PANEL_GAP = 6;
    /** How long a fully successful upload stays on screen. */
    const AUTO_CLOSE_MS = 3500;

    const EN = {
      action: 'Upload files',
      actionHint: 'Upload files from this computer into this workspace',
      actionDrop: 'Drop to upload into this workspace',
      panel: 'Uploads',
      panelClose: 'Close uploads',
      target: 'Saving to',
      cancel: 'Cancel',
      summaryBusy: 'Uploading {done} of {total}…',
      summaryDone: '{count} files uploaded',
      summaryDoneOne: '1 file uploaded',
      summaryFailed: '{done} uploaded, {failed} failed',
      summaryFailedOne: '1 file failed',
      statusQueued: 'Waiting',
      statusUploading: '{percent}%',
      statusDone: 'Uploaded',
      statusRenamed: 'Uploaded as {name}',
      statusCancelled: 'Cancelled',
      errorUpload: 'The upload failed',
      errorNetwork: 'The browser could not reach DSH',
      errorTooLarge: 'This file is larger than the upload limit',
      errorRejected: 'The Host rejected this upload',
      errorNoSession: 'This conversation has no readable working directory',
      errorOutside: 'That destination is outside the workspace',
      errorName: 'No free file name is available',
      errorEmpty: 'The file is empty',
    };

    const ZH = {
      action: '上传文件',
      actionHint: '把本机文件上传到这个工作区',
      actionDrop: '松开鼠标即可上传到工作区',
      panel: '上传',
      panelClose: '关闭上传面板',
      target: '保存到',
      cancel: '取消',
      summaryBusy: '正在上传第 {done} / {total} 个…',
      summaryDone: '已上传 {count} 个文件',
      summaryDoneOne: '已上传 1 个文件',
      summaryFailed: '已上传 {done} 个，失败 {failed} 个',
      summaryFailedOne: '1 个文件上传失败',
      statusQueued: '等待上传',
      statusUploading: '{percent}%',
      statusDone: '已上传',
      statusRenamed: '已上传为 {name}',
      statusCancelled: '已取消',
      errorUpload: '上传失败',
      errorNetwork: '浏览器无法连接 DSH',
      errorTooLarge: '文件超过上传大小上限',
      errorRejected: '服务器拒绝了这次上传',
      errorNoSession: '这个会话没有可读的工作目录',
      errorOutside: '目标目录不在工作区内',
      errorName: '没有可用的文件名',
      errorEmpty: '文件内容为空',
    };

    const STYLE = `
.wu-root{position:relative;display:inline-flex;align-items:center;flex:none}
.wu-button{appearance:none;position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1;flex:none}
.wu-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wu-button[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wu-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.wu-button[data-drag="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.wu-button svg{display:block;width:15px;height:15px}
.wu-badge{position:absolute;right:-3px;bottom:-4px;box-sizing:border-box;min-width:13px;height:13px;padding:0 3px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:600 8px/13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;text-align:center}
.wu-pop{position:fixed;z-index:90;box-sizing:border-box;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 16px 42px rgba(0,0,0,.34));overflow:hidden;font-size:var(--dsh-content-font-size-secondary,12px);line-height:1.5}
.wu-pop-head{display:flex;flex:none;align-items:flex-start;gap:6px;min-width:0;padding:9px 8px 8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.wu-pop-copy{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0}
.wu-pop-title{margin:0;font-size:11.5px;font-weight:600;line-height:1.45}
.wu-pop-target{display:flex;align-items:baseline;gap:5px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:1.4}
.wu-pop-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:9.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.9}
.wu-close{appearance:none;display:inline-flex;flex:none;align-items:center;justify-content:center;width:24px;height:24px;padding:4px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1}
.wu-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.wu-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.wu-close svg{display:block}
.wu-list{flex:1 1 auto;min-height:0;margin:0;padding:0;overflow:auto;list-style:none;scrollbar-width:thin}
.wu-item{display:flex;flex-direction:column;gap:4px;padding:7px 12px 8px;border-top:1px solid var(--dsw-alias-border-l1)}
.wu-item:first-child{border-top:0}
.wu-item-top{display:flex;align-items:baseline;gap:8px;min-width:0}
.wu-item-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.45}
.wu-item-size{flex:none;color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:1.45;font-variant-numeric:tabular-nums;opacity:.85}
.wu-bar{height:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.wu-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .12s linear}
.wu-item-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:1.45;overflow-wrap:anywhere}
.wu-item-status[data-state="done"]{color:var(--dsw-alias-state-success-primary)}
.wu-item-status[data-state="error"]{color:var(--dsw-alias-state-error-primary)}
.wu-item-status[data-state="uploading"]{color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums}
.wu-foot{display:flex;flex:none;align-items:center;gap:8px;padding:7px 10px 8px 12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.wu-summary{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:1.45}
.wu-summary[data-failed="true"]{color:var(--dsw-alias-state-error-primary)}
.wu-foot-button{appearance:none;flex:none;padding:3px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:10.5px;line-height:1.5;white-space:nowrap}
.wu-foot-button:hover{background:var(--dsw-alias-bg-layer-2)}
.wu-foot-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
@media (prefers-reduced-motion:reduce){.wu-bar-fill{transition:none}}
`;

    /**
     * The upload glyph: a tray with an arrow rising out of it.
     * @returns {object} the SVG element.
     */
    function IconUpload() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 16, height: 16, role: 'presentation', 'aria-hidden': 'true', focusable: 'false' },
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
     * @param {string} sessionId - Session whose workspace receives the file.
     * @param {(fraction: number) => void} onProgress - send progress in 0..1.
     * @param {(xhr: XMLHttpRequest | null) => void} track - exposes the live request for cancellation.
     * @returns {Promise<object>} the stored value, or a failure with `code`.
     */
    function sendOne(file, sessionId, onProgress, track) {
      return new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
          if (settled) return;
          settled = true;
          track(null);
          resolve(value);
        };
        const url = new URL(UPLOAD_ROUTE, document.baseURI);
        url.searchParams.set('sessionId', sessionId);
        url.searchParams.set('name', file.name);
        const xhr = new XMLHttpRequest();
        track(xhr);
        xhr.open('POST', url.href);
        xhr.setRequestHeader('content-type', 'application/octet-stream');
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
        };
        xhr.onload = () => {
          const body = parseJson(xhr.responseText);
          if (xhr.status === 200 && body !== null && body.ok === true && body.value !== null && typeof body.value === 'object') {
            settle({ ok: true, value: body.value });
            return;
          }
          settle({
            ok: false,
            code: typeof body?.code === 'string' ? body.code : 'http',
            message: typeof body?.message === 'string' ? body.message : `HTTP ${xhr.status}`,
          });
        };
        xhr.onerror = () => settle({ ok: false, code: 'network', message: '' });
        xhr.onabort = () => settle({ ok: false, code: 'cancelled', cancelled: true, message: '' });
        xhr.send(file);
      });
    }

    /**
     * Place the panel below the control, or above it when the viewport is short.
     * @param {HTMLElement} anchor - the control the panel belongs to.
     * @returns {{ top?: number, bottom?: number, left: number, width: number, maxHeight: number }} fixed-position style.
     */
    function panelPosition(anchor) {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(PANEL_WIDTH, Math.max(220, window.innerWidth - 16));
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - PANEL_GAP - 8;
      const above = rect.top - PANEL_GAP - 8;
      const openBelow = below >= 200 || below >= above;
      const space = openBelow ? below : above;
      const maxHeight = Math.max(150, Math.min(320, space));
      return openBelow
        ? { top: Math.round(rect.bottom + PANEL_GAP), left: Math.round(left), width, maxHeight }
        : { bottom: Math.round(window.innerHeight - rect.top + PANEL_GAP), left: Math.round(left), width, maxHeight };
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
        case 'done':
          return item.savedAs !== '' && item.savedAs !== item.name
            ? t('statusRenamed', { name: item.savedAs })
            : t('statusDone');
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
          return t('errorRejected');
        case 'session-unavailable':
          return t('errorNoSession');
        case 'path-outside-workspace':
          return t('errorOutside');
        case 'name-conflict':
        case 'name-unavailable':
        case 'directory-target':
        case 'symlink-target':
          return t('errorName');
        case 'empty-body':
          return t('errorEmpty');
        case 'cancelled':
          return t('statusCancelled');
        default:
          return item.message !== '' ? item.message : t('errorUpload');
      }
    }

    /**
     * The Files page header control and its upload panel.
     * @param {object} props - slot props: `sessionId`, `absolutePath`, and the namespace translator.
     * @returns {object} the control, and its panel while there is something to report.
     */
    function UploadAction(props) {
      const { t, sessionId, absolutePath } = props;
      const [items, setItems] = React.useState([]);
      const [busy, setBusy] = React.useState(false);
      const [drag, setDrag] = React.useState(false);
      const [open, setOpen] = React.useState(false);
      const [position, setPosition] = React.useState(null);
      const anchorRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const inputRef = React.useRef(null);
      const abortRef = React.useRef(null);
      const busyRef = React.useRef(false);
      const cancelRef = React.useRef(false);
      const aliveRef = React.useRef(true);
      const autoCloseRef = React.useRef(null);
      const sessionRef = React.useRef(sessionId);
      sessionRef.current = sessionId;

      /**
       * Update one listed upload when the component is still mounted.
       * @param {string} key - listed upload identity.
       * @param {object} patch - fields to replace.
       */
      const patch = React.useCallback((key, value) => {
        if (!aliveRef.current) return;
        setItems((previous) => previous.map((item) => (item.key === key ? { ...item, ...value } : item)));
      }, []);

      /**
       * Stream the chosen files into the workspace, one at a time.
       * @param {FileList | File[]} fileList - files chosen or dropped by the user.
       */
      const start = React.useCallback(async (fileList) => {
        if (busyRef.current) return;
        const files = Array.from(fileList ?? []).filter((file) => file instanceof File);
        if (files.length === 0) return;
        const session = sessionRef.current;
        busyRef.current = true;
        cancelRef.current = false;
        abortRef.current = null;
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
        setBusy(true);
        setOpen(true);
        const stamp = Date.now().toString(36);
        const entries = files.map((file, index) => ({
          key: `${stamp}-${index}`,
          name: file.name === '' ? `file-${index + 1}` : file.name,
          size: file.size,
          state: 'queued',
          progress: 0,
          savedAs: '',
          code: '',
          message: '',
        }));
        setItems(entries);
        let failed = 0;
        for (let index = 0; index < files.length; index += 1) {
          const entry = entries[index];
          if (cancelRef.current) {
            patch(entry.key, { state: 'cancelled' });
            failed += 1;
            continue;
          }
          patch(entry.key, { state: 'uploading', progress: 0 });
          let result;
          try {
            result = await sendOne(
              files[index],
              session,
              (fraction) => patch(entry.key, { progress: fraction }),
              (xhr) => { abortRef.current = xhr; },
            );
          } catch (error) {
            result = { ok: false, code: 'unknown', message: error instanceof Error ? error.message : String(error) };
          }
          if (result.ok) {
            const stored = typeof result.value.name === 'string' ? result.value.name : entry.name;
            patch(entry.key, { state: 'done', progress: 1, savedAs: stored });
          } else if (result.cancelled) {
            patch(entry.key, { state: 'cancelled' });
            failed += 1;
          } else {
            patch(entry.key, { state: 'error', code: result.code, message: result.message });
            failed += 1;
          }
        }
        busyRef.current = false;
        if (!aliveRef.current) return;
        setBusy(false);
        if (failed === 0) {
          autoCloseRef.current = setTimeout(() => {
            if (aliveRef.current && panelRef.current?.contains(document.activeElement)) {
              anchorRef.current?.focus({ preventScroll: true });
            }
            if (aliveRef.current) setOpen(false);
          }, AUTO_CLOSE_MS);
        }
      }, [patch]);

      /**
       * Stop the current file and skip the rest of the queue.
       */
      const cancel = React.useCallback(() => {
        cancelRef.current = true;
        const xhr = abortRef.current;
        if (xhr !== null) xhr.abort();
      }, []);

      /**
       * Dismiss the panel and hand focus back to the control when it held focus.
       */
      const close = React.useCallback(() => {
        setOpen(false);
        if (panelRef.current !== null && panelRef.current.contains(document.activeElement)) {
          anchorRef.current?.focus({ preventScroll: true });
        }
      }, []);

      // Follow the control while the panel is open: it is fixed-position, so a
      // resize or a sidebar scroll would otherwise leave it behind.
      React.useEffect(() => {
        if (!open) return undefined;
        const update = () => {
          const anchor = anchorRef.current;
          if (anchor !== null) setPosition(panelPosition(anchor));
        };
        update();
        panelRef.current?.focus({ preventScroll: true });
        const onKeyDown = (event) => {
          if (event.key === 'Escape') close();
        };
        const onPointerDown = (event) => {
          const target = event.target;
          if (panelRef.current !== null && panelRef.current.contains(target)) return;
          if (anchorRef.current !== null && anchorRef.current.contains(target)) return;
          setOpen(false);
        };
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
          window.removeEventListener('resize', update);
          window.removeEventListener('scroll', update, true);
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [open, close]);

      // A page leaving mid-upload would lose the browser's stream; ask first.
      React.useEffect(() => {
        if (!busy) return undefined;
        const guard = (event) => {
          event.preventDefault();
          event.returnValue = '';
        };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
      }, [busy]);

      // Resource cleanup only: a running upload continues after this tab closes,
      // so the bytes the user chose are not discarded silently.
      React.useEffect(() => () => {
        aliveRef.current = false;
        clearTimeout(autoCloseRef.current);
      }, []);

      const onDrop = (event) => {
        event.preventDefault();
        setDrag(false);
        const files = event.dataTransfer?.files;
        if (files !== undefined && files.length > 0) void start(files);
      };
      const onDragOver = (event) => {
        if (event.dataTransfer === null || !Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDrag(true);
      };
      const onDragLeave = (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setDrag(false);
      };

      const done = items.filter((item) => item.state === 'done').length;
      const failed = items.filter((item) => item.state === 'error' || item.state === 'cancelled').length;
      const settled = done + failed;
      const badge = busy ? `${Math.min(settled + 1, items.length)}/${items.length}` : null;
      let summary;
      if (busy) summary = t('summaryBusy', { done: Math.min(settled + 1, items.length), total: items.length });
      else if (failed > 0) {
        summary = items.length === 1
          ? t('summaryFailedOne')
          : t('summaryFailed', { done, failed });
      } else {
        summary = items.length === 1 ? t('summaryDoneOne') : t('summaryDone', { count: items.length });
      }

      const anchor = h(
        'button',
        {
          ref: anchorRef,
          type: 'button',
          className: 'wu-button',
          'aria-label': t('action'),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          title: drag ? t('actionDrop') : t('actionHint'),
          'data-drag': drag ? 'true' : 'false',
          'data-workspace-upload': 'trigger',
          onClick: () => {
            if (busyRef.current) {
              setOpen((value) => !value);
              return;
            }
            inputRef.current?.click();
          },
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
          if (files !== null && files.length > 0) void start(files);
        },
      });

      const panel = open && position !== null
        ? ReactDOM.createPortal(
          h(
            'div',
            {
              ref: panelRef,
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
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'wu-close',
                  'aria-label': t('panelClose'),
                  onClick: close,
                },
                h(IconClose),
              ),
            ),
            h(
              'ul',
              { className: 'wu-list' },
              items.map((item) => h(
                'li',
                { key: item.key, className: 'wu-item' },
                h(
                  'div',
                  { className: 'wu-item-top' },
                  h('span', { className: 'wu-item-name', title: item.name }, item.name),
                  h('span', { className: 'wu-item-size' }, formatBytes(item.size)),
                ),
                item.state === 'uploading'
                  ? h(
                    'div',
                    { className: 'wu-bar' },
                    h('div', {
                      className: 'wu-bar-fill',
                      style: { width: `${Math.round(item.progress * 100)}%` },
                    }),
                  )
                  : null,
                h('p', { className: 'wu-item-status', 'data-state': item.state }, statusText(item, t)),
              )),
            ),
            h(
              'div',
              { className: 'wu-foot' },
              h('span', { className: 'wu-summary', 'data-failed': String(failed > 0) }, summary),
              busy
                ? h('button', { type: 'button', className: 'wu-foot-button', onClick: cancel }, t('cancel'))
                : h('button', { type: 'button', className: 'wu-foot-button', onClick: close }, t('panelClose')),
            ),
          ),
          document.body,
        )
        : null;

      return h(
        'div',
        {
          className: 'wu-root',
          'data-workspace-upload': 'root',
          onDrop,
          onDragOver,
          onDragLeave,
        },
        anchor,
        selection,
        panel,
      );
    }

    return {
      inject: ['slots', 'locale'],

      /**
       * Register the dictionaries, the panel styles, and the Files header entry.
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