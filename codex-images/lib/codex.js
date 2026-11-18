/**
 * Isolated Codex environment for the image plugin.
 *
 * The plugin never reads or writes the user's `~/.codex` configuration. Every
 * Codex process it starts receives its own `CODEX_HOME` (default
 * `~/.dsh/codex-home`), with a stock OpenAI configuration and its own
 * `auth.json`. Signing in here therefore cannot change the terminal Codex
 * setup, and the terminal provider never leaks into image generation.
 */

import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Default isolated home, relative to the user's home directory. */
export const DEFAULT_CODEX_HOME = '~/.dsh/codex-home';

/**
 * Expand a leading `~` and resolve the result.
 * @param value - configured path.
 * @param base - base directory for a relative path.
 * @returns an absolute path.
 */
export function expandHomePath(value, base = process.cwd()) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('path must be a non-empty string');
  const trimmed = value.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(base, trimmed);
}

/**
 * Validate and normalize a proxy URL.
 * @param value - proxy URL such as `socks5h://127.0.0.1:1080`.
 * @returns the normalized URL, or an empty string when unset.
 */
export function normalizeProxy(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('proxy must be a URL such as socks5h://127.0.0.1:1080 or http://127.0.0.1:7890');
  }
  if (!['http:', 'https:', 'socks5:', 'socks5h:', 'socks4:', 'socks4a:'].includes(url.protocol)) {
    throw new Error(`unsupported proxy protocol "${url.protocol}"`);
  }
  if (url.hostname === '') throw new Error('proxy URL needs a host');
  return url.toString();
}

/**
 * Build the proxy environment for Codex. Loopback stays direct so the local
 * login server and app-server are never sent through the proxy.
 * @param proxy - normalized proxy URL.
 * @returns environment entries.
 */
export function proxyEnv(proxy) {
  if (typeof proxy !== 'string' || proxy === '') return {};
  const noProxy = 'localhost,127.0.0.1,::1';
  return {
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    ALL_PROXY: proxy,
    https_proxy: proxy,
    http_proxy: proxy,
    all_proxy: proxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

/**
 * The environment overrides every Codex process starts with.
 * @param codexHome - isolated home directory.
 * @param proxy - normalized proxy URL, or empty for a direct connection.
 * @returns explicit environment entries for the subprocess service.
 */
export function codexEnv(codexHome, proxy = '') {
  return { CODEX_HOME: codexHome, ...proxyEnv(proxy) };
}

/** Name of the proxy settings file inside the isolated home. */
export const PROXY_FILE = 'proxy.json';

/**
 * Read the stored proxy.
 * @param codexHome - isolated home directory.
 * @returns the normalized proxy, or empty.
 */
export function readStoredProxy(codexHome) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(codexHome, PROXY_FILE), 'utf8'));
    return normalizeProxy(parsed && typeof parsed === 'object' ? parsed.proxy : '');
  } catch {
    return '';
  }
}

/**
 * Persist the proxy for future plugin starts.
 * @param codexHome - isolated home directory.
 * @param proxy - normalized proxy, or empty to clear.
 */
