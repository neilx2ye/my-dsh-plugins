/**
 * Browser half of the model-quota bundle.
 *
 * One pill in the composer dock, beside the shipped activity and token-usage
 * pills: how much of the ChatGPT/Codex subscription is left in each limit
 * window. Clicking it opens a panel with a live countdown to each window's
 * reset — the numbers refresh every minute, the countdown every second. The
 * figures come from this package's own Host route, which reads the Codex
 * grant; the page never sees the token.
 */

window.__ModuleLoader__.load({
  id: '@local/model-quota',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'modelQuota';
    /** Composer dock the pill joins, next to `activity` and `usage`. */
    const SLOT = 'conversation.composer.dock';
    /** Host route returning the subscription windows. */
    const URL = 'api/model-quota';
    /** Refresh cadence while the page is visible. */
    const POLL_MS = 60_000;
    /** Countdown cadence while the panel is open. */
    const TICK_MS = 1_000;

    const EN = {
      'pill.codex': 'Codex {percent}%',
      'pill.weekly': 'week {percent}%',
      'pill.empty': 'Codex quota',
      'panel.title': 'ChatGPT / Codex quota',
      'panel.plan': 'Plan · {plan}',
      'panel.window': '{label} window',
      'panel.remaining': '{percent}% left',
      'panel.used': '{percent}% used',
      'panel.resetsIn': 'resets in',
      'panel.resetsAt': 'at {time}',
      'panel.exhausted': 'Limit reached — Codex requests fail until the window resets.',
      'panel.credits': 'Extra credits are available on this account.',
      'panel.updated': 'read {time}',
      'panel.refresh': 'Refresh now',
      'panel.refreshing': 'Refreshing…',
      'panel.stale': 'Not signed in to Codex yet, so there is no quota to show.',
      'panel.expired': 'The Codex grant expired and could not be renewed — sign in again in Settings → Models.',
      'panel.unauthorized': 'ChatGPT refused the grant and the renewal failed — sign in again in Settings → Models.',
      'panel.network': 'Could not reach the ChatGPT usage endpoint.',
      'panel.upstream': 'The ChatGPT usage endpoint answered unusably.',
      'panel.close': 'Close',
      'label.fiveHours': '5h',
      'label.week': 'week',
      'label.days': '{days}d',
    };

    const ZH = {
      'pill.codex': 'Codex 剩 {percent}%',
      'pill.weekly': '周 {percent}%',
      'pill.empty': 'Codex 额度',
      'panel.title': 'ChatGPT / Codex 额度',
      'panel.plan': '方案 · {plan}',
      'panel.window': '{label}窗口',
      'panel.remaining': '剩 {percent}%',
      'panel.used': '已用 {percent}%',
      'panel.resetsIn': '距重置',
      'panel.resetsAt': '重置于 {time}',
      'panel.exhausted': '额度已用尽 —— 重置前 Codex 路由的请求会失败。',
      'panel.credits': '这个账号还有额外额度可用。',
      'panel.updated': '读取于 {time}',
      'panel.refresh': '立即刷新',
      'panel.refreshing': '刷新中…',
      'panel.stale': '尚未登录 Codex，没有可显示的额度。',
      'panel.expired': 'Codex 授权过期且续期失败 —— 请到 设置 → 模型 重新登录。',
      'panel.unauthorized': 'ChatGPT 拒绝了授权，自动续期也没成功 —— 请到 设置 → 模型 重新登录。',
      'panel.network': '连不上 ChatGPT 的用量接口。',
      'panel.upstream': 'ChatGPT 用量接口返回了无法解析的内容。',
      'panel.close': '关闭',
      'label.fiveHours': '5 小时',
      'label.week': '每周',
      'label.days': '{days} 天',
    };

    const STYLE = `
.mq-wrap { display: inline-flex; align-items: center; }
.mq { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 1; color: var(--dsw-alias-label-tertiary); white-space: nowrap; cursor: pointer; border: 0; background: transparent; padding: 2px 0; font-family: inherit; }
.mq:hover { color: var(--dsw-alias-label-secondary); }
.mq:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; border-radius: var(--dsw-radius-xs); }
.mq[data-tone=warn] { color: var(--dsw-alias-state-warn-label); }
.mq[data-tone=danger] { color: var(--dsw-alias-state-error-primary); }
.mq-sep { opacity: 0.55; }
.mq-icon { display: block; flex: none; }
.mq-panel { position: fixed; z-index: 60; width: 272px; box-sizing: border-box; padding: 12px 14px 10px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); box-shadow: 0 8px 24px rgba(0,0,0,0.28); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.45; }
.mq-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.mq-title { font-size: 12px; font-weight: 500; }
.mq-plan { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.mq-window { padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l3); }
.mq-window:first-of-type { border-top: 0; padding-top: 0; }
.mq-window-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.mq-window-label { color: var(--dsw-alias-label-secondary); }
.mq-window-value { font-variant-numeric: tabular-nums; }
.mq-window-value[data-tone=warn] { color: var(--dsw-alias-state-warn-label); }
.mq-window-value[data-tone=danger] { color: var(--dsw-alias-state-error-primary); }
.mq-bar { position: relative; height: 4px; margin: 6px 0 5px; border-radius: 999px; background: var(--dsw-alias-border-l3); overflow: hidden; }
.mq-bar-fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: var(--dsw-alias-state-business-primary); }
.mq-bar-fill[data-tone=warn] { background: var(--dsw-alias-state-warn-label); }
.mq-bar-fill[data-tone=danger] { background: var(--dsw-alias-state-error-primary); }
.mq-count { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.mq-count-value { font-family: var(--ds-font-family-code); font-variant-numeric: tabular-nums; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.mq-note { margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.mq-note[data-tone=danger] { color: var(--dsw-alias-state-error-primary); }
.mq-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l3); }
.mq-updated { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.mq-refresh { font: inherit; font-size: 11px; padding: 4px 8px; border-radius: var(--dsw-radius-sm); border: 1px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.mq-refresh:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.mq-refresh:disabled { opacity: 0.55; cursor: default; }
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
     * Render a countdown from milliseconds left.
     * @param ms - milliseconds until the window resets.
     * @returns text such as `4h 10m 32s`, `6d 4h 12m`, or `12s`.
     */
    function countdown(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
      const total = Math.max(0, Math.floor(ms / 1000));
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (days > 0) return `${days}d ${hours}h ${String(minutes).padStart(2, '0')}m`;
      if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
      return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }

    /**
     * Format an absolute time in the browser's clock.
     * @param at - epoch milliseconds.
     * @returns a local time, or null when unknown.
     */
    function clockTime(at) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return null;
      return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    /**
     * Format a reset instant as a local date and time.
     * @param at - epoch milliseconds.
     * @returns a local stamp, or null when unknown.
     */
    function resetTime(at) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return null;
      return new Date(at).toLocaleString(undefined, {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      });
    }

    /**
     * Localize one window label.
     * @param tr - translate function bound to this namespace.
     * @param label - the Host's neutral label.
     * @returns the displayed label.
     */
    function windowName(tr, label) {
      if (label === '5h') return tr('label.fiveHours');
      if (label === 'week') return tr('label.week');
      const days = /^(\d+)d$/.exec(label);
      if (days !== null) return interpolate(tr('label.days'), { days: days[1] });
      return label;
    }

    /**
     * Tone for one percentage: quiet, warning below 20%, danger at zero.
     * @param remaining - percent left.
     * @returns `warn`, `danger`, or undefined.
     */
    function toneOf(remaining) {
      if (remaining <= 0) return 'danger';
      if (remaining < 20) return 'warn';
      return undefined;
    }

    /**
     * A gauge glyph matching the shipped pills' weight.
     * @returns the icon element.
     */
    function GaugeIcon() {
      return h('svg', {
        className: 'mq-icon',
        width: 12,
        height: 12,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        'aria-hidden': true,
      },
        h('path', { d: 'M2.5 12.5a6.5 6.5 0 1 1 11 0', strokeLinecap: 'round' }),
        h('path', { d: 'M8 9.4 10.6 6.6', strokeLinecap: 'round' }),
        h('circle', { cx: 8, cy: 10.1, r: 1.05, fill: 'currentColor', stroke: 'none' }));
    }

    /**
     * Build the pill and its countdown panel.
     * @param tr - translate function bound to this namespace.
     * @returns the registered React component.
     */
    function makePill(tr) {
      return function ModelQuotaPill() {
        const [quota, setQuota] = React.useState(null);
        const [loading, setLoading] = React.useState(false);
        const [open, setOpen] = React.useState(false);
        const [now, setNow] = React.useState(() => Date.now());
        const [anchor, setAnchor] = React.useState(null);
        const alive = React.useRef(true);
        const buttonRef = React.useRef(null);
        const panelRef = React.useRef(null);

        const load = React.useCallback(async (force) => {
          setLoading(true);
          try {
            const response = await fetch(force ? `${URL}?fresh=1` : URL, {
              cache: 'no-store',
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
            });
            if (!response.ok) return;
            const data = await response.json();
            if (!alive.current) return;
            setQuota(data);
            setNow(Date.now());
          } catch {
            // Keep the previous reading; the panel reports the failure reason.
          } finally {
            if (alive.current) setLoading(false);
          }
        }, []);

        React.useEffect(() => {
          alive.current = true;
          let timer = null;
          const start = () => {
            if (timer !== null) return;
            void load(false);
            timer = window.setInterval(() => { void load(false); }, POLL_MS);
          };
          const stop = () => {
            if (timer === null) return;
            window.clearInterval(timer);
            timer = null;
          };
          const onVisibility = () => {
            if (document.visibilityState === 'hidden') stop();
            else start();
          };
          document.addEventListener('visibilitychange', onVisibility);
          if (document.visibilityState !== 'hidden') start();
          return () => {
            alive.current = false;
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
          };
        }, [load]);

        React.useEffect(() => {
          if (!open) return undefined;
          const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
          return () => window.clearInterval(tick);
        }, [open]);

        const place = React.useCallback(() => {
          const button = buttonRef.current;
          if (button === null) return;
          const rect = button.getBoundingClientRect();
          const width = 272;
          const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
          setAnchor({ left, top: Math.max(8, rect.top - 12) });
        }, []);

        React.useLayoutEffect(() => {
          if (!open) return undefined;
          place();
          const onScroll = () => place();
          window.addEventListener('resize', onScroll);
          window.addEventListener('scroll', onScroll, true);
          return () => {
            window.removeEventListener('resize', onScroll);
            window.removeEventListener('scroll', onScroll, true);
          };
        }, [open, place]);

        React.useEffect(() => {
          if (!open) return undefined;
          const onPointer = (event) => {
            if (panelRef.current?.contains(event.target)) return;
            if (buttonRef.current?.contains(event.target)) return;
            setOpen(false);
          };
          const onKey = (event) => {
            if (event.key === 'Escape') setOpen(false);
          };
          document.addEventListener('pointerdown', onPointer, true);
          document.addEventListener('keydown', onKey);
          return () => {
            document.removeEventListener('pointerdown', onPointer, true);
            document.removeEventListener('keydown', onKey);
          };
        }, [open]);

        if (quota === null) return null;

        const available = quota.available === true;
        const windows = available && Array.isArray(quota.windows) ? quota.windows : [];
        const primary = windows[0];
        const secondary = windows[1];
        const worst = windows.reduce((low, window) => (window.remainingPercent < low ? window.remainingPercent : low), 100);
        const tone = quota.limitReached === true || worst <= 0 ? 'danger' : worst < 20 ? 'warn' : undefined;

        const parts = [];
        if (primary !== undefined) parts.push(interpolate(tr('pill.codex'), { percent: Math.round(primary.remainingPercent) }));
        else parts.push(available ? tr('pill.empty') : tr('pill.empty'));
        if (secondary !== undefined) parts.push(interpolate(tr('pill.weekly'), { percent: Math.round(secondary.remainingPercent) }));

        const hint = available
          ? windows.map((window) => `${windowName(tr, window.label)} ${tr('panel.resetsIn')} ${countdown((window.resetAt ?? now) - now)}`).join(' · ')
          : tr('panel.stale');

        const reasonText = (reason) => {
          if (reason === 'EXPIRED') return tr('panel.expired');
          if (reason === 'UNAUTHORIZED') return tr('panel.unauthorized');
          if (reason === 'NETWORK') return tr('panel.network');
          if (reason === 'UPSTREAM' || reason === 'FAILED') return tr('panel.upstream');
          return tr('panel.stale');
        };

        const windowRows = windows.map((window) => {
          const remaining = Math.round(window.remainingPercent);
          const windowTone = toneOf(window.remainingPercent);
          const resetAt = window.resetAt;
          const left = typeof resetAt === 'number' ? resetAt - now : null;
          return h('div', { className: 'mq-window', key: `${window.label}-${window.lengthSeconds}` },
            h('div', { className: 'mq-window-head' },
              h('span', { className: 'mq-window-label' }, interpolate(tr('panel.window'), { label: windowName(tr, window.label) })),
              h('span', { className: 'mq-window-value', 'data-tone': windowTone },
                `${interpolate(tr('panel.remaining'), { percent: remaining })} · ${interpolate(tr('panel.used'), { percent: Math.round(window.usedPercent) })}`)),
            h('div', { className: 'mq-bar', role: 'presentation' },
              h('span', { className: 'mq-bar-fill', 'data-tone': windowTone, style: { width: `${Math.max(0, Math.min(100, window.usedPercent))}%` } })),
            h('div', { className: 'mq-count' },
              h('span', null, tr('panel.resetsIn')),
              h('span', { className: 'mq-count-value' }, countdown(left))),
            resetTime(resetAt) === null ? null : h('div', { className: 'mq-count' },
              h('span', { className: 'mq-count-value' }, interpolate(tr('panel.resetsAt'), { time: resetTime(resetAt) }))));
        });

        const panel = open ? ReactDOM.createPortal(
          h('div', {
            className: 'mq-panel',
            ref: panelRef,
            role: 'dialog',
            'aria-label': tr('panel.title'),
            style: anchor === null ? { right: 16, bottom: 88 } : { left: anchor.left, top: anchor.top, transform: 'translateY(-100%)' },
            onPointerDown: (event) => event.stopPropagation(),
          },
            h('div', { className: 'mq-head' },
              h('span', { className: 'mq-title' }, tr('panel.title')),
              h('span', { className: 'mq-plan' }, typeof quota.plan === 'string' && quota.plan !== ''
                ? interpolate(tr('panel.plan'), { plan: quota.plan })
                : '')),
            available ? windowRows : h('p', { className: 'mq-note', 'data-tone': quota.reason === 'EXPIRED' || quota.reason === 'UNAUTHORIZED' ? 'danger' : undefined }, reasonText(quota.reason)),
            available && quota.limitReached === true ? h('p', { className: 'mq-note', 'data-tone': 'danger' }, tr('panel.exhausted')) : null,
            available && quota.credits?.hasCredits === true ? h('p', { className: 'mq-note' }, tr('panel.credits')) : null,
            h('div', { className: 'mq-foot' },
              h('span', { className: 'mq-updated' }, available
                ? interpolate(tr('panel.updated'), { time: clockTime(quota.sampledAt) ?? '—' })
                : ''),
              h('button', {
                type: 'button',
                className: 'mq-refresh',
                disabled: loading,
                onClick: () => { void load(true); },
              }, loading ? tr('panel.refreshing') : tr('panel.refresh')))),
          document.body) : null;

        return h('div', { className: 'mq-wrap' },
          h('button', {
            type: 'button',
            ref: buttonRef,
            className: 'mq',
            'data-tone': tone,
            'data-loading': loading ? 'true' : 'false',
            'aria-haspopup': 'dialog',
            'aria-expanded': open ? 'true' : 'false',
            title: hint,
            'aria-label': `${tr('panel.title')}: ${parts.join(' · ')}`,
            onClick: () => {
              setOpen((was) => {
                if (!was) setNow(Date.now());
                return !was;
              });
            },
          },
            h(GaugeIcon, null),
            parts.map((text, index) => h(React.Fragment, { key: `${index}-${text}` },
              index === 0 ? null : h('span', { className: 'mq-sep', 'aria-hidden': true }, '·'),
              h('span', null, text)))),
          panel);
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'model-quota: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/model-quota/pill.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/model-quota';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'model-quota: styles');

        const tr = (key, vars) => interpolate(ctx.locale.bind(NS)(key), vars ?? {});
        const Pill = makePill(tr);
        ctx.slots.inject(SLOT, () => ctx.slots.register(
          { name: SLOT, id: 'model-quota', order: 10, locale: NS, label: () => tr('pill.empty') },
          Pill,
        ));
      },
    };
  },
});