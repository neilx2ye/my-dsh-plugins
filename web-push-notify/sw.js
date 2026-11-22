/* Task-completion Service Worker.
 *
 * Registers itself at the origin root, receives `push` events from the browser
 * push service, and shows one system notification. The same worker accepts a
 * `notify` message from a controlled page: that is the page-local fallback used
 * when no push subscription could be obtained. A notification is suppressed
 * while a controlled window is visible AND focused, unless the payload asks to
 * force it (the "send test" action).
 */

const FALLBACK_TITLE = 'DSH · 任务完成';
const FALLBACK_BODY = '任务已完成';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Read a push payload, tolerating a non-JSON body.
 * @param event - the push event.
 * @returns notification fields.
 */
function readPayload(event) {
  if (event.data === null) return {};
  try {
    return event.data.json();
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

/**
 * Whether a controlled window is both visible and focused.
 *
 * A visible but unfocused page — another app in front, another browser window,
 * or the tab merely sitting in the background of its own window — must not
 * swallow the notification. Only the page the user is actually looking at and
 * typing in counts as "already showing the conversation".
 * @returns true when at least one page is visible and focused.
 */
async function hasFocusedWindow() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.some((client) => client.visibilityState === 'visible' && client.focused === true);
}

/**
 * Report one display receipt to the Host so the settings popover can say what
 * the browser actually did. Failures are ignored: a receipt is diagnostic.
 * @param event - received, shown, suppressed, or error.
 * @param payload - notification fields.
 * @param message - optional error detail.
 */
async function report(event, payload, message) {
  try {
    const body = JSON.stringify({
      event,
      tag: typeof payload.tag === 'string' ? payload.tag : '',
      sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : '',
      message: typeof message === 'string' ? message : '',
    });
    await fetch('/api/web-push-notify/ack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    // The popover simply keeps the previous receipt.
  }
}

/**
 * Close previous cards for the same task, so a fresh completion always alerts
 * instead of silently updating a card the operating system already showed.
 * Test cards collapse under `dsh-test`; real cards collapse per Session.
 * @param payload - notification fields.
 */
async function closeGroup(payload) {
  let group;
  if (payload.test === true || (typeof payload.tag === 'string' && payload.tag.startsWith('dsh-test'))) {
    group = 'dsh-test';
  } else if (typeof payload.sessionId === 'string' && payload.sessionId !== '') {
    group = `dsh-${payload.sessionId}`;
  }
  if (group === undefined) return;
  const existing = await self.registration.getNotifications();
  for (const notification of existing) {
    if (typeof notification.tag === 'string' && notification.tag.startsWith(group)) notification.close();
  }
}

/**
 * Show one notification unless a focused page already shows the conversation.
 * @param payload - notification fields from the Host.
 */
async function show(payload) {
  if (payload.force !== true && (await hasFocusedWindow())) {
    await report('suppressed', payload);
    return;
  }
  try {
    await closeGroup(payload);
    const options = {
      body: typeof payload.body === 'string' && payload.body !== '' ? payload.body : FALLBACK_BODY,
      tag: typeof payload.tag === 'string' && payload.tag !== '' ? payload.tag : 'dsh-task',
      data: {
        url: typeof payload.url === 'string' && payload.url !== '' ? payload.url : '/',
        ...(typeof payload.sessionId === 'string' && payload.sessionId !== '' ? { sessionId: payload.sessionId } : {}),
      },
      timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
      renotify: true,
      requireInteraction: false,
      silent: false,
    };
    if (typeof payload.icon === 'string' && payload.icon !== '') options.icon = payload.icon;
    if (typeof payload.lang === 'string' && payload.lang !== '') options.lang = payload.lang;
    if (typeof payload.openLabel === 'string' && payload.openLabel !== '') {
      options.actions = [{ action: 'open', title: payload.openLabel }];
    }
    await self.registration.showNotification(
      typeof payload.title === 'string' && payload.title !== '' ? payload.title : FALLBACK_TITLE,
      options,
    );
    await report('shown', payload);
  } catch (error) {
    await report('error', payload, error && typeof error.message === 'string' ? error.message : String(error));
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  event.waitUntil((async () => {
    await report('received', payload);
    await show(payload);
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === null || typeof data !== 'object' || data.type !== 'notify') return;
  const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
  event.waitUntil((async () => {
    await report('received', payload);
    await show(payload);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data && typeof event.notification.data === 'object' ? event.notification.data : {};
  const base = typeof data.url === 'string' && data.url !== '' ? data.url : '/';
  const sessionId = typeof data.sessionId === 'string' && data.sessionId !== '' ? data.sessionId : undefined;
  let target = base;
  if (sessionId !== undefined) {
    try {
      const url = new URL(base);
      url.searchParams.set('dshSession', sessionId);
      target = url.href;
    } catch {
      target = base;
    }
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (typeof client.focus !== 'function') continue;
      try {
        await client.focus();
      } catch {
        continue;
      }
      if (sessionId !== undefined && typeof client.postMessage === 'function') {
        client.postMessage({ type: 'web-push-notify:open-session', sessionId });
        return;
      }
      return;
    }
    if (self.clients.openWindow !== undefined) await self.clients.openWindow(target);
  })());
});