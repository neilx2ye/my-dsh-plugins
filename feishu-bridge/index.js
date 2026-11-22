/**
 * Host half of the Feishu bridge bundle.
 *
 * The bundle's Loader row carries the Feishu app credentials and chat policy.
 * This half connects them to the Harness: the long-connection client receives
 * Feishu messages, one durable Session answers each chat, and a small Settings
 * section lets the user save credentials, test them, and watch the socket.
 *
 * Routes are owner-only connection routes; no endpoint is public. The bridge
 * itself opens an outbound WebSocket to Feishu, so the deployment needs no
 * inbound port, domain, or TLS certificate.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  Config,
  describeIssues,
  hasCredentials,
  normalizeConfig,
  resolveAppSecret,
} from './lib/config.js';
import { FeishuBridge, messageOf, probeCredentials } from './lib/bridge.js';

export { Config };

/** Services the bridge needs from the Host. */
export const inject = ['sessions', 'sessionController'];

/** Exact Fetch route returning bridge status and editable configuration. */
const STATE_PATH = '/api/feishu-bridge/state';
/** Exact Fetch route saving the plugin's own Loader row. */
const CONFIG_PATH = '/api/feishu-bridge/config';
/** Exact Fetch route testing an unsaved credential draft. */
const TEST_PATH = '/api/feishu-bridge/test';
/** Exact Fetch route reconnecting the live socket. */
const RECONNECT_PATH = '/api/feishu-bridge/reconnect';
/** Exact Fetch route forgetting one or every chat binding. */
const RESET_PATH = '/api/feishu-bridge/reset';

/** Loader-row fields the Settings page may write. */
const EDITABLE_FIELDS = new Set([
  'enabled',
  'appId',
  'appSecret',
  'domain',
  'cwd',
  'agentPreset',
  'dmMode',
  'dmAllowlist',
  'groupAllowlist',
  'requireMention',
  'respondToMentionAll',
  'streaming',
  'markdown',
  'replyInThread',
]);

/**
 * Resolve the plugin's profile-local data directory.
 * @param ctx - Host Context.
 * @returns an absolute directory.
 */
function resolveDataDir(ctx) {
  const profile = ctx.get('profileContext');
  if (profile !== undefined && typeof profile.dir === 'string' && profile.dir !== '') {
    return join(profile.dir, 'feishu-bridge');
  }
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'feishu-bridge');
}

/**
 * Load the Feishu SDK and probe one credential pair.
 * @param settings - normalized draft settings.
 * @param logger - Harness logger.
 * @returns the probe result.
 */
async function probe(settings, logger) {
  let sdk;
  try {
    sdk = await import('@larksuiteoapi/node-sdk');
  } catch (error) {
    const wrapped = new Error(`缺少依赖 @larksuiteoapi/node-sdk：${messageOf(error)}`);
    wrapped.code = 'dependency-missing';
    throw wrapped;
  }
  return await probeCredentials(sdk, settings, logger);
}

/**
 * Register the bridge and its owner routes.
 * @param ctx - Host root Context.
 * @param rawConfig - Loader row configuration, validated by {@link Config}.
 */
export function apply(ctx, rawConfig) {
  const parsed = normalizeConfig(rawConfig ?? {});
  if (parsed.issues !== undefined) throw new Error(`feishu-bridge: ${describeIssues(parsed.issues)}`);
  const settings = parsed.value;
  const dataDir = resolveDataDir(ctx);
  const logger = ctx.logger;
  const bridge = new FeishuBridge(ctx, settings, { dataDir, logger });

  void bridge.start().catch((error) => {
    logger?.error?.(`feishu-bridge: 启动失败: ${messageOf(error)}`);
  });
  ctx.effect(() => () => void bridge.stop(), 'feishu-bridge: long connection');

  const connection = ctx.get('connection');
  if (connection === undefined) return;

  const register = (path, methods, handler, label) =>
    ctx.effect(
      () =>
        connection.fetch.register({
          path,
          methods,
          requestBody: 'buffered',
          fetch: handler,
        }),
      `feishu-bridge: ${label} route`,
    );

  register(STATE_PATH, ['GET'], async () => json(statePayload(ctx, settings, bridge)), 'state');
  register(CONFIG_PATH, ['PUT'], async (request) => saveRoute(ctx, settings, request), 'config');
  register(TEST_PATH, ['POST'], async (request) => testRoute(settings, logger, request), 'test');
  register(RECONNECT_PATH, ['POST'], async () => reconnectRoute(bridge), 'reconnect');
  register(RESET_PATH, ['POST'], async (request) => resetRoute(bridge, request), 'reset');
}

/**
 * Build the public status payload.
 * @param ctx - Host Context.
 * @param settings - live normalized configuration.
 * @param bridge - running bridge.
 * @returns the payload.
 */
