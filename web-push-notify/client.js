/**
 * Browser half of the task-completion Web Push bundle.
 *
 * One row inside the sidebar account menu ("More"). The popover it opens owns
 * the whole permission flow: it asks for notification permission, registers
 * the root Service Worker, subscribes through the Push API with the Host's
 * VAPID key, and hands the subscription back to the Host. While a subscription
 * exists, completion notifications arrive through Web Push (even with the tab
 * closed). When a browser cannot obtain a push subscription, a hidden page
 * falls back to the Host's SSE channel and asks the same Service Worker to
 * show the notification instead.
 *
 * Routes are document-relative so a prefix-mounted UI keeps working.
 */

window.__ModuleLoader__.load({
  id: '@local/web-push-notify',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'webPushNotify';
    /** Host routes backing the popover. */
    const STATE_URL = 'api/web-push-notify/state';
    const SUBSCRIBE_URL = 'api/web-push-notify/subscribe';
    const UNSUBSCRIBE_URL = 'api/web-push-notify/unsubscribe';
    const TEST_URL = 'api/web-push-notify/test';
    const EVENTS_URL = 'api/web-push-notify/events';
    /** Popover width in pixels; also used to clamp its left edge. */
    const WIDTH = 312;
    /** Local opt-in flag; absent means the user never enabled this plugin. */
    const ENABLED_KEY = 'web-push-notify:enabled';
    /** Window event that opens the settings surface above an anchor element. */
    const OPEN_EVENT = 'web-push-notify:open';
    /** Local preference for notifications while this page is focused. */
    const VIEWING_KEY = 'web-push-notify:notify-while-viewing';

    /** English dictionary; also the fallback for unknown locales. */
    const EN = {
      'menu.item': 'Task notifications',
      'pop.title': 'Task notifications',
      'pop.subtitle': 'Web Push · Push API + Service Worker',
      'status.loading': 'Checking…',
      'status.on': 'On · {count} device(s)',
      'status.off': 'Not enabled',
      'status.fallback': 'On · this tab only',
      'action.retry': 'Retry push subscription',
      'status.blocked': 'Blocked by the browser',
      'status.unsupported': 'Not supported here',
      'status.denied': 'Notifications are blocked. Allow them in this site’s settings, then try again.',
      'status.unsupported.detail': 'This browser does not expose the Service Worker and Push API. Use a Chromium-based browser on localhost or HTTPS.',
      'action.enable': 'Enable completion notifications',
      'action.disable': 'Turn off',
      'action.test': 'Send a test notification',
      'action.working': 'Working…',
      'hint.visible': 'Quiet while you are viewing this page; other windows still notify.',
      'hint.closed': 'Web Push still works after the tab is closed.',
      'hint.foreground': 'Notifications also arrive while this page is focused.',
      'toggle.foreground': 'Notify while viewing this page',
      'hint.fallback': 'No push subscription: notifications only arrive while this tab is open but hidden.',
      'hint.content': 'Each notification includes the session, task, result, duration, and usage.',
      'error.unsupported': 'This browser does not support Service Worker + Push API.',
      'error.dismissed': 'Notification permission was not granted.',
      'error.host': 'The Host did not provide a VAPID key.',
      'error.subscribe': 'Could not subscribe to push: {message}',
      'error.notify': 'Could not show a notification: {message}',
      'test.ok': 'Test push delivered to {delivered} of {attempted} device(s).',
      'test.empty': 'No subscribed device yet. Enable notifications first.',
      'test.fail': 'Push failed: {message}',
      'last.none': 'No push sent yet.',
      'last.delivery': 'Last push: {delivered}/{attempted} delivered',
      'last.received': 'Last push: received by the browser.',
      'last.shown': 'Last push: notification shown.',
      'last.suppressed': 'Last push: quiet because you were viewing this page.',
      'last.error': 'Last push failed: {message}',
    };

    /** Simplified Chinese dictionary. */
    const ZH = {
      'menu.item': '任务通知',
      'pop.title': '任务通知',
      'pop.subtitle': 'Web Push · Push API + Service Worker',
      'status.loading': '检查中…',
      'status.on': '已开启 · {count} 台设备',
      'status.off': '未开启',
      'status.fallback': '已开启 · 仅本页',
      'action.retry': '重试推送订阅',
      'status.blocked': '被浏览器阻止',
      'status.unsupported': '当前环境不支持',
      'status.denied': '通知权限被阻止。请在本站点的权限设置中允许通知，然后重试。',
      'status.unsupported.detail': '当前浏览器没有提供 Service Worker 与 Push API。请使用 localhost 或 HTTPS 下的 Chromium 系浏览器。',
      'action.enable': '开启完成通知',
      'action.disable': '关闭通知',
      'action.test': '发送测试通知',
      'action.working': '处理中…',
      'hint.visible': '正在查看此页面时保持安静；切到其它窗口仍会通知。',
      'hint.closed': '关闭标签页后仍可通过 Web Push 收到。',
      'hint.foreground': '即使正在查看此页面也会通知。',
      'toggle.foreground': '正在查看页面时也通知',
      'hint.fallback': '没有推送订阅：仅在标签页打开但不可见时通知。',
      'hint.content': '每条通知包含：会话、任务、结果、耗时与用量。',
      'error.unsupported': '浏览器不支持 Service Worker + Push API。',
      'error.dismissed': '未获得通知权限。',
      'error.host': '宿主没有提供 VAPID 公钥。',
      'error.subscribe': '推送订阅失败：{message}',
      'error.notify': '无法显示通知：{message}',
      'test.ok': '测试推送已送达 {delivered}/{attempted} 台设备。',
      'test.empty': '还没有已订阅的设备，请先开启通知。',
      'test.fail': '推送失败：{message}',
      'last.none': '还没有发送过推送。',
      'last.delivery': '上次推送：{delivered}/{attempted} 送达',
      'last.received': '上次推送：浏览器已收到。',
      'last.shown': '上次推送：已显示通知。',
      'last.suppressed': '上次推送：正在查看页面，已静默。',
      'last.error': '上次推送失败：{message}',
    };

    /** Popover chrome. Only theme tokens are used, so light and dark both work. */
    const STYLE = `
.wpn-dot{fill:var(--dsw-alias-state-success-primary,#3fb950)}

.wpn-pop:focus{outline:none}
.wpn-pop{position:fixed;z-index:9500;box-sizing:border-box;width:312px;padding:12px;
  background:var(--dsw-alias-bg-overlay,#1c1e22);color:var(--dsw-alias-label-primary,#e7e8ea);
  border:1px solid var(--dsw-alias-border-l2,#3a3d44);border-radius:10px;
  box-shadow:0 14px 36px rgba(0,0,0,.42);font-size:13px;line-height:1.5}
.wpn-head{display:flex;align-items:flex-start;gap:9px;padding:0 2px}
.wpn-head-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;
  border-radius:7px;background:var(--dsw-alias-bg-layer-2,#2a2d33);color:var(--dsw-alias-brand-primary,#4c8dff)}
.wpn-head-text{min-width:0;flex:1}
.wpn-title{font-size:14px;font-weight:600;line-height:1.3}
.wpn-sub{margin-top:2px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#9aa0a8)}
.wpn-sep{height:1px;margin:10px 2px;background:var(--dsw-alias-border-l1,#2c2f35)}
.wpn-status{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500}
.wpn-status .dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary,#6b7280)}
.wpn-status.on .dot{background:var(--dsw-alias-state-success-primary,#3fb950)}
.wpn-status.warn .dot{background:var(--dsw-alias-state-warn-primary,#d29922)}
.wpn-status.err .dot{background:var(--dsw-alias-state-error-primary,#f85149)}
.wpn-note{margin-top:7px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#9aa0a8)}
.wpn-note.callout{padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,#2a2d33)}
.wpn-hints{margin-top:9px;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary,#9aa0a8)}
.wpn-hint{display:flex;gap:6px}
.wpn-hint::before{content:'·';flex:none;opacity:.7}
.wpn-last{margin-top:7px;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa0a8);opacity:.85}
.wpn-note.err{color:var(--dsw-alias-state-error-primary,#f85149)}
.wpn-note.ok{color:var(--dsw-alias-state-success-primary,#3fb950)}
.wpn-actions{display:flex;gap:7px;margin-top:11px}
.wpn-toggle{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px;line-height:1.4;
  color:var(--dsw-alias-label-primary,#e7e8ea);cursor:pointer}
.wpn-toggle input{flex:none;width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary,#4c8dff);cursor:pointer}
.wpn-toggle span{min-width:0}
.wpn-btn{flex:1;box-sizing:border-box;height:30px;padding:0 10px;border-radius:7px;font:inherit;font-size:12.5px;
  line-height:1;cursor:pointer;border:1px solid transparent}
.wpn-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:-2px}
.wpn-btn:disabled{cursor:default;opacity:.55}
.wpn-btn.primary{background:#2f6fed;border-color:#2f6fed;color:#fff}
.wpn-btn.primary:hover:not(:disabled){filter:brightness(1.08)}
.wpn-btn.ghost{background:none;color:var(--dsw-alias-label-primary,#e7e8ea);border-color:var(--dsw-alias-border-l2,#3a3d44)}
.wpn-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
`;

    /**
     * Interpolate `{name}` placeholders.
     * @param text - dictionary value.
     * @param vars - replacement values.
     */
    function interpolate(text, vars) {
      if (vars === undefined || text === undefined) return text;
      return String(text).replace(/\{(\w+)\}/g, (match, name) =>
        vars[name] === undefined ? match : String(vars[name]),
      );
    }

    /** Whether this browser exposes the whole Web Push stack. */
    function supported() {
      return (
        window.isSecureContext === true &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
      );
    }

    /**
     * Browser fetch returning `{ok, status, data}`.
     * @param url - document-relative route.
     * @param init - optional request init.
     */
    async function requestJson(url, init) {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, data };
    }

    /**
     * POST a JSON body and read a JSON response.
     * @param url - document-relative route.
     * @param value - request body.
     */
    function postJson(url, value) {
      return requestJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
    }

    /**
     * Decode an unpadded base64url public key.
     * @param value - base64url text.
     */
    function decodeKey(value) {
      const padding = '='.repeat((4 - (value.length % 4)) % 4);
      const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = window.atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      return bytes;
    }

    /**
     * Whether two application server keys are the same bytes.
     * @param left - existing key bytes, if exposed.
     * @param right - current VAPID public key bytes.
     */
    function sameKey(left, right) {
      if (left === null || left === undefined) return true;
      const bytes = new Uint8Array(left);
      if (bytes.length !== right.length) return false;
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== right[index]) return false;
      }
      return true;
    }

    /** Read the local opt-in flag. */
    function readEnabled() {
      try {
        return window.localStorage.getItem(ENABLED_KEY) === '1';
      } catch {
        return false;
      }
    }

    /**
     * Persist the local opt-in flag.
     * @param value - true when the user wants completion notifications.
     */
    function writeEnabled(value) {
      try {
        if (value) window.localStorage.setItem(ENABLED_KEY, '1');
        else window.localStorage.removeItem(ENABLED_KEY);
      } catch {
        // A browser that blocks storage still keeps the in-memory state.
      }
    }

    /**
     * Read the foreground-notification preference. Absent means on: the plugin
     * should not silently swallow a completion because the page happens to be
     * focused.
     * @returns true when focused pages should still show the notification.
     */
    function readNotifyWhileViewing() {
      try {
        return window.localStorage.getItem(VIEWING_KEY) !== '0';
      } catch {
        return true;
      }
    }

    /**
     * Persist the foreground-notification preference.
     * @param value - true to notify while this page is focused.
     */
    function writeNotifyWhileViewing(value) {
      try {
        window.localStorage.setItem(VIEWING_KEY, value ? '1' : '0');
      } catch {
        // A browser that blocks storage still keeps the in-memory state.
      }
    }

    /** Bell glyph drawn with the current text color. */
    function BellIcon({ on }) {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M8 1.6a4.1 4.1 0 0 0-4.1 4.1v2.4L2.6 10.4a.55.55 0 0 0 .47.85h9.86a.55.55 0 0 0 .47-.85L12.1 8.1V5.7A4.1 4.1 0 0 0 8 1.6Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M6.4 13.1a1.7 1.7 0 0 0 3.2 0',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinecap: 'round',
        }),
        on ? h('circle', { className: 'wpn-dot', cx: 12.7, cy: 3.3, r: 2.3 }) : null,
      );
    }

    /**
     * Own subscription state and the operations the popover exposes.
     * @param tr - translate function bound to this namespace.
     */
    function useNotifications(tr, currentLocale) {
      const [phase, setPhase] = React.useState('loading');
      const [enabled, setEnabled] = React.useState(readEnabled);
      const [notifyWhileViewing, setNotifyWhileViewingState] = React.useState(readNotifyWhileViewing);
      const [permission, setPermission] = React.useState('default');
      const [subscribed, setSubscribed] = React.useState(false);
      const [count, setCount] = React.useState(0);
      const [lastDelivery, setLastDelivery] = React.useState(null);
      const [lastAck, setLastAck] = React.useState(null);
      const [hostError, setHostError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState(null);
      const preferenceSynced = React.useRef(false);

      const refresh = React.useCallback(async () => {
        if (!supported()) {
          setPhase('unsupported');
          return;
        }
        setPermission(window.Notification.permission);
        setEnabled(readEnabled());
        let registration;
        try {
          registration = await navigator.serviceWorker.getRegistration();
        } catch {
          registration = undefined;
        }
        let subscription = null;
        if (registration !== undefined && registration !== null) {
          try {
            subscription = await registration.pushManager.getSubscription();
          } catch {
            subscription = null;
          }
        }
        const active = subscription !== null;
        if (active) setNotifyWhileViewingState(readNotifyWhileViewing());
        const host = await requestJson(STATE_URL).catch(() => null);
        setSubscribed(active);
        setCount(typeof host?.data?.subscriptions === 'number' ? host.data.subscriptions : 0);
        setLastDelivery(host?.data?.lastDelivery ?? null);
        setLastAck(host?.data?.lastAck ?? null);
        setHostError(host === null || !host.ok ? host?.data?.message ?? 'HTTP ' + String(host?.status ?? 0) : null);
        setPhase('ready');
        if (active && !preferenceSynced.current) {
          preferenceSynced.current = true;
          void postJson(SUBSCRIBE_URL, {
            subscription: subscription.toJSON(),
            locale: currentLocale(),
            notifyWhileViewing: readNotifyWhileViewing(),
          }).catch(() => {});
        }
      }, [currentLocale]);

      React.useEffect(() => {
        void refresh();
      }, [refresh]);

      // Keep a previously granted origin in sync without prompting again.
      // Mount-only: the enable action performs the same steps for a fresh opt-in.
      const synced = React.useRef(false);
      React.useEffect(() => {
        if (synced.current) return undefined;
        synced.current = true;
        if (!readEnabled() || !supported() || window.Notification.permission !== 'granted') return undefined;
        let alive = true;
        void (async () => {
          try {
            const registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
            await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            if (subscription !== null) {
              await postJson(SUBSCRIBE_URL, {
                subscription: subscription.toJSON(),
                locale: currentLocale(),
              }).catch(() => {});
            }
            try {
              await registration.update();
            } catch {
              // A failed update is retried by the browser later.
            }
          } catch {
            // The popover reports any real failure when the user acts.
          }
          if (alive) void refresh();
        })();
        return () => {
          alive = false;
        };
      }, [refresh]);

      // Page-local fallback: no push subscription, so ask the Service Worker
      // directly while this page is open but hidden.
      React.useEffect(() => {
        if (!enabled || !supported() || permission !== 'granted' || subscribed) return undefined;
        const source = new EventSource(`${EVENTS_URL}?locale=${encodeURIComponent(currentLocale())}`);
        source.onmessage = (event) => {
          let payload;
          try {
            payload = JSON.parse(event.data);
          } catch {
            return;
          }
          if (document.visibilityState === 'visible') return;
          void navigator.serviceWorker.ready
            .then((registration) => registration.active?.postMessage({ type: 'notify', payload }))
            .catch((error) => setNote({ kind: 'error', text: tr('error.notify', { message: error?.message ?? error }) }));
        };
        return () => source.close();
      }, [currentLocale, enabled, permission, subscribed, tr]);

      const clearNotifications = React.useCallback(async (tag) => {
        try {
          const registration = await navigator.serviceWorker.ready;
          const shown = await registration.getNotifications();
          for (const notification of shown) {
            const current = typeof notification.tag === 'string' ? notification.tag : '';
            if (tag === undefined || current.startsWith(tag)) notification.close();
          }
        } catch {
          // Closing old cards is best effort.
        }
      }, []);

      const enable = React.useCallback(async () => {
        setBusy(true);
        setNote(null);
        try {
          if (!supported()) throw new Error(tr('error.unsupported'));
          const nextPermission =
            window.Notification.permission === 'granted'
              ? 'granted'
              : await window.Notification.requestPermission();
          setPermission(nextPermission);
          if (nextPermission !== 'granted') {
            setNote({ kind: 'error', text: nextPermission === 'denied' ? tr('status.denied') : tr('error.dismissed') });
            return;
          }
          writeEnabled(true);
          setEnabled(true);
          await clearNotifications();

          const registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
          await navigator.serviceWorker.ready;
          try {
            await registration.update();
          } catch {
            // A failed update is retried by the browser later.
          }

          const host = await requestJson(STATE_URL);
          const publicKey = host.data?.publicKey;
          if (!host.ok || typeof publicKey !== 'string' || publicKey === '') {
            throw new Error(host.data?.message ?? tr('error.host'));
          }
          const keyBytes = decodeKey(publicKey);

          let subscription = await registration.pushManager.getSubscription();
          if (subscription !== null && !sameKey(subscription.options?.applicationServerKey, keyBytes)) {
            await subscription.unsubscribe().catch(() => {});
            subscription = null;
          }
          if (subscription === null) {
            try {
              subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: keyBytes,
              });
            } catch (error) {
              throw new Error(tr('error.subscribe', { message: error?.message ?? error }));
            }
          }

          const saved = await postJson(SUBSCRIBE_URL, {
            subscription: subscription.toJSON(),
            locale: currentLocale(),
            notifyWhileViewing: readNotifyWhileViewing(),
          });
          preferenceSynced.current = true;
          if (!saved.ok) throw new Error(saved.data?.message ?? `HTTP ${saved.status}`);
          setSubscribed(true);
          setCount(typeof saved.data?.subscriptions === 'number' ? saved.data.subscriptions : 1);
          setHostError(null);
          setNote(null);
        } catch (error) {
          setNote({ kind: 'error', text: error?.message ?? String(error) });
        } finally {
          setBusy(false);
        }
      }, [clearNotifications, currentLocale, tr]);

      const disable = React.useCallback(async () => {
        setBusy(true);
        setNote(null);
        writeEnabled(false);
        setEnabled(false);
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          const subscription = await registration?.pushManager.getSubscription();
          if (subscription !== null && subscription !== undefined) {
            const endpoint = subscription.endpoint;
            await subscription.unsubscribe().catch(() => {});
            await postJson(UNSUBSCRIBE_URL, { endpoint }).catch(() => {});
          }
          setSubscribed(false);
          setNote(null);
          await refresh();
        } catch (error) {
          setNote({ kind: 'error', text: error?.message ?? String(error) });
        } finally {
          setBusy(false);
        }
      }, [refresh, tr]);

      const test = React.useCallback(async () => {
        setBusy(true);
        setNote(null);
        try {
          await clearNotifications('dsh-test');
          const result = await postJson(TEST_URL, {});
          const attempted = result.data?.attempted;
          if (!result.ok) throw new Error(result.data?.message ?? `HTTP ${result.status}`);
          if (attempted === 0) {
            setNote({ kind: 'error', text: tr('test.empty') });
          } else if (result.data?.delivered > 0) {
            setNote({
              kind: 'ok',
              text: tr('test.ok', { delivered: result.data.delivered, attempted }),
            });
          } else {
            setNote({ kind: 'error', text: tr('test.fail', { message: result.data?.message ?? 'unknown' }) });
          }
          setLastDelivery(result.data?.lastDelivery ?? null);
          await refresh();
          // The push and its display receipt arrive after the HTTP response.
          window.setTimeout(() => {
            void refresh();
          }, 4000);
        } catch (error) {
          setNote({ kind: 'error', text: tr('test.fail', { message: error?.message ?? error }) });
        } finally {
          setBusy(false);
        }
      }, [clearNotifications, refresh, tr]);

      const setNotifyWhileViewing = React.useCallback(
        async (value) => {
          writeNotifyWhileViewing(value);
          setNotifyWhileViewingState(value);
          try {
            const registration = await navigator.serviceWorker.getRegistration();
            const subscription = await registration?.pushManager.getSubscription();
            if (subscription !== null && subscription !== undefined) {
              preferenceSynced.current = true;
              await postJson(SUBSCRIBE_URL, {
                subscription: subscription.toJSON(),
                locale: currentLocale(),
                notifyWhileViewing: value,
              }).catch(() => {});
            }
          } catch {
            // The next subscribe or refresh retries the preference sync.
          }
        },
        [currentLocale],
      );

      return {
        phase,
        enabled,
        notifyWhileViewing,
        permission,
        subscribed,
        count,
        lastDelivery,
        lastAck,
        hostError,
        busy,
        note,
        refresh,
        enable,
        disable,
        test,
        setNotifyWhileViewing,
      };
    }

    /**
     * Build the settings surface. It stays mounted for the whole session and
     * renders only while the account menu asks it to open; the menu row passes
     * the account trigger as its anchor so the card floats above the sidebar
     * footer the same way it used to float above its own bell row.
     * @param tr - translate function bound to this namespace.
     */
    function makeLayer(tr, currentLocale) {
      return function TaskNotifyLayer() {
        const notify = useNotifications(tr, currentLocale);
        const [open, setOpen] = React.useState(false);
        const [anchor, setAnchor] = React.useState(null);
        const anchorRef = React.useRef(null);
        const popoverRef = React.useRef(null);

        const close = React.useCallback((restoreFocus) => {
          const previous = anchorRef.current;
          setOpen(false);
          setAnchor(null);
          anchorRef.current = null;
          if (restoreFocus === true && previous !== null) previous.focus();
        }, []);

        React.useEffect(() => {
          if (open && popoverRef.current !== null) popoverRef.current.focus();
        }, [open]);

        React.useEffect(() => {
          const onOpen = (event) => {
            const next = event !== null && typeof event === 'object' ? event.detail?.anchor : null;
            anchorRef.current = next instanceof Element ? next : null;
            setAnchor(anchorRef.current);
            setOpen(true);
            void notify.refresh();
          };
          window.addEventListener(OPEN_EVENT, onOpen);
          return () => window.removeEventListener(OPEN_EVENT, onOpen);
        }, [notify]);

        React.useEffect(() => {
          if (!open) return undefined;
          const onPointerDown = (event) => {
            if (anchor !== null && anchor.contains(event.target)) {
              // The trigger owns the account menu; dismiss the card so that menu
              // is not left covered when the user reopens it.
              close();
              return;
            }
            if (event.target instanceof Element && event.target.closest('.wpn-pop') !== null) return;
            close();
          };
          const onKeyDown = (event) => {
            if (event.key === 'Escape') close(true);
          };
          const onResize = () => close();
          document.addEventListener('mousedown', onPointerDown, true);
          window.addEventListener('keydown', onKeyDown);
          window.addEventListener('resize', onResize);
          return () => {
            document.removeEventListener('mousedown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', onResize);
          };
        }, [anchor, close, open]);

        const geometry = React.useMemo(() => {
          if (anchor === null) return { left: 8, bottom: 8 };
          const rect = anchor.getBoundingClientRect();
          const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
          return { left, bottom: window.innerHeight - rect.top + 6 };
        }, [anchor]);

        const statusView = () => {
          if (notify.phase === 'unsupported') {
            return { tone: 'err', text: tr('status.unsupported'), detail: tr('status.unsupported.detail') };
          }
          if (notify.phase === 'loading') {
            return { tone: '', text: tr('status.loading') };
          }
          if (notify.permission === 'denied') {
            return { tone: 'err', text: tr('status.blocked'), detail: tr('status.denied') };
          }
          if (!notify.enabled) {
            return { tone: 'warn', text: tr('status.off') };
          }
          if (notify.subscribed) {
            return { tone: 'on', text: tr('status.on', { count: notify.count }) };
          }
          return { tone: 'warn', text: tr('status.fallback'), detail: tr('hint.fallback') };
        };
        const status = statusView();

        const actions = [];
        if (notify.phase === 'ready' && notify.permission !== 'denied') {
          if (!notify.enabled) {
            actions.push(
              h(
                'button',
                {
                  key: 'enable',
                  type: 'button',
                  className: 'wpn-btn primary',
                  disabled: notify.busy,
                  onClick: () => void notify.enable(),
                },
                notify.busy ? tr('action.working') : tr('action.enable'),
              ),
            );
          } else if (!notify.subscribed) {
            actions.push(
              h(
                'button',
                {
                  key: 'retry',
                  type: 'button',
                  className: 'wpn-btn primary',
                  disabled: notify.busy,
                  onClick: () => void notify.enable(),
                },
                notify.busy ? tr('action.working') : tr('action.retry'),
              ),
              h(
                'button',
                {
                  key: 'disable',
                  type: 'button',
                  className: 'wpn-btn ghost',
                  disabled: notify.busy,
                  onClick: () => void notify.disable(),
                },
                tr('action.disable'),
              ),
            );
          } else {
            actions.push(
              h(
                'button',
                {
                  key: 'test',
                  type: 'button',
                  className: 'wpn-btn primary',
                  disabled: notify.busy,
                  onClick: () => void notify.test(),
                },
                notify.busy ? tr('action.working') : tr('action.test'),
              ),
              h(
                'button',
                {
                  key: 'disable',
                  type: 'button',
                  className: 'wpn-btn ghost',
                  disabled: notify.busy,
                  onClick: () => void notify.disable(),
                },
                tr('action.disable'),
              ),
            );
          }
        }

        const hints = [];
        if (notify.subscribed) {
          hints.push(notify.notifyWhileViewing ? tr('hint.foreground') : tr('hint.visible'));
          hints.push(tr('hint.closed'));
          hints.push(tr('hint.content'));
        } else if (notify.enabled && notify.permission === 'granted') {
          hints.push(tr('hint.fallback'));
        }

        const popover = () =>
          h(
            'div',
            {
              ref: popoverRef,
              tabIndex: -1,
              className: 'wpn-pop',
              role: 'dialog',
              'aria-label': tr('pop.title'),
              style: { left: `${geometry.left}px`, bottom: `${geometry.bottom}px` },
            },
            h(
              'div',
              { className: 'wpn-head' },
              h('span', { className: 'wpn-head-icon', 'aria-hidden': true }, h(BellIcon, { on: notify.enabled && notify.permission === 'granted' })),
              h(
                'span',
                { className: 'wpn-head-text' },
                h('div', { className: 'wpn-title' }, tr('pop.title')),
                h('div', { className: 'wpn-sub' }, tr('pop.subtitle')),
              ),
            ),
            h('div', { className: 'wpn-sep' }),
            h(
              'div',
              { className: `wpn-status ${status.tone}` },
              h('span', { className: 'dot', 'aria-hidden': true }),
              h('span', null, status.text),
            ),
            status.detail !== undefined ? h('div', { className: 'wpn-note' }, status.detail) : null,
            notify.hostError !== null ? h('div', { className: 'wpn-note err' }, notify.hostError) : null,
            actions.length > 0 ? h('div', { className: 'wpn-actions' }, actions) : null,
            notify.note !== null
              ? h('div', { className: `wpn-note callout ${notify.note.kind}` }, notify.note.text)
              : null,
            h('div', { className: 'wpn-sep' }),
            h(
              'label',
              { className: 'wpn-toggle' },
              h('input', {
                type: 'checkbox',
                checked: notify.notifyWhileViewing,
                onChange: (event) => {
                  void notify.setNotifyWhileViewing(event.target.checked);
                },
              }),
              h('span', null, tr('toggle.foreground')),
            ),
            hints.length > 0
              ? h(
                  'div',
                  { className: 'wpn-hints' },
                  hints.map((text, index) => h('div', { className: 'wpn-hint', key: index }, text)),
                )
              : null,
            notify.lastAck !== null && notify.lastAck.event !== 'received'
              ? h(
                  'div',
                  { className: 'wpn-last' },
                  notify.lastAck.event === 'error'
                    ? tr('last.error', { message: notify.lastAck.message || 'unknown' })
                    : tr(`last.${notify.lastAck.event}`),
                )
              : notify.lastAck !== null && notify.lastAck.event === 'received'
                ? h('div', { className: 'wpn-last' }, tr('last.received'))
                : notify.subscribed && notify.lastDelivery !== null
                  ? h(
                      'div',
                      { className: 'wpn-last' },
                      tr('last.delivery', {
                        delivered: notify.lastDelivery.delivered,
                        attempted: notify.lastDelivery.attempted,
                      }),
                    )
                  : null,
          );

        return open && anchor !== null ? ReactDOM.createPortal(popover(), document.body) : null;
      };
    }

    /** Bell glyph markup for the cloned native menu row. */
    function bellMarkup(on) {
      return '<svg viewBox="0 0 16 16" width="16" height="16" data-icon="web-push-notify-bell" aria-hidden="true" focusable="false">'
        + '<path d="M8 1.6a4.1 4.1 0 0 0-4.1 4.1v2.4L2.6 10.4a.55.55 0 0 0 .47.85h9.86a.55.55 0 0 0 .47-.85L12.1 8.1V5.7A4.1 4.1 0 0 0 8 1.6Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>'
        + '<path d="M6.4 13.1a1.7 1.7 0 0 0 3.2 0" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>'
        + (on ? '<circle cx="12.7" cy="3.3" r="2.3" fill="var(--dsw-alias-state-success-primary,#3fb950)"/>' : '')
        + '</svg>';
    }

    /**
     * Decorate the rendered sidebar account menu with one extra row.
     *
     * The account menu is a product-owned menu without a slot for extra rows,
     * so this follows its rendered DOM instead: it recognizes the menu by its
     * Settings and Feedback rows, clones the Settings row to inherit the exact
     * native item markup and styling, and swaps in the bell glyph and label.
     * The row exists only while a menu opening is rendered, and its click
     * closes that menu and asks the persistent settings layer to open above the
     * account trigger.
     *
     * @param tr - translate function bound to this namespace.
     * @returns disposer removing the observer and any injected rows.
     */
    function installMenuEntry(tr) {
      const MENU_SELECTOR = '[role="menu"]';
      const SETTINGS_ICON = 'use[href="#dsw-icon-settings-outline-medium"]';
      const FEEDBACK_ICON = 'use[href="#dsw-icon-paper-plane-outline-medium"]';
      const ENTRY_ATTR = 'data-web-push-notify-entry';

      const accountTrigger = () => document.querySelector('button[aria-label="账号菜单"]');
      const menuObservers = new Map();

      const decorate = (menu) => {
        if (!menu.isConnected) return;
        if (!menuObservers.has(menu)) {
          const watcher = new MutationObserver(() => decorate(menu));
          watcher.observe(menu, { childList: true, subtree: true });
          menuObservers.set(menu, watcher);
        }
        if (menu.querySelector(`[${ENTRY_ATTR}]`) !== null) return;
        const buttons = Array.from(menu.querySelectorAll('button[role="menuitem"]'));
        const settings = buttons.find((button) => button.querySelector(SETTINGS_ICON) !== null);
        const feedback = buttons.find((button) => button.querySelector(FEEDBACK_ICON) !== null);
        if (settings === undefined || feedback === undefined) return;
        const wrapper = settings.parentElement;
        if (wrapper === null || !menu.contains(wrapper)) return;
        const button = settings.cloneNode(true);
        const icon = button.querySelector('span[class*="itemIcon"]') ?? button.querySelector('span');
        const label = button.querySelector('span[class*="itemLabel"]') ?? button.lastElementChild;
        if (icon === null || label === null) return;

        const item = document.createElement('div');
        item.setAttribute(ENTRY_ATTR, '');
        item.className = wrapper.className;
        const on = readEnabled() && (typeof Notification === 'undefined' || Notification.permission === 'granted');
        icon.innerHTML = bellMarkup(on);
        label.textContent = tr('menu.item');
        button.setAttribute('aria-label', tr('menu.item'));
        button.setAttribute('title', tr('menu.item'));
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const anchor = accountTrigger();
          // The account Menu owns its open state; its trigger toggles it shut.
          if (anchor !== null) anchor.click();
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { anchor } }));
          }, 0);
        });
        item.appendChild(button);
        wrapper.after(item);
      };

      const scan = (root) => {
        if (!(root instanceof Element)) return;
        if (root.matches(MENU_SELECTOR)) decorate(root);
        for (const menu of root.querySelectorAll(MENU_SELECTOR)) decorate(menu);
      };
      const release = (root) => {
        if (!(root instanceof Element)) return;
        const menus = root.matches(MENU_SELECTOR) ? [root] : [];
        for (const menu of root.querySelectorAll(MENU_SELECTOR)) menus.push(menu);
        for (const menu of menus) {
          const watcher = menuObservers.get(menu);
          if (watcher === undefined) continue;
          watcher.disconnect();
          menuObservers.delete(menu);
        }
      };
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) scan(node);
          for (const node of record.removedNodes) release(node);
        }
      });
      // Menus portal directly onto <body>; watching body children keeps this
      // decorator off the chat stream's own mutation traffic.
      observer.observe(document.body, { childList: true });
      for (const menu of document.querySelectorAll(MENU_SELECTOR)) decorate(menu);
      return () => {
        observer.disconnect();
        for (const watcher of menuObservers.values()) watcher.disconnect();
        menuObservers.clear();
        for (const item of document.querySelectorAll(`[${ENTRY_ATTR}]`)) item.remove();
      };
    }

    return {
      inject: ['locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'web-push-notify: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/web-push-notify/popover.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/web-push-notify';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'web-push-notify: styles');

        const translate = ctx.locale.bind(NS);
        const tr = (key, vars) => interpolate(translate(key), vars);
        const currentLocale = () => ctx.locale.getLocale().active;

        /**
         * Open one Session in the main view once the workspace service and its
         * session list are ready. The Host notification carries the id; the
         * Service Worker posts it here, or puts it in the URL when it has to
         * open a new page.
         * @param sessionId - Session to reveal.
         * @param attempt - retry counter while the Client boots.
         */
        const openSession = (sessionId, attempt = 0) => {
          const workspace = ctx.get('uiWorkspace');
          if (workspace === undefined || typeof workspace.openSession !== 'function') {
            if (attempt < 24) window.setTimeout(() => openSession(sessionId, attempt + 1), 250);
            return;
          }
          try {
            workspace.openSession(sessionId);
          } catch {
            if (attempt < 24) window.setTimeout(() => openSession(sessionId, attempt + 1), 250);
          }
        };

        ctx.effect(() => {
          const params = new URL(window.location.href).searchParams;
          const requested = params.get('dshSession');
          if (requested !== null && requested !== '') {
            params.delete('dshSession');
            const query = params.toString();
            const next = `${window.location.pathname}${query === '' ? '' : `?${query}`}${window.location.hash}`;
            try {
              window.history.replaceState(null, '', next);
            } catch {
              // A read-only history still opens the session below.
            }
            window.setTimeout(() => openSession(requested), 350);
          }
          const onMessage = (event) => {
            const data = event.data;
            if (data === null || typeof data !== 'object' || data.type !== 'web-push-notify:open-session') return;
            if (typeof data.sessionId === 'string' && data.sessionId !== '') openSession(data.sessionId);
          };
          navigator.serviceWorker.addEventListener('message', onMessage);
          return () => navigator.serviceWorker.removeEventListener('message', onMessage);
        }, 'web-push-notify: open session');
        /**
         * The settings surface lives outside any slot: the account menu row is
         * injected into the product menu, and this layer is the popover that
         * row opens. Mounting it once keeps the notification hook alive across
         * menu openings and gives the row a stable open target.
         */
        ctx.effect(() => {
          const host = document.createElement('div');
          host.setAttribute('data-web-push-notify-layer', '');
          document.body.appendChild(host);
          const root = ReactDOM.createRoot(host);
          root.render(h(makeLayer(tr, currentLocale)));
          return () => {
            root.unmount();
            host.remove();
          };
        }, 'web-push-notify: settings layer');
        ctx.effect(() => installMenuEntry(tr), 'web-push-notify: account menu entry');
      },
    };
  },
});