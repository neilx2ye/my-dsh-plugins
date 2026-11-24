/**
 * Browser half of the cache-cleaner bundle.
 *
 * The page lives in Settings as its own section. It scans every DSH home this
 * Host can read, shows session-log, projection-checkpoint, and canvas sizes per
 * account, and deletes the categories the user confirms. Sessions held open by
 * any DSH process are skipped by the Host; the page reports how many and why.
 */

window.__ModuleLoader__.load({
  id: '@local/cache-cleaner',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'cacheCleaner';
    /** Host route returning the current scan. */
    const SCAN_URL = 'api/cache-cleaner/scan';
    /** Host route deleting the selected categories. */
    const CLEAN_URL = 'api/cache-cleaner/clean';

    /** English dictionary; also the fallback for unknown locales. */
    const EN = {
      nav: 'Cache cleanup',
      title: 'Cache cleanup',
      description:
        'Scans every DSH home on this machine, including the homes of other Linux accounts, and reports session logs, projection checkpoints, and canvas documents. Cleaning permanently deletes them; a session that any DSH process still holds open is skipped.',
      warning: 'Only archived session logs are deleted; unarchived sessions and their checkpoints are kept, and an archived session that is in use is skipped. Canvas documents are deleted in full. These are not rebuildable caches: deleted sessions cannot be resumed and deleted canvas documents cannot be restored.',
      rescan: 'Scan again',
      scanning: 'Scanning…',
      scannedAt: 'Scanned {time}',
      total: 'Total',
      homes: '{count} DSH home(s)',
      liveNote: '{count} session(s) in use · skipped while cleaning',
      recentNote: '{count} session(s) modified recently · skipped while cleaning',
      restrictedNote:
        'This process cannot read every open file under /proc, so the in-use count may be low for other accounts; deletion still checks each session lock and skips a session whose lock is held or cannot be verified.',
      archiveBlocked: 'Archive state is unreadable in {count} DSH home(s); their session logs are kept.',
      current: 'This instance',
      unavailable: 'Unavailable',
      readOnly: 'Read-only',
      sessions: 'Session logs',
      projection: 'Projection checkpoints',
      canvas: 'Canvas documents',
      sessionsNote: '{count} session(s)',
      archivedNote: '{count} archived · {size}',
      archiveUnavailable: 'Archive state unavailable · logs are kept',
      liveInHome: '{count} in use',
      projectionNote: '{count} record(s)',
      canvasNote: '{count} document(s)',
      cleanSessions: 'Clear session history',
      cleanCanvas: 'Clear canvas documents',
      cleanAll: 'Clear everything',
      confirmTitle: 'Confirm deletion',
      confirmSessions:
        'Deletes up to {count} archived, idle session log(s) and their projection checkpoints, freeing up to about {size}. Unarchived sessions are kept; {live} archived session(s) in use and their checkpoints are kept.',
      confirmCanvas: 'Deletes {count} canvas document(s), freeing about {size}. Canvas contents cannot be recovered.',
      confirmAll:
        'Deletes up to {count} archived, idle session log(s) with their checkpoints, plus {artifacts} canvas document(s), freeing up to about {size}. Unarchived sessions are kept; canvas contents and deleted sessions cannot be recovered.',
      confirmNote: 'This action cannot be undone.',
      cancel: 'Cancel',
      confirm: 'Delete now',
      cleaning: 'Cleaning…',
      loadError: 'Could not read cache information',
      retry: 'Try again',
      noLiveDetection:
        'This platform exposes neither the process file table nor flock, so session cleanup is unavailable; canvas cleanup still works.',
      emptyTitle: 'No DSH caches found',
      emptyText: 'No writable DSH home contains session, projection, or canvas data yet.',
      resultSummary:
        'Freed {size}: {sessions} archived session log(s), {records} projection record(s), {artifacts} canvas document(s).',
      resultRetained: 'Kept {count} unarchived session log(s).',
      resultSkipped: 'Skipped {parts}.',
      resultSkippedLive: '{count} in use',
      resultSkippedRecent: '{count} recently modified',
      resultSkippedChanged: '{count} changed after the scan',
      resultSkippedUnverifiable: '{count} with an unverifiable lock',
      resultFailures: '{count} item(s) could not be cleaned',
      resultFailuresMore: 'Showing the first 5; {count} more failed.',
      resultFailureHint: 'A common cause is a permission or file-lock problem.',
      resultError: 'Cleanup failed: {message}',
      resultRemaining: 'Cache now totals {size}.',
    };

    /** Simplified Chinese dictionary. */
    const ZH = {
      nav: '缓存清理',
      title: '缓存清理',
      description:
        '扫描本机所有 DSH 主目录（包括其他 Linux 账户），列出会话日志、会话投影缓存与画布文档。清理会永久删除这些数据；任何 DSH 进程仍在使用中的会话都会跳过。',
      warning: '会话日志只删除已归档的会话：未归档会话及其投影缓存保留，使用中的归档会话跳过。画布文档会全部删除。这些都不是可重建的缓存：已删除的会话无法恢复，已删除的画布文档也无法找回。',
      rescan: '重新扫描',
      scanning: '正在扫描…',
      scannedAt: '扫描于 {time}',
      total: '总计',
      homes: '{count} 个 DSH 主目录',
      liveNote: '{count} 个会话正在使用 · 清理时跳过',
      recentNote: '{count} 个会话最近修改 · 清理时跳过',
      restrictedNote:
        '当前进程无法读取全部 /proc 打开文件，其他账户的“使用中”数量可能偏少；删除时仍会逐个检查会话锁，锁被占用或无法验证的会话会跳过。',
      archiveBlocked: '{count} 个 DSH 主目录的归档状态无法读取，这些主目录的会话日志会保留。',
      current: '当前实例',
      unavailable: '不可用',
      readOnly: '只读',
      sessions: '会话日志',
      projection: '会话投影缓存',
      canvas: '画布文档',
      sessionsNote: '{count} 个会话',
      archivedNote: '已归档 {count} 个 · {size}',
      archiveUnavailable: '归档状态不可用 · 会话日志保留',
      liveInHome: '{count} 个使用中',
      projectionNote: '{count} 条记录',
      canvasNote: '{count} 个文档',
      cleanSessions: '清理会话记录',
      cleanCanvas: '清理画布文档',
      cleanAll: '全部清理',
      confirmTitle: '确认删除',
      confirmSessions:
        '将删除至多 {count} 个已归档且未在使用中的会话日志及其投影缓存，最多释放约 {size}；未归档会话全部保留，{live} 个使用中的归档会话及其缓存也会保留。',
      confirmCanvas: '将删除 {count} 个画布文档，释放约 {size}。画布内容删除后无法恢复。',
      confirmAll:
        '将删除至多 {count} 个已归档且未在使用中的会话日志及其投影缓存，以及 {artifacts} 个画布文档，最多释放约 {size}。未归档会话保留；画布文档与已删除的会话都无法恢复。',
      confirmNote: '此操作不可撤销。',
      cancel: '取消',
      confirm: '确认删除',
      cleaning: '正在清理…',
      loadError: '无法读取缓存信息',
      retry: '重试',
      noLiveDetection: '当前平台既没有进程文件表也没有 flock，因此不能清理会话缓存；画布清理仍可使用。',
      emptyTitle: '没有发现 DSH 缓存',
      emptyText: '可写的 DSH 主目录中还没有会话、投影或画布数据。',
      resultSummary: '已释放 {size}：已归档会话日志 {sessions} 个、投影记录 {records} 条、画布文档 {artifacts} 个。',
      resultRetained: '保留了 {count} 个未归档会话日志。',
      resultSkipped: '跳过 {parts}。',
      resultSkippedLive: '{count} 个使用中',
      resultSkippedRecent: '{count} 个最近修改',
      resultSkippedChanged: '{count} 个在扫描后有变化',
      resultSkippedUnverifiable: '{count} 个无法验证锁',
      resultFailures: '{count} 项未能清理',
      resultFailuresMore: '仅显示前 5 项，另有 {count} 项失败。',
      resultFailureHint: '常见原因是权限不足或文件被占用。',
      resultError: '清理失败：{message}',
      resultRemaining: '当前缓存共 {size}。',
    };

    const STYLE = `
.cac-page{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;padding:4px 0 36px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.cac-head{display:flex;flex-direction:column;gap:4px;min-width:0}
.cac-title{margin:0;font-size:16px;line-height:1.45;font-weight:600;letter-spacing:-.005em}
.cac-desc{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;max-width:62em}
.cac-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.cac-summary-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.cac-summary-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
.cac-summary-value{font-size:20px;line-height:1.25;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.cac-summary-note{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
.cac-summary-warn{margin:0;color:var(--dsw-alias-state-warn-primary);font-size:11.5px;line-height:1.6}
.cac-warning{margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.6}
.cac-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;box-sizing:border-box;min-height:29px;padding:3px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:1.5;white-space:nowrap;flex:none}
.cac-button:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover)}
.cac-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cac-button[disabled]{opacity:.5;cursor:default}
.cac-button-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.cac-button-danger:hover:not([disabled]){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.cac-link{appearance:none;padding:3px 4px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11.5px;line-height:1.5;flex:none}
.cac-link:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cac-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cac-home{box-sizing:border-box;display:flex;flex-direction:column;gap:9px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.cac-home-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
.cac-chip{display:inline-flex;align-items:center;height:18px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:10px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;flex:none}
.cac-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;color:var(--dsw-alias-label-secondary);font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.cac-tag{display:inline-flex;align-items:center;height:17px;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1;white-space:nowrap;flex:none}
.cac-tag-danger{color:var(--dsw-alias-state-error-primary)}
.cac-home-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:1.55;overflow-wrap:anywhere}
.cac-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.cac-stat{display:flex;flex-direction:column;gap:1px;min-width:0;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}
.cac-stat-label{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.5}
.cac-stat-value{font-size:15px;line-height:1.35;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.cac-stat-note{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.5}
.cac-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.cac-confirm{display:flex;flex-direction:column;gap:9px;padding:10px 11px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.cac-confirm-title{margin:0;font-size:12.5px;line-height:1.5;font-weight:600;color:var(--dsw-alias-state-error-primary)}
.cac-confirm-text{margin:0;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.6;overflow-wrap:anywhere}
.cac-confirm-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5}
.cac-confirm-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.cac-alert{display:flex;flex-direction:column;gap:3px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:11.5px;line-height:1.55}
.cac-alert[data-tone="ok"]{border-left-color:var(--dsw-alias-state-success-primary)}
.cac-alert[data-tone="warn"]{border-left-color:var(--dsw-alias-state-warn-primary)}
.cac-alert-title{margin:0;color:var(--dsw-alias-label-primary)}
.cac-alert-text{margin:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.cac-alert-list{display:flex;flex-direction:column;gap:2px;margin:2px 0 0;padding:0;list-style:none;color:var(--dsw-alias-label-tertiary);font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.cac-alert-list li{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cac-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.cac-skeleton{display:flex;flex-direction:column;gap:8px;padding:4px 0}
.cac-sk{height:9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);animation:cac-pulse 1.5s ease-in-out infinite}
.cac-sk:nth-child(1){width:58%}
.cac-sk:nth-child(2){width:82%}
.cac-sk:nth-child(3){width:44%}
@keyframes cac-pulse{0%,100%{opacity:.5}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.cac-sk{animation:none}}
@media (max-width:560px){.cac-stats{grid-template-columns:minmax(0,1fr)}.cac-summary{align-items:flex-start;flex-direction:column}}
`;

    /**
     * Replace `{name}` placeholders in one translated string.
     * @param {string} text - dictionary text.
     * @param {object} [vars] - replacement values.
     * @returns the text with replacements.
     */
    function interpolate(text, vars = {}) {
      if (typeof text !== 'string') return '';
      return text.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
      );
    }

    /**
     * Render a byte count for the page.
     * @param {number} bytes - byte count.
     * @returns a short size.
     */
    function formatBytes(bytes) {
      const value = Number(bytes);
      if (!Number.isFinite(value) || value <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let index = 0;
      let scaled = value;
      while (scaled >= 1024 && index < units.length - 1) {
        scaled /= 1024;
        index += 1;
      }
      const digits = index === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${scaled.toFixed(digits)} ${units[index]}`;
    }

    /**
     * Fetch a JSON route and surface its structured failure.
     * @param {string} url - route path.
     * @param {object} [options] - fetch options.
     * @returns {Promise<object>} parsed payload.
     */
    async function requestJson(url, options = {}) {
      const response = await fetch(url, {
        ...options,
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.headers ?? {}),
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
            ? payload.message
            : `HTTP ${response.status}`;
        throw new Error(message);
      }
      return payload ?? {};
    }

    /**
     * Render one thrown value as a short message.
     * @param {unknown} error - thrown value.
     * @returns a message string.
     */
    function messageOf(error) {
      if (error instanceof Error) return error.message;
      return String(error);
    }

    /**
     * Render one cache stat cell.
     * @param {object} props - label, size, count note, and optional extra note.
     * @returns the cell.
     */
    function StatCell({ label, bytes, note, extra }) {
      return h(
        'div',
        { className: 'cac-stat' },
        h('span', { className: 'cac-stat-label' }, label),
        h('span', { className: 'cac-stat-value' }, formatBytes(bytes)),
        h('span', { className: 'cac-stat-note' }, extra === undefined ? note : `${note} · ${extra}`),
      );
    }

    /**
     * Render one DSH home's card.
     * @param {object} props - home report and translate function.
     * @returns the card.
     */
    function HomeCard({ home, t }) {
      return h(
        'section',
        { className: 'cac-home' },
        h(
          'div',
          { className: 'cac-home-head' },
          h('span', { className: 'cac-chip' }, home.owner),
          h('code', { className: 'cac-path', title: home.path }, home.path),
          home.current ? h('span', { className: 'cac-tag' }, t('current')) : null,
          !home.available
            ? h('span', { className: 'cac-tag cac-tag-danger' }, t('unavailable'))
            : !home.writable
              ? h('span', { className: 'cac-tag' }, t('readOnly'))
              : null,
        ),
        home.error === null || home.error === undefined
          ? null
          : h('p', { className: 'cac-home-error' }, home.error),
        home.available
          ? h(
              'div',
              { className: 'cac-stats' },
              h(StatCell, {
                label: t('sessions'),
                bytes: home.sessions.bytes,
                note: t('sessionsNote', { count: home.sessions.count }),
                extra: home.archive.available === false
                  ? t('archiveUnavailable')
                  : [
                      t('archivedNote', {
                        count: home.sessions.archivedCount,
                        size: formatBytes(home.sessions.archivedBytes),
                      }),
                      ...(home.sessions.archivedLiveCount > 0
                        ? [t('liveInHome', { count: home.sessions.archivedLiveCount })]
                        : []),
                    ].join(' · '),
              }),
              h(StatCell, {
                label: t('projection'),
                bytes: home.projectionCache.bytes,
                note: t('projectionNote', { count: home.projectionCache.count }),
              }),
              h(StatCell, {
                label: t('canvas'),
                bytes: home.canvas.bytes,
                note: t('canvasNote', { count: home.canvas.count }),
              }),
            )
          : null,
      );
    }

    /**
     * Settings section: scan, show, and clear the machine's DSH caches.
     * @param {object} props - slot props (a bound `tr` translator is injected).
     * @returns the section tree.
     */
    function CacheSection(props) {
      const translate = props.tr ?? props.t ?? ((key) => key);
      const t = React.useCallback(
        (key, vars) => interpolate(translate(key), vars ?? {}),
        [translate],
      );
      const [state, setState] = React.useState({ status: 'loading', report: null, error: null });
      const [busy, setBusy] = React.useState(null);
      const [confirm, setConfirm] = React.useState(null);
      const [result, setResult] = React.useState(null);
      const alive = React.useRef(true);
      const confirmButton = React.useRef(null);

      React.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);

      const load = React.useCallback(async (silent) => {
        if (!silent) setState((previous) => ({ ...previous, status: 'loading', error: null }));
        try {
          const report = await requestJson(SCAN_URL);
          if (!alive.current) return;
          setState({ status: 'ready', report, error: null });
        } catch (error) {
          if (!alive.current) return;
          setState((previous) => ({
            status: previous.report === null ? 'error' : 'ready',
            report: previous.report,
            error: messageOf(error),
          }));
        }
      }, []);

      React.useEffect(() => {
        void load();
      }, [load]);

      React.useEffect(() => {
        if (confirm !== null) confirmButton.current?.focus();
      }, [confirm]);

      const rescan = React.useCallback(async () => {
        setBusy('scan');
        setConfirm(null);
        setResult(null);
        try {
          await load();
        } finally {
          if (alive.current) setBusy(null);
        }
      }, [load]);

      const runClean = React.useCallback(
        async (kind) => {
          const targets = kind === 'sessions' ? ['sessions'] : kind === 'canvas' ? ['canvas'] : ['sessions', 'canvas'];
          setBusy(kind);
          setResult(null);
          try {
            const payload = await requestJson(CLEAN_URL, {
              method: 'POST',
              body: JSON.stringify({ targets, confirm: true }),
            });
            if (!alive.current) return;
            setResult({ status: payload.failureCount > 0 ? 'warn' : 'ok', data: payload });
            setConfirm(null);
            await load(true);
          } catch (error) {
            if (!alive.current) return;
            setResult({ status: 'error', message: messageOf(error) });
          } finally {
            if (alive.current) setBusy(null);
          }
        },
        [load],
      );

      const report = state.report;
      const totals = report?.totals;
      const liveCount = totals?.liveSessions ?? 0;
      const recentCount = totals?.recentSessions ?? 0;
      const writableHomes = report === null ? [] : report.homes.filter((home) => home.available && home.writable);
      const cleanable = writableHomes.reduce(
        (sum, home) => ({
          sessions: sum.sessions + Math.max(
            0,
            home.sessions.archivedCount - home.sessions.archivedLiveCount - home.sessions.archivedRecentCount,
          ),
          sessionBytes: sum.sessionBytes + Math.max(
            0,
            home.sessions.archivedBytes - home.sessions.archivedLiveBytes - home.sessions.archivedRecentBytes,
          ),
          cacheBytes: sum.cacheBytes + Math.max(
            0,
            home.projectionCache.eligibleBytes - home.projectionCache.eligibleLiveBytes,
          ),
          artifacts: sum.artifacts + home.canvas.count,
          canvasBytes: sum.canvasBytes + home.canvas.bytes,
        }),
        { sessions: 0, sessionBytes: 0, cacheBytes: 0, artifacts: 0, canvasBytes: 0 },
      );
      const cleanableSessions = cleanable.sessions;
      const cleanableSessionBytes = cleanable.sessionBytes + cleanable.cacheBytes;
      const canvasCount = cleanable.artifacts;
      const canvasBytes = cleanable.canvasBytes;
      const noLiveDetection = report !== null && report.liveDetection === 'unavailable';
      const restricted = report !== null && report.liveDetection === 'proc-restricted';
      const archiveBlockedCount = report === null
        ? 0
        : report.homes.filter((home) => home.available && home.archive?.available === false).length;
      const scannedLabel = report === null
        ? ''
        : t('scannedAt', {
            time: new Date(report.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          });

      const confirmCopy = confirm === 'sessions'
        ? t('confirmSessions', {
            count: cleanableSessions,
            size: formatBytes(cleanableSessionBytes),
            live: totals?.archivedLiveSessions ?? 0,
          })
        : confirm === 'canvas'
          ? t('confirmCanvas', { count: canvasCount, size: formatBytes(canvasBytes) })
          : t('confirmAll', {
              count: cleanableSessions,
              artifacts: canvasCount,
              size: formatBytes(cleanableSessionBytes + canvasBytes),
            });

      const skippedReasons = result?.data?.skippedByReason ?? {};
      const skippedParts = [];
      if ((skippedReasons.live ?? 0) > 0) skippedParts.push(t('resultSkippedLive', { count: skippedReasons.live }));
      if ((skippedReasons.recent ?? 0) > 0) skippedParts.push(t('resultSkippedRecent', { count: skippedReasons.recent }));
      if ((skippedReasons.changed ?? 0) > 0) skippedParts.push(t('resultSkippedChanged', { count: skippedReasons.changed }));
      if ((skippedReasons.unverifiable ?? 0) > 0) skippedParts.push(t('resultSkippedUnverifiable', { count: skippedReasons.unverifiable }));
      const skippedText = skippedParts.length === 0 ? null : t('resultSkipped', { parts: skippedParts.join(' · ') });

      const resultText = result?.data === undefined
        ? null
        : t('resultSummary', {
            size: formatBytes(result.data.freed.bytes),
            sessions: result.data.removed.sessions,
            records: result.data.removed.cacheRecords,
            artifacts: result.data.removed.artifacts,
          });

      return h(
        'div',
        { className: 'cac-page' },
        h(
          'div',
          { className: 'cac-head' },
          h('h2', { className: 'cac-title' }, t('title')),
          h('p', { className: 'cac-desc' }, t('description')),
          h('p', { className: 'cac-warning', role: 'note' }, t('warning')),
        ),
        state.status === 'loading' && report === null
          ? h(
              'div',
              { className: 'cac-skeleton', role: 'status', 'aria-live': 'polite' },
              h('span', { className: 'cac-sk' }),
              h('span', { className: 'cac-sk' }),
              h('span', { className: 'cac-sk' }),
              h('span', { className: 'cac-visually-hidden' }, t('scanning')),
            )
          : null,
        state.status === 'error'
          ? h(
              'div',
              { className: 'cac-alert', role: 'alert' },
              h('p', { className: 'cac-alert-title' }, t('loadError')),
              h('p', { className: 'cac-alert-text' }, state.error ?? ''),
              h('div', null, h('button', { type: 'button', className: 'cac-button', onClick: () => void load() }, t('retry'))),
            )
          : null,
        report !== null
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'cac-summary' },
                h(
                  'div',
                  { className: 'cac-summary-copy' },
                  h('span', { className: 'cac-summary-label' }, t('total')),
                  h('span', { className: 'cac-summary-value' }, formatBytes(totals?.bytes ?? 0)),
                  h(
                    'span',
                    { className: 'cac-summary-note' },
                    `${t('homes', { count: report.homes.length })}`
                      + (liveCount > 0 ? ` · ${t('liveNote', { count: liveCount })}` : '')
                      + (recentCount > 0 ? ` · ${t('recentNote', { count: recentCount })}` : '')
                      + ((totals?.archivedSessions ?? 0) > 0
                        ? ` · ${t('archivedNote', {
                            count: totals.archivedSessions,
                            size: formatBytes(totals.archivedSessionBytes),
                          })}`
                        : '')
                      + (scannedLabel === '' ? '' : ` · ${scannedLabel}`),
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cac-button',
                    disabled: busy !== null,
                    'aria-busy': busy === 'scan' ? 'true' : undefined,
                    onClick: () => void rescan(),
                  },
                  busy === 'scan' ? t('scanning') : t('rescan'),
                ),
              ),
              noLiveDetection ? h('p', { className: 'cac-summary-warn', role: 'note' }, t('noLiveDetection')) : null,
              restricted ? h('p', { className: 'cac-summary-warn', role: 'note' }, t('restrictedNote')) : null,
              archiveBlockedCount > 0
                ? h('p', { className: 'cac-summary-warn', role: 'note' }, t('archiveBlocked', { count: archiveBlockedCount }))
                : null,
              state.error !== null && state.status === 'ready'
                ? h(
                    'div',
                    { className: 'cac-alert', role: 'alert' },
                    h('p', { className: 'cac-alert-text' }, state.error),
                  )
                : null,
              report.homes.length === 0
                ? h(
                    'div',
                    { className: 'cac-home' },
                    h('p', { className: 'cac-alert-title' }, t('emptyTitle')),
                    h('p', { className: 'cac-alert-text' }, t('emptyText')),
                  )
                : report.homes.map((home) => h(HomeCard, { key: home.path, home, t })),
              h(
                'div',
                { className: 'cac-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cac-button cac-button-danger',
                    disabled: busy !== null || noLiveDetection || cleanableSessions === 0,
                    title: noLiveDetection ? t('noLiveDetection') : undefined,
                    onClick: () => {
                      setResult(null);
                      setConfirm('sessions');
                    },
                  },
                  t('cleanSessions'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cac-button cac-button-danger',
                    disabled: busy !== null || canvasCount === 0,
                    onClick: () => {
                      setResult(null);
                      setConfirm('canvas');
                    },
                  },
                  t('cleanCanvas'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cac-button cac-button-danger',
                    disabled: busy !== null || noLiveDetection || (cleanableSessions === 0 && canvasCount === 0),
                    title: noLiveDetection ? t('noLiveDetection') : undefined,
                    onClick: () => {
                      setResult(null);
                      setConfirm('all');
                    },
                  },
                  t('cleanAll'),
                ),
              ),
              confirm === null
                ? null
                : h(
                    'div',
                    {
                      className: 'cac-confirm',
                      role: 'group',
                      'aria-label': t('confirmTitle'),
                      'aria-live': 'polite',
                    },
                    h('p', { className: 'cac-confirm-title' }, t('confirmTitle')),
                    h('p', { className: 'cac-confirm-text' }, confirmCopy),
                    h('p', { className: 'cac-confirm-note' }, t('confirmNote')),
                    h(
                      'div',
                      { className: 'cac-confirm-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'cac-button',
                          disabled: busy !== null,
                          onClick: () => setConfirm(null),
                        },
                        t('cancel'),
                      ),
                      h(
                        'button',
                        {
                          ref: confirmButton,
                          type: 'button',
                          className: 'cac-button cac-button-danger',
                          disabled: busy !== null,
                          onClick: () => void runClean(confirm),
                        },
                        busy === null ? t('confirm') : t('cleaning'),
                      ),
                    ),
                  ),
              result === null
                ? null
                : h(
                    'div',
                    { className: 'cac-alert', 'data-tone': result.status, role: 'status', 'aria-live': 'polite' },
                    result.status === 'error'
                      ? h('p', { className: 'cac-alert-title' }, t('resultError', { message: result.message ?? '' }))
                      : h(
                          React.Fragment,
                          null,
                          h('p', { className: 'cac-alert-title' }, resultText),
                          (result.data.retained?.unarchivedSessions ?? 0) > 0
                            ? h(
                                'p',
                                { className: 'cac-alert-text' },
                                t('resultRetained', { count: result.data.retained.unarchivedSessions }),
                              )
                            : null,
                          skippedText === null ? null : h('p', { className: 'cac-alert-text' }, skippedText),
                          h(
                            'p',
                            { className: 'cac-alert-text' },
                            t('resultRemaining', { size: formatBytes(result.data.after.bytes) }),
                          ),
                          result.data.failureCount > 0
                            ? h(
                                React.Fragment,
                                null,
                                h(
                                  'p',
                                  { className: 'cac-alert-text' },
                                  `${t('resultFailures', { count: result.data.failureCount })}. ${t('resultFailureHint')}`,
                                ),
                                h(
                                  'ul',
                                  { className: 'cac-alert-list' },
                                  result.data.failures.slice(0, 5).map((failure) =>
                                    h('li', { key: failure.path, title: failure.message }, `${failure.path} — ${failure.message}`),
                                  ),
                                ),
                                result.data.failureCount > 5
                                  ? h(
                                      'p',
                                      { className: 'cac-alert-text' },
                                      t('resultFailuresMore', { count: result.data.failureCount - 5 }),
                                    )
                                  : null,
                              )
                            : null,
                        ),
                  ),
            )
          : null,
      );
    }

    /**
     * Navigation glyph: a trash can for cache deletion.
     * @param {object} props - `size` from the settings navigation.
     * @returns the icon tree.
     */
    function CacheGlyph({ size = 16 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        [
          h('path', { key: 'lid', d: 'M4 7h16' }),
          h('path', { key: 'handle', d: 'M9 7V5.2c0-.7.5-1.2 1.2-1.2h3.6c.7 0 1.2.5 1.2 1.2V7' }),
          h('path', { key: 'body', d: 'M6.4 7.6 7.5 19c.1 1 .9 1.6 1.9 1.6h5.2c1 0 1.8-.6 1.9-1.6l1.1-11.4' }),
          h('path', { key: 'line-a', d: 'M10.3 11.2v5.6' }),
          h('path', { key: 'line-b', d: 'M13.7 11.2v5.6' }),
        ],
      );
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the Settings page, its icon, and its dictionaries.
       * @param {object} ctx - Client plugin context.
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'cache-cleaner: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/cache-cleaner/settings.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/cache-cleaner';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'cache-cleaner: styles');

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'cache-cleaner',
              order: 40,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ tr: t }),
            },
            CacheSection,
          ),
        );

        ctx.slots.inject('settings.section.icon', () =>
          ctx.slots.register(
            {
              name: 'settings.section.icon',
              id: 'cache-cleaner',
              locale: NS,
            },
            CacheGlyph,
          ),
        );
      },
    };
  },
});