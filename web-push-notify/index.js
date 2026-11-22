/**
 * Host half of the task-completion Web Push bundle.
 *
 * A browser subscribes through the Push API with this plugin's VAPID key; the
 * subscription is stored under the Harness home. When a live Session's Agent
 * goes from running to idle, the Host encrypts a small JSON payload for every
 * stored subscription (RFC 8291 `aes128gcm`) and posts it to the browser push
 * service with a VAPID JWT (RFC 8292). The Service Worker served from `/sw.js`
 * turns that push into a system notification. Sessions whose header marks them
 * as subagents are ignored, and a page that is visible AND focused suppresses
 * the notification in the Service Worker rather than losing it in the Host.
 *
 * A second, page-local channel (`/api/web-push-notify/events`, SSE) lets a page
 * that could not obtain a push subscription still show the same notification
 * while it is hidden. Real Web Push stays the delivery path whenever a push
 * subscription exists, so notifications survive a closed tab.
 *
 * Everything runs on `node:crypto`; the plugin declares no third-party
 * dependency.
 */

import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package directory, used to read the Service Worker and icon assets. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Service Worker path; root scope is what makes it control the whole UI. */
const SW_PATH = '/sw.js';
/** Public icon used by notifications. */
const ICON_PATH = '/web-push-notify/icon.png';
/** Exact browser-admission Fetch route reporting subscription state. */
const STATE_PATH = '/api/web-push-notify/state';
/** Exact browser-admission Fetch route adding one push subscription. */
const SUBSCRIBE_PATH = '/api/web-push-notify/subscribe';
/** Exact browser-admission Fetch route removing one push subscription. */
const UNSUBSCRIBE_PATH = '/api/web-push-notify/unsubscribe';
/** Exact browser-admission Fetch route sending a forced test notification. */
const TEST_PATH = '/api/web-push-notify/test';
/** Exact browser-admission Fetch route receiving Service Worker display receipts. */
const ACK_PATH = '/api/web-push-notify/ack';
/** Owner-only SSE route for page-local fallback notifications. */
const EVENTS_PATH = '/api/web-push-notify/events';
/** How long a turn/end stays usable as proof of a completion after a reload. */
const TURN_END_GRACE_MS = 120_000;

/** Defaults for a row that supplies no config. */
const DEFAULTS = Object.freeze({
  subject: 'mailto:dsh@localhost',
});

/** Event listener contract required before the Host half can work. */
export const inject = ['webServer', 'connection'];

/**
 * Validate the row's config. Invalid values fail activation with a named field
 * instead of silently falling back.
 * @param raw - the Loader row's `config` value.
 * @returns normalized settings.
 */
function readSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const subject = source.subject ?? DEFAULTS.subject;
  if (typeof subject !== 'string' || !/^(mailto:|https:)/.test(subject)) {
    throw new Error('web-push-notify: config.subject must be a mailto: or https: URI');
  }
  return { subject };
}

/** Encode a string or buffer as unpadded base64url. */
function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

/**
 * Generate a stable VAPID P-256 key pair.
 * @returns the private JWK plus the uncompressed public key as base64url.
 */
function createVapid() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicRaw = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  return {
    v: 1,
    createdAt: Date.now(),
    privateJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d },
    publicKey: publicRaw.toString('base64url'),
  };
}

/**
 * Validate a VAPID record read from disk.
 * @param raw - parsed JSON, or undefined when the file does not exist.
 * @returns the record, or undefined when it is malformed.
 */
function validVapid(raw) {
  if (raw === null || typeof raw !== 'object' || raw.v !== 1) return undefined;
  const key = raw.privateJwk;
  if (key === null || typeof key !== 'object') return undefined;
  if (typeof key.x !== 'string' || typeof key.y !== 'string' || typeof key.d !== 'string') return undefined;
  if (typeof raw.publicKey !== 'string' || raw.publicKey === '') return undefined;
  return raw;
}

/**
 * Read JSON, treating a missing file as absent.
 * @param path - absolute file path.
 * @returns parsed JSON, or undefined.
 */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Replace a file atomically with private permissions.
 * @param path - destination path.
 * @param text - complete file contents.
 */
async function writePrivate(path, text) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, path);
}

/**
 * Format a turn duration for a notification body.
 * @param ms - elapsed milliseconds.
 * @param zh - whether the subscriber prefers Chinese.
 * @returns a short human duration.
 */
