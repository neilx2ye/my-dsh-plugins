window.__ModuleLoader__.load({
  id: '@local/codex-fast-mode',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'codex-fast-mode';
    const SEAT = 'conversation.input.model.options';
    const saves = new Map();
    const en = {
      label: 'Codex fast mode',
      quota: 'Only for this session. May use quota faster.',
      loading: 'Loading…', saving: 'Saving…', retry: 'Retry',
      loadFailed: 'Could not read Codex fast mode. Reopen the menu to retry.',
      saveFailed: 'Could not change Codex fast mode. Reopen the menu to check the current state.',
      requested: 'Fast tier requested; not yet confirmed.',
      confirmed: 'The server confirmed the fast tier on the latest eligible request.',
      unconfirmed: 'The server did not confirm the fast tier on the latest eligible request.',
    };
    const zh = {
      label: 'Codex 快速模式',
      quota: '仅当前会话生效，可能更快消耗额度。',
      loading: '读取中…', saving: '保存中…', retry: '重试',
      loadFailed: '无法读取 Codex 快速模式。重新打开菜单可重试。',
      saveFailed: '无法更改 Codex 快速模式。请重新打开菜单确认当前状态。',
      requested: '已申请快速档，尚未确认。',
      confirmed: '最近一次符合条件的请求，服务端已确认快速档。',
      unconfirmed: '最近一次符合条件的请求，服务端未确认快速档。',
    };
    const css = `
      .dsh-cfm-row { position:relative; box-sizing:border-box; display:flex; align-items:center; justify-content:space-between;
        width:100%; min-height:34px; padding:0 8px; gap:16px; border:0; border-radius:var(--dsw-radius-md);
        background:none; color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; line-height:20px;
        text-align:start; cursor:pointer; }
      .dsh-cfm-row[aria-disabled=true] { cursor:default; opacity:.64; }
      .dsh-cfm-row:focus-visible { outline:2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color); outline-offset:-2px;
        background:var(--dsw-alias-interactive-bg-hover); }
      @media (hover:hover) { .dsh-cfm-row[aria-disabled=false]:hover { background:var(--dsw-alias-interactive-bg-hover); } }
      .dsh-cfm-track { display:flex; align-items:center; flex:none; box-sizing:border-box; inline-size:36px; block-size:20px;
        padding:2px; border-radius:12px; background:color-mix(in srgb,var(--dsw-alias-label-caption) 50%,transparent); }
      .dsh-cfm-row[aria-checked=true] .dsh-cfm-track { justify-content:flex-end; background:var(--dsw-alias-brand-primary-new-colorprimary-new-color); }
      .dsh-cfm-thumb { inline-size:16px; block-size:16px; border-radius:50%; background:var(--dsw-alias-switch-thumb); }
      .dsh-cfm-note { flex:none; color:var(--dsw-alias-label-caption); font-size:12px; }
      @media (forced-colors: active) {
        .dsh-cfm-track { outline:1px solid ButtonText; }
        .dsh-cfm-thumb { forced-color-adjust:none; background:ButtonText; }
        .dsh-cfm-row[aria-checked=true] .dsh-cfm-thumb { background:Highlight; }
      }
      .dsh-cfm-sr { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
    `;

    async function load(sessionId, enabled, signal) {
      const path = `/api/codex-fast-mode?${new URLSearchParams({ sessionId })}`;
      const response = await fetch(path, {
        credentials: 'same-origin', signal, cache: 'no-store',
        ...(enabled === undefined ? {} : {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }),
        }),
      });
      if (!response.ok) throw new Error(`Fast mode: HTTP ${response.status}`);
      const result = await response.json();
      if (typeof result?.enabled !== 'boolean') throw new Error('Invalid fast mode status');
      return result;
    }

    function FastModeSwitch({ sessionId, locked, reportFailure, t }) {
      const id = React.useId();
      const [state, setState] = React.useState(null);
      const [pending, setPending] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [revision, retry] = React.useReducer((value) => value + 1, 0);
      const mounted = React.useRef(false);
      React.useEffect(() => {
        mounted.current = true;
        const abort = new AbortController();
        const previousSave = saves.get(sessionId);
        let timeout;
        setPending(previousSave !== undefined);
        setState(null);
        setError(null);
        void (async () => {
          await previousSave?.catch(() => {});
          if (abort.signal.aborted) return;
          setPending(false);
          timeout = setTimeout(() => { abort.abort(); setError('loadFailed'); }, 10000);
          try {
            const value = await load(sessionId, undefined, abort.signal);
            if (!abort.signal.aborted) setState(value);
          } catch {
            if (!abort.signal.aborted) setError('loadFailed');
          } finally {
            clearTimeout(timeout);
          }
        })();
        return () => { mounted.current = false; clearTimeout(timeout); abort.abort(); };
      }, [sessionId, revision]);
      const enabled = state?.enabled === true;
      const blocked = locked || state === null || pending || error !== null;
      const last = state?.last;
      const description = [t('quota'), error ? t(error) : state === null ? t('loading')
        : last?.phase === 'ended' && ['fast', 'priority'].includes(last.reported) ? t('confirmed')
        : last?.phase === 'sent' ? t('requested') : last ? t('unconfirmed') : null].filter(Boolean).join(' ');
      const toggle = async () => {
        if (blocked || saves.has(sessionId)) return;
        const save = load(sessionId, !enabled, AbortSignal.timeout(10000));
        saves.set(sessionId, save);
        setPending(true);
        try {
          const next = await save;
          if (mounted.current) setState(next);
        } catch {
          if (mounted.current) {
            setError('saveFailed');
            reportFailure(t('saveFailed'));
          }
        } finally {
          saves.delete(sessionId);
          if (mounted.current) setPending(false);
        }
      };
      const note = error ? t('retry') : pending ? t('saving') : state === null ? t('loading') : null;
      return h(React.Fragment, null,
        h('style', null, css),
        h('button', {
          type: 'button', role: error ? 'menuitem' : 'switch', className: 'dsh-cfm-row',
          'aria-label': error ? `${t('label')} · ${note}` : t('label'),
          'aria-describedby': id, 'aria-checked': error ? undefined : enabled,
          disabled: locked || (state === null && error === null && !pending && revision === 0),
          'aria-disabled': error ? locked : blocked,
          'aria-busy': pending || (state === null && !error), title: description, onClick: error ? retry : toggle,
        }, h('span', null, t('label')),
        note ? h('span', { className: 'dsh-cfm-note', 'aria-hidden': true }, note)
          : h('span', { className: 'dsh-cfm-track', 'aria-hidden': true }, h('span', { className: 'dsh-cfm-thumb' }))),
        h('span', { className: 'dsh-cfm-sr', id, 'aria-live': 'polite' }, pending ? t('saving') : description));
    }

    function FastModeOption({ directory, ...props }) {
      const provider = React.useSyncExternalStore(
        (listener) => directory.subscribe(listener),
        () => directory.getSnapshot().current?.provider,
      );
      return provider === 'openai-codex' ? h(FastModeSwitch, { ...props, key: props.sessionId }) : null;
    }

    return {
      inject: ['slots', 'locale', 'modelDirectories'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'codex-fast-mode: translations');
        ctx.slots.inject(SEAT, () => ctx.slots.register({
          name: SEAT, id: NS, order: 10, locale: NS,
          inject: (sessionId) => ({ directory: ctx.modelDirectories.directoryFor(sessionId).store }),
        }, FastModeOption));
      },
    };
  },
});