function statePayload(ctx, settings, bridge) {
  const secret = resolveAppSecret(settings);
  return {
    config: {
      enabled: settings.enabled,
      appId: settings.appId,
      appSecret: '',
      hasSecret: secret !== '',
      secretSource: settings.appSecret.startsWith('$') ? 'environment' : secret === '' ? 'none' : 'profile',
      domain: settings.domain,
      cwd: settings.cwd,
      agentPreset: settings.agentPreset,
      dmMode: settings.dmMode,
      dmAllowlist: settings.dmAllowlist,
      groupAllowlist: settings.groupAllowlist,
      requireMention: settings.requireMention,
      respondToMentionAll: settings.respondToMentionAll,
      streaming: settings.streaming,
      markdown: settings.markdown,
      replyInThread: settings.replyInThread,
    },
    editable: ctx.get('configEditor') !== undefined && ctx.fiber.entry !== undefined,
    configured: hasCredentials(settings),
    bridge: bridge.status(),
  };
}

/**
 * Save a new Loader row configuration.
 * @param ctx - Host Context.
 * @param settings - current configuration.
 * @param request - buffered PUT request.
 * @returns the response.
 */
async function saveRoute(ctx, settings, request) {
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return failure(400, 'invalid-body', messageOf(error));
  }
  const editor = ctx.get('configEditor');
  const entry = ctx.fiber.entry;
  if (editor === undefined || entry === undefined) {
    return failure(409, 'not-editable', '当前 profile 没有配置编辑器，无法保存飞书设置');
  }

  const patch = {};
  for (const [key, value] of Object.entries(body)) {
    if (EDITABLE_FIELDS.has(key)) patch[key] = value;
  }
  if (body.clearSecret === true) patch.appSecret = '';
  else if (patch.appSecret === undefined || patch.appSecret === '') delete patch.appSecret;

  const candidate = normalizeConfig({ ...settings, ...patch });
  if (candidate.issues !== undefined) return failure(400, 'invalid-config', describeIssues(candidate.issues));

  try {
    await editor.edit(entry, (current) => ({ ...current, ...patch }));
  } catch (error) {
    return failure(409, 'save-failed', messageOf(error));
  }
  return json({ ok: true, saved: Object.keys(patch) });
}

/**
 * Probe an unsaved credential draft.
 * @param settings - current configuration.
 * @param logger - Harness logger.
 * @param request - buffered POST request.
 * @returns the response.
 */
async function testRoute(settings, logger, request) {
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return failure(400, 'invalid-body', messageOf(error));
  }
  const candidate = normalizeConfig({
    ...settings,
    appId: typeof body.appId === 'string' ? body.appId : settings.appId,
    appSecret:
      typeof body.appSecret === 'string' && body.appSecret !== ''
        ? body.appSecret
        : settings.appSecret,
    domain: typeof body.domain === 'string' ? body.domain : settings.domain,
  });
  if (candidate.issues !== undefined) return failure(400, 'invalid-config', describeIssues(candidate.issues));
  if (!hasCredentials(candidate.value)) {
    return failure(400, 'missing-credentials', '请先填写 App ID 和 App Secret');
  }
  try {
    const result = await probe(candidate.value, logger);
    return json({ ok: true, ...result });
  } catch (error) {
    return failure(502, error?.code === 'dependency-missing' ? 'dependency-missing' : 'connect-failed', messageOf(error));
  }
}

/**
 * Reconnect the live channel.
 * @param bridge - running bridge.
 * @returns the response.
 */
async function reconnectRoute(bridge) {
  try {
    await bridge.restart();
    const status = bridge.status();
    if (status.connected) return json({ ok: true, bridge: status });
    return failure(502, 'connect-failed', status.lastError ?? '未能建立飞书长连接');
  } catch (error) {
    return failure(500, 'reconnect-failed', messageOf(error));
  }
}

/**
 * Forget one chat binding, or all of them.
 * @param bridge - running bridge.
 * @param request - buffered POST request.
 * @returns the response.
 */
async function resetRoute(bridge, request) {
  let body = {};
  try {
    body = await readJson(request);
  } catch {
    body = {};
  }
  const chatId = typeof body.chatId === 'string' && body.chatId !== '' ? body.chatId : undefined;
  const removed = bridge.store.remove(chatId);
  return json({ ok: true, removed });
}

/**
 * Parse one JSON body as an object.
 * @param request - buffered request.
 * @returns the parsed object.
 */
async function readJson(request) {
  const value = await request.json();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求体必须是 JSON 对象');
  }
  return value;
}

/**
 * Build one JSON response.
 * @param body - payload.
 * @param status - HTTP status.
 * @returns the response.
 */
function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Build one JSON failure.
 * @param status - HTTP status.
 * @param code - machine-readable code.
 * @param message - human-readable message.
 * @returns the response.
 */
function failure(status, code, message) {
  return json({ code, message }, status);
}