function formatDuration(ms, zh) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (zh) {
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`;
    const hours = Math.floor(minutes / 60);
    const left = minutes % 60;
    return left === 0 ? `${hours} 小时` : `${hours} 小时 ${left} 分`;
  }
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  const left = minutes % 60;
  return left === 0 ? `${hours}h` : `${hours}h ${left}m`;
}

/**
 * Describe one turn outcome in the subscriber's language.
 * @param reason - the `turn/end` reason, or undefined when none was seen.
 * @param zh - whether the subscriber prefers Chinese.
 * @returns notification glyph, title label, and body fragment.
 */
function describeOutcome(reason, zh) {
  const kind = reason?.kind ?? 'unknown';
  if (kind === 'error') {
    return zh
      ? { glyph: '❌', label: '任务出错', text: '结束时发生错误' }
      : { glyph: '❌', label: 'Task failed', text: 'the turn ended with an error' };
  }
  if (kind === 'aborted' || kind === 'interrupted') {
    return zh
      ? { glyph: '⏹', label: '任务已停止', text: '已被停止' }
      : { glyph: '⏹', label: 'Task stopped', text: 'the turn was stopped' };
  }
  if (kind === 'max-tokens') {
    return zh
      ? { glyph: '⚠️', label: '回复被截断', text: '达到输出上限' }
      : { glyph: '⚠️', label: 'Reply truncated', text: 'the output limit was reached' };
  }
  if (kind === 'completed') {
    return zh
      ? { glyph: '✅', label: '任务完成', text: '已完成' }
      : { glyph: '✅', label: 'Task complete', text: 'is complete' };
  }
  return zh
    ? { glyph: '✅', label: '任务结束', text: '已结束' }
    : { glyph: '✅', label: 'Task finished', text: 'has finished' };
}

/**
 * Collapse whitespace and clip one text fragment for a notification.
 * @param text - raw text.
 * @param max - maximum characters.
 */
function clip(text, max) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Concatenate the visible text blocks of one message.
 * @param message - user or assistant message.
 */
function messageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Read the last turn's prompt, result, tool usage, model, and token usage.
 * Only the newest events are scanned so a long Session does not cost a full log
 * walk on every completion.
 * @param session - the Session that just went idle.
 * @returns detailed notification facts, with absent fields omitted.
 */
function turnDetails(session) {
  const details = {};
  if (session === undefined || session === null) return details;
  let events;
  try {
    const from = Math.max(0, Number(session.seq) - 1000);
    events = session.snapshotEvents(from);
  } catch {
    return details;
  }
  let start = 0;
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type === 'turn/start') start = index;
  }
  const turn = events.slice(start);
  let steps = 0;
  let tools = 0;
  for (const event of turn) {
    if (event.type === 'user/message') {
      const text = messageText(event.data);
      if (text.trim() !== '') details.prompt = text;
    } else if (event.type === 'assistant/message') {
      const text = messageText(event.data?.message);
      if (text.trim() !== '') details.answer = text;
      const total = event.data?.usage?.totalTokens;
      if (typeof total === 'number' && total > 0) details.tokens = total;
    } else if (event.type === 'tool/call') {
      tools += 1;
    } else if (event.type === 'step/start') {
      steps += 1;
    } else if (event.type === 'request/header') {
      const model = event.data?.header?.config?.model;
      if (typeof model === 'string' && model !== '') details.model = model;
    }
  }
  if (steps > 0) details.steps = steps;
  if (tools > 0) details.tools = tools;
  const cwd = session.header?.cwd;
  if (typeof cwd === 'string' && cwd !== '') details.workspace = basename(cwd) || cwd;
  return details;
}

/**
 * Compact a token count for a notification fact line.
 * @param tokens - token count.
 */
function formatTokens(tokens) {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}

/**
 * Encrypt one payload for one `aes128gcm` push subscription (RFC 8291).
 * @param payload - JSON-serializable notification payload.
 * @param p256dh - subscriber public key, base64url.
 * @param authSecret - subscriber auth secret, base64url.
 * @returns the complete encrypted request body.
 */
function encryptPayload(payload, p256dh, authSecret) {
  const clientPublic = Buffer.from(p256dh, 'base64url');
  const auth = Buffer.from(authSecret, 'base64url');
  if (clientPublic.length !== 65 || clientPublic[0] !== 4) {
    throw new Error('invalid p256dh public key');
  }
  if (auth.length < 16) throw new Error('invalid auth secret');

  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientPublic);

  const authInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPublic, serverPublic]);
  const keyInfo = Buffer.from('Content-Encoding: aes128gcm\0');
  const nonceInfo = Buffer.from('Content-Encoding: nonce\0');
  const salt = randomBytes(16);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, authInfo, 32));
  const contentKey = Buffer.from(hkdfSync('sha256', ikm, salt, keyInfo, 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, nonceInfo, 12));

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const padded = Buffer.concat([plaintext, Buffer.from([2])]);
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  const keyLength = Buffer.from([serverPublic.length]);
  return Buffer.concat([salt, recordSize, keyLength, serverPublic, ciphertext]);
}

/**
 * Build one notification payload for a subscriber locale.
 * @param base - notification facts, including the mode and turn details.
 * @param locale - subscriber language tag, if known.
 * @returns the exact JSON payload.
 */
function payloadFor(base, locale) {
  const zh = typeof locale !== 'string' || locale === '' || locale.toLowerCase().startsWith('zh');
  const outcome = describeOutcome(base.reason, zh);
  const test = base.test === true;
  const rawTitle = base.title === undefined || base.title === '' ? (zh ? '当前会话' : 'Current session') : base.title;
  const title = test
    ? (zh ? '🔔 测试 · 任务完成样式' : '🔔 Test · task-complete preview')
    : `${outcome.glyph} ${outcome.label}`;

  const lines = [];
  if (test) {
    lines.push(zh ? '会话：任务完成样式示例' : 'Session: task-complete sample');
    lines.push(zh ? '任务：分析本周广告数据并给出优化建议' : 'Task: analyze this week’s ad data');
    lines.push(zh ? '结果：已生成 5 条优化建议，预计降低 12% 成本' : 'Result: 5 recommendations, about 12% lower cost');
  } else {
    lines.push(`${zh ? '会话' : 'Session'}：${clip(rawTitle, 50)}`);
    const genericTitle = base.title === undefined || base.title === '' || base.title === '当前会话' || base.title === 'Current session';
    if (genericTitle && typeof base.prompt === 'string' && base.prompt.trim() !== '') {
      lines.push(`${zh ? '任务' : 'Task'}：${clip(base.prompt, 60)}`);
    }
    if (base.reason?.kind === 'error') {
      const detail = typeof base.reason?.error?.message === 'string' ? clip(base.reason.error.message, 90) : outcome.text;
      lines.push(`${zh ? '错误' : 'Error'}：${detail}`);
    } else if (base.reason?.kind === 'completed') {
      if (typeof base.answer === 'string' && base.answer.trim() !== '') {
        lines.push(`${zh ? '结果' : 'Result'}：${clip(base.answer, 90)}`);
      }
    } else {
      lines.push(`${zh ? '状态' : 'Status'}：${outcome.text}`);
    }
  }

  const facts = [];
  if (typeof base.durationMs === 'number' && base.durationMs > 0) {
    facts.push(zh ? `用时 ${formatDuration(base.durationMs, true)}` : formatDuration(base.durationMs, false));
  }
  if (typeof base.steps === 'number' && base.steps > 0) facts.push(zh ? `${base.steps} 步` : `${base.steps} steps`);
  if (typeof base.tools === 'number' && base.tools > 0) facts.push(zh ? `${base.tools} 次工具` : `${base.tools} tools`);
  if (typeof base.tokens === 'number' && base.tokens > 0) facts.push(`${formatTokens(base.tokens)} tokens`);
  if (facts.length > 0) lines.push(facts.join(' · '));

  const meta = [];
  if (typeof base.workspace === 'string' && base.workspace !== '') meta.push(base.workspace);
  if (typeof base.model === 'string' && base.model !== '') meta.push(clip(base.model, 32));
  if (meta.length > 0) lines.push(meta.join(' · '));

  return {
    title,
    body: lines.join('\n'),
    tag: test ? `dsh-test-${Date.now()}` : `dsh-${base.sessionId}-${Date.now()}`,
    sessionId: typeof base.sessionId === 'string' && base.sessionId !== '' ? base.sessionId : undefined,
    url: base.url,
    icon: base.icon,
    force: base.force === true,
    test,
    lang: zh ? 'zh-CN' : 'en',
    openLabel: zh ? '打开 DSH' : 'Open DSH',
    timestamp: Date.now(),
  };
}

/**
 * Compose the Host half.
 * @param ctx - plugin context carrying webServer and connection.
 * @param settings - validated {@link readSettings}.
 */
function createNotifier(ctx, settings) {
  const directory = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'web-push-notify');
  const vapidPath = join(directory, 'vapid.json');
  const subscriptionsPath = join(directory, 'subscriptions.json');

  /** endpoint -> stored subscription. */
  const subscriptions = new Map();
  /** Live SSE responses, each with its own locale. */
  const sseClients = new Set();
  /** sessionId -> turn start time while the Agent is running. */
  const running = new Map();
  /** sessionId -> last `turn/end` reason kind. */
  const turnEnds = new Map();
  /** Last push attempt summary, surfaced to the settings popover. */
  let lastDelivery = null;
  /** Last receipt reported by a Service Worker; proves what the browser did. */
  let lastAck = null;

  let vapid;
  let signingKey;
  let initError;
  let writeChain = Promise.resolve();
  let disposed = false;

  const logger = ctx.logger;

  /** Persist subscriptions in their current order. */
  function persistSubscriptions() {
    const snapshot = JSON.stringify([...subscriptions.values()], null, 2);
    writeChain = writeChain
      .then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writePrivate(subscriptionsPath, snapshot);
      })
      .catch((error) => {
        logger?.warn?.(`web-push-notify: cannot persist subscriptions: ${error?.message ?? error}`);
      });
    return writeChain;
  }

  /** Load or mint the VAPID identity and restore subscriptions. */
  async function initialize() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let record = validVapid(await readJson(vapidPath));
    if (record === undefined) {
      record = createVapid();
      await writePrivate(vapidPath, JSON.stringify(record, null, 2));
      logger?.info?.('web-push-notify: generated a VAPID identity');
    }
    vapid = record;
    signingKey = createPrivateKey({ key: record.privateJwk, format: 'jwk' });

    const stored = await readJson(subscriptionsPath);
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (entry === null || typeof entry !== 'object') continue;
        if (typeof entry.endpoint !== 'string' || entry.endpoint === '') continue;
        if (typeof entry.keys?.p256dh !== 'string' || typeof entry.keys?.auth !== 'string') continue;
        subscriptions.set(entry.endpoint, entry);
      }
    }
  }

  const ready = initialize().catch((error) => {
    initError = error;
    logger?.warn?.(`web-push-notify: initialization failed: ${error?.message ?? error}`);
  });

  /** Absolute origin of this Web GUI, when the carrier is listening. */
  function origin() {
    try {
      return ctx.webServer.getOrigin();
    } catch {
      try {
        return ctx.get('webApp')?.getAdvertisedUrl() ?? '';
      } catch {
        return '';
      }
    }
  }

  /** JSON body, bounded so a subscription cannot be used as a file upload. */
  async function body(request) {
    const text = await request.text();
    if (text.length > 64 * 1024) throw new Error('request body is too large');
    return text === '' ? undefined : JSON.parse(text);
  }

  /** Failure response with a client-readable message. */
  function fail(status, message) {
    return Response.json({ ok: false, message }, { status });
  }

  /**
   * Normalize one `PushSubscription.toJSON()` object.
   * @param input - parsed request body.
   * @param request - originating request, for the User-Agent.
   */
  function normalizeSubscription(input, request) {
    const candidate = input?.subscription ?? input;
    if (candidate === null || typeof candidate !== 'object') return undefined;
    const endpoint = candidate.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 2048) return undefined;
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      return undefined;
    }
    if (url.protocol !== 'https:') return undefined;
    const p256dh = candidate.keys?.p256dh;
    const auth = candidate.keys?.auth;
    if (typeof p256dh !== 'string' || typeof auth !== 'string') return undefined;
    if (Buffer.from(p256dh, 'base64url').length !== 65) return undefined;
    if (Buffer.from(auth, 'base64url').length < 16) return undefined;
    const locale = typeof input?.locale === 'string' ? input.locale.slice(0, 35) : 'zh';
    // Absent means the older default: notify even while the page is focused.
    const notifyWhileViewing = input?.notifyWhileViewing !== false;
    return {
      endpoint,
      keys: { p256dh, auth },
      expirationTime: typeof candidate.expirationTime === 'number' ? candidate.expirationTime : null,
      locale,
      notifyWhileViewing,
      ua: (request.headers.get('user-agent') ?? '').slice(0, 240),
      addedAt: Date.now(),
    };
  }

  /**
   * Build the VAPID Authorization header for one push endpoint.
   * @param endpoint - subscription endpoint URL.
   */
  function authorization(endpoint) {
    const audience = new URL(endpoint).origin;
    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64url(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: settings.subject,
      }),
    );
    const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
      key: signingKey,
      dsaEncoding: 'ieee-p1363',
    });
    return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
  }

  /**
   * Encrypt and post one payload to one subscription.
   * @param subscription - stored subscription.
   * @param payload - JSON notification payload.
   * @param ttl - seconds the push service may retain an undelivered message.
   * @returns delivery outcome; `gone` means the push service dropped it.
   */
  async function sendOne(subscription, payload, ttl) {
    let response;
    try {
      const encrypted = encryptPayload(payload, subscription.keys.p256dh, subscription.keys.auth);
      response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          authorization: authorization(subscription.endpoint),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: String(ttl),
          urgency: 'normal',
        },
        body: encrypted,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      return { ok: false, status: 0, message: error?.message ?? String(error) };
    }
    if (response.status >= 200 && response.status < 300) {
      await response.body?.cancel().catch(() => {});
      return { ok: true, status: response.status };
    }
    const detail = (await response.text().catch(() => '')).slice(0, 240);
    const gone = response.status === 404 || response.status === 410;
    return {
      ok: false,
      status: response.status,
      gone,
      message: detail === '' ? `HTTP ${response.status}` : `HTTP ${response.status}: ${detail}`,
    };
  }

  /**
   * Deliver one notification to every stored subscription and to live SSE
   * fallbacks.
   * @param base - session-independent notification facts.
   * @returns the summary shown by the settings popover.
   */
  async function deliver(base) {
    await ready;
    if (initError !== undefined) throw initError;
    if (vapid === undefined) throw new Error('VAPID identity is unavailable');

    const targets = [...subscriptions.values()];
    const ttl = base.test === true ? 0 : 3600;
    const results = await Promise.all(
      targets.map(async (subscription) => ({
        subscription,
        result: await sendOne(
          subscription,
          payloadFor(
            {
              ...base,
              // A subscriber that opted into foreground notifications asks the
              // Service Worker not to suppress the card while the page is focused.
              force: base.test === true || base.force === true || subscription.notifyWhileViewing !== false,
            },
            subscription.locale,
          ),
          ttl,
        ),
      })),
    );
    let pruned = 0;
    for (const { subscription, result } of results) {
      if (result.ok) {
        subscription.lastOkAt = Date.now();
        continue;
      }
      if (result.gone) {
        subscriptions.delete(subscription.endpoint);
        pruned += 1;
      }
    }
    if (pruned > 0) await persistSubscriptions();

    const delivered = results.filter((entry) => entry.result.ok).length;
    const failures = results.filter((entry) => !entry.result.ok);
    lastDelivery = {
      at: Date.now(),
      attempted: results.length,
      delivered,
      failed: failures.length,
      message: failures[0]?.result.message,
    };
    if (failures.length > 0) {
      logger?.warn?.(
        `web-push-notify: ${failures.length}/${results.length} push deliveries failed: ${failures[0]?.result.message}`,
      );
    }

    broadcast(base);
    return {
      ok: failures.length === 0,
      attempted: results.length,
      delivered,
      failed: failures.length,
      pruned,
      message: failures[0]?.result.message,
    };
  }

  /**
   * Send a page-local fallback frame to every SSE reader.
   * @param base - session-independent notification facts.
   */
  function broadcast(base) {
    for (const entry of sseClients) {
      try {
        entry.response.write(`data: ${JSON.stringify(payloadFor(base, entry.locale))}\n\n`);
      } catch {
        sseClients.delete(entry);
      }
    }
  }

  /**
   * Notify that one main Session finished a turn.
   * @param sessionId - the Session that went idle.
   * @param startedAt - when this process observed it running.
   */
  async function complete(sessionId, startedAt) {
    const sessions = ctx.get('sessions');
    const session = sessions?.get(sessionId);
    if (session?.header?.origin === 'subagent') {
      turnEnds.delete(String(sessionId));
      return;
    }

    let title;
    try {
      title = ctx.get('sessionTitle')?.get(session)?.title;
    } catch {
      title = undefined;
    }

    const reason = turnEnds.get(sessionId)?.reason ?? { kind: 'unknown' };
    let details = {};
    try {
      details = turnDetails(session);
    } catch {
      details = {};
    }
    const base = {
      sessionId: String(sessionId),
      title,
      reason,
      ...details,
      durationMs: Date.now() - startedAt,
      url: `${origin()}/`,
      icon: `${origin()}${ICON_PATH}`,
      force: false,
    };
    turnEnds.delete(sessionId);
    try {
      await deliver(base);
    } catch (error) {
      logger?.warn?.(`web-push-notify: completion delivery failed: ${error?.message ?? error}`);
    }
  }

  /** GET /api/web-push-notify/state */
  async function state(request) {
    await ready;
    if (initError !== undefined) return fail(500, `初始化失败：${initError?.message ?? initError}`);
    return Response.json({
      ok: true,
      publicKey: vapid.publicKey,
      subscriptions: subscriptions.size,
      lastDelivery,
      lastAck,
      subject: settings.subject,
    });
  }

  /** POST /api/web-push-notify/subscribe */
  async function subscribe(request) {
    await ready;
    if (initError !== undefined) return fail(500, '初始化失败');
    let parsed;
    try {
      parsed = await body(request);
    } catch (error) {
      return fail(400, `无法读取请求：${error?.message ?? error}`);
    }
    const subscription = normalizeSubscription(parsed, request);
    if (subscription === undefined) return fail(400, '无效的推送订阅');
    subscriptions.set(subscription.endpoint, subscription);
    await persistSubscriptions();
    logger?.info?.(`web-push-notify: subscribed ${subscription.endpoint.slice(0, 48)}…`);
    return Response.json({ ok: true, subscriptions: subscriptions.size });
  }

  /** POST /api/web-push-notify/unsubscribe */
  async function unsubscribe(request) {
    let parsed;
    try {
      parsed = await body(request);
    } catch (error) {
      return fail(400, `无法读取请求：${error?.message ?? error}`);
    }
    const endpoint = typeof parsed?.endpoint === 'string' ? parsed.endpoint : '';
    if (endpoint === '') return fail(400, '缺少 endpoint');
    const removed = subscriptions.delete(endpoint);
    if (removed) await persistSubscriptions();
    return Response.json({ ok: true, removed, subscriptions: subscriptions.size });
  }

  /** POST /api/web-push-notify/ack — a Service Worker display receipt. */
  async function ack(request) {
    let parsed;
    try {
      parsed = await body(request);
    } catch {
      return fail(400, '无效的回执');
    }
    const event = ['received', 'shown', 'suppressed', 'error'].includes(parsed?.event) ? parsed.event : 'unknown';
    lastAck = {
      at: Date.now(),
      event,
      tag: typeof parsed?.tag === 'string' ? parsed.tag.slice(0, 96) : '',
      sessionId: typeof parsed?.sessionId === 'string' ? parsed.sessionId.slice(0, 96) : '',
      message: typeof parsed?.message === 'string' ? parsed.message.slice(0, 240) : '',
    };
    return Response.json({ ok: true });
  }

  /** POST /api/web-push-notify/test */
  async function test(request) {
    const base = {
      sessionId: undefined,
      title: undefined,
      test: true,
      force: true,
      durationMs: 61_000,
      steps: 4,
      tools: 3,
      tokens: 12_300,
      workspace: 'default-workspace',
      model: 'deepseek-v4.1-flash-1017',
      url: `${origin()}/`,
      icon: `${origin()}${ICON_PATH}`,
    };
    try {
      const result = await deliver(base);
      return Response.json({ ok: true, ...result });
    } catch (error) {
      return fail(500, `测试推送失败：${error?.message ?? error}`);
    }
  }

  /** Register every route and event listener, with cleanup on unload. */
  function install() {
    const fetches = [
      [STATE_PATH, ['GET'], state],
      [SUBSCRIBE_PATH, ['POST'], subscribe],
      [UNSUBSCRIBE_PATH, ['POST'], unsubscribe],
      [TEST_PATH, ['POST'], test],
      [ACK_PATH, ['POST'], ack],
    ];
    for (const [path, methods, handler] of fetches) {
      ctx.effect(
        () =>
          ctx.connection.fetch.register({
            path,
            methods,
            requestBody: 'buffered',
            fetch: async (request) => handler(request),
          }),
        `web-push-notify: ${path}`,
      );
    }

    ctx.effect(() => {
      const dispose = ctx.webServer.register({
        kind: 'exact',
        path: SW_PATH,
        resource: async () => {
          const source = await readFile(join(HERE, 'sw.js'), 'utf8');
          return new Response(source, {
            status: 200,
            headers: {
              'content-type': 'text/javascript; charset=utf-8',
              'cache-control': 'no-cache',
              'service-worker-allowed': '/',
            },
          });
        },
      });
      return dispose;
    }, 'web-push-notify: service worker');

    ctx.effect(() => {
      const dispose = ctx.webServer.register({
        kind: 'exact',
        path: ICON_PATH,
        resource: async () => {
          const icon = await readFile(join(HERE, 'icon.png'));
          return new Response(icon, {
            status: 200,
            headers: { 'content-type': 'image/png', 'cache-control': 'max-age=3600' },
          });
        },
      });
      return dispose;
    }, 'web-push-notify: notification icon');

    ctx.effect(() => {
      const dispose = ctx.webServer.register({
        kind: 'exact',
        path: EVENTS_PATH,
        handler: (request, response) => {
          const rejection = ctx.connection.requestRejection({ headers: request.headers });
          if (rejection !== undefined) {
            response.writeHead(rejection);
            response.end();
            return;
          }
          if (request.method !== 'GET') {
            response.writeHead(405);
            response.end();
            return;
          }
          const locale = new URL(request.url ?? '/', 'http://localhost').searchParams.get('locale') ?? 'zh';
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });
          response.write(': connected\n\n');
          const entry = { response, locale };
          sseClients.add(entry);
          const ping = setInterval(() => {
            try {
              response.write(': ping\n\n');
            } catch {
              sseClients.delete(entry);
            }
          }, 25_000);
          ping.unref();
          const close = () => {
            clearInterval(ping);
            sseClients.delete(entry);
          };
          response.on('close', close);
          response.on('error', close);
        },
      });
      return () => {
        dispose();
        for (const entry of sseClients) {
          try {
            entry.response.end();
          } catch {
            // already closed
          }
        }
        sseClients.clear();
      };
    }, 'web-push-notify: fallback events');

    ctx.on('api-session/status', (sessionId, isRunning) => {
      const key = String(sessionId);
      if (isRunning) {
        running.set(key, Date.now());
        return;
      }
      const startedAt = running.get(key);
      running.delete(key);
      // A plugin reload or process restart during a running turn loses the
      // start timestamp. The turn/end event still reaches this process, so a
      // fresh one proves a main turn just finished; use it as the start so the
      // completion is not silently dropped.
      const ended = turnEnds.get(key);
      const justEnded = ended !== undefined && Date.now() - ended.at < TURN_END_GRACE_MS;
      if (startedAt === undefined && !justEnded) return;
      const since = startedAt ?? ended.at;
      void ready.then(() => {
        if (disposed) return;
        return complete(key, since);
      });
    });

    ctx.on('session/event', (session, event) => {
      if (event?.type !== 'turn/end') return;
      const at = typeof event.time === 'number' ? event.time : Date.now();
      turnEnds.set(String(session.id), { at, reason: event.data?.reason ?? { kind: 'unknown' } });
      if (turnEnds.size > 200) {
        const oldest = turnEnds.keys().next().value;
        if (oldest !== undefined) turnEnds.delete(oldest);
      }
    });

    ctx.on('session/disposed', (session) => {
      running.delete(String(session.id));
      turnEnds.delete(String(session.id));
    });

    ctx.effect(() => () => {
      disposed = true;
    }, 'web-push-notify: lifecycle');
  }

  return { install };
}

/**
 * Activate the bundle: one notifier owns the VAPID identity, subscriptions,
 * routes, and Session completion listeners.
 * @param ctx - plugin context.
 * @param config - Loader row config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config);
  const notifier = createNotifier(ctx, settings);
  notifier.install();
}