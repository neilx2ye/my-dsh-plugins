import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachFastMode } from './fast.js';

export const inject = ['connection', 'sessions', 'profileContext'];
export const FAST_MODE_PATH = '/api/codex-fast-mode';

const SDK = '@earendil-works/pi-ai';

// Resolve the adapter's own SDK copy, not a separately installed dependency.
export async function loadSdkModels(installAnchor) {
  const fromHost = createRequire(installAnchor);
  const fromAdapter = createRequire(fromHost.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json'));
  // This SDK only exposes ESM subpaths; require.resolve cannot select its import condition.
  for (const candidate of fromAdapter.resolve.paths(SDK) ?? []) {
    const pkgDir = join(candidate, SDK);
    let data;
    try {
      data = readFileSync(join(pkgDir, 'package.json'), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    const manifest = JSON.parse(data);
    const entry = manifest.exports?.['./models']?.import;
    if (manifest.name !== SDK || manifest.version !== '1.6.0' || entry !== './dist/models.js') {
      throw new Error('Codex Fast Mode requires the tested pi-ai 1.6.0 stream interface');
    }
    return import(pathToFileURL(resolve(pkgDir, entry)).href);
  }
  throw new Error('Cannot locate the installed Codex SDK');
}

export function createFastModeRoute(sessions, controller) {
  const json = (value, status = 200) => Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
  const failure = (status, code) => json({ code }, status);
  return {
    path: FAST_MODE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      // Exact connection routes are owner-only; do not accept cross-origin browser mutations.
      const site = request.headers.get('sec-fetch-site');
      if (site !== null && site !== 'same-origin') return failure(403, 'origin');
      const id = new URL(request.url).searchParams.get('sessionId');
      if (!id || id.length > 256) return failure(400, 'session-id');
      if (!sessions.get(id)) return failure(404, 'session-unavailable');
      if (request.method === 'POST') {
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          return failure(415, 'content-type');
        }
        const input = await request.json().catch(() => null);
        if (typeof input?.enabled !== 'boolean') return failure(400, 'enabled');
        request.signal.throwIfAborted();
        if (!sessions.get(id)) return failure(404, 'session-unavailable');
        controller.setEnabled(id, input.enabled);
      }
      return json(controller.statusOf(id));
    },
  };
}

export async function apply(ctx) {
  const { createModels } = await loadSdkModels(ctx.get('profileContext').installAnchor);
  const prototype = Object.getPrototypeOf(createModels());
  ctx.effect(function* () {
    const controller = attachFastMode(prototype);
    yield controller.dispose;
    yield ctx.connection.fetch.register(createFastModeRoute(ctx.sessions, controller));
  }, 'Codex Fast Mode');
}
