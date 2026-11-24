/**
 * Browser half of the codex-login bundle.
 *
 * One block inside the Models settings card for the pi-ai `openai-codex` route:
 * the card's credential field is inert for an OAuth-only provider, so this is
 * where the sign-in lives. It polls the package's own Host routes for the
 * attempt snapshot and posts start / answer / cancel / sign-out actions back.
 * The device code and the page to type it on come from the flow's notices; the
 * token never reaches the page.
 */

window.__ModuleLoader__.load({
  id: '@local/codex-login',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'codexLogin';
    /** Models-page slot this bundle fills, keyed by the owning settings namespace. */
    const SLOT = 'settings.models.provider-card';
    /** The pi-ai route whose flow this surface runs. */
    const PROVIDER = 'openai-codex';
    /** Host routes, document-relative so a prefix-mounted UI works. */
    const STATE_URL = 'api/codex-login/state';
    const ACTION_URL = 'api/codex-login/action';
    /** Poll cadence while an attempt runs. */
    const POLL_MS = 1200;

    const EN = {
      'title': 'ChatGPT subscription (Codex)',
      'desc': 'Uses the ChatGPT Plus/Pro/Team sign-in instead of an API key: DSH sends its model requests to the Codex backend with the quota of that subscription.',
      'state.loading': 'Reading sign-in state…',
      'state.signedOut': 'Not signed in',
      'state.signedIn': 'Signed in · account {account}',
      'state.expires': ' · grant expires {time}',
      'state.running': 'Waiting for the browser',
      'action.login': 'Sign in with ChatGPT',
      'action.relogin': 'Sign in again',
      'action.cancel': 'Cancel',
      'action.signout': 'Sign out',
      'action.open': 'Open page',
      'action.copy': 'Copy code',
      'action.copied': 'Copied',
      'action.copyFailed': 'Select the code and copy it manually',
      'action.submit': 'Submit',
      'notice.instructions': 'Open this page and enter the code below.',
      'notice.code': 'One-time code',
      'notice.waiting': 'This page updates itself when the sign-in finishes.',
      'phase.authorized': 'Signed in. Pick a GPT model from the model picker to use this subscription.',
      'phase.cancelled': 'Sign-in cancelled.',
      'phase.failed': 'Sign-in failed: {error}',
      'prompt.text': 'The sign-in needs an answer:',
      'error.ALREADY_IN_FLIGHT': 'A sign-in is already running.',
      'error.STALE_QUESTION': 'That question expired; retry the sign-in.',
      'error.BAD_ANSWER': 'The answer was malformed.',
      'error.UNKNOWN_ACTION': 'Unknown action.',
    };

    const ZH = {
      'title': 'ChatGPT 订阅（Codex）',
      'desc': '用 ChatGPT Plus/Pro/Team 的登录授权，而不是 API key：DSH 的模型请求走 Codex 后端，额度算在这份订阅上。',
      'state.loading': '正在读取登录状态…',
      'state.signedOut': '未登录',
      'state.signedIn': '已登录 · 账号 {account}',
      'state.expires': ' · 授权到期 {time}',
      'state.running': '等待浏览器完成授权',
      'action.login': '登录 ChatGPT',
      'action.relogin': '重新登录',
      'action.cancel': '取消',
      'action.signout': '退出登录',
      'action.open': '打开页面',
      'action.copy': '复制代码',
      'action.copied': '已复制',
      'action.copyFailed': '请手动选中代码复制',
      'action.submit': '提交',
      'notice.instructions': '在浏览器打开下面的页面，输入一次性代码。',
      'notice.code': '一次性代码',
      'notice.waiting': '授权完成后这里会自动更新。',
      'phase.authorized': '已登录。在模型选择器里挑一个 GPT 模型即可使用这份订阅。',
      'phase.cancelled': '已取消登录。',
      'phase.failed': '登录失败：{error}',
      'prompt.text': '登录还需要一个回答：',
      'error.ALREADY_IN_FLIGHT': '已经有一个登录在进行中。',
      'error.STALE_QUESTION': '这条问题已失效，请重新登录。',
      'error.BAD_ANSWER': '回答格式不对。',
      'error.UNKNOWN_ACTION': '未知操作。',
    };

    const STYLE = `
.dcl { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l3); }
.dcl-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dcl-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-tertiary); }
.dcl-dot[data-state=signedIn] { background: var(--dsw-alias-state-success-primary); }
.dcl-dot[data-state=running] { background: var(--dsw-alias-state-warn-label); }
.dcl-dot[data-state=failed] { background: var(--dsw-alias-state-error-primary); }
.dcl-title { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dcl-status { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dcl-desc { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); margin: 0; }
.dcl-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.dcl-btn { font: inherit; font-size: 12px; line-height: 1; padding: 6px 10px; border-radius: var(--dsw-radius-md); border: 1px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dcl-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dcl-btn:disabled { opacity: 0.55; cursor: default; }
.dcl-btn[data-kind=primary] { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-label-primary-foreground); }
.dcl-btn[data-kind=primary]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dcl-notice { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); }
.dcl-notice-text { font-size: 12px; color: var(--dsw-alias-label-secondary); margin: 0; }
.dcl-code-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dcl-code { font-family: var(--ds-font-family-code); font-size: 15px; letter-spacing: 0.08em; padding: 6px 10px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); user-select: all; }
.dcl-link { font-size: 12px; color: var(--dsw-alias-state-business-primary); text-decoration: none; }
.dcl-link:hover { text-decoration: underline; }
.dcl-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); margin: 0; }
.dcl-ok { font-size: 12px; color: var(--dsw-alias-state-success-primary); margin: 0; }
.dcl-input { font: inherit; font-size: 12px; padding: 6px 8px; border-radius: var(--dsw-radius-sm); border: 1px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); }
`;

    /**
     * Fill `{name}` placeholders.
     * @param text - dictionary string.
     * @param vars - replacement values.
     * @returns the rendered string.
     */
    function interpolate(text, vars) {
      return String(text).replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
    }

    /**
     * Shorten an account id for display.
     * @param value - the flow's chatgpt_account_id.
     * @returns a middle-elided id.
     */
    function shortAccount(value) {
      if (typeof value !== 'string' || value.length <= 14) return value ?? '—';
      return `${value.slice(0, 6)}…${value.slice(-4)}`;
    }

    /**
     * Format a grant expiry in the browser's clock.
     * @param at - epoch milliseconds.
     * @returns a local date and time, or an em dash.
     */
    function formatExpiry(at) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return '—';
      return new Date(at).toLocaleString(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      });
    }

    /**
     * Build the sign-in block.
     * @param tr - translate function bound to this namespace.
     * @returns the registered React component.
     */
    function makeCard(tr) {
      /**
       * The interactive half; hooks live here so the outer wrapper stays
       * hook-free when it declines a card for another provider.
       * @param props - the slot's owner props.
       * @returns the block, or null while the first snapshot loads.
       */
      return function CodexLoginCard() {
        const [snapshot, setSnapshot] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [copied, setCopied] = React.useState('');
        const [text, setText] = React.useState('');
        const alive = React.useRef(true);
        const timer = React.useRef(null);

        const read = React.useCallback(async () => {
          try {
            const response = await fetch(STATE_URL, {
              cache: 'no-store',
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
            });
            if (!response.ok) return null;
            const data = await response.json();
            if (!alive.current) return null;
            setSnapshot(data);
            return data;
          } catch {
            return null;
          }
        }, []);

        const act = React.useCallback(async (action, extra) => {
          setBusy(true);
          try {
            const response = await fetch(ACTION_URL, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ action, ...(extra ?? {}) }),
            });
            const data = await response.json().catch(() => null);
            if (!alive.current) return;
            if (data !== null && typeof data === 'object') {
              if (typeof data.error === 'string' && data.error !== '') setCopied(data.error);
              setSnapshot(data);
            }
          } catch {
            if (alive.current) setCopied('');
          } finally {
            if (alive.current) setBusy(false);
          }
        }, []);

        React.useEffect(() => {
          alive.current = true;
          void read();
          return () => {
            alive.current = false;
            if (timer.current !== null) window.clearInterval(timer.current);
          };
        }, [read]);

        React.useEffect(() => {
          if (timer.current !== null) {
            window.clearInterval(timer.current);
            timer.current = null;
          }
          if (snapshot?.phase !== 'running') return undefined;
          timer.current = window.setInterval(() => { void read(); }, POLL_MS);
          return () => {
            if (timer.current !== null) {
              window.clearInterval(timer.current);
              timer.current = null;
            }
          };
        }, [snapshot?.phase, read]);

        if (snapshot === null) {
          return h('div', { className: 'dcl' },
            h('p', { className: 'dcl-desc' }, tr('state.loading')));
        }

        const running = snapshot.phase === 'running';
        const signedIn = snapshot.signedIn === true;
        const code = [...(snapshot.notices ?? [])].reverse().find((notice) => typeof notice.code === 'string' && notice.code !== '');
        const url = [...(snapshot.notices ?? [])].reverse().find((notice) => typeof notice.url === 'string' && notice.url !== '');
        const prompt = snapshot.prompt ?? null;
        const lastNotice = [...(snapshot.notices ?? [])].reverse().find((notice) => typeof notice.message === 'string' && notice.message !== '');
        const problem = typeof snapshot.error === 'string' && snapshot.error !== '' ? snapshot.error : null;

        const copy = async () => {
          if (code === undefined) return;
          try {
            await navigator.clipboard.writeText(code.code);
            setCopied(code.code);
            window.setTimeout(() => {
              if (alive.current) setCopied('');
            }, 1500);
          } catch {
            setCopied('copy-failed');
          }
        };

        const dotState = running ? 'running' : problem !== null && snapshot.phase === 'failed' ? 'failed' : signedIn ? 'signedIn' : 'idle';
        const status = running
          ? tr('state.running')
          : signedIn
            ? `${interpolate(tr('state.signedIn'), { account: shortAccount(snapshot.accountId) })}${interpolate(tr('state.expires'), { time: formatExpiry(snapshot.expiresAt) })}`
            : tr('state.signedOut');

        return h('div', { className: 'dcl' },
          h('div', { className: 'dcl-head' },
            h('span', { className: 'dcl-dot', 'data-state': dotState, 'aria-hidden': true }),
            h('span', { className: 'dcl-title' }, tr('title')),
            h('span', { className: 'dcl-status' }, status)),
          h('p', { className: 'dcl-desc' }, tr('desc')),

          running && code !== undefined
            ? h('div', { className: 'dcl-notice' },
                h('p', { className: 'dcl-notice-text' }, tr('notice.instructions')),
                url === undefined ? null : h('a', {
                  className: 'dcl-link', href: url.url, target: '_blank', rel: 'noreferrer noopener',
                }, `${tr('action.open')} · ${url.url}`),
                h('div', { className: 'dcl-code-row' },
                  h('span', { className: 'dcl-code', 'aria-label': tr('notice.code') }, code.code),
                  h('button', { type: 'button', className: 'dcl-btn', onClick: () => { void copy(); } },
                    copied === code.code ? tr('action.copied') : copied === 'copy-failed' ? tr('action.copyFailed') : tr('action.copy'))),
                h('p', { className: 'dcl-notice-text' }, tr('notice.waiting')))
            : running && lastNotice !== undefined
              ? h('p', { className: 'dcl-desc' }, lastNotice.message)
              : null,

          running && prompt !== null
            ? h('div', { className: 'dcl-notice' },
                h('p', { className: 'dcl-notice-text' }, prompt.message === '' ? tr('prompt.text') : prompt.message),
                Array.isArray(prompt.options) && prompt.options.length > 0
                  ? h('div', { className: 'dcl-actions' },
                      prompt.options.map((option) => h('button', {
                        type: 'button',
                        className: 'dcl-btn',
                        key: option.id,
                        disabled: busy,
                        title: option.description ?? undefined,
                        onClick: () => { void act('answer', { id: prompt.id, value: option.id }); },
                      }, option.label)))
                  : h('div', { className: 'dcl-code-row' },
                      h('input', {
                        className: 'dcl-input',
                        type: prompt.kind === 'secret' ? 'password' : 'text',
                        value: text,
                        placeholder: prompt.placeholder ?? '',
                        'aria-label': prompt.message === '' ? tr('prompt.text') : prompt.message,
                        onChange: (event) => setText(event.target.value),
                      }),
                      h('button', {
                        type: 'button',
                        className: 'dcl-btn',
                        disabled: busy || text === '',
                        onClick: () => {
                          void act('answer', { id: prompt.id, value: text });
                          setText('');
                        },
                      }, tr('action.submit'))))
            : null,

          problem === null ? null : h('p', { className: 'dcl-error' }, problem),
          snapshot.phase === 'authorized' && !running ? h('p', { className: 'dcl-ok' }, tr('phase.authorized')) : null,

          h('div', { className: 'dcl-actions' },
            running
              ? h('button', { type: 'button', className: 'dcl-btn', disabled: busy, onClick: () => { void act('cancel'); } }, tr('action.cancel'))
              : h('button', {
                  type: 'button',
                  className: 'dcl-btn',
                  'data-kind': 'primary',
                  disabled: busy,
                  onClick: () => { void act('start'); },
                }, signedIn ? tr('action.relogin') : tr('action.login')),
            signedIn && !running
              ? h('button', { type: 'button', className: 'dcl-btn', disabled: busy, onClick: () => { void act('signout'); } }, tr('action.signout'))
              : null),
        );
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'codex-login: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/codex-login/card.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/codex-login';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'codex-login: styles');

        const translate = ctx.locale.bind(NS);
        const tr = (key, vars) => interpolate(translate(key), vars ?? {});
        const Inner = makeCard(tr);

        /**
         * Wrapper without hooks: the Models page dispatches this slot for every
         * pi-ai provider card, and only the Codex route has anything to say here.
         * @param props - owner props from the Models page.
         * @returns the sign-in block, or null for another provider.
         */
        function CodexLoginSlot(props) {
          const route = props?.provider?.provider;
          if (route !== PROVIDER) return null;
          return h(Inner, props);
        }

        ctx.slots.inject(SLOT, () => ctx.slots.register(
          { name: SLOT, key: 'llm-pi-ai', order: 10, locale: NS },
          CodexLoginSlot,
        ));
      },
    };
  },
});