export async function writeStoredProxy(codexHome, proxy) {
  await fs.mkdir(codexHome, { recursive: true });
  const target = path.join(codexHome, PROXY_FILE);
  if (proxy === '') {
    await fs.rm(target, { force: true });
    return;
  }
  const temporary = `${target}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ proxy }, null, 2), { mode: 0o600 });
  await fs.rename(temporary, target);
  try {
    await fs.chmod(target, 0o600);
  } catch {}
}

/**
 * Create the isolated home and a stock configuration when absent.
 * @param codexHome - isolated home directory.
 */
export async function ensureCodexHome(codexHome) {
  await fs.mkdir(codexHome, { recursive: true });
  const configPath = path.join(codexHome, 'config.toml');
  try {
    await fs.access(configPath);
  } catch {
    await fs.writeFile(configPath, defaultConfig(), 'utf8');
  }
}

/**
 * Stock configuration used only when the isolated home has no config.
 * @returns TOML text.
 */
function defaultConfig() {
  return [
    '# Isolated Codex home for the DSH Codex image plugin.',
    '# Kept separate from ~/.codex: signing in here never changes the terminal Codex setup.',
    'model_reasoning_effort = "medium"',
    'approvals_reviewer = "user"',
    '',
    `[projects."${os.homedir()}"]`,
    'trust_level = "trusted"',
    '',
  ].join('\n');
}

/**
 * Read the provider selection from the isolated config.
 * @param codexHome - isolated home directory.
 * @returns provider, model, and whether OpenAI auth is required.
 */
export async function readProvider(codexHome) {
  let text = '';
  try {
    text = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
  } catch {}
  const provider = text.match(/^\s*model_provider\s*=\s*"([^"]+)"/m)?.[1] ?? 'openai';
  const model = text.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  return { provider, model, requiresOpenaiAuth: provider === 'openai' };
}

/**
 * Decode a JWT payload without verifying it. Only used for display fields.
 * @param token - JWT string.
 * @returns the payload object, or undefined.
 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return undefined;
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    const body = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Read account information from the isolated auth file. Tokens are never
 * returned; only display-safe identity fields.
 * @param codexHome - isolated home directory.
 * @returns account snapshot.
 */
export async function readAccount(codexHome) {
  const authPath = path.join(codexHome, 'auth.json');
  let auth;
  try {
    auth = JSON.parse(await fs.readFile(authPath, 'utf8'));
  } catch {
    return { loggedIn: false, mode: 'none', email: null, name: null, plan: null, accountId: null, workspaceName: null, subscriptionUntil: null, subscriptionStart: null, expiresAt: null, apiKeyHint: null, authPath };
  }
  const tokens = auth !== null && typeof auth === 'object' && auth.tokens !== null && typeof auth.tokens === 'object' ? auth.tokens : {};
  const idClaims = decodeJwtPayload(tokens.id_token) ?? {};
  const accessClaims = decodeJwtPayload(tokens.access_token) ?? {};
  const authClaims = idClaims['https://api.openai.com/auth'] ?? accessClaims['https://api.openai.com/auth'] ?? {};
  const apiKey = typeof auth.OPENAI_API_KEY === 'string'
    ? auth.OPENAI_API_KEY
    : typeof auth.openai_api_key === 'string'
      ? auth.openai_api_key
      : null;
  const hasChatgpt = typeof tokens.access_token === 'string' && tokens.access_token !== '';
  const email = idClaims.email ?? authClaims.email ?? accessClaims.email ?? null;
  const name = idClaims.name ?? null;
  const plan = authClaims.chatgpt_plan_type ?? accessClaims.chatgpt_plan_type ?? null;
  const accountId = tokens.account_id ?? authClaims.chatgpt_account_id ?? accessClaims.chatgpt_account_id ?? null;
  const workspaceName = authClaims.chatgpt_workspace_name ?? accessClaims.chatgpt_workspace_name ?? null;
  const subscriptionUntil = authClaims.chatgpt_subscription_active_until ?? accessClaims.chatgpt_subscription_active_until ?? null;
  const subscriptionStart = authClaims.chatgpt_subscription_active_start ?? accessClaims.chatgpt_subscription_active_start ?? null;
  const expiresAt = typeof idClaims.exp === 'number' ? new Date(idClaims.exp * 1000).toISOString() : null;
  return {
    loggedIn: hasChatgpt || apiKey !== null,
    mode: hasChatgpt ? 'chatgpt' : apiKey !== null ? 'apiKey' : 'none',
    email: typeof email === 'string' ? email : null,
    name: typeof name === 'string' ? name : null,
    plan: typeof plan === 'string' ? plan : null,
    accountId: typeof accountId === 'string' ? accountId : null,
    workspaceName: typeof workspaceName === 'string' ? workspaceName : null,
    subscriptionUntil: typeof subscriptionUntil === 'string' ? subscriptionUntil : null,
    subscriptionStart: typeof subscriptionStart === 'string' ? subscriptionStart : null,
    expiresAt,
    apiKeyHint: apiKey !== null && apiKey.length > 4 ? `…${apiKey.slice(-4)}` : null,
    authPath,
  };
}

/**
 * Extract the first authorization URL from process output.
 * @param text - accumulated stdout/stderr.
 * @returns the URL without trailing punctuation.
 */
export function authUrlFrom(text) {
  const match = String(text).match(/https:\/\/[^\s"'<>]+/);
  if (match === null) return undefined;
  return match[0].replace(/[.,;)]+$/, '');
}
/**
 * Validate a pasted OAuth callback URL for the local Codex login server.
 * Only the loopback callback is accepted, so a pasted link cannot make the
 * Host fetch an arbitrary address.
 * @param input - full callback URL, or its `code=...&state=...` query string.
 * @returns the normalized loopback URL.
 */
export function callbackUrl(input) {
  const raw = String(input ?? '').trim();
  if (raw === '') throw new Error('paste the callback URL or its code/state query');
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://127.0.0.1:1455/auth/callback?${raw.replace(/^\?/, '')}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('that is not a valid URL');
  }
  if (url.protocol !== 'http:') throw new Error('the callback must use http://localhost');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('the callback must point at localhost');
  if (url.port !== '1455') throw new Error('the callback must use port 1455');
  if (url.pathname !== '/auth/callback') throw new Error('the callback path must be /auth/callback');
  if (url.searchParams.get('code') === null || url.searchParams.get('state') === null) throw new Error('the callback must include code and state');
  return url.toString();
}
