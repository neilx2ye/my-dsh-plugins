/**
 * Host half of the MCP settings bundle.
 *
 * Three owner-only routes back the Settings page: read the saved servers and
 * their live state, persist a new server list through the profile config
 * editor, and probe or reconnect one server. The actual MCP clients live in
 * `./lib/manager.js`; saving a list updates this plugin's own Loader row, so
 * the plugin restarts and rebuilds its connections from the new generation.
 */

import { McpManager, messageOf } from './lib/manager.js';
import { Config, describeIssues, validateServers } from './lib/config.js';

/** Services this bundle needs from the Web Host composition. */
export const inject = ['connection', 'tools'];

/** Exact Fetch route for reading and saving the server list. */
const SERVERS_PATH = '/api/mcp-settings/servers';
/** Exact Fetch route for a temporary connection probe. */
const TEST_PATH = '/api/mcp-settings/test';
/** Exact Fetch route for reconnecting live servers. */
const RECONNECT_PATH = '/api/mcp-settings/reconnect';

export { Config };

/**
 * Register the routes and start the saved server generation.
 * @param {object} ctx - Host root Context.
 * @param {{ servers?: unknown[] }} config - validated plugin configuration.
 */
export function apply(ctx, config) {
  const manager = new McpManager(ctx);
  const initial = Array.isArray(config?.servers) ? config.servers : [];
  void manager.applyServers(initial).catch((error) => {
    ctx.logger?.error?.(`mcp-settings: 初始连接失败: ${messageOf(error)}`);
  });

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SERVERS_PATH,
        methods: ['GET', 'PUT'],
        requestBody: 'buffered',
        fetch: (request) => serversRoute(ctx, manager, request),
      }),
    'mcp-settings: servers route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: TEST_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => testRoute(manager, request),
      }),
    'mcp-settings: test route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: RECONNECT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => reconnectRoute(manager, request),
      }),
    'mcp-settings: reconnect route',
  );

  ctx.effect(() => () => void manager.disposeAll(), 'mcp-settings: connections');
}

/**
 * Answer a server-list read or profile save.
 * @param {object} ctx - Host root Context.
 * @param {McpManager} manager - live server manager.
 * @param {Request} request - admitted owner Fetch request.
 * @returns {Promise<Response>} JSON payload or a structured failure.
 */
async function serversRoute(ctx, manager, request) {
  if (request.method === 'GET') {
    return json({ servers: manager.snapshot(), editable: ctx.get('configEditor') !== undefined });
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return failure(400, 'invalid-body', messageOf(error));
  }
  const result = validateServers({ servers: body.servers });
  if (result.issues !== undefined) {
    return failure(400, 'invalid-config', describeIssues(result.issues));
  }

  const editor = ctx.get('configEditor');
  const entry = ctx.fiber.entry;
  if (editor === undefined || entry === undefined) {
    return failure(409, 'not-editable', '当前 profile 没有配置编辑器，无法保存 MCP 服务器');
  }

  try {
    await editor.edit(entry, (current) => ({ ...current, servers: result.value.servers }));
  } catch (error) {
    return failure(409, 'save-failed', messageOf(error));
  }
  return json({ ok: true, servers: result.value.servers });
}

/**
 * Answer a temporary connection probe for one unsaved server draft.
 * @param {McpManager} manager - live server manager.
 * @param {Request} request - admitted owner Fetch request.
 * @returns {Promise<Response>} probe outcome.
 */
async function testRoute(manager, request) {
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return failure(400, 'invalid-body', messageOf(error));
  }
  const result = validateServers({ servers: [body.server] });
  if (result.issues !== undefined) {
    return failure(400, 'invalid-config', describeIssues(result.issues));
  }
  try {
    const outcome = await manager.test(result.value.servers[0]);
    return json(outcome);
  } catch (error) {
    return failure(500, 'test-failed', messageOf(error));
  }
}

/**
 * Answer a reconnect request for one server or the whole set.
 * @param {McpManager} manager - live server manager.
 * @param {Request} request - admitted owner Fetch request.
 * @returns {Promise<Response>} reconnect outcome.
 */
async function reconnectRoute(manager, request) {
  let body = {};
  try {
    body = await readJson(request);
  } catch {
    body = {};
  }
  try {
    const outcome = await manager.reconnect(typeof body.key === 'string' ? body.key : '');
    return json(outcome);
  } catch (error) {
    return failure(500, 'reconnect-failed', messageOf(error));
  }
}

/**
 * Parse one JSON request body.
 * @param {Request} request - buffered request.
 * @returns {Promise<Record<string, unknown>>} parsed object.
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
 * @param {object} body - JSON payload.
 * @param {number} [status=200] - HTTP status.
 * @returns {Response} the response.
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
 * Build one JSON failure response.
 * @param {number} status - HTTP status.
 * @param {string} code - machine-readable code.
 * @param {string} message - human-readable message.
 * @returns {Response} the failure response.
 */
function failure(status, code, message) {
  return json({ code, message }, status);
}