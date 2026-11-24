/**
 * Browser half of the system-usage bundle.
 *
 * One compact meter in the sidebar foot: a full-width row above the System
 * users action and the settings seat, which share the row below. It shows
 * three side-by-side readouts (CPU, memory, disk), each a label, a percentage,
 * and a short bar. Hovering or focusing shows cores, load average, memory
 * totals, disk totals, the DSH
 * process footprint, and the sample time; clicking asks the Host for a fresh
 * sample. Values come from the package's own Host route and are refreshed every
 * two seconds while the page is visible; the route is document-relative so a
 * prefix-mounted UI works. The 56px rail hides the readout because the footer
 * cannot fit another cell there.
 */

window.__ModuleLoader__.load({
  id: '@local/system-usage',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'systemUsage';
    /** Host route returning one sample of the machine's load. */
    const URL = 'api/system-usage';
    /** Refresh cadence while this page is visible. */
    const POLL_MS = 2000;

    /** English dictionary; also the fallback for unknown locales. */
    const EN = {
      'footer.title': 'Device usage',
      'metric.cpu': 'CPU',
      'metric.memory': 'MEM',
      'metric.disk': 'DISK',
      'aria': 'CPU use {cpu}, memory use {memory}, disk use {disk}',
      'aria.offline': ', host offline',
      'aria.action': '; click to refresh',
      'tooltip.title': 'Device usage · click to refresh',
      'tooltip.device': 'Device · {host}',
      'tooltip.cpu': 'CPU {percent} · {cores} cores · load {load}',
      'tooltip.memory': 'Memory {used} / {total} · {percent}',
      'tooltip.disk': 'Disk {mount} · {used} / {total} · {percent}',
      'tooltip.dsh': 'DSH process · {rss} resident',
      'tooltip.updated': 'Sampled {time}',
      'tooltip.offline': 'Host unreachable · showing the last sample',
      'tooltip.waiting': 'Waiting for the Host…',
    };

    /** Simplified Chinese dictionary. */
    const ZH = {
      'footer.title': '设备占用',
      'metric.cpu': 'CPU',
      'metric.memory': '内存',
      'metric.disk': '硬盘',
      'aria': '本机 CPU {cpu}，内存 {memory}，硬盘 {disk}',
      'aria.offline': '，离线',
      'aria.action': '；点击刷新',
      'tooltip.title': '设备占用 · 点击刷新',
      'tooltip.device': '设备 · {host}',
      'tooltip.cpu': 'CPU {percent} · {cores} 核 · 负载 {load}',
      'tooltip.memory': '内存 {used} / {total} · {percent}',
      'tooltip.disk': '磁盘 {mount} · {used} / {total} · {percent}',
      'tooltip.dsh': 'DSH 进程 · 常驻 {rss}',
      'tooltip.updated': '采样于 {time}',
      'tooltip.offline': '宿主不可达 · 显示上次采样',
      'tooltip.waiting': '正在等待宿主…',
    };

    /** Meter chrome. Only theme tokens are used, so light and dark both work. */
    const STYLE = `
.dsu{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:12px;
  box-sizing:border-box;flex:1 1 auto;width:100%;min-width:0;height:36px;margin:0;padding:0 10px;
  border:0;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary,#9aa0a8);
  font:inherit;line-height:1;text-align:left;cursor:pointer;overflow:hidden}
/* Two rows for the sidebar foot: this meter across the first, then the System
   users action and the settings seat side by side. The actions seat wraps its
   entries in a display:contents box, so lift it into one grid. */
div:has(> div > div > .dsu){display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  align-items:center;column-gap:8px;row-gap:4px}
div:has(> div > .dsu){display:contents}
div:has(> div > .dsu) > div > .dsu{grid-column:1 / -1;grid-row:1;width:100%;min-width:0}
div:has(> div > .dsu) > div > *:not(.dsu){grid-column:1;grid-row:2;width:100%;min-width:0}
div:has(> div > .dsu) + div{grid-column:2;grid-row:2;width:100%;min-width:0}
.dsu:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsu:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:-2px}
.dsu-metric{display:flex;flex-direction:column;justify-content:center;gap:3px;min-width:0}
.dsu-line{display:flex;align-items:baseline;justify-content:space-between;gap:3px;min-width:0}
.dsu-key{flex:none;font-size:11px;font-weight:600;letter-spacing:.02em;line-height:1;
  color:var(--dsw-alias-label-secondary,#9aa0a8)}
.dsu-val{flex:1 1 auto;min-width:0;font-size:12px;line-height:1;text-align:right;
  font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#e7e8ea);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-track{display:block;width:100%;height:3px;border-radius:999px;overflow:hidden;
  background:var(--dsw-alias-border-l2,rgba(127,127,127,.25));
  background:color-mix(in srgb, var(--dsw-alias-label-primary,#888) 18%, transparent)}
.dsu-fill{display:block;height:100%;border-radius:inherit;background:var(--dsw-alias-brand-primary,#4c8dff);
  transition:width .35s ease, opacity .2s ease}
.dsu-metric[data-tone="warn"] .dsu-fill{background:var(--dsw-alias-state-warn-primary,#d0a215)}
.dsu-metric[data-tone="error"] .dsu-fill{background:var(--dsw-alias-state-error-primary,#e5534b)}
.dsu[data-offline="true"] .dsu-fill{opacity:.35}
.dsu[data-offline="true"] .dsu-val{color:var(--dsw-alias-label-tertiary,#7c8492)}
.dsu[data-refreshing="true"] .dsu-fill{opacity:.6}
.dsu-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;
  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}

@media (prefers-reduced-motion: reduce){.dsu-fill{transition:none}}
`;

    /**
     * Fill `{name}` placeholders in one translated string.
     * @param text - translated template.
     * @param vars - replacement values.
     * @returns the interpolated string.
     */
    function interpolate(text, vars) {
      return String(text).replace(/\{(\w+)\}/g, (whole, key) => (
        vars[key] === undefined ? whole : String(vars[key])
      ));
    }

    /**
     * Render one usage fraction as a whole percentage.
     * @param usage - fraction from 0 through 1, or null when unknown.
     * @returns the percentage text.
     */
    function percentText(usage) {
      return usage === null ? '—' : `${Math.round(usage * 100)}%`;
    }

    /**
     * Map a usage fraction onto the meter's severity.
     * @param usage - fraction from 0 through 1, or null when unknown.
     * @returns the readout's tone.
     */
    function toneOf(usage) {
      if (usage === null) return 'normal';
      if (usage >= 0.9) return 'error';
      if (usage >= 0.7) return 'warn';
      return 'normal';
    }

    /**
     * Format a byte count for the tooltip.
     * @param bytes - byte count.
     * @returns a short binary-unit size.
     */
    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '—';
      const gib = bytes / (1024 ** 3);
      if (gib >= 1) return `${gib >= 10 ? Math.round(gib) : gib.toFixed(1)} GiB`;
      return `${Math.round(bytes / (1024 ** 2))} MiB`;
    }

    /**
     * Format one sample timestamp in the browser's clock.
     * @param at - epoch milliseconds.
     * @returns a time of day.
     */
    function formatTime(at) {
      if (!Number.isFinite(at)) return '—';
      return new Date(at).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }

    /**
     * Build the sidebar-foot meter component.
     * @param tr - translate function bound to this namespace.
     * @returns the registered React component.
     */
    function makeMeter(tr) {
      return function SystemUsageMeter(props) {
        const wide = props.wide !== false;
        const [sample, setSample] = React.useState({ data: null, offline: false });
        const [refreshing, setRefreshing] = React.useState(false);
        const alive = React.useRef(true);
        const inFlight = React.useRef(null);
        const detailId = React.useId();

        const load = React.useCallback(async (fresh) => {
          inFlight.current?.abort();
          const controller = new AbortController();
          inFlight.current = controller;
          try {
            const response = await fetch(fresh ? `${URL}?fresh=1` : URL, {
              cache: 'no-store',
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
              signal: controller.signal,
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!alive.current) return false;
            setSample({ data, offline: false });
            return true;
          } catch (error) {
            if (controller.signal.aborted || !alive.current) return false;
            setSample(previous => ({ data: previous.data, offline: true }));
            return false;
          } finally {
            if (inFlight.current === controller) inFlight.current = null;
          }
        }, []);

        React.useEffect(() => {
          if (!wide) return undefined;
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
            setRefreshing(false);
            stop();
            inFlight.current?.abort();
            document.removeEventListener('visibilitychange', onVisibility);
          };
        }, [load, wide]);

        const refresh = React.useCallback(async () => {
          setRefreshing(true);
          try {
            await load(true);
          } finally {
            if (alive.current) setRefreshing(false);
          }
        }, [load]);

        const data = sample.data;
        const cpu = Number.isFinite(data?.cpu?.usage) ? data.cpu.usage : null;
        const memory = Number.isFinite(data?.memory?.usage) ? data.memory.usage : null;
        const disk = Number.isFinite(data?.disk?.usage) ? data.disk.usage : null;
        const cpuText = percentText(cpu);
        const memoryText = percentText(memory);
        const diskText = percentText(disk);
        const offline = sample.offline;

        const details = [tr('tooltip.title')];
        if (data === null) {
          details.push(tr('tooltip.waiting'));
          if (offline) details.push(tr('tooltip.offline'));
        } else {
          details.push(tr('tooltip.device', { host: data.host ?? '—' }));
          details.push(tr('tooltip.cpu', {
            percent: cpuText,
            cores: data.cpu?.cores ?? '—',
            load: Array.isArray(data.cpu?.load) ? data.cpu.load.join(' / ') : '—',
          }));
          details.push(tr('tooltip.memory', {
            used: formatBytes(data.memory?.usedBytes),
            total: formatBytes(data.memory?.totalBytes),
            percent: memoryText,
          }));
          if (data.disk !== null && data.disk !== undefined) {
            details.push(tr('tooltip.disk', {
              mount: data.disk.path ?? '—',
              used: formatBytes(data.disk.usedBytes),
              total: formatBytes(data.disk.totalBytes),
              percent: diskText,
            }));
          }
          if (data.dsh !== undefined) details.push(tr('tooltip.dsh', { rss: formatBytes(data.dsh.rssBytes) }));
          details.push(tr('tooltip.updated', { time: formatTime(data.sampledAt) }));
          if (offline) details.push(tr('tooltip.offline'));
        }

        if (!wide) return null;

        const metric = (key, label, text, usage) => h(
          'span',
          { className: 'dsu-metric', 'data-tone': toneOf(usage), key },
          h(
            'span',
            { className: 'dsu-line' },
            h('span', { className: 'dsu-key' }, label),
            h('span', { className: 'dsu-val' }, text),
          ),
          h(
            'span',
            { className: 'dsu-track', 'aria-hidden': true },
            h('span', {
              className: 'dsu-fill',
              style: { width: usage === null || usage <= 0 ? '0%' : `${Math.max(2, Math.round(usage * 100))}%` },
            }),
          ),
        );

        return h(
          'button',
          {
            type: 'button',
            className: 'dsu',
            title: details.join('\n'),
            'aria-label': tr('aria', { cpu: cpuText, memory: memoryText, disk: diskText })
              + (offline ? tr('aria.offline') : '')
              + tr('aria.action'),
            'aria-describedby': detailId,
            'data-offline': offline ? 'true' : 'false',
            'data-refreshing': refreshing ? 'true' : 'false',
            onClick: () => { void refresh(); },
          },
          h('span', { className: 'dsu-sr', id: detailId }, details.join('. ')),
          metric('cpu', tr('metric.cpu'), cpuText, cpu),
          metric('memory', tr('metric.memory'), memoryText, memory),
          metric('disk', tr('metric.disk'), diskText, disk),
        );
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'system-usage: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/system-usage/meter.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/system-usage';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'system-usage: styles');

        const translate = ctx.locale.bind(NS);
        const tr = (key, vars) => interpolate(translate(key), vars ?? {});

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'system-usage',
              order: 100,
              locale: NS,
              label: () => tr('footer.title'),
            },
            makeMeter(tr),
          ),
        );
      },
    };
  },
});