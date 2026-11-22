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
      zip: 'Download as ZIP',
      started: 'Download started',
      confirmWorkspace: 'Archive the whole workspace? .git and node_modules are left out. The archive stops at {entries} entries or {size}.',
      confirmWorkspacePlain: 'Archive the whole workspace? .git and node_modules are left out.',
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
      zip: '下载为 ZIP',
      started: '已开始下载',
      confirmWorkspace: '要打包整个工作区吗？.git 与 node_modules 会被排除，最多 {entries} 项或 {size}。',
      confirmWorkspacePlain: '要打包整个工作区吗？.git 与 node_modules 会被排除。',
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
     * @returns {Promise<void>} resolves once the browser owns the transfer.
     * @throws {DownloadFailure} when the Host refuses the download.
     */
    async function startDownload(sessionId, path, zip) {
      const url = downloadUrl(zip ? ZIP_ROUTE : FILE_ROUTE, sessionId, path);
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
      const label = t(zip ? 'workspace' : 'file');
      const click = () => {
        if (busy) return;
        if (zip) {
          const confirmed = archiveLimits === null
            ? t('confirmWorkspacePlain')
            : t('confirmWorkspace', { entries: archiveLimits.maxEntries, size: formatBytes(archiveLimits.maxTotalBytes) });
          if (!window.confirm(confirmed)) return;
        }
        setBusy(true);
        startDownload(sessionId, absolutePath, zip)
          .then(() => { if (typeof notify === 'function') notify(t('started'), true); })
          .catch((error) => { if (typeof notify === 'function') notify(failureText(error, t), false); })
          .finally(() => setBusy(false));
      };
      return h(
        'div',
        { className: 'wd-root' },
        h(
          'button',
          {
            type: 'button',
            className: 'wd-button',
            'aria-label': label,
            title: label,
            'aria-busy': busy ? 'true' : undefined,
            disabled: busy,
            'data-workspace-download': 'trigger',
            onClick: click,
          },
          busy ? h('span', { className: 'wd-spinner', 'aria-hidden': 'true' }) : h(IconDownload),
        ),
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
      __internals: { DownloadFailure, failureOf, failureText, downloadUrl },

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
            const label = t('zip');
            return [{
              id: 'downloadZip',
              label,
              icon: { key: 'workspace-download.zip' },
              failureLabel: t('errorFailed'),
              run: async () => {
                try {
                  await startDownload(target.sessionId, target.path, true);
                  ctx.contextMenus.notify(t('started'), true);
                } catch (error) {
                  ctx.contextMenus.notify(failureText(error, t), false);
                }
              },
            }];
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