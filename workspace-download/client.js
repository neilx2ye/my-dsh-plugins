/**
 * Browser half of the workspace download bundle.
 *
 * Three entry points read the execution device through the Host's download
 * routes, which stream their bytes straight to the browser's download manager:
 *
 * - a download control in a document preview's header, for the previewed file;
 * - a download control in the Files page header, for the whole workspace ZIP;
 * - a directory context-menu action, for any folder's ZIP.
 *
 * Every entry asks the route with HEAD first, so a refused download is reported
 * in the page instead of appearing as a failed browser download.
 */

window.__ModuleLoader__.load({
  id: '@local/workspace-download',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'workspaceDownload';
    /** Browser-relative Host route streaming one file. */
    const FILE_ROUTE = 'api/workspace-download/file';
    /** Browser-relative Host route streaming one directory as ZIP. */
    const ZIP_ROUTE = 'api/workspace-download/zip';
    /** Browser-relative Host route reporting the archive limits. */
    const LIMITS_ROUTE = 'api/workspace-download/limits';

    const EN = {
      file: 'Download this file',
      workspace: 'Download the whole workspace as a ZIP',
      zip: 'Download as ZIP (without .git)',
      zipWithGit: 'Download as ZIP (with .git)',
      menuTitle: 'Download a ZIP',
      includeGit: 'Include the .git folder',
      menuNote: 'node_modules is not included; the archive stops at {entries} entries or {size}.',
      menuNotePlain: 'node_modules is not included.',
      download: 'Download',
      cancel: 'Cancel',
      preparing: 'Preparing download…',
      started: 'Download started',
      errorFailed: 'The download failed; the Host reported an internal error',
      errorTooLarge: 'This folder is larger than the archive limit',
      errorTooLargeLimit: 'This folder is larger than the {size} archive limit',
      errorTooMany: 'This folder has too many files to archive',
      errorTooManyLimit: 'This folder has more than {entries} entries',
      errorOutside: 'That folder is outside the workspace',
      errorNotDirectory: 'That path is not a folder',
      errorNotFile: 'That path is not a regular file',
      errorUnavailable: 'The file or folder is no longer readable',
      errorNoSession: 'This conversation has no readable working directory',
      errorInvalidPath: 'The Host cannot use that path',
      errorUnauthorized: 'The session expired; refresh the page and try again',
      errorRejected: 'The Host rejected this download',
      errorNetwork: 'The browser could not reach DSH',
    };

    const ZH = {
      file: '下载此文件',
      workspace: '把整个工作区下载为 ZIP',
      zip: '下载为 ZIP（不含 .git）',
      zipWithGit: '下载为 ZIP（含 .git）',
      menuTitle: '下载 ZIP',
      includeGit: '包含 .git 目录',
      menuNote: '不含 node_modules；最多 {entries} 项或 {size}。',
      menuNotePlain: '不含 node_modules。',
      download: '下载',
      cancel: '取消',
      preparing: '正在准备下载…',
      started: '已开始下载',
      errorFailed: '下载失败，服务器内部错误',
      errorTooLarge: '这个文件夹超过打包大小上限',
      errorTooLargeLimit: '这个文件夹超过 {size} 的打包上限',
      errorTooMany: '这个文件夹的文件数量过多，无法打包',
      errorTooManyLimit: '这个文件夹超过 {entries} 项的打包上限',
      errorOutside: '该文件夹不在工作区内',
      errorNotDirectory: '该路径不是文件夹',
      errorNotFile: '该路径不是普通文件',
      errorUnavailable: '文件或文件夹已不可读',
      errorNoSession: '这个会话没有可读的工作目录',
      errorInvalidPath: '服务器无法使用该路径',
      errorUnauthorized: '登录状态已过期，请刷新页面后重试',
      errorRejected: '服务器拒绝了这次下载',
      errorNetwork: '浏览器无法连接 DSH',
    };

    const STYLE = `
.wd-root{position:relative;display:inline-flex;align-items:center;flex:none}
.wd-button{appearance:none;position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1;flex:none}
@media (hover:hover){.wd-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.wd-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));outline-offset:1px}
.wd-button:disabled{opacity:.45;cursor:default}
.wd-button svg{display:block;width:15px;height:15px}
.wd-spinner{display:block;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:wd-spin .8s linear infinite}
.wd-menu{position:fixed;z-index:1002;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:11px 13px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 16px 42px rgba(0,0,0,.34));outline:none;overflow:auto;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}
.wd-menu-title{margin:0;font-size:13px;font-weight:600;line-height:1.45}
.wd-menu-check{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.45;cursor:pointer}
.wd-menu-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}
.wd-menu-actions{display:flex;justify-content:flex-end;gap:6px}
.wd-menu-primary{appearance:none;padding:4px 12px;border:1px solid var(--dsw-alias-brand-primary);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;line-height:1.45}
.wd-menu-secondary{appearance:none;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:12px;line-height:1.45}
.wd-menu-primary:focus-visible,.wd-menu-secondary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));outline-offset:1px}
@keyframes wd-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.wd-spinner{animation:none;border-right-color:currentColor;opacity:.55}}
`;

    /** Archive limits reported by the Host, once known. */
    let archiveLimits = null;

    /**
     * A refused or failed download with its Host failure code.
     */
    class DownloadFailure extends Error {
      /**
       * @param {string} code - Host failure code or a transport code.
       * @param {number} status - HTTP status, 0 for a transport failure.
       */
      constructor(code, status) {
        super(code);
        this.name = 'DownloadFailure';
        this.code = code;
        this.status = status;
      }
    }

    /**
     * The download glyph: an arrow falling into a tray.
     * @returns {object} the SVG element.
     */
    function IconDownload() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 15, height: 15, role: 'presentation', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M8 2.4v7.1M5.2 6.9 8 9.7l2.8-2.8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M2.7 10.1v2.2c0 .8.6 1.4 1.4 1.4h7.8c.8 0 1.4-.6 1.4-1.4v-2.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
        }),
      );
    }

    /**
     * The archive glyph used by the directory menu action.
     * @returns {object} the SVG element.
     */
    function IconArchive() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 15, height: 15, role: 'presentation', 'aria-hidden': 'true', focusable: 'false' },
        h('rect', {
          x: 2.2,
          y: 2.6,
          width: 11.6,
          height: 10.8,
          rx: 2,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
        h('path', {
          d: 'M5.6 2.6v3.1c0 .6.5 1.1 1.1 1.1h4.6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M8 8.2v3.1M6.7 10 8 11.3 9.3 10',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
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
     * Place the workspace ZIP menu under its control, or above it when short.
     * @param {HTMLElement | null} anchor - the control that owns the menu.
     * @returns {{ top?: number, bottom?: number, left: number, width: number, maxHeight: number } | null} fixed style.
     */
    function menuPositionOf(anchor) {
      if (anchor === null) return null;
      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      const width = Math.min(320, Math.max(240, window.innerWidth - 16));
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      if (below >= 180 || below >= above) {
        return {
          top: Math.round(rect.bottom + 6),
          left: Math.round(left),
          width,
          maxHeight: Math.max(150, Math.min(320, below)),
        };
      }
      return {
        bottom: Math.round(window.innerHeight - rect.top + 6),
        left: Math.round(left),
        width,
        maxHeight: Math.max(150, Math.min(320, above)),
      };
    }

    /**
     * Build one route URL for a download.
     * @param {string} route - browser-relative route path.
     * @param {string} sessionId - Session the file belongs to.
     * @param {string} path - absolute Host path.
     * @returns {URL} the request URL.
     */
    function downloadUrl(route, sessionId, path) {
      const url = new URL(route, document.baseURI);
      url.searchParams.set('sessionId', sessionId);
      url.searchParams.set('path', path);
      return url;
    }

    /**
     * Read one failure answer into a coded failure.
     * @param {Response} response - failed HEAD answer.
     * @returns {Promise<DownloadFailure>} the failure.
     */
    /** Status-only fallbacks for answers that carry no Host code. */
    const STATUS_CODES = {
      400: 'invalid-path',
      403: 'rejected',
      404: 'file-unavailable',
      413: 'too-large',
      503: 'session-unavailable',
    };

    async function failureOf(response) {
      // HEAD carries no body, so the Host puts the code in a response header;
      // a GET (or a proxy) may instead answer with JSON or plain text.
      let code = response.headers.get('x-workspace-download-code') ?? '';
      if (code === '') {
        try {
          const body = await response.json();
          if (body !== null && typeof body === 'object' && typeof body.code === 'string') code = body.code;
        } catch {
          // A proxy or the bridge may answer without JSON.
        }
      }
      if (response.status === 401) return new DownloadFailure('unauthorized', response.status);
      if (code === '') code = STATUS_CODES[response.status] ?? `http-${response.status}`;
      return new DownloadFailure(code, response.status);
    }

    /**
     * Ask the Host for the download, then hand it to the browser's download manager.
     * @param {string} sessionId - Session the path belongs to.
     * @param {string} path - absolute Host path.
     * @param {boolean} zip - archive a directory instead of streaming one file.
     * @param {boolean} includeGit - include the folder's .git directory in the archive.
     * @returns {Promise<void>} resolves once the browser owns the transfer.
     * @throws {DownloadFailure} when the Host refuses the download.
     */
    async function startDownload(sessionId, path, zip, includeGit) {
      const url = downloadUrl(zip ? ZIP_ROUTE : FILE_ROUTE, sessionId, path);
      if (zip && includeGit) url.searchParams.set('git', '1');
      const controller = new AbortController();
      // Chrome allows a programmatic download only while the click's activation
      // lasts; a slow archive preflight must not spend that window, so a late
      // answer lets the download start and the browser reports a refusal instead.
      const timer = setTimeout(() => controller.abort(), 1500);
      let response = null;
      try {
        response = await fetch(url.href, {
          method: 'HEAD',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch (error) {
        if (!controller.signal.aborted) throw new DownloadFailure('network', 0);
      } finally {
        clearTimeout(timer);
      }
      if (response !== null && !response.ok) throw await failureOf(response);
      const anchor = document.createElement('a');
      anchor.href = url.href;
      anchor.download = '';
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }

    /**
     * Translate one download failure.
     * @param {unknown} error - thrown value.
     * @param {Function} t - namespace-bound translator.
     * @returns {string} the localized message.
     */
    function failureText(error, t) {
      const code = error instanceof DownloadFailure ? error.code : 'network';
      switch (code) {
        case 'too-large':
          return archiveLimits === null
            ? t('errorTooLarge')
            : t('errorTooLargeLimit', { size: formatBytes(archiveLimits.maxTotalBytes) });
        case 'too-many-entries':
          return archiveLimits === null
            ? t('errorTooMany')
            : t('errorTooManyLimit', { entries: archiveLimits.maxEntries });
        case 'path-outside-workspace':
          return t('errorOutside');
        case 'not-a-directory':
          return t('errorNotDirectory');
        case 'not-a-regular-file':
          return t('errorNotFile');
        case 'file-unavailable':
        case 'directory-unavailable':
          return t('errorUnavailable');
        case 'session-unavailable':
        case 'invalid-session':
        case 'working-directory-unavailable':
        case 'working-directory-failed':
          return t('errorNoSession');
        case 'invalid-path':
          return t('errorInvalidPath');
        case 'unauthorized':
          return t('errorUnauthorized');
        case 'rejected':
          return t('errorRejected');
        case 'network':
          return t('errorNetwork');
        default:
          return t('errorFailed');
      }
    }

    /**
     * One 28px download control: the glyph becomes a spinner while the Host answers.
     * @param {{ t: Function, sessionId: string, absolutePath: string, zip: boolean, notify: Function }} props -
     *   slot copy, the target, whether to archive a directory, and the toast seat.
     * @returns {object} the control.
     */
    function DownloadControl(props) {
      const { t, sessionId, absolutePath, zip, notify } = props;
      const [busy, setBusy] = React.useState(false);
      const [menuOpen, setMenuOpen] = React.useState(false);
      const [includeGit, setIncludeGit] = React.useState(false);
      const [menuStyle, setMenuStyle] = React.useState(null);
      const anchorRef = React.useRef(null);
      const menuRef = React.useRef(null);
      const downloadRef = React.useRef(null);
      const label = t(zip ? 'workspace' : 'file');

      const run = (withGit) => {
        setBusy(true);
        startDownload(sessionId, absolutePath, zip, withGit)
          .then(() => { if (typeof notify === 'function') notify(t('started'), true); })
          .catch((error) => { if (typeof notify === 'function') notify(failureText(error, t), false); })
          .finally(() => setBusy(false));
      };

      const click = () => {
        if (busy) return;
        if (!zip) {
          run(false);
          return;
        }
        setMenuOpen((value) => {
          if (value) return false;
          setMenuStyle(menuPositionOf(anchorRef.current));
          return true;
        });
      };

      // The menu is fixed-position: follow the control and close on Escape or
      // a click elsewhere, like the host's own popups.
      React.useEffect(() => {
        if (!menuOpen) return undefined;
        const update = () => setMenuStyle(menuPositionOf(anchorRef.current));
        update();
        downloadRef.current?.focus({ preventScroll: true });
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          setMenuOpen(false);
        };
        const onPointerDown = (event) => {
          if (menuRef.current !== null && menuRef.current.contains(event.target)) return;
          if (anchorRef.current !== null && anchorRef.current.contains(event.target)) return;
          setMenuOpen(false);
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
      }, [menuOpen]);

      const menu = menuOpen && menuStyle !== null
        ? ReactDOM.createPortal(
          h(
            'div',
            {
              ref: menuRef,
              className: 'wd-menu',
              role: 'dialog',
              'aria-label': t('menuTitle'),
              style: menuStyle,
            },
            h('p', { className: 'wd-menu-title' }, t('menuTitle')),
            h(
              'label',
              { className: 'wd-menu-check' },
              h('input', {
                type: 'checkbox',
                checked: includeGit,
                onChange: (event) => setIncludeGit(event.target.checked),
              }),
              h('span', null, t('includeGit')),
            ),
            h(
              'p',
              { className: 'wd-menu-note' },
              archiveLimits === null
                ? t('menuNotePlain')
                : t('menuNote', { entries: archiveLimits.maxEntries, size: formatBytes(archiveLimits.maxTotalBytes) }),
            ),
            h(
              'div',
              { className: 'wd-menu-actions' },
              h('button', {
                ref: downloadRef,
                type: 'button',
                className: 'wd-menu-primary',
                onClick: () => {
                  setMenuOpen(false);
                  run(includeGit);
                },
              }, t('download')),
              h('button', {
                type: 'button',
                className: 'wd-menu-secondary',
                onClick: () => setMenuOpen(false),
              }, t('cancel')),
            ),
          ),
          document.body,
        )
        : null;

      return h(
        'div',
        { className: 'wd-root' },
        h(
          'button',
          {
            ref: anchorRef,
            type: 'button',
            className: 'wd-button',
            'aria-label': busy ? t('preparing') : label,
            title: busy ? t('preparing') : label,
            'aria-busy': busy ? 'true' : undefined,
            'aria-haspopup': zip ? 'dialog' : undefined,
            'aria-expanded': zip ? menuOpen : undefined,
            disabled: busy,
            'data-workspace-download': 'trigger',
            onClick: click,
          },
          busy ? h('span', { className: 'wd-spinner', 'aria-hidden': 'true' }) : h(IconDownload),
        ),
        menu,
      );
    }

    /**
     * Preview header entry: downloads the previewed file.
     * @param {object} props - slot props.
     * @returns {object} the control.
     */
    function DownloadFileAction(props) {
      return h(DownloadControl, { ...props, zip: false });
    }

    /**
     * Files page header entry: downloads the workspace root as a ZIP.
     * @param {object} props - slot props.
     * @returns {object} the control.
     */
    function DownloadWorkspaceAction(props) {
      return h(DownloadControl, { ...props, zip: true });
    }

    return {
      inject: ['contextMenus', 'slots', 'locale'],

      // Pure helpers exposed for this plugin's own tests; not a client contract.
      __internals: { DownloadFailure, downloadUrl, failureOf, failureText, menuPositionOf },

      /**
       * Register dictionaries, styles, the context menu action, and the controls.
       * @param {object} ctx - Client root Context.
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'workspace-download: dictionaries');
        ctx.effect(() => {
          let cancelled = false;
          const url = new URL(LIMITS_ROUTE, document.baseURI);
          fetch(url.href, { credentials: 'same-origin', cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => {
              if (cancelled) return;
              if (body !== null && typeof body === 'object'
                && Number.isFinite(body.maxEntries) && Number.isFinite(body.maxTotalBytes)) {
                archiveLimits = { maxEntries: body.maxEntries, maxTotalBytes: body.maxTotalBytes };
              }
            })
            .catch(() => {});
          return () => { cancelled = true; };
        }, 'workspace-download: limits');
        ctx.effect(() => {
          const tagId = '@local/workspace-download/controls.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/workspace-download';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => { tag.remove(); };
        }, 'workspace-download: styles');

        ctx.effect(() => ctx.slots.inject('contextMenu.icon', () => ctx.slots.register(
          { name: 'contextMenu.icon', key: 'workspace-download.zip' },
          IconArchive,
        )), 'workspace-download: menu glyph');

        ctx.effect(() => ctx.contextMenus.register({
          id: 'workspace-download.directory',
          target: 'directory',
          order: 150,
          resolve: (target) => {
            const run = (includeGit) => async () => {
              try {
                await startDownload(target.sessionId, target.path, true, includeGit);
                ctx.contextMenus.notify(t('started'), true);
              } catch (error) {
                ctx.contextMenus.notify(failureText(error, t), false);
              }
            };
            return [
              {
                id: 'downloadZip',
                label: t('zip'),
                icon: { key: 'workspace-download.zip' },
                failureLabel: t('errorFailed'),
                run: run(false),
              },
              {
                id: 'downloadZipWithGit',
                label: t('zipWithGit'),
                icon: { key: 'workspace-download.zip' },
                failureLabel: t('errorFailed'),
                run: run(true),
              },
            ];
          },
        }), 'workspace-download: directory menu');

        const notify = (message, success) => { ctx.contextMenus.notify(message, success); };
        for (const [slot, Component, order] of [
          ['sidebar.right.tab.document.actions', DownloadFileAction, 5],
          ['sidebar.right.tab.files.actions', DownloadWorkspaceAction, 5],
        ]) {
          ctx.effect(() => ctx.slots.inject(slot, () => ctx.slots.register(
            {
              name: slot,
              id: 'workspace-download',
              order,
              locale: NS,
              inject: () => ({ notify }),
            },
            Component,
          )), `workspace-download: ${slot}`);
        }
      },
    };
  },
});