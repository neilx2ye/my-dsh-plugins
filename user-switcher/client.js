/**
 * Browser half of the system-user switcher bundle.
 *
 * One sidebar-foot row. Clicking it opens a small popover directly above the
 * row: one account per line, no headers, no second page. Clicking a line
 * switches to that account's Harness: it reuses the instance already running
 * there and navigates to it, or starts one when this process has the privilege
 * to change uid. Anything else is reported as one short line inside the same
 * popover.
 *
 * Routes are document-relative so a prefix-mounted UI keeps working.
 */

window.__ModuleLoader__.load({
  id: '@local/user-switcher',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'userSwitcher';
    /** Host route returning identity, accounts, and live instances. */
    const STATE_URL = 'api/user-switcher/state';
    /** Host route selecting the account shown in this switcher. */
    const SELECT_URL = 'api/user-switcher/select';
    /** Host route starting or reusing the account's own Harness instance. */
    const INSTANCE_URL = 'api/user-switcher/instance';
    /** Host route hiding or showing one account in the list. */
    const VISIBILITY_URL = 'api/user-switcher/visibility';
    /** Popover width in pixels; also used to clamp its left edge. */
    const WIDTH = 248;

    /** English dictionary; also the fallback for unknown locales. */
    const EN = {
      'footer.title': 'System users',
      'state.running': 'running',
      'state.ready': 'ready',
      'state.absent': 'not set up',
      'state.denied': 'no access',
      'row.self': 'process',
      'row.switching': 'switching…',
      'row.active': 'in use',
      'row.switch': 'switch',
      'row.admin': 'admin',
      'loading': 'Reading accounts…',
      'error.load': 'Could not read accounts: {message}',
      'accounts.empty': 'No switchable account.',
      'settings.open': 'Manage accounts',
      'settings.title': 'Show in this list',
      'settings.shown': 'shown',
      'settings.hidden': 'hidden',
    };

    /** Simplified Chinese dictionary. */
    const ZH = {
      'footer.title': '系统用户',
      'state.running': '运行中',
      'state.ready': '已就绪',
      'state.absent': '未初始化',
      'state.denied': '无权查看',
      'row.self': '进程用户',
      'row.switching': '切换中…',
      'row.active': '使用中',
      'row.switch': '切换',
      'row.admin': '管理员',
      'loading': '正在读取账户…',
      'error.load': '读取账户失败：{message}',
      'accounts.empty': '没有可切换的账户。',
      'settings.open': '管理账户',
      'settings.title': '显示在列表中',
      'settings.shown': '显示',
      'settings.hidden': '隐藏',
    };

    /** Popover chrome. Only theme tokens are used, so light and dark both work. */
    const STYLE = `
.usw-trigger{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-width:0;height:32px;
  padding:0 8px;margin:0;border:0;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary,#9aa0a8);
  font:inherit;font-size:13px;line-height:1;text-align:left;cursor:pointer}
.usw-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#e7e8ea)}
.usw-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:-2px}
.usw-trigger svg{flex:none}
.usw-trigger .lbl{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.usw-pop{position:fixed;z-index:9500;box-sizing:border-box;width:248px;max-height:calc(100vh - 90px);
  display:flex;flex-direction:column;padding:4px;overflow:auto;overscroll-behavior:contain;
  background:var(--dsw-alias-bg-overlay,#1c1e22);color:var(--dsw-alias-label-primary,#e7e8ea);
  border:1px solid var(--dsw-alias-border-l2,#3a3d44);border-radius:10px;
  box-shadow:0 14px 36px rgba(0,0,0,.42);font-size:13px}

.usw-head{display:flex;align-items:center;justify-content:space-between;gap:6px;height:24px;padding:0 2px 2px 8px;flex:none}
.usw-head-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;
  color:var(--dsw-alias-label-secondary,#9aa0a8)}
.usw-gear{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;
  border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary,#9aa0a8);cursor:pointer}
.usw-gear:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#e7e8ea)}
.usw-gear.on{background:var(--dsw-alias-bg-layer-2,#2a2d33);color:var(--dsw-alias-label-primary,#e7e8ea)}
.usw-gear:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:-2px}
.usw-box{display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px;height:14px;
  border-radius:4px;border:1px solid var(--dsw-alias-border-l2,#3a3d44);background:none;
  font-size:9px;line-height:1;color:#fff}
.usw-box.on{background:var(--dsw-alias-brand-primary,#2f6fed);border-color:transparent}
.usw-row{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;height:30px;padding:0 7px;margin:0;
  border:0;border-radius:7px;background:none;color:inherit;font:inherit;font-size:13px;line-height:1;
  text-align:left;cursor:pointer;flex:none}
.usw-row:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.usw-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:-2px}
.usw-row:disabled{cursor:default;color:var(--dsw-alias-label-secondary,#9aa0a8)}
.usw-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.usw-right{display:inline-flex;align-items:center;gap:6px;flex:none}
.usw-row .st{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa0a8)}

.usw-av{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:50%;
  background:var(--dsw-alias-bg-layer-2,#2a2d33);border:1px solid var(--dsw-alias-border-l2,#3a3d44);
  font-size:10px;font-weight:600;text-transform:uppercase}

.usw-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary,#6b7280)}
.usw-dot.on{background:var(--dsw-alias-state-success-primary,#3fb950)}
.usw-dot.off{background:var(--dsw-alias-state-warn-primary,#d29922)}
.usw-dot.no{background:var(--dsw-alias-state-error-primary,#f85149)}

.usw-note{padding:5px 7px 3px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#9aa0a8)}
.usw-note.err{color:var(--dsw-alias-state-error-primary,#f85149)}
.usw-sep{height:1px;margin:4px 3px;background:var(--dsw-alias-border-l1,#2c2f35);flex:none}
`;

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
     * Fetch JSON without throwing on a non-2xx status.
     * @param url - document-relative route.
     * @param init - fetch options.
     * @returns status plus parsed body.
     */
    async function requestJson(url, init) {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, data };
    }

    /**
     * Render the gear glyph that opens the visibility settings.
     * @param props.size - pixel size.
     */
    function GearIcon(props) {
      const size = props.size ?? 14;
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('circle', { cx: 12, cy: 12, r: 3 }),
        h('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5.9z' }),
      );
    }

    /**
     * Render the users glyph used by the trigger.
     * @param props.size - pixel size.
     */
    function UsersIcon(props) {
      const size = props.size ?? 16;
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('circle', { cx: 9, cy: 8, r: 3.1 }),
        h('path', { d: 'M3.6 19c0-3 2.4-5 5.4-5s5.4 2 5.4 5' }),
        h('path', { d: 'M16.2 5.6a3.1 3.1 0 0 1 0 5.9' }),
        h('path', { d: 'M17.4 14.2c2 .6 3.4 2.3 3.4 4.8' }),
      );
    }

    /**
     * Open the personal-agent identity bound to the account, so the workspace,
     * the persona and the memory all follow the switched user. Falls back to
     * the account's plain home workspace when no identity answers.
     * @param ctx - client context carrying the Workspace services.
     * @param name - selected account name.
     * @param home - selected account home directory.
     */
    async function openIdentityFor(ctx, name, home) {
      const ui = ctx.get('uiWorkspace');
      if (ui !== undefined) {
        try {
          const response = await fetch('api/personal-agent/open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identityId: name.toLowerCase() }),
          });
          if (response.ok) {
            const data = await response.json();
            if (typeof data.sessionId === 'string' && data.sessionId !== '') {
              ui.openSession(data.sessionId);
              return;
            }
            if (typeof data.workspaceId === 'string' && data.workspaceId !== '') {
              ui.startSession(data.workspaceId);
              return;
            }
          }
        } catch {
          // Fall through to the workspace path.
        }
      }
      await openWorkspaceFor(ctx, home);
    }

    /**
     * Open a session inside the account's home workspace, creating the
     * workspace and a blank session when they do not exist yet, so the visible
     * project follows the switched identity.
     * @param ctx - client context carrying the Workspace services.
     * @param home - target account's home directory.
     */
    async function openWorkspaceFor(ctx, home) {
      const workspaces = ctx.get('workspaces');
      const ui = ctx.get('uiWorkspace');
      if (workspaces === undefined || ui === undefined) return;
      const snapshot = workspaces.list.getSnapshot();
      let view = (snapshot.items ?? []).find((item) => item.path === home);
      if (view === undefined) view = await workspaces.create({ path: home });
      if (view === undefined) return;
      const archived = workspaces.list.getSnapshot().archivedSessionIds ?? [];
      const sessionId = (view.sessionIds ?? []).find((id) => !archived.includes(id));
      if (sessionId === undefined) ui.startSession(view.workspaceId);
      else ui.openSession(sessionId);
    }

    /**
     * Build the popover, closing over the namespace translator.
     * @param tr - translate function bound to this namespace.
     * @param ctx - client context carrying the Workspace services.
     */
    function makePopover(tr, ctx) {
      return function UserSwitcherPopover(props) {
        const { anchor, onClose } = props;
        const [state, setState] = React.useState(null);
        const [error, setError] = React.useState(null);
        const [pending, setPending] = React.useState(null);
        const [mode, setMode] = React.useState('list');
        const rootRef = React.useRef(null);

        React.useEffect(() => {
          let alive = true;
          (async () => {
            try {
              const result = await requestJson(STATE_URL);
              if (!result.ok || result.data === null) throw new Error(`HTTP ${result.status}`);
              if (alive) setState(result.data);
            } catch (failure) {
              if (alive) setError(failure instanceof Error ? failure.message : String(failure));
            }
          })();
          return () => {
            alive = false;
          };
        }, []);

        React.useEffect(() => {
          const onPointerDown = (event) => {
            const node = rootRef.current;
            if (node !== null && node.contains(event.target)) return;
            if (anchor !== null && anchor.contains(event.target)) return;
            onClose();
          };
          const onKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
          };
          const onScrollOrResize = () => onClose();
          document.addEventListener('mousedown', onPointerDown, true);
          window.addEventListener('keydown', onKeyDown);
          window.addEventListener('resize', onScrollOrResize);
          window.addEventListener('scroll', onScrollOrResize, true);
          return () => {
            document.removeEventListener('mousedown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', onScrollOrResize);
            window.removeEventListener('scroll', onScrollOrResize, true);
          };
        }, [anchor, onClose]);

        const geometry = React.useMemo(() => {
          if (anchor === null) return { left: 8, bottom: 8, maxHeight: 240 };
          const rect = anchor.getBoundingClientRect();
          const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
          const maxHeight = Math.max(120, Math.min(rect.top - 14, window.innerHeight - 90));
          return { left, bottom: window.innerHeight - rect.top + 6, maxHeight };
        }, [anchor]);

        const pick = React.useCallback(async (user, home) => {
          setPending(user);
          setError(null);
          try {
            const result = await requestJson(SELECT_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ user }),
            });
            if (!result.ok || result.data?.ok !== true) throw new Error(result.data?.message ?? `HTTP ${result.status}`);
            // Keep the row pending through the instance request: starting an
            // account's Harness can take seconds, and until the browser lands
            // on that instance this account is not in use yet.
            const instance = await requestJson(INSTANCE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ user }),
            });
            const target = instance.data?.url;
            if (instance.ok && typeof target === 'string' && target !== '') {
              window.location.assign(target);
              return;
            }
            setPending(null);
            if (!instance.ok) setError(instance.data?.message ?? `HTTP ${instance.status}`);
          } catch (failure) {
            setPending(null);
            setError(failure instanceof Error ? failure.message : String(failure));
          }
        }, [ctx]);

        // The account "in use" is the one this instance actually runs as.
        // Selecting another account opens that account's own instance, so the
        // persisted selection only records the last click and must not be
        // reported as the live identity here.
        const isActive = (user) => user.name === state.self?.user;

        const toggleVisible = React.useCallback(async (user) => {
          const nextVisible = user.visible === false;
          const apply = (value) =>
            setState((current) =>
              current === null
                ? current
                : { ...current, users: current.users.map((entry) => (entry.name === user.name ? { ...entry, visible: value } : entry)) },
            );
          apply(nextVisible);
          setError(null);
          try {
            const result = await requestJson(VISIBILITY_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ user: user.name, visible: nextVisible }),
            });
            if (!result.ok || result.data?.ok !== true) throw new Error(result.data?.message ?? `HTTP ${result.status}`);
          } catch (failure) {
            apply(!nextVisible);
            setError(failure instanceof Error ? failure.message : String(failure));
          }
        }, []);

        const switchRow = (user, self) => {
          const isSelf = user.name === self;
          const active = isActive(user);
          const switching = pending === user.name;
          const label = switching
            ? tr('row.switching')
            : active
              ? tr('row.active')
              : user.admin
                ? tr('row.admin')
                : tr('row.switch');
          return h(
            'button',
            {
              type: 'button',
              key: user.name,
              className: 'usw-row',
              disabled: active || pending !== null,
              title: isSelf ? tr('row.self') : user.name,
              onClick: () => void pick(user.name, user.home),
            },
            h('span', { className: 'usw-av', 'aria-hidden': true }, user.name.slice(0, 1)),
            h('span', { className: 'nm' }, user.name),
            h(
              'span',
              { className: 'usw-right' },
              switching ? null : h('span', { className: `usw-dot ${active ? 'on' : ''}` }),
              h('span', { className: 'st' }, label),
            ),
          );
        };

        const settingRow = (user) => {
          const shown = user.visible !== false;
          return h(
            'button',
            {
              type: 'button',
              key: `set-${user.name}`,
              className: 'usw-row',
              role: 'menuitemcheckbox',
              'aria-checked': shown,
              onClick: () => void toggleVisible(user),
            },
            h('span', { className: `usw-box${shown ? ' on' : ''}`, 'aria-hidden': true }, shown ? '\u2713' : null),
            h('span', { className: 'usw-av', 'aria-hidden': true }, user.name.slice(0, 1)),
            h('span', { className: 'nm' }, user.name),
            h('span', { className: 'st' }, shown ? tr('settings.shown') : tr('settings.hidden')),
          );
        };

        const content = () => {
          if (error !== null && state === null) return h('div', { className: 'usw-note err' }, tr('error.load', { message: error }));
          if (state === null) return h('div', { className: 'usw-note' }, tr('loading'));
          const users = state.users ?? [];
          if (mode === 'settings') {
            if (users.length === 0) return h('div', { className: 'usw-note' }, tr('accounts.empty'));
            return users.map((user) => settingRow(user));
          }
          const self = state.self?.user;
          const shown = users.filter((user) => user.visible !== false);
          if (shown.length === 0) return h('div', { className: 'usw-note' }, tr('accounts.empty'));
          return shown.map((user) => switchRow(user, self));
        };

        return h(
          'div',
          {
            ref: rootRef,
            className: 'usw-pop',
            role: 'menu',
            style: { left: `${geometry.left}px`, bottom: `${geometry.bottom}px`, maxHeight: `${geometry.maxHeight}px` },
          },
          h(
            'div',
            { className: 'usw-head' },
            h('span', { className: 'usw-head-title' }, mode === 'settings' ? tr('settings.title') : ''),
            h(
              'button',
              {
                type: 'button',
                className: `usw-gear${mode === 'settings' ? ' on' : ''}`,
                title: tr('settings.open'),
                'aria-label': tr('settings.open'),
                'aria-pressed': mode === 'settings',
                onClick: () => {
                  setMode((current) => (current === 'settings' ? 'list' : 'settings'));
                  setError(null);
                },
              },
              h(GearIcon),
            ),
          ),
          content(),
          error !== null && state !== null ? h('div', { className: 'usw-sep' }, null) : null,
          error !== null && state !== null ? h('div', { className: 'usw-note err' }, error) : null,
        );
      };
    }

    /**
     * Build the sidebar-foot trigger, closing over the namespace translator.
     * @param tr - translate function bound to this namespace.
     */
    function makeTrigger(tr, ctx) {
      const Popover = makePopover(tr, ctx);
      return function UserSwitcherTrigger(props) {
        const [open, setOpen] = React.useState(false);
        const buttonRef = React.useRef(null);
        const [anchor, setAnchor] = React.useState(null);
        const close = React.useCallback(() => {
          setOpen(false);
          setAnchor(null);
        }, []);
        const toggle = React.useCallback(() => {
          setOpen((value) => {
            if (value) {
              setAnchor(null);
              return false;
            }
            setAnchor(buttonRef.current);
            return true;
          });
        }, []);
        return h(
          React.Fragment,
          null,
          h(
            'button',
            {
              ref: buttonRef,
              type: 'button',
              className: 'usw-trigger',
              onClick: toggle,
              title: tr('footer.title'),
              'aria-label': tr('footer.title'),
              'aria-haspopup': 'menu',
              'aria-expanded': open,
            },
            h(UsersIcon),
            props.wide === false ? null : h('span', { className: 'lbl' }, tr('footer.title')),
          ),
          open && anchor !== null ? ReactDOM.createPortal(h(Popover, { anchor, onClose: close }), document.body) : null,
        );
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'user-switcher: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/user-switcher/popover.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/user-switcher';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'user-switcher: styles');

        const translate = ctx.locale.bind(NS);
        const tr = (key, vars) => interpolate(translate(key), vars);
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'user-switcher',
              order: 20,
              locale: NS,
              label: () => tr('footer.title'),
            },
            makeTrigger(tr, ctx),
          ),
        );
      },
    };
  },
});