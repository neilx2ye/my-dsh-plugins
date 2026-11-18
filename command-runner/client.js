/**
 * Browser half of the command runner bundle.
 *
 * Registers a composer tool-row toggle and a floating, multi-tab command window
 * portaled to the document body, so the composer's sticky, clipped layer never
 * covers it. Each tab owns one independently running command, so several
 * commands can stream at the same time. The window can be moved by its title
 * bar, resized in height from the bottom grip, and remembers its geometry. It
 * posts to the Host's `/api/command-runner` routes and renders the
 * Server-Sent Events they stream back. URLs in that output render as links;
 * interactive tabs run on a PTY and forward typed lines back as standard input.
 */

window.__ModuleLoader__.load({
  id: '@local/command-runner',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'commandRunner';
    /** Host route that runs one command in the Session directory. App-owned browser routes are document-relative. */
    const RUN_URL = '/api/command-runner/run'.slice(1);
    /** Host route that reports the Session directory. */
    const WORKSPACE_URL = '/api/command-runner/workspace'.slice(1);
    /** Host route that forwards one input line to an interactive run's PTY. */
    const INPUT_URL = '/api/command-runner/input'.slice(1);
    /** Client-side ceiling so one huge command cannot freeze the window. */
    const MAX_OUTPUT_CHARS = 400_000;
    /** Remembered command lines per tab. */
    const MAX_HISTORY = 50;
    /** localStorage key holding the floating window's last geometry. */
    const GEOMETRY_KEY = 'dsh.command-runner.window.v1';
    /** localStorage prefix for a project's common commands. */
    const SHORTCUTS_KEY_PREFIX = 'dsh.command-runner.shortcuts.v1:';
    /** Most common commands retained per project. */
    const MAX_SHORTCUTS = 24;
    /** Starting window width before viewport clamping. */
    const DEFAULT_WIDTH = 640;
    /** Starting window height before viewport clamping. */
    const DEFAULT_HEIGHT = 320;
    /** Space kept between the window and the viewport edge. */
    const VIEWPORT_MARGIN = 8;
    /** Room left below a fallback window for the composer. */
    const COMPOSER_CLEARANCE = 220;

    const STYLE = `
.crk-toggle{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;min-width:28px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em}
.crk-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.crk-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.crk-toggle[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.crk-window{position:fixed;z-index:60;box-sizing:border-box;display:flex;flex-direction:column;min-width:280px;min-height:210px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.45));overflow:hidden}
.crk-window[data-dragging="true"],.crk-window[data-resizing="true"]{user-select:none}
.crk-head{box-sizing:border-box;display:flex;flex:none;align-items:center;gap:8px;padding:8px 10px 8px 12px;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.4;min-width:0;cursor:grab;touch-action:none;user-select:none}
.crk-window[data-dragging="true"] .crk-head{cursor:grabbing}
.crk-grip{flex:none;width:11px;height:15px;border-radius:2px;background-image:radial-gradient(circle at 2px 2px,var(--dsw-alias-label-caption) 1.1px,transparent 1.3px);background-size:6px 5px;opacity:.9}
.crk-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.crk-dot[data-running="true"]{background:var(--dsw-alias-state-warn-primary)}
.crk-cwd{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.crk-ghost{appearance:none;flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:6px;padding:2px 6px;font-size:12px;line-height:1.4}
.crk-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.crk-ghost:disabled{opacity:.45;cursor:default}
.crk-tabbar{display:flex;flex:none;align-items:center;gap:4px;min-width:0;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1)}
.crk-tablist{display:flex;flex:1;align-items:center;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:thin}
.crk-tab{display:flex;flex:none;align-items:center;max-width:180px;border-radius:7px;color:var(--dsw-alias-label-tertiary)}
.crk-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.crk-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.crk-tab-label{appearance:none;display:flex;align-items:center;gap:6px;min-width:0;max-width:150px;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;padding:4px 2px 4px 8px;font-size:11.5px;line-height:1.4;text-align:left}
.crk-tab-label:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.crk-tab-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.crk-tab-dot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-caption)}
.crk-tab-dot[data-state="running"]{background:var(--dsw-alias-state-warn-primary)}
.crk-tab-dot[data-state="done"]{background:var(--dsw-alias-state-success-primary)}
.crk-tab-dot[data-state="error"]{background:var(--dsw-alias-state-error-primary)}
.crk-tab-dot[data-state="stopped"]{background:var(--dsw-alias-label-tertiary)}
.crk-tab-dot[data-state="idle"]{visibility:hidden}
.crk-tab-close{appearance:none;flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:13px;line-height:1;padding:0}
.crk-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.crk-tab-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.crk-newtab{appearance:none;flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:16px;line-height:1;padding:0}
.crk-newtab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.crk-newtab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.crk-form{display:flex;flex:none;align-items:center;gap:8px;padding:8px 10px 8px 12px;border-bottom:1px solid var(--dsw-alias-border-l3)}
.crk-prompt{flex:none;color:var(--dsw-alias-brand-primary);font:600 13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;user-select:none}
.crk-input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:3px 0}
.crk-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.crk-btn{appearance:none;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;padding:3px 12px;font-size:12px;line-height:1.6;white-space:nowrap}
.crk-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.crk-btn:disabled{opacity:.45;cursor:default}
.crk-btn[data-kind="stop"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.crk-mode{appearance:none;flex:none;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:3px 8px;font-size:11px;line-height:1.5;white-space:nowrap}
.crk-mode:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.crk-mode[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.crk-mode:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.crk-mode:disabled{opacity:.45;cursor:default}
.crk-star{appearance:none;flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:0}
.crk-star:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.crk-star:disabled{opacity:.45;cursor:default}
.crk-star[data-saved="true"]{color:var(--dsw-alias-brand-primary);opacity:1}
.crk-star:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.crk-shortcuts{display:flex;flex:none;align-items:center;gap:8px;min-width:0;padding:4px 8px 5px;border-bottom:1px solid var(--dsw-alias-border-l3)}
.crk-short-label{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;letter-spacing:.04em;padding-left:2px}
.crk-chips{display:flex;flex:1;align-items:center;gap:6px;min-width:0;overflow-x:auto;scrollbar-width:thin}
.crk-chip{display:inline-flex;flex:none;align-items:center;max-width:240px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary)}
.crk-chip:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.crk-chip-run{appearance:none;flex:0 1 auto;min-width:0;border:0;background:transparent;color:inherit;cursor:pointer;padding:2px 2px 2px 9px;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crk-chip-run:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:999px}
.crk-chip-close{appearance:none;flex:none;display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;margin-right:3px;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px;line-height:1;padding:0}
.crk-chip-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.crk-chip-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.crk-output{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);box-sizing:border-box;flex:1 1 auto;min-height:34px;margin:0;padding:9px 12px 10px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;scrollbar-width:thin}
.crk-link{color:var(--dsw-alias-brand-primary);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;overflow-wrap:anywhere;cursor:pointer;border-radius:2px}
.crk-link:hover{text-decoration-thickness:2px}
.crk-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.crk-foot{box-sizing:border-box;display:flex;flex:none;align-items:center;gap:10px;padding:4px 12px 5px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;min-height:19px}
.crk-foot-note{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crk-good{color:var(--dsw-alias-state-success-primary)}
.crk-bad{color:var(--dsw-alias-state-error-primary)}
.crk-resize{display:flex;flex:none;align-items:center;justify-content:center;height:12px;background:transparent;cursor:ns-resize;touch-action:none}
.crk-resize::after{content:"";width:34px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);transition:background .12s}
.crk-resize:hover::after,.crk-resize:focus-visible::after,.crk-window[data-resizing="true"] .crk-resize::after{background:var(--dsw-alias-brand-primary)}
.crk-resize:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:6px}
`;

    const EN = {
      toggle: 'Command line',
      placeholder: 'Enter a command, press Enter to run',
      run: 'Run',
      stop: 'Stop',
      clear: 'Clear',
      close: 'Close',
      tab: 'Command {number}',
      newTab: 'New tab',
      closeTab: 'Close tab',
      interactive: 'Interactive',
      interactiveHint: 'Run on a PTY and send input lines to the process',
      rawPlaceholder: 'Terminal input — keystrokes go to the process',
      hostRestart: 'Restart dsh web to enable interactive input',
      shortcuts: 'COMMON',
      saveShortcut: 'Save as a common command',
      savedShortcut: 'Already a common command',
      removeShortcut: 'Remove common command',
      shortcutLimit: 'Common command limit reached',
      inputFailed: 'Could not send input; the process may have exited',
      empty: "Runs in the current session's working directory.",
      cwdPending: 'Reading working directory…',
      exitCode: 'Exit code {code}',
      exitSignal: 'Signal {signal}',
      timeout: 'Timed out — the process was terminated',
      stopped: 'Stopped',
      truncated: 'Output truncated',
      move: 'Drag to move · double-click to reset position',
      resize: 'Drag or use the arrow keys to resize the height',
    };

    const ZH = {
      toggle: '命令行',
      placeholder: '输入命令，回车运行',
      run: '运行',
      stop: '停止',
      clear: '清空',
      close: '关闭',
      tab: '命令 {number}',
      newTab: '新建标签',
      closeTab: '关闭标签',
      interactive: '交互',
      interactiveHint: '在 PTY 中运行，回车把输入发送给进程',
      rawPlaceholder: '终端输入：按键直接发送到进程',
      hostRestart: '重启 dsh web 后可启用交互输入',
      shortcuts: '常用',
      saveShortcut: '保存为常用命令',
      savedShortcut: '已在常用命令中',
      removeShortcut: '移除常用命令',
      shortcutLimit: '常用命令已满',
      inputFailed: '输入发送失败，进程可能已退出',
      empty: '命令会在当前会话的工作目录中运行。',
      cwdPending: '正在读取工作目录…',
      exitCode: '退出码 {code}',
      exitSignal: '信号 {signal}',
      timeout: '已超时，进程已终止',
      stopped: '已停止',
      truncated: '输出已截断',
      move: '拖动标题栏移动 · 双击复位',
      resize: '拖动或按方向键调整高度',
    };

    /** Window states keyed by Workspace (or by Session when ungrouped), kept outside React. */
    const stores = new Map();

    /** Last known floating-window geometry, remembered across reloads. */
    let savedGeometry = readSavedGeometry();

    /** Last rendered geometry, kept across composer remounts when switching Sessions. */
    let lastGeometry = null;

    /** Client Workspace list service captured at activation. */
    let workspaceList = null;

    /** Identity-stable empty Workspace snapshot used before activation. */
    const EMPTY_WORKSPACE_SNAPSHOT = Object.freeze({ items: [] });

    /**
     * Subscribe to the Client Workspace list.
     * @param listener - invalidation callback.
     * @returns the unsubscribe function.
     */
    function subscribeWorkspaces(listener) {
      return workspaceList === null ? () => {} : workspaceList.subscribe(listener);
    }

    /**
     * Read the Client Workspace snapshot.
     * @returns the current snapshot, or an empty one before activation.
     */
    function getWorkspaceSnapshot() {
      return workspaceList === null ? EMPTY_WORKSPACE_SNAPSHOT : workspaceList.getSnapshot();
    }

    /**
     * Read the remembered window geometry.
     * @returns the stored geometry, or null when absent or unreadable.
     */
    function readSavedGeometry() {
      try {
        const raw = localStorage.getItem(GEOMETRY_KEY);
        if (raw === null) return null;
        const value = JSON.parse(raw);
        return value !== null && typeof value === 'object' ? value : null;
      } catch {
        return null;
      }
    }

    /**
     * Persist the window geometry, ignoring storage failures.
     * @param geometry - clamped geometry to remember.
     */
    function saveGeometry(geometry) {
      savedGeometry = geometry;
      try {
        localStorage.setItem(GEOMETRY_KEY, JSON.stringify(geometry));
      } catch {}
    }

    /**
     * Read a project's saved common commands.
     * @param storageKey - project path or Session identity.
     * @returns validated commands in saved order.
     */
    function readShortcuts(storageKey) {
      try {
        const raw = localStorage.getItem(`${SHORTCUTS_KEY_PREFIX}${storageKey}`);
        if (raw === null) return [];
        const value = JSON.parse(raw);
        if (!Array.isArray(value)) return [];
        const shortcuts = [];
        for (const item of value) {
          if (typeof item !== 'string') continue;
          const command = item.trim();
          if (command === '' || shortcuts.includes(command)) continue;
          shortcuts.push(command);
          if (shortcuts.length >= MAX_SHORTCUTS) break;
        }
        return shortcuts;
      } catch {
        return [];
      }
    }

    /**
     * Persist a project's common commands.
     * @param storageKey - project path or Session identity.
     * @param shortcuts - commands to save.
     */
    function writeShortcuts(storageKey, shortcuts) {
      try {
        localStorage.setItem(`${SHORTCUTS_KEY_PREFIX}${storageKey}`, JSON.stringify(shortcuts));
      } catch {}
    }

    /**
     * Read a finite number, falling back when absent.
     * @param value - candidate value.
     * @param fallback - value used when the candidate is not finite.
     * @returns a finite number.
     */
    function finite(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    }

    /**
     * Compute the geometry a freshly opened window uses.
     * @returns width, height, left, and top in viewport coordinates.
     */
    function defaultGeometry() {
      const viewportWidth = Math.max(320, window.innerWidth || 1024);
      const viewportHeight = Math.max(240, window.innerHeight || 768);
      const width = Math.min(DEFAULT_WIDTH, viewportWidth - 2 * VIEWPORT_MARGIN);
      const height = Math.min(DEFAULT_HEIGHT, Math.max(210, Math.round(viewportHeight * 0.5)));
      return {
        width,
        height,
        left: Math.round((viewportWidth - width) / 2),
        top: Math.round(viewportHeight - height - COMPOSER_CLEARANCE),
      };
    }

    /**
     * Place a fresh window just above the composer card that owns the toggle.
     * Falls back to the centered default when the composer cannot be measured.
     * @param node - the toggle button the user clicked.
     * @returns geometry aligned with the composer and clamped to the viewport.
     */
    function anchoredGeometry(node) {
      const base = defaultGeometry();
      if (node === null || node === undefined || typeof node.closest !== 'function') return base;
      const card = node.closest('[data-composer-card]');
      const anchor = card === null ? node : card;
      const rect = anchor.getBoundingClientRect();
      if (!Number.isFinite(rect.top) || !Number.isFinite(rect.left) || rect.width <= 0) return base;
      return clampGeometry({
        width: base.width,
        height: base.height,
        left: rect.left + rect.width / 2 - base.width / 2,
        top: rect.top - base.height - 12,
      });
    }

    /**
     * Keep a window geometry fully inside the current viewport.
     * @param value - candidate geometry; missing fields fall back to the default.
     * @returns clamped integer geometry.
     */
    function clampGeometry(value) {
      const fallback = defaultGeometry();
      const source = value !== null && typeof value === 'object' ? value : {};
      const viewportWidth = Math.max(320, window.innerWidth || 1024);
      const viewportHeight = Math.max(240, window.innerHeight || 768);
      const maxWidth = Math.max(240, viewportWidth - 2 * VIEWPORT_MARGIN);
      const maxHeight = Math.max(160, viewportHeight - 2 * VIEWPORT_MARGIN);
      const width = Math.min(maxWidth, Math.max(Math.min(280, maxWidth), finite(source.width, fallback.width)));
      const height = Math.min(maxHeight, Math.max(Math.min(210, maxHeight), finite(source.height, fallback.height)));
      const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
      const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN);
      const left = Math.min(maxLeft, Math.max(VIEWPORT_MARGIN, finite(source.left, fallback.left)));
      const top = Math.min(maxTop, Math.max(VIEWPORT_MARGIN, finite(source.top, fallback.top)));
      return {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
      };
    }

    /** URLs worth turning into anchors: explicit schemes, www hosts, and loopback ports. */
    const URL_PATTERN = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"'`]+|(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/[^\s<>"'`]*)?/gi;
    /** Ceiling on anchors per output render, so a pathological stream stays responsive. */
    const MAX_LINKS = 500;
    /** Punctuation that ends a sentence rather than a URL. */
    const TRAILING_PUNCTUATION = '.,;:!?\'"`';
    /** Closing brackets whose matching opener may or may not belong to the URL. */
    const CLOSING_BRACKETS = { ')': '(', ']': '[', '}': '{', '>': '<' };
    /** Shared empty segment list for closed or empty output. */
    const EMPTY_SEGMENTS = Object.freeze([]);

    /**
     * Drop sentence punctuation and unbalanced closing brackets from a match.
     * @param url - raw match text.
     * @returns the URL without trailing prose punctuation.
     */
    function trimUrlEnd(url) {
      let end = url.length;
      while (end > 0) {
        const char = url[end - 1];
        if (TRAILING_PUNCTUATION.includes(char)) {
          end -= 1;
          continue;
        }
        const opener = CLOSING_BRACKETS[char];
        if (opener !== undefined) {
          let opens = 0;
          let closes = 0;
          for (let index = 0; index < end; index += 1) {
            if (url[index] === opener) opens += 1;
            else if (url[index] === char) closes += 1;
          }
          if (closes > opens) {
            end -= 1;
            continue;
          }
        }
        break;
      }
      return url.slice(0, end);
    }

    /**
     * Build the href for a matched URL, adding a scheme where the display omits one.
     * @param url - trimmed URL text.
     * @returns an absolute http(s)/ftp URL.
     */
    function hrefFor(url) {
      if (/^www\./i.test(url)) return `https://${url}`;
      if (/^(?:localhost|127\.0\.0\.1|\[::1\]):/i.test(url)) return `http://${url}`;
      return url;
    }

    /**
     * Split command output into text runs and clickable URL runs.
     * Whitespace is preserved verbatim so the output keeps its terminal layout.
     * @param text - one tab's output.
     * @returns strings and `{ href, label }` link descriptors.
     */
    function linkify(text) {
      if (typeof text !== 'string' || text === '') return EMPTY_SEGMENTS;
      const segments = [];
      let last = 0;
      let links = 0;
      URL_PATTERN.lastIndex = 0;
      let match;
      while ((match = URL_PATTERN.exec(text)) !== null) {
        const url = trimUrlEnd(match[0]);
        if (url === '') continue;
        if (links >= MAX_LINKS) break;
        const start = match.index;
        if (start > last) segments.push(text.slice(last, start));
        segments.push({ href: hrefFor(url), label: url });
        last = start + url.length;
        URL_PATTERN.lastIndex = last;
        links += 1;
      }
      if (last < text.length) segments.push(text.slice(last));
      return segments;
    }

    /** Keys that must never scroll the window while a PTY owns the keyboard. */
    const TERMINAL_KEYS = new Set([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Home', 'End', 'PageUp', 'PageDown',
      'Tab', 'Escape', 'Insert', 'Delete',
    ]);

    /**
     * Translate a browser key event into the bytes a terminal expects.
     * @param event - React keyboard event.
     * @returns bytes to write, or undefined for browser-only combinations.
     */
    function keyToBytes(event) {
      if (event.metaKey) return undefined;
      if (event.ctrlKey) {
        if (event.key === ' ') return '\x00';
        if (event.key.length !== 1) return undefined;
        const upper = event.key.toUpperCase();
        if (upper >= 'A' && upper <= 'Z') return String.fromCharCode(upper.charCodeAt(0) - 64);
        switch (event.key) {
          case '@': return '\x00';
          case '[': return '\x1b';
          case '\\': return '\x1c';
          case ']': return '\x1d';
          case '^': return '\x1e';
          case '_': return '\x1f';
          case '?': return '\x7f';
          default: return undefined;
        }
      }
      if (event.altKey && event.key.length === 1) return `\x1b${event.key}`;
      switch (event.key) {
        case 'Enter': return '\r';
        case 'Backspace': return '\x7f';
        case 'Tab': return event.shiftKey ? '\x1b[Z' : '\t';
        case 'Escape': return '\x1b';
        case 'ArrowUp': return '\x1b[A';
        case 'ArrowDown': return '\x1b[B';
        case 'ArrowRight': return '\x1b[C';
        case 'ArrowLeft': return '\x1b[D';
        case 'Home': return '\x1b[H';
        case 'End': return '\x1b[F';
        case 'PageUp': return '\x1b[5~';
        case 'PageDown': return '\x1b[6~';
        case 'Insert': return '\x1b[2~';
        case 'Delete': return '\x1b[3~';
        case 'F1': return '\x1bOP';
        case 'F2': return '\x1bOQ';
        case 'F3': return '\x1bOR';
        case 'F4': return '\x1bOS';
        case 'F5': return '\x1b[15~';
        case 'F6': return '\x1b[17~';
        case 'F7': return '\x1b[18~';
        case 'F8': return '\x1b[19~';
        case 'F9': return '\x1b[20~';
        case 'F10': return '\x1b[21~';
        case 'F11': return '\x1b[23~';
        case 'F12': return '\x1b[24~';
        default:
          return event.key.length === 1 ? event.key : undefined;
      }
    }

    /**
     * Read or create the store for one Workspace (or ungrouped Session).
     * @param storeKey - prefixed Workspace or Session identity.
     * @param scope - where commands run and which Host identity to send.
     * @returns its store.
     */
    function storeFor(storeKey, scope) {
      let store = stores.get(storeKey);
      if (store === undefined) {
        store = createStore(scope);
        stores.set(storeKey, store);
      }
      return store;
    }

    /**
     * Build the observable tabbed window state and its commands.
     * @param scope - Workspace or Session execution scope.
     * @returns the store.
     */
    function createStore(scope) {
      let nextTabId = 0;
      let nextTabNumber = 0;
      const shortcutsKey = scope.kind === 'workspace' ? `path:${scope.cwd}` : `session:${String(scope.sessionId)}`;
      /** Active streaming request per tab. */
      const controllers = new Map();
      /** Input draft saved while recalling history, per tab. */
      const drafts = new Map();

      const makeTab = () => ({
        id: `tab-${++nextTabId}`,
        number: ++nextTabNumber,
        command: '',
        output: '',
        partial: '',
        running: false,
        exit: undefined,
        error: '',
        timedOut: false,
        truncated: false,
        stopped: false,
        history: [],
        historyIndex: -1,
        lastCommand: '',
        interactive: false,
        runId: undefined,
        notice: '',
      });

      const first = makeTab();
      let snapshot = {
        open: false,
        cwd: scope.kind === 'workspace' ? scope.cwd : '',
        tabs: [first],
        activeId: first.id,
        shortcuts: readShortcuts(shortcutsKey),
      };
      const listeners = new Set();

      const publish = (patch) => {
        snapshot = Object.assign({}, snapshot, patch);
        for (const listener of Array.from(listeners)) listener();
      };

      const tabById = (id) => snapshot.tabs.find((tab) => tab.id === id);

      const patchTab = (id, patch) => {
        let changed = false;
        const tabs = snapshot.tabs.map((tab) => {
          if (tab.id !== id) return tab;
          changed = true;
          return Object.assign({}, tab, patch);
        });
        if (changed) publish({ tabs });
      };

      const append = (id, text) => {
        if (text === '') return;
        const tab = tabById(id);
        if (tab === undefined) return;
        const next = tab.output + text;
        patchTab(id, { output: next.length > MAX_OUTPUT_CHARS ? next.slice(0, MAX_OUTPUT_CHARS) : next });
      };

      const handle = (id, event) => {
        if (event === null || typeof event !== 'object') return;
        switch (event.type) {
          case 'start': {
            if (typeof event.cwd === 'string') publish({ cwd: event.cwd });
            const current = tabById(id);
            const runId = typeof event.runId === 'string' ? event.runId : undefined;
            patchTab(id, {
              runId,
              notice: runId === undefined && current !== undefined && current.interactive ? 'hostRestart' : '',
            });
            break;
          }
          case 'stdout':
          case 'stderr':
            if (typeof event.data === 'string') append(id, event.data);
            break;
          case 'partial':
            if (typeof event.data === 'string') patchTab(id, { partial: event.data });
            break;
          case 'screen':
            if (typeof event.data === 'string') {
              patchTab(id, {
                output: event.data.length > MAX_OUTPUT_CHARS ? event.data.slice(0, MAX_OUTPUT_CHARS) : event.data,
                partial: '',
              });
            }
            break;
          case 'truncated':
            patchTab(id, { truncated: true });
            break;
          case 'timeout':
            patchTab(id, { timedOut: true });
            break;
          case 'exit':
            patchTab(id, {
              exit: {
                code: typeof event.code === 'number' ? event.code : null,
                signal: typeof event.signal === 'string' ? event.signal : null,
              },
            });
            break;
          case 'error':
            patchTab(id, { error: typeof event.message === 'string' ? event.message : 'error' });
            break;
          default:
            break;
        }
      };

      const refresh = async () => {
        if (scope.kind === 'workspace') {
          if (typeof scope.cwd === 'string' && scope.cwd !== '') publish({ cwd: scope.cwd });
          return;
        }
        try {
          const response = await fetch(`${WORKSPACE_URL}?sessionId=${encodeURIComponent(scope.sessionId)}`, {
            headers: { accept: 'application/json' },
          });
          if (!response.ok) return;
          const data = await response.json();
          if (data !== null && typeof data === 'object' && typeof data.cwd === 'string') publish({ cwd: data.cwd });
        } catch {}
      };

      const run = async (id, currentSessionId) => {
        const tab = tabById(id);
        if (tab === undefined || tab.running) return;
        const command = tab.command.trim();
        if (command === '') return;
        const history = [command, ...tab.history.filter((item) => item !== command)].slice(0, MAX_HISTORY);
        const abort = new AbortController();
        controllers.get(id)?.abort();
        controllers.set(id, abort);
        drafts.delete(id);
        patchTab(id, {
          running: true,
          output: '',
          partial: '',
          exit: undefined,
          error: '',
          timedOut: false,
          truncated: false,
          stopped: false,
          history,
          historyIndex: -1,
          lastCommand: command,
          command: tab.command,
          runId: undefined,
          notice: '',
        });
        const body = scope.kind === 'workspace' ? { workspaceId: scope.workspaceId, command } : { sessionId: scope.sessionId, command };
        body.interactive = tab.interactive === true;
        // The current Session id rides along so a Host that predates Workspace
        // routing still resolves the same directory through its Session path.
        if (scope.kind === 'workspace' && typeof currentSessionId === 'string' && currentSessionId !== '') body.sessionId = currentSessionId;
        try {
          const response = await fetch(RUN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: abort.signal,
          });
          if (!response.ok) {
            patchTab(id, { error: await failureMessage(response) });
            return;
          }
          if (response.body === null) {
            patchTab(id, { error: 'no response body' });
            return;
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
              const block = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              for (const line of block.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (payload === '') continue;
                try {
                  handle(id, JSON.parse(payload));
                } catch {}
              }
            }
          }
        } catch (error) {
          if (!abort.signal.aborted) patchTab(id, { error: error instanceof Error ? error.message : String(error) });
        } finally {
          if (controllers.get(id) === abort) controllers.delete(id);
          patchTab(id, { running: false, stopped: abort.signal.aborted, runId: undefined });
        }
      };

      const inputChains = new Map();

      const sendBytes = (id, data) => {
        const tab = tabById(id);
        if (tab === undefined || !tab.running || !tab.interactive || tab.runId === undefined || data === '') return;
        const runId = tab.runId;
        const previous = inputChains.get(id) ?? Promise.resolve();
        const next = previous.then(async () => {
          const live = tabById(id);
          if (live === undefined || live.runId !== runId || !live.running) return;
          try {
            const response = await fetch(INPUT_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ runId, data }),
            });
            if (!response.ok) patchTab(id, { notice: 'inputFailed' });
            else if (tabById(id)?.notice !== '') patchTab(id, { notice: '' });
          } catch {
            patchTab(id, { notice: 'inputFailed' });
          }
        });
        inputChains.set(id, next);
        void next.finally(() => {
          if (inputChains.get(id) === next) inputChains.delete(id);
        });
      };

      const addShortcut = (command) => {
        const value = typeof command === 'string' ? command.trim() : '';
        if (value === '' || snapshot.shortcuts.includes(value) || snapshot.shortcuts.length >= MAX_SHORTCUTS) return;
        const shortcuts = [...snapshot.shortcuts, value];
        publish({ shortcuts });
        writeShortcuts(shortcutsKey, shortcuts);
      };

      const removeShortcut = (command) => {
        const value = typeof command === 'string' ? command.trim() : '';
        if (!snapshot.shortcuts.includes(value)) return;
        const shortcuts = snapshot.shortcuts.filter((item) => item !== value);
        publish({ shortcuts });
        writeShortcuts(shortcutsKey, shortcuts);
      };

      const runShortcut = (command, currentSessionId) => {
        const value = typeof command === 'string' ? command.trim() : '';
        if (value === '') return;
        const current = tabById(snapshot.activeId);
        let tab = current;
        let id = snapshot.activeId;
        if (tab === undefined || tab.running) {
          const inheritInteractive = current !== undefined && current.interactive === true;
          tab = makeTab();
          tab.interactive = inheritInteractive;
          id = tab.id;
          publish({ tabs: [...snapshot.tabs, tab], activeId: id });
        }
        patchTab(id, { command: value });
        void run(id, currentSessionId);
      };

      const recall = (id, step) => {
        const tab = tabById(id);
        if (tab === undefined || tab.history.length === 0) return;
        if (tab.historyIndex === -1) {
          if (step < 0) return;
          drafts.set(id, tab.command);
          patchTab(id, { command: tab.history[0], historyIndex: 0 });
          return;
        }
        const next = tab.historyIndex + step;
        if (next < 0) {
          patchTab(id, { command: drafts.get(id) ?? '', historyIndex: -1 });
          return;
        }
        if (next >= tab.history.length) return;
        patchTab(id, { command: tab.history[next], historyIndex: next });
      };

      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot() {
          return snapshot;
        },
        toggle() {
          const open = !snapshot.open;
          publish({ open });
          if (open) void refresh();
        },
        open() {
          if (snapshot.open) return;
          publish({ open: true });
          void refresh();
        },
        close() {
          if (snapshot.open) publish({ open: false });
        },
        addTab() {
          const tab = makeTab();
          publish({ tabs: [...snapshot.tabs, tab], activeId: tab.id });
        },
        selectTab(id) {
          if (id === snapshot.activeId || tabById(id) === undefined) return;
          publish({ activeId: id });
        },
        closeTab(id) {
          const index = snapshot.tabs.findIndex((tab) => tab.id === id);
          if (index === -1) return;
          const abort = controllers.get(id);
          if (abort !== undefined) abort.abort();
          controllers.delete(id);
          drafts.delete(id);
          const remaining = snapshot.tabs.filter((tab) => tab.id !== id);
          if (remaining.length === 0) {
            const tab = makeTab();
            publish({ tabs: [tab], activeId: tab.id });
            return;
          }
          const activeId = snapshot.activeId === id ? remaining[Math.min(index, remaining.length - 1)].id : snapshot.activeId;
          publish({ tabs: remaining, activeId });
        },
        setCommand(id, command) {
          patchTab(id, { command, historyIndex: -1 });
        },
        setInteractive(id, interactive) {
          const tab = tabById(id);
          if (tab === undefined || tab.running) return;
          patchTab(id, { interactive: interactive === true, notice: '' });
        },
        recall,
        run,
        sendBytes,
        addShortcut,
        removeShortcut,
        runShortcut,
        stop(id) {
          controllers.get(id)?.abort();
        },
        clear(id) {
          patchTab(id, { output: '', partial: '', exit: undefined, error: '', timedOut: false, truncated: false, stopped: false });
        },
      };
    }

    /**
     * Read one failed response's human-readable message.
     * @param response - non-2xx host response.
     * @returns the message text.
     */
    async function failureMessage(response) {
      try {
        const data = await response.json();
        if (data !== null && typeof data === 'object') {
          if (typeof data.message === 'string' && data.message !== '') return data.message;
          if (typeof data.code === 'string' && data.code !== '') return data.code;
        }
      } catch {}
      return `HTTP ${response.status}`;
    }

    /**
     * Subscribe one component to its Workspace's store.
     * @param storeKey - prefixed Workspace or Session identity.
     * @param scope - execution scope used only when creating the store.
     * @returns the store and the current snapshot.
     */
    function usePanelStore(storeKey, scope) {
      const store = React.useMemo(() => storeFor(storeKey, scope), [storeKey]);
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      return [store, state];
    }

    /**
     * Composer tool-row control plus the floating tabbed command window it
     * manages. The window portals to the document body: the composer sits in
     * its own compositor layer and clips fixed descendants, which is what hid
     * the previous inline panel.
     * @param props.sessionId - owning Session.
     * @param props.t - namespace translator.
     * @returns the toggle button and, while open, the portal.
     */
    function CommandRunner(props) {
      const { sessionId, t } = props;
      const workspaceSnapshot = React.useSyncExternalStore(subscribeWorkspaces, getWorkspaceSnapshot, getWorkspaceSnapshot);
      const workspace = sessionId === undefined ? undefined : workspaceSnapshot.items.find((item) => item.sessionIds.includes(sessionId));
      const storeKey = workspace === undefined ? `session:${String(sessionId)}` : `workspace:${workspace.workspaceId}`;
      const scope =
        workspace === undefined
          ? { kind: 'session', sessionId }
          : { kind: 'workspace', workspaceId: workspace.workspaceId, cwd: workspace.path };
      const [store, state] = usePanelStore(storeKey, scope);
      const [geometry, setGeometry] = React.useState(() => clampGeometry(savedGeometry ?? lastGeometry));
      const geometryRef = React.useRef(geometry);
      const toggleRef = React.useRef(null);
      const outputRef = React.useRef(null);
      const inputRef = React.useRef(null);
      const tabListRef = React.useRef(null);
      const [interaction, setInteraction] = React.useState(null);

      const active = state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0];
      const anyRunning = state.tabs.some((tab) => tab.running);
      const shortcuts = state.shortcuts;

      const applyGeometry = React.useCallback((next) => {
        const clamped = clampGeometry(next);
        geometryRef.current = clamped;
        lastGeometry = clamped;
        setGeometry(clamped);
      }, []);

      /**
       * Open the window above the composer, or close it when already visible.
       * A user-moved window keeps its remembered geometry.
       * @param event - the toggle button click.
       */
      const toggleWindow = (event) => {
        if (!state.open && savedGeometry === null) applyGeometry(anchoredGeometry(event.currentTarget));
        store.toggle();
      };

      React.useEffect(() => {
        const onViewportResize = () => applyGeometry(geometryRef.current);
        window.addEventListener('resize', onViewportResize);
        return () => window.removeEventListener('resize', onViewportResize);
      }, [applyGeometry]);

      const wasOpen = React.useRef(state.open);
      const previousActive = React.useRef(state.activeId);

      React.useEffect(() => {
        const opened = state.open && !wasOpen.current;
        wasOpen.current = state.open;
        if (!opened) return undefined;
        const frame = requestAnimationFrame(() => {
          if (inputRef.current !== null) inputRef.current.focus();
        });
        return () => cancelAnimationFrame(frame);
      }, [state.open]);

      React.useEffect(() => {
        const switched = state.activeId !== previousActive.current;
        previousActive.current = state.activeId;
        if (!state.open || !switched) return undefined;
        const frame = requestAnimationFrame(() => {
          if (inputRef.current !== null) inputRef.current.focus();
        });
        return () => cancelAnimationFrame(frame);
      }, [state.open, state.activeId]);

      React.useEffect(() => {
        if (!state.open || !active.running || !active.interactive) return undefined;
        const frame = requestAnimationFrame(() => {
          if (inputRef.current !== null) inputRef.current.focus();
        });
        return () => cancelAnimationFrame(frame);
      }, [state.open, active.running, active.interactive]);

      const outputText = active.output + active.partial;

      React.useEffect(() => {
        const element = outputRef.current;
        if (element !== null) element.scrollTop = element.scrollHeight;
      }, [active.id, active.output, active.partial, state.open]);

      const outputSegments = React.useMemo(
        () => (state.open ? linkify(active.output) : EMPTY_SEGMENTS),
        [state.open, active.output],
      );

      React.useEffect(() => {
        if (!state.open) return;
        const list = tabListRef.current;
        if (list === null) return;
        const selected = list.querySelector('[data-active="true"]');
        if (selected !== null) selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }, [state.open, state.activeId, state.tabs.length]);

      if (!state.open) {
        const closedLabel = t('toggle');
        return h(
          'button',
          {
            type: 'button',
            className: 'crk-toggle',
            title: closedLabel,
            'aria-label': closedLabel,
            'aria-pressed': 'false',
            ref: toggleRef,
            onClick: toggleWindow,
          },
          h('span', { 'aria-hidden': 'true' }, '>_'),
        );
      }

      const label = t('toggle');

      /**
       * Drag the window or its bottom edge until the pointer is released.
       * @param mode - move the whole window or resize its height.
       * @param event - the originating pointer event.
       */
      const beginInteraction = (mode, event) => {
        if (event.button !== 0) return;
        if (mode === 'move' && event.target !== null && typeof event.target.closest === 'function' && event.target.closest('button') !== null) return;
        event.preventDefault();
        const node = event.currentTarget;
        const start = geometryRef.current;
        const originX = event.clientX;
        const originY = event.clientY;
        let moved = false;
        setInteraction(mode);
        if (typeof node.setPointerCapture === 'function') node.setPointerCapture(event.pointerId);
        const handleMove = (moveEvent) => {
          const deltaX = moveEvent.clientX - originX;
          const deltaY = moveEvent.clientY - originY;
          if (deltaX !== 0 || deltaY !== 0) moved = true;
          applyGeometry(
            mode === 'move'
              ? { ...start, left: start.left + deltaX, top: start.top + deltaY }
              : { ...start, height: start.height + deltaY },
          );
        };
        const finish = (finishEvent) => {
          node.removeEventListener('pointermove', handleMove);
          node.removeEventListener('pointerup', finish);
          node.removeEventListener('pointercancel', finish);
          if (finishEvent !== undefined && typeof node.hasPointerCapture === 'function' && node.hasPointerCapture(finishEvent.pointerId)) {
            node.releasePointerCapture(finishEvent.pointerId);
          }
          setInteraction(null);
          if (moved) saveGeometry(geometryRef.current);
        };
        node.addEventListener('pointermove', handleMove);
        node.addEventListener('pointerup', finish);
        node.addEventListener('pointercancel', finish);
      };

      /** Restore the default size and re-anchor above the composer. */
      const resetGeometry = () => {
        savedGeometry = null;
        try {
          localStorage.removeItem(GEOMETRY_KEY);
        } catch {}
        applyGeometry(anchoredGeometry(toggleRef.current));
      };

      const resizeByKeyboard = (event) => {
        if (rawInput) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const delta = event.key === 'ArrowUp' ? -24 : 24;
        applyGeometry({ ...geometryRef.current, height: geometryRef.current.height + delta });
        saveGeometry(geometryRef.current);
      };

      const tabStatus = (tab) => {
        if (tab.running) return 'running';
        if (tab.error !== '' || tab.timedOut || (tab.exit !== undefined && (tab.exit.signal !== null || tab.exit.code !== 0))) return 'error';
        if (tab.stopped) return 'stopped';
        if (tab.exit !== undefined) return 'done';
        return 'idle';
      };

      const tabTitle = (tab) => {
        const draft = tab.command.trim();
        if (draft !== '') return draft;
        if (typeof tab.lastCommand === 'string' && tab.lastCommand !== '') return tab.lastCommand;
        return t('tab', { number: tab.number });
      };

      const running = active.running;
      const notes = [];
      if (active.error !== '') notes.push(h('span', { key: 'error', className: 'crk-foot-note crk-bad' }, active.error));
      if (active.notice !== '') notes.push(h('span', { key: 'notice', className: 'crk-foot-note crk-bad' }, t(active.notice)));
      if (active.timedOut) notes.push(h('span', { key: 'timeout', className: 'crk-foot-note crk-bad' }, t('timeout')));
      if (active.stopped) notes.push(h('span', { key: 'stopped', className: 'crk-foot-note' }, t('stopped')));
      if (active.truncated) notes.push(h('span', { key: 'truncated', className: 'crk-foot-note' }, t('truncated')));
      if (running) notes.push(h('span', { key: 'running', className: 'crk-foot-note' }, '…'));
      if (active.exit !== undefined) {
        const failed = active.exit.signal !== null || (active.exit.code !== null && active.exit.code !== 0);
        notes.push(
          h(
            'span',
            { key: 'exit', className: `crk-foot-note ${failed ? 'crk-bad' : 'crk-good'}` },
            active.exit.signal !== null
              ? t('exitSignal', { signal: active.exit.signal })
              : t('exitCode', { code: String(active.exit.code) }),
          ),
        );
      }

      const rawInput = running && active.interactive;
      const placeholder = outputText === '' && !running && active.exit === undefined && active.error === '';
      const inputPlaceholder = rawInput ? t('rawPlaceholder') : t('placeholder');

      const tabs = state.tabs.map((tab) => {
        const selected = tab.id === active.id;
        const title = tabTitle(tab);
        return h('div', { key: tab.id, className: 'crk-tab', 'data-active': selected ? 'true' : 'false' }, [
          h(
            'button',
            {
              key: 'label',
              type: 'button',
              role: 'tab',
              className: 'crk-tab-label',
              'aria-selected': selected ? 'true' : 'false',
              title,
              onClick: () => store.selectTab(tab.id),
            },
            [
              h('span', { key: 'dot', className: 'crk-tab-dot', 'data-state': tabStatus(tab), 'aria-hidden': 'true' }),
              h('span', { key: 'text', className: 'crk-tab-text' }, title),
            ],
          ),
          h(
            'button',
            {
              key: 'close',
              type: 'button',
              className: 'crk-tab-close',
              title: t('closeTab'),
              'aria-label': t('closeTab'),
              onClick: () => store.closeTab(tab.id),
            },
            '×',
          ),
        ]);
      });

      const windowNode = ReactDOM.createPortal(
        h(
          'section',
          {
            className: 'crk-window',
            role: 'dialog',
            'aria-label': label,
            'aria-modal': 'false',
            'data-command-runner': 'window',
            'data-dragging': interaction === 'move' ? 'true' : 'false',
            'data-resizing': interaction === 'resize' ? 'true' : 'false',
            style: {
              left: `${geometry.left}px`,
              top: `${geometry.top}px`,
              width: `${geometry.width}px`,
              height: `${geometry.height}px`,
            },
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                if (rawInput) {
                  event.preventDefault();
                  store.sendBytes(active.id, '\x1b');
                  return;
                }
                store.close();
                return;
              }
              if (rawInput && event.target !== inputRef.current && TERMINAL_KEYS.has(event.key)) {
                const bytes = keyToBytes(event);
                if (bytes !== undefined) {
                  event.preventDefault();
                  event.stopPropagation();
                  store.sendBytes(active.id, bytes);
                }
              }
            },
          },
          [
            h(
              'div',
              {
                key: 'head',
                className: 'crk-head',
                title: t('move'),
                onPointerDown: (event) => beginInteraction('move', event),
                onDoubleClick: (event) => {
                  if (event.target !== null && typeof event.target.closest === 'function' && event.target.closest('button') !== null) return;
                  resetGeometry();
                },
              },
              [
                h('span', { key: 'grip', className: 'crk-grip', 'aria-hidden': 'true' }),
                h('span', { key: 'dot', className: 'crk-dot', 'data-running': anyRunning ? 'true' : 'false', 'aria-hidden': 'true' }),
                h('span', { key: 'cwd', className: 'crk-cwd', title: state.cwd }, state.cwd === '' ? t('cwdPending') : state.cwd),
                h(
                  'button',
                  {
                    key: 'clear',
                    type: 'button',
                    className: 'crk-ghost',
                    onClick: () => store.clear(active.id),
                    disabled:
                      running ||
                      (outputText === '' &&
                        active.exit === undefined &&
                        active.error === '' &&
                        !active.timedOut &&
                        !active.truncated &&
                        !active.stopped),
                  },
                  t('clear'),
                ),
                h(
                  'button',
                  {
                    key: 'close',
                    type: 'button',
                    className: 'crk-ghost',
                    title: t('close'),
                    'aria-label': t('close'),
                    onClick: () => store.close(),
                  },
                  '✕',
                ),
              ],
            ),
            h('div', { key: 'tabbar', className: 'crk-tabbar' }, [
              h(
                'div',
                { key: 'list', className: 'crk-tablist', role: 'tablist', ref: tabListRef, 'aria-label': label },
                tabs,
              ),
              h(
                'button',
                {
                  key: 'add',
                  type: 'button',
                  className: 'crk-newtab',
                  title: t('newTab'),
                  'aria-label': t('newTab'),
                  onClick: () => store.addTab(),
                },
                '+',
              ),
            ]),
            shortcuts.length === 0
              ? null
              : h('div', { key: 'shortcuts', className: 'crk-shortcuts' }, [
                  h('span', { key: 'label', className: 'crk-short-label' }, t('shortcuts')),
                  h(
                    'div',
                    { key: 'chips', className: 'crk-chips' },
                    shortcuts.map((command) =>
                      h('span', { key: command, className: 'crk-chip' }, [
                        h(
                          'button',
                          {
                            key: 'run',
                            type: 'button',
                            className: 'crk-chip-run',
                            title: command,
                            onClick: () => store.runShortcut(command, sessionId),
                          },
                          command,
                        ),
                        h(
                          'button',
                          {
                            key: 'remove',
                            type: 'button',
                            className: 'crk-chip-close',
                            title: t('removeShortcut'),
                            'aria-label': t('removeShortcut'),
                            onClick: () => store.removeShortcut(command),
                          },
                          '×',
                        ),
                      ]),
                    ),
                  ),
                ]),
            h('div', { key: 'form', className: 'crk-form' }, [
              h('span', { key: 'prompt', className: 'crk-prompt', 'aria-hidden': 'true' }, '$'),
              h('input', {
                key: 'input',
                ref: inputRef,
                className: 'crk-input',
                type: 'text',
                spellCheck: false,
                autoComplete: 'off',
                value: rawInput ? '' : active.command,
                placeholder: inputPlaceholder,
                'aria-label': inputPlaceholder,
                onChange: (event) => {
                  if (!rawInput) store.setCommand(active.id, event.target.value);
                },
                onPaste: (event) => {
                  if (!rawInput) return;
                  event.preventDefault();
                  const clipboard = event.clipboardData;
                  const text = clipboard === undefined || clipboard === null ? '' : clipboard.getData('text');
                  if (text !== '') store.sendBytes(active.id, text.replace(/\r?\n/g, '\r'));
                },
                onCompositionEnd: (event) => {
                  if (rawInput && typeof event.data === 'string' && event.data !== '') store.sendBytes(active.id, event.data);
                },
                onKeyDown: (event) => {
                  if (rawInput) {
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
                    if (event.nativeEvent !== undefined && event.nativeEvent !== null && event.nativeEvent.isComposing) return;
                    const bytes = keyToBytes(event);
                    if (bytes === undefined) return;
                    event.preventDefault();
                    event.stopPropagation();
                    store.sendBytes(active.id, bytes);
                    return;
                  }
                  if (event.key === 'Enter' && !event.shiftKey && !(event.nativeEvent && event.nativeEvent.isComposing)) {
                    event.preventDefault();
                    void store.run(active.id, sessionId);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    store.recall(active.id, 1);
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    store.recall(active.id, -1);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    store.close();
                  }
                },
              }),
              h(
                'button',
                {
                  key: 'star',
                  type: 'button',
                  className: 'crk-star',
                  title: running
                    ? t('saveShortcut')
                    : active.command.trim() !== '' && shortcuts.includes(active.command.trim())
                      ? t('savedShortcut')
                      : shortcuts.length >= MAX_SHORTCUTS
                        ? t('shortcutLimit')
                        : t('saveShortcut'),
                  'aria-label': t('saveShortcut'),
                  'data-saved': active.command.trim() !== '' && shortcuts.includes(active.command.trim()) ? 'true' : 'false',
                  disabled:
                    running ||
                    active.command.trim() === '' ||
                    shortcuts.includes(active.command.trim()) ||
                    shortcuts.length >= MAX_SHORTCUTS,
                  onClick: () => store.addShortcut(active.command),
                },
                active.command.trim() !== '' && shortcuts.includes(active.command.trim()) ? '★' : '☆',
              ),
              h(
                'button',
                {
                  key: 'mode',
                  type: 'button',
                  className: 'crk-mode',
                  title: t('interactiveHint'),
                  'aria-label': t('interactiveHint'),
                  'aria-pressed': active.interactive ? 'true' : 'false',
                  disabled: running,
                  onClick: () => store.setInteractive(active.id, !active.interactive),
                },
                t('interactive'),
              ),
              running
                ? h('button', { key: 'stop', type: 'button', className: 'crk-btn', 'data-kind': 'stop', onClick: () => store.stop(active.id) }, t('stop'))
                : h(
                    'button',
                    {
                      key: 'run',
                      type: 'button',
                      className: 'crk-btn',
                      onClick: () => void store.run(active.id, sessionId),
                      disabled: active.command.trim() === '',
                    },
                    t('run'),
                  ),
            ]),
            h(
              'pre',
              {
                key: 'output',
                ref: outputRef,
                className: 'crk-output',
                'aria-live': rawInput ? 'off' : 'polite',
                style: placeholder ? { color: 'var(--dsw-alias-label-tertiary)' } : undefined,
                onMouseUp: () => {
                  if (!rawInput) return;
                  const selection = window.getSelection();
                  if (selection === null || selection.isCollapsed) {
                    if (inputRef.current !== null) inputRef.current.focus();
                  }
                },
              },
              placeholder
                ? t('empty')
                : [
                    outputSegments.map((segment, index) =>
                      typeof segment === 'string'
                        ? segment
                        : h(
                            'a',
                            {
                              key: `link-${index}`,
                              className: 'crk-link',
                              href: segment.href,
                              target: '_blank',
                              rel: 'noopener noreferrer',
                              title: segment.href,
                            },
                            segment.label,
                          ),
                    ),
                    active.partial,
                  ],
            ),
            h('div', { key: 'foot', className: 'crk-foot' }, notes.length === 0 ? h('span', { className: 'crk-foot-note' }, '') : notes),
            h('div', {
              key: 'resize',
              className: 'crk-resize',
              role: 'separator',
              'aria-orientation': 'horizontal',
              'aria-label': t('resize'),
              title: t('resize'),
              tabIndex: 0,
              onPointerDown: (event) => beginInteraction('resize', event),
              onKeyDown: resizeByKeyboard,
            }),
          ],
        ),
        document.body,
      );

      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            type: 'button',
            className: 'crk-toggle',
            title: label,
            'aria-label': label,
            'aria-pressed': 'true',
            ref: toggleRef,
            onClick: toggleWindow,
          },
          h('span', { 'aria-hidden': 'true' }, '>_'),
        ),
        windowNode,
      );
    }

    return {
      inject: ['slots', 'locale', 'workspaces'],

      /**
       * Register dictionaries, styles, and the composer tool-row entry.
       * @param ctx - Client root Context.
       */
      apply(ctx) {
        workspaceList = ctx.workspaces?.list ?? null;
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'command-runner: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/command-runner/panel.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/command-runner';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'command-runner: styles');

        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'command-runner-toggle',
              order: 40,
              locale: NS,
            },
            CommandRunner,
          ),
        );
      },
    };
  },
});