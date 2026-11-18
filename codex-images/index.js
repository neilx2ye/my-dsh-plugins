/**
 * Host half of the Codex image gallery — project scope.
 *
 * Images belong to the Session's project, not to a global library:
 *
 * - the project directory (default `output/imagegen`) is scanned directly;
 * - generation runs `codex exec -C <project>` so Codex sees the project and
 *   writes the result into that project directory;
 * - prompt metadata is stored in a hidden index inside the same directory;
 * - the browser API and the `codex_image` tool both resolve the caller's
 *   project, so two Sessions never see each other's images.
 */

import { randomBytes } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runProcess, tailText } from './lib/exec.js';
import { ProjectImages, expandPath, extensionForMedia, isImageName, mediaTypeOf, slugify, sniffImageType } from './lib/project.js';
import { imageSizeFromBuffer, parseSizeText, sizeText, snapImageSize } from './lib/sizes.js';
import { CodexAppServer } from './lib/appserver.js';
import { PublicImageServer } from './lib/cdn.js';
import { SocksHttpBridge, isSocksProxy } from './lib/bridge.js';
import { DEFAULT_CODEX_HOME, callbackUrl, codexEnv, ensureCodexHome, expandHomePath, normalizeProxy, readAccount, readProvider, readStoredProxy, writeStoredProxy } from './lib/codex.js';

/** Services this bundle needs from the Web Host composition. */
export const inject = ['tools', 'connection', 'sessions', 'workingDirectory', 'subprocess'];

/** Browser route listing the current project's images. */
const LIST_PATH = '/api/codex-images/list';
/** Browser route streaming one project image. */
const FILE_PATH = '/api/codex-images/file';
/** Browser route running one project-scoped Codex CLI generation. */
const GENERATE_PATH = '/api/codex-images/generate';
/** Browser route copying one project image to another project path. */
const EXPORT_PATH = '/api/codex-images/export';
/** Browser route renaming one project image. */
const RENAME_PATH = '/api/codex-images/rename';
/** Browser route deleting one project image. */
const DELETE_PATH = '/api/codex-images/delete';
/** Browser route reading the isolated Codex account. */
const ACCOUNT_PATH = '/api/codex-images/account';
/** Browser route starting the isolated Codex OAuth login. */
const LOGIN_PATH = '/api/codex-images/account/login';
/** Browser route cancelling the pending login. */
const LOGIN_CANCEL_PATH = '/api/codex-images/account/cancel';
/** Browser route delivering a pasted OAuth callback to the local login server. */
const LOGIN_CALLBACK_PATH = '/api/codex-images/account/login/callback';
/** Browser route importing an auth.json from another device. */
const IMPORT_AUTH_PATH = '/api/codex-images/account/import';
/** Browser route saving or clearing the Codex network proxy. */
const PROXY_PATH = '/api/codex-images/account/proxy';
/** Browser route testing one proxy against the ChatGPT backend. */
const PROXY_TEST_PATH = '/api/codex-images/account/proxy/test';
/** Browser route uploading one reference image for generation. */
const REFERENCE_PATH = '/api/codex-images/reference';
/** Browser route listing the project's reference images. */
const REFERENCES_PATH = '/api/codex-images/references';
/** Browser route deleting one reference image. */
const REFERENCE_DELETE_PATH = '/api/codex-images/references/delete';
/** Browser route turning one gallery work into a reference image. */
const REFERENCE_FROM_WORK_PATH = '/api/codex-images/references/from-work';
/** Browser route reading and changing the public image server settings. */
const CDN_PATH = '/api/codex-images/cdn';

/** Default port of the public image server. */
const DEFAULT_CDN_PORT = 8787;
/** Browser route signing out of the isolated Codex account. */
const LOGOUT_PATH = '/api/codex-images/account/logout';

/** Wall-clock limit for one OAuth login attempt. */
const LOGIN_TIMEOUT_MS = 300_000;

/** Prompt length accepted by generation. */
const MAX_PROMPT_LENGTH = 4000;
/** Images returned by one `generate` tool call as inline previews. */
const MAX_TOOL_IMAGES = 3;
/** Captured CLI output ceiling. */
const MAX_CLI_BYTES = 512 * 1024;

/** Output schema for one image descriptor returned by the tool. */
const IMAGE_DESCRIPTOR = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    relPath: { type: 'string' },
    path: { type: 'string' },
    createdAt: { type: 'string' },
    bytes: { type: 'number' },
    prompt: { type: 'string' },
    size: { type: 'string' },
    mediaType: { type: 'string' },
    attachment: { type: 'object' },
  },
};

/**
 * Validate the Loader row's config with named-field failures.
 * @param raw - the row's `config` value.
 * @returns normalized settings.
 */
function readSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    projectDir:
      typeof source.projectDir === 'string' && source.projectDir.trim() !== ''
        ? source.projectDir.trim()
        : 'output/imagegen',
    codexHome:
      typeof source.codexHome === 'string' && source.codexHome.trim() !== ''
        ? expandHomePath(source.codexHome.trim())
        : expandHomePath(DEFAULT_CODEX_HOME),
    generate: source.generate !== false,
    codexBin: typeof source.codexBin === 'string' && source.codexBin.trim() !== '' ? source.codexBin.trim() : 'codex',
    generateTimeoutMs: positiveInteger(source.generateTimeoutMs, 300_000, 'generateTimeoutMs'),
    maxBytes: positiveInteger(source.maxBytes, 25 * 1024 * 1024, 'maxBytes'),
    sandbox: typeof source.sandbox === 'string' && source.sandbox.trim() !== '' ? source.sandbox.trim() : 'workspace-write',
    size: typeof source.size === 'string' && source.size.trim() !== '' ? source.size.trim() : '1024x1024',
    proxy: typeof source.proxy === 'string' ? source.proxy.trim() : '',
  };
}

/**
 * Read one positive integer config field.
 * @param value - raw value.
 * @param fallback - value used when absent.
 * @param field - field name for diagnostics.
 * @returns the accepted value.
 */
function positiveInteger(value, fallback, field) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`codex-images: config.${field} must be a positive integer`);
  }
  return value;
}

/**
 * Register the project scanner, browser routes, and the agent tool.
 * @param ctx - Host root Context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = readSettings(config);
  /** One scanner per project directory. */
  const stores = new Map();
  /** Active network proxy for every Codex process (empty = direct). */
  let activeProxy = readStoredProxy(settings.codexHome);
  if (activeProxy === '') {
    try {
      activeProxy = normalizeProxy(settings.proxy !== '' ? settings.proxy : process.env.CODEX_IMAGE_PROXY ?? '');
    } catch {
      activeProxy = '';
    }
  }
  /** Local HTTP bridge used when the configured proxy is SOCKS. */
  let bridge;
  /** SOCKS URL the current bridge forwards to. */
  let bridgeSocks = '';
  /** The proxy Codex actually receives (bridge URL for SOCKS, else the configured proxy). */
  let effectiveProxy = '';
  /** Public image server settings persisted in the isolated home. */
  const cdnFile = path.join(settings.codexHome, 'cdn.json');
  let cdnSettings = { enabled: false, port: DEFAULT_CDN_PORT, publicBaseUrl: '', tokens: {} };
  try {
    const parsed = JSON.parse(readFileSync(cdnFile, 'utf8'));
    if (parsed !== null && typeof parsed === 'object') {
      cdnSettings = {
        enabled: parsed.enabled === true,
        port: Number.isInteger(parsed.port) && parsed.port >= 1024 && parsed.port <= 65535 ? parsed.port : DEFAULT_CDN_PORT,
        publicBaseUrl: typeof parsed.publicBaseUrl === 'string' ? parsed.publicBaseUrl : '',
        tokens: parsed.tokens !== null && typeof parsed.tokens === 'object' ? parsed.tokens : {},
      };
    }
  } catch {}
  /** Token -> project mapping for the public image server. */
  const cdnTokens = new Map(
    Object.entries(cdnSettings.tokens).filter(([, value]) => value !== null && typeof value === 'object' && typeof value.cwd === 'string' && typeof value.dir === 'string'),
  );
  /** Running public image server, when enabled. */
  let cdnServer;

  /**
   * Detect non-internal IPv4 addresses and classify a likely public one.
   * @returns addresses plus public and LAN candidates.
   */
  function detectAddresses() {
    const addresses = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const item of list ?? []) {
        if (item.family === 'IPv4' && item.internal !== true) addresses.push({ name, address: item.address });
      }
    }
    const isPrivate = (ip) => /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
    return {
      addresses,
      publicIp: addresses.find((item) => !isPrivate(item.address))?.address ?? null,
      lanIp: addresses.find((item) => isPrivate(item.address))?.address ?? null,
    };
  }

  /** Persist the public image server settings. */
  async function saveCdnSettings() {
    await ensureCodexHome(settings.codexHome);
    const payload = JSON.stringify(cdnSettings, null, 2);
    const temporary = `${cdnFile}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temporary, payload, { mode: 0o600 });
    await fs.rename(temporary, cdnFile);
    try {
      await fs.chmod(cdnFile, 0o600);
    } catch {}
  }

  /**
   * Get or create the opaque public token for one project.
   * @param project - resolved project.
   * @returns the token.
   */
  async function projectCdnToken(project) {
    for (const [token, entry] of cdnTokens) {
      if (entry.cwd === project.cwd) {
        if (entry.dir !== project.dir) {
          cdnTokens.set(token, { cwd: project.cwd, dir: project.dir });
          cdnSettings.tokens = Object.fromEntries(cdnTokens);
          await saveCdnSettings();
        }
        return token;
      }
    }
    const token = randomBytes(16).toString('hex');
    cdnTokens.set(token, { cwd: project.cwd, dir: project.dir });
    cdnSettings.tokens = Object.fromEntries(cdnTokens);
    await saveCdnSettings();
    return token;
  }

  /** Start the public image server. */
  async function startCdn() {
    if (cdnServer !== undefined) return;
    await ensureCodexHome(settings.codexHome);
    const server = new PublicImageServer({
      port: cdnSettings.port,
      bind: '0.0.0.0',
      tokens: cdnTokens,
    });
    await server.start();
    cdnServer = server;
  }

  /** Stop the public image server. */
  function stopCdn() {
    if (cdnServer === undefined) return;
    cdnServer.stop();
    cdnServer = undefined;
  }

  /**
   * Describe the public image server for one project.
   * @param project - resolved project, when a Session is open.
   * @returns display and link facts.
   */
  async function cdnSnapshot(project) {
    if (cdnSettings.enabled && cdnServer === undefined) {
      try {
        await startCdn();
      } catch {}
    }
    const detected = detectAddresses();
    const host = detected.publicIp ?? detected.lanIp ?? '127.0.0.1';
    const baseUrl = (cdnSettings.publicBaseUrl.trim() !== '' ? cdnSettings.publicBaseUrl.trim() : `http://${host}:${cdnSettings.port}`).replace(/\/+$/, '');
    const token = project === undefined || !cdnSettings.enabled ? '' : await projectCdnToken(project);
    return {
      enabled: cdnSettings.enabled,
      running: cdnServer !== undefined,
      port: cdnSettings.port,
      baseUrl,
      autoBaseUrl: `http://${host}:${cdnSettings.port}`,
      publicBaseUrl: cdnSettings.publicBaseUrl,
      publicIp: detected.publicIp,
      lanIp: detected.lanIp,
      addresses: detected.addresses,
      token,
      urlBase: project === undefined || token === '' ? '' : `${baseUrl}/cdn/${token}`,
    };
  }

  /**
   * Apply public image server settings.
   * @param project - current project.
   * @param input - enabled, port, publicBaseUrl.
   * @returns refreshed snapshot.
   */
  async function setCdn(project, input) {
    const enabled = input.enabled === true;
    const port = Number.isInteger(input.port) && input.port >= 1024 && input.port <= 65535
      ? input.port
      : cdnSettings.port;
    const publicBaseUrl = typeof input.publicBaseUrl === 'string' ? input.publicBaseUrl.trim() : '';
    if (publicBaseUrl !== '') {
      let parsed;
      try {
        parsed = new URL(publicBaseUrl);
      } catch {
        throw new Error('public base URL must be a valid http(s) URL');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('public base URL must start with http:// or https://');
    }
    const previous = cdnSettings;
    cdnSettings = { ...cdnSettings, enabled: false, port, publicBaseUrl };
    try {
      stopCdn();
      if (enabled) await startCdn();
      cdnSettings.enabled = enabled;
      await saveCdnSettings();
      if (project !== undefined) await projectCdnToken(project);
    } catch (error) {
      cdnSettings = previous;
      try {
        if (previous.enabled) await startCdn();
      } catch {}
      throw error;
    }
    return cdnSnapshot(project);
  }

  /**
   * Ensure Codex has an HTTP proxy. A SOCKS proxy is bridged to loopback HTTP
   * because Codex's HTTP client does not complete requests over SOCKS.
   * @returns the effective proxy URL.
   */
  async function prepareProxy() {
    if (!isSocksProxy(activeProxy)) {
      if (bridge !== undefined) {
        bridge.stop();
        bridge = undefined;
      }
      bridgeSocks = '';
      effectiveProxy = activeProxy;
      return effectiveProxy;
    }
    if (bridge !== undefined && bridgeSocks === activeProxy && effectiveProxy !== '') return effectiveProxy;
    if (bridge !== undefined) {
      bridge.stop();
      bridge = undefined;
    }
    const candidate = new SocksHttpBridge(activeProxy);
    effectiveProxy = await candidate.start();
    bridge = candidate;
    bridgeSocks = activeProxy;
    return effectiveProxy;
  }
  /** One generation at a time; shared by the panel and the tool. */
  let generation;
  /** One managed app-server for account state and login. */
  let appServer;
  /** Last reported login state for the panel. */
  let loginPhase = { phase: 'idle', method: '', url: '', userCode: '', loginId: '', error: '', output: '', startedAt: 0 };
  /** Soft deadline for a pending login. */
  let loginTimer;

  /** Current login snapshot. */
  function loginSnapshot() {
    return {
      phase: loginPhase.phase,
      method: loginPhase.method,
      url: loginPhase.url,
      userCode: loginPhase.userCode,
      loginId: loginPhase.loginId,
      error: loginPhase.error,
      output: loginPhase.output,
      startedAt: loginPhase.startedAt,
    };
  }

  /**
   * Replace the login state and stop the soft timer outside an active login.
   * @param next - complete next state.
   */
  function setLoginPhase(next) {
    loginPhase = next;
    if (next.phase !== 'starting' && next.phase !== 'pending') {
      clearTimeout(loginTimer);
      loginTimer = undefined;
    }
  }

  /**
   * Handle app-server notifications.
   * @param method - notification method.
   * @param params - notification payload.
   */
  function handleNotification(method, params) {
    if (method !== 'account/login/completed') return;
    const success = params !== null && typeof params === 'object' && params.success === true;
    if (success) {
      rateLimitsCache = { at: 0, value: null };
      setLoginPhase({ ...loginPhase, phase: 'done', error: '' });
      return;
    }
    const reason = params !== null && typeof params === 'object' && typeof params.error === 'string' && params.error !== ''
      ? params.error
      : 'the login was not completed';
    setLoginPhase({ ...loginPhase, phase: 'error', error: reason });
  }

  /** Lazily create the app-server client. */
  function appServerClient() {
    if (appServer === undefined) {
      appServer = new CodexAppServer({
        subprocess: ctx.subprocess,
        argv: [settings.codexBin, 'app-server'],
        cwd: settings.codexHome,
        env: codexEnv(settings.codexHome, effectiveProxy),
        clientInfo: { name: 'dsh-codex-images', title: 'DSH Codex Images', version: '0.1.0' },
        onNotification: handleNotification,
      });
    }
    return appServer;
  }

  /**
   * Ensure the app-server is running.
   * @returns the started client.
   */
  async function ensureAppServer() {
    await ensureCodexHome(settings.codexHome);
    await prepareProxy();
    const client = appServerClient();
    try {
      await client.start();
    } catch (error) {
      client.stop();
      appServer = undefined;
      throw error;
    }
    return client;
  }

  /**
   * Resolve the current account, merging structured app-server data with the
   * display-safe fields decoded from the isolated auth file.
   * @returns account object or null.
   */
  async function currentAccount() {
    const [remote, raw] = await Promise.all([
      ensureAppServer()
        .then((client) => client.request('account/read', {}, 15_000))
        .catch(() => undefined),
      readAccount(settings.codexHome),
    ]);
    const account = remote !== undefined && remote.account !== null && typeof remote.account === 'object' ? remote.account : null;
    if (account === null) return raw.loggedIn ? raw : null;
    if (account.type === 'chatgpt') {
      return {
        loggedIn: true,
        mode: 'chatgpt',
        email: account.email ?? raw.email ?? null,
        name: raw.name,
        plan: account.planType ?? raw.plan ?? null,
        workspaceName: account.workspaceName ?? raw.workspaceName ?? null,
        accountId: raw.accountId,
        subscriptionUntil: raw.subscriptionUntil ?? null,
        subscriptionStart: raw.subscriptionStart ?? null,
        expiresAt: raw.expiresAt,
        apiKeyHint: null,
      };
    }
    if (account.type === 'apiKey') {
      return { loggedIn: true, mode: 'apiKey', email: null, name: null, plan: null, workspaceName: null, accountId: null, subscriptionUntil: null, subscriptionStart: null, expiresAt: null, apiKeyHint: raw.apiKeyHint };
    }
    return { loggedIn: true, mode: account.type, email: null, name: null, plan: null, workspaceName: null, accountId: null, subscriptionUntil: null, subscriptionStart: null, expiresAt: null, apiKeyHint: null };
  }

  /**
   * Start a device-code or browser login in the isolated app-server.
   * @param method - `device` or `browser`.
   * @returns the new login state.
   */
  async function startLogin(method = 'device') {
    if (loginPhase.phase === 'starting' || loginPhase.phase === 'pending') throw new Error('a Codex login is already pending');
    setLoginPhase({ phase: 'starting', method, url: '', userCode: '', loginId: '', error: '', output: '', startedAt: Date.now() });
    try {
      const client = await ensureAppServer();
      const result = method === 'browser'
        ? await client.request('account/login/start', { type: 'chatgpt' }, 30_000)
        : await client.request('account/login/start', { type: 'chatgptDeviceCode' }, 30_000);
      if (result !== null && typeof result === 'object' && result.type === 'chatgptDeviceCode') {
        setLoginPhase({
          phase: 'pending',
          method: 'device',
          url: result.verificationUrl,
          userCode: result.userCode,
          loginId: result.loginId,
          error: '',
          output: '',
          startedAt: loginPhase.startedAt,
        });
      } else if (result !== null && typeof result === 'object' && result.type === 'chatgpt') {
        setLoginPhase({
          phase: 'pending',
          method: 'browser',
          url: result.authUrl,
          userCode: '',
          loginId: result.loginId,
          error: '',
          output: '',
          startedAt: loginPhase.startedAt,
        });
      } else {
        throw new Error(`unsupported Codex login response: ${String(result?.type)}`);
      }
      loginTimer = setTimeout(() => {
        if (loginPhase.phase === 'pending') setLoginPhase({ ...loginPhase, phase: 'error', error: 'the login was not completed in time' });
      }, 10 * 60 * 1000);
      return loginSnapshot();
    } catch (error) {
      setLoginPhase({ ...loginPhase, phase: 'error', error: messageOf(error) });
      throw error;
    }
  }

  /**
   * Deliver a pasted browser callback to the app-server's local login server.
   * @param input - callback URL or its code/state query.
   * @returns the signed-in account.
   */
  async function completeLogin(input) {
    if (loginPhase.phase !== 'pending' || loginPhase.method !== 'browser') {
      throw new Error('no browser login is waiting; start the browser login again');
    }
    const target = callbackUrl(input);
    let response;
    try {
      response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new Error(`could not reach the local login server: ${messageOf(error)}`);
    }
    if (response.status >= 400) throw new Error(`the login server rejected the callback (HTTP ${response.status})`);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const account = await currentAccount();
      if (account !== null) {
        setLoginPhase({ ...loginPhase, phase: 'done', error: '' });
        return account;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('the callback was delivered, but no account was stored yet');
  }

  /** Stop the pending login and reset the panel state. */
  async function cancelLogin() {
    const loginId = loginPhase.loginId;
    const pending = loginPhase.phase === 'starting' || loginPhase.phase === 'pending';
    setLoginPhase({ phase: 'idle', method: '', url: '', userCode: '', loginId: '', error: '', output: '', startedAt: 0 });
    if (!pending || loginId === '') return;
    try {
      const client = appServerClient();
      await client.start();
      await client.request('account/login/cancel', { loginId }, 10_000);
    } catch {}
  }

  /**
   * Sign out of the isolated Codex account.
   * @returns readable result.
   */
  async function logoutAccount() {
    setLoginPhase({ phase: 'idle', method: '', url: '', userCode: '', loginId: '', error: '', output: '', startedAt: 0 });
    await prepareProxy();
    const client = await ensureAppServer();
    await client.request('account/logout', {}, 15_000);
    return { output: 'Signed out of the isolated Codex account.' };
  }

  /**
   * Write an auth.json supplied by the user into the isolated home and reset
   * the account cache. Only display-safe fields are returned.
   * @param content - auth.json text.
   * @returns the refreshed account snapshot.
   */
  async function importAuth(content) {
    if (typeof content !== 'string' || content.trim() === '') throw new Error('auth.json content is empty');
    if (Buffer.byteLength(content, 'utf8') > 256 * 1024) throw new Error('auth.json is larger than 256 KiB');
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('that file is not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('auth.json must contain a JSON object');
    const tokens = parsed.tokens;
    const hasOauth = tokens !== null && typeof tokens === 'object' && typeof tokens.access_token === 'string' && tokens.access_token !== '';
    const apiKey = typeof parsed.OPENAI_API_KEY === 'string'
      ? parsed.OPENAI_API_KEY
      : typeof parsed.openai_api_key === 'string'
        ? parsed.openai_api_key
        : '';
    if (!hasOauth && apiKey === '') throw new Error('auth.json has no ChatGPT tokens or OpenAI API key');
    await ensureCodexHome(settings.codexHome);
    const target = path.join(settings.codexHome, 'auth.json');
    const temporary = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temporary, content, { mode: 0o600 });
    await fs.rename(temporary, target);
    try {
      await fs.chmod(target, 0o600);
    } catch {}
    if (appServer !== undefined) {
      appServer.stop();
      appServer = undefined;
    }
    loginPhase = { phase: 'idle', method: '', url: '', userCode: '', loginId: '', error: '', output: '', startedAt: 0 };
    rateLimitsCache = { at: 0, value: null };
    try {
      const client = await ensureAppServer();
      await client.request('account/read', { refreshToken: true }, 20_000);
    } catch {}
    return accountSnapshot();
  }

  /**
   * Save or clear the proxy used by every Codex process.
   * @param input - proxy URL, or empty to clear.
   * @returns refreshed account snapshot.
   */
  async function setProxy(input) {
    const proxy = normalizeProxy(input);
    await writeStoredProxy(settings.codexHome, proxy);
    activeProxy = proxy;
    if (bridge !== undefined) {
      bridge.stop();
      bridge = undefined;
    }
    bridgeSocks = '';
    effectiveProxy = '';
    rateLimitsCache = { at: 0, value: null };
    if (appServer !== undefined) {
      appServer.stop();
      appServer = undefined;
    }
    loginPhase = { phase: 'idle', method: '', url: '', userCode: '', loginId: '', error: '', output: '', startedAt: 0 };
    try {
      await ensureAppServer();
    } catch {}
    return accountSnapshot();
  }

  /**
   * Test one proxy against the ChatGPT backend that Codex needs.
   * @param input - proxy URL; empty tests the active proxy.
   * @returns reachability facts.
   */
  async function testProxy(input) {
    const proxy = normalizeProxy(input === '' ? activeProxy : input);
    if (proxy === '') throw new Error('no proxy is configured');
    let target = proxy;
    let temporary;
    if (isSocksProxy(proxy)) {
      temporary = new SocksHttpBridge(proxy);
      try {
        target = await temporary.start();
      } catch (error) {
        throw new Error(`could not start the SOCKS bridge: ${messageOf(error)}`);
      }
    }
    let result;
    try {
      result = await runProcess({
        subprocess: ctx.subprocess,
        argv: ['curl', '-x', target, '-sS', '--max-time', '20', '-w', '\n%{http_code}', 'https://chatgpt.com/backend-api/codex/models'],
        cwd: settings.codexHome,
        env: codexEnv(settings.codexHome, ''),
        timeoutMs: 30_000,
        maxOutputBytes: 128 * 1024,
      });
    } finally {
      if (temporary !== undefined) temporary.stop();
    }
    const output = `${result.output}\n${result.stderr}`.trim();
    const lines = output.split('\n');
    const code = (lines.at(-1) ?? '').trim();
    const body = lines.slice(0, -1).join('\n');
    const blocked = /unable to load site|cloudflare|cf-ray/i.test(body);
    const ok = code === '200' || code === '401';
    let message;
    if (ok) message = `reachable (HTTP ${code})`;
    else if (blocked) message = `the proxy exit is still blocked (HTTP ${code})`;
    else if (result.timedOut) message = 'the proxy test timed out';
    else if (result.exitCode !== 0) message = `curl exited with code ${result.exitCode}`;
    else message = `unexpected HTTP ${code}`;
    return { ok, code, blocked, message, sample: body.slice(0, 300) };
  }

  /** Cached rate-limit snapshot, refreshed at most every five seconds. */
  let rateLimitsCache = { at: 0, value: null };

  /**
   * Read the account's rate-limit windows through the app-server.
   * @returns display-safe quota facts, or null when unavailable.
   */
  async function readRateLimits() {
    if (Date.now() - rateLimitsCache.at < 5000) return rateLimitsCache.value;
    const client = await ensureAppServer();
    const result = await client.request('account/rateLimits/read', {}, 15_000);
    const snapshot = result !== null && typeof result === 'object' ? result : {};
    const byId = snapshot.rateLimitsByLimitId;
    const base = snapshot.rateLimits !== null && typeof snapshot.rateLimits === 'object'
      ? snapshot.rateLimits
      : byId !== null && typeof byId === 'object' && byId.codex !== null && typeof byId.codex === 'object'
        ? byId.codex
        : null;
    const windowOf = (window) => {
      if (window === null || typeof window !== 'object') return null;
      return {
        usedPercent: typeof window.usedPercent === 'number' ? window.usedPercent : null,
        windowDurationMins: typeof window.windowDurationMins === 'number' ? window.windowDurationMins : null,
        resetsAt: typeof window.resetsAt === 'number' ? window.resetsAt : null,
      };
    };
    const credits = base !== null && base.credits !== null && typeof base.credits === 'object'
      ? {
          hasCredits: base.credits.hasCredits === true,
          unlimited: base.credits.unlimited === true,
          balance: typeof base.credits.balance === 'string' ? base.credits.balance : null,
        }
      : null;
    const summary = snapshot.rateLimitResetCredits;
    const value = {
      planType: base !== null && typeof base.planType === 'string' ? base.planType : null,
      primary: windowOf(base === null ? null : base.primary),
      secondary: windowOf(base === null ? null : base.secondary),
      credits,
      resetCredits: summary !== null && typeof summary === 'object' && typeof summary.availableCount === 'number' ? summary.availableCount : null,
      ordinaryUsageAllowed: typeof snapshot.ordinaryUsageAllowed === 'boolean' ? snapshot.ordinaryUsageAllowed : null,
    };
    rateLimitsCache = { at: Date.now(), value };
    return value;
  }

  /**
   * Snapshot the isolated account, provider, and pending login.
   * @returns display-safe account facts.
   */
  async function accountSnapshot() {
    await ensureCodexHome(settings.codexHome);
    const provider = await readProvider(settings.codexHome);
    let rateLimits = null;
    let rateLimitsError = null;
    try {
      rateLimits = await readRateLimits();
    } catch (error) {
      rateLimitsError = messageOf(error);
    }
    let account = null;
    try {
      account = await currentAccount();
    } catch {}
    return { codexHome: settings.codexHome, provider, account, rateLimits, login: loginSnapshot(), proxy: activeProxy, effectiveProxy, ...(rateLimitsError === null ? {} : { rateLimitsError }) };
  }

  /**
   * Resolve a Session's project directory and scanner.
   * @param session - live Session object.
   * @returns project facts, or undefined when the Session has no directory.
   */
  function projectOf(session) {
    if (session === undefined) return undefined;
    let cwd;
    try {
      cwd = ctx.workingDirectory.get(session);
    } catch {
      return undefined;
    }
    if (typeof cwd !== 'string' || cwd === '') return undefined;
    const dir = path.isAbsolute(settings.projectDir) || settings.projectDir.startsWith('~')
      ? expandPath(settings.projectDir)
      : path.resolve(cwd, settings.projectDir);
    const relative = path.relative(cwd, dir);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`codex-images: config.projectDir must resolve inside the project (${cwd}); got ${dir}`);
    }
    let store = stores.get(dir);
    if (store === undefined) {
      store = new ProjectImages(dir, cwd);
      stores.set(dir, store);
    }
    return { session, cwd, dir, store, relative: displayDir(cwd, dir) };
  }

  /**
   * Resolve a browser request's Session project.
   * @param sessionId - Session identity from the query or body.
   * @returns project facts, or undefined for an unknown Session.
   */
  function projectOfSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined;
    return projectOf(ctx.sessions.get(sessionId));
  }

  /**
   * Resolve the project of the Agent calling a tool.
   * @param exec - tool execution context.
   * @returns project facts, or undefined outside an Agent.
   */
  function projectOfAgent(exec) {
    return projectOf(exec.agent?.session);
  }

  /**
   * Express a directory relative to the project when it is inside it.
   * @param cwd - project root.
   * @param dir - image directory.
   * @returns a project-relative label, or the absolute path when outside.
   */
  function displayDir(cwd, dir) {
    const rel = path.relative(cwd, dir);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return dir;
    return rel.split(path.sep).join('/');
  }

  /**
   * Resolve the sandbox mode for one Session so a generated CLI run never
   * exceeds the authority the Session already holds.
   * @param session - Session object, when known.
   * @returns a Codex sandbox mode name.
   */
  function sandboxFor(session) {
    const policy = ctx.get('sandboxPolicy');
    if (policy === undefined || session === undefined) return settings.sandbox;
    try {
      const resolved = policy.resolve({ session });
      if (resolved !== null && typeof resolved === 'object' && ['read-only', 'workspace-write', 'danger-full-access'].includes(resolved.mode)) return resolved.mode;
    } catch {}
    return settings.sandbox;
  }

  /**
   * Project one image descriptor for the browser and the tool.
   * @param entry - scanner descriptor.
   * @returns a serializable descriptor with its project-relative and absolute paths.
   */
  function describe(entry) {
    return {
      id: entry.relPath,
      name: entry.name,
      relPath: entry.relPath,
      path: entry.path,
      createdAt: entry.createdAt,
      bytes: entry.bytes,
      prompt: entry.prompt ?? '',
      size: entry.size ?? '',
    };
  }

  /**
   * Save one project image into the durable attachment store so it renders inline.
   * @param found - image read result.
   * @param displayPath - path to report for the image.
   * @returns a descriptor carrying an attachment when the service is mounted.
   */
  async function withAttachment(found, displayPath) {
    const attachments = ctx.get('attachments');
    const descriptor = {
      id: found.entry.relPath,
      name: found.entry.name,
      relPath: found.entry.relPath,
      path: displayPath,
      createdAt: '',
      bytes: found.data.length,
      prompt: '',
      size: '',
    };
    if (attachments === undefined) return descriptor;
    const ref = await attachments.saveImage({
      data: found.data,
      mediaType: found.mediaType,
      name: found.entry.name,
    });
    return {
      ...descriptor,
      attachment: {
        attachmentId: String(ref.attachmentId),
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        ...(ref.name === undefined ? {} : { name: ref.name }),
      },
    };
  }

  /**
   * Build the model-facing content for one tool outcome.
   * @param text - summary text.
   * @param images - descriptors that may carry an attachment.
   * @returns text plus image blocks.
   */
  function contentFor(text, images) {
    const blocks = [{ type: 'text', text }];
    for (const image of images) {
      if (image.attachment !== undefined) blocks.push({ type: 'image', attachment: image.attachment });
    }
    return blocks;
  }

  /**
   * Compose the Codex CLI prompt that asks for exactly one project image.
   * @param prompt - the user's image request.
   * @param size - requested output size.
   * @param dir - project image directory the CLI should write into.
   * @returns the full prompt text.
   */
  function buildPrompt(prompt, size, dir, referenceCount = 0) {
    return [
      'Generate one image asset for the current project. Use your image generation capability (the imagegen skill) to make a genuinely model-generated image.',
      'Do not substitute code, SVG, HTML, canvas, PIL/Pillow, or a deterministic drawing; if no image generation tool is available, stop and say exactly that.',
      ...(referenceCount > 0
        ? [`${referenceCount} reference image(s) are attached as Image 1${referenceCount > 1 ? `..Image ${referenceCount}` : ''}. Use them for style, subject, or composition as the request describes; do not edit them.`]
        : []),
      'Save the final image file with a descriptive lowercase file name in this project directory:',
      `  ${dir}`,
      'Use .png, .jpg, .jpeg, or .webp. Write only that one image file (plus no other files) and do not modify the imagegen skill scripts.',
      `Requested size: ${size}. The saved file must be exactly ${size} pixels.`,
      'Reply with the project-relative path of the saved file.',
      '',
      `Image request: ${prompt}`,
    ].join('\n');
  }

  /**
   * Compose the Codex CLI prompt that asks for an edit of one project image.
   * @param prompt - the edit request.
   * @param size - requested output size.
   * @param dir - project image directory the CLI should write into.
   * @param sourceRel - project-relative path of the attached source image.
   * @returns the full prompt text.
   */
  function buildEditPrompt(prompt, size, dir, sourceRel, referenceCount = 0) {
    return [
      'Edit the image attached to this request and save the result as a new project image. Use your image generation capability (the imagegen skill).',
      'Do not substitute code, SVG, HTML, canvas, PIL/Pillow, or a deterministic drawing; if no image editing tool is available, stop and say exactly that.',
      `Source image: ${sourceRel} (attached as Image 1).`,
      ...(referenceCount > 0
        ? [`${referenceCount} additional reference image(s) follow Image 1, starting at Image 2. Use them only as references.`]
        : []),
      'Do not modify, overwrite, or delete the source image. Save a new image file with a descriptive lowercase file name in this project directory:',
      `  ${dir}`,
      'Use .png, .jpg, .jpeg, or .webp. Write only that one image file (plus no other files) and do not modify the imagegen skill scripts.',
      `Requested size: ${size}. The saved file must be exactly ${size} pixels; keep the source aspect ratio when no other ratio is requested.`,
      'Reply with the project-relative path of the saved file.',
      '',
      `Edit request: ${prompt}`,
    ].join('\n');
  }

  /**
   * Resolve one reference image path or project-relative image id.
   * @param value - absolute path or project-relative image id.
   * @param project - resolved project, when available.
   * @returns the absolute path and display name.
   */
  async function resolveReference(value, project) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error('reference paths must be non-empty strings');
    const raw = value.trim();
    let absolute;
    if (path.isAbsolute(raw)) {
      absolute = path.resolve(raw);
    } else {
      if (project === undefined) throw new Error('relative reference paths need an open Session project');
      const found = await project.store.read(raw);
      if (found === undefined) throw new Error(`reference "${raw}" is not in this project's image directory`);
      absolute = found.entry.path;
    }
    let media = isImageName(absolute) ? mediaTypeOf(absolute) : undefined;
    if (media === undefined) {
      const handle = await fs.open(absolute, 'r');
      try {
        const buffer = Buffer.alloc(16);
        const { bytesRead } = await handle.read(buffer, 0, 16, 0);
        media = sniffImageType(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    }
    if (media === undefined) throw new Error(`"${raw}" is not a PNG, JPEG, WebP, or GIF image`);
    const stat = await fs.stat(absolute);
    if (stat.size > settings.maxBytes) throw new Error(`"${raw}" exceeds the ${settings.maxBytes}-byte limit`);
    return { path: absolute, name: path.basename(absolute) };
  }

  /**
   * Copy one local image (for example a chat attachment's normalized copy) into
   * the project\'s reference library.
   * @param project - resolved project.
   * @param input - absolute path or project-relative image id.
   * @param name - optional preferred file name.
   * @returns the stored reference descriptor.
   */
  async function importReference(project, input, name) {
    if (typeof input !== 'string' || input.trim() === '') throw new Error('reference requires an image path');
    const raw = input.trim();
    let data;
    let originalName;
    if (path.isAbsolute(raw)) {
      try {
        data = await fs.readFile(raw);
      } catch {
        throw new Error(`"${raw}" could not be read`);
      }
      originalName = path.basename(raw);
    } else {
      const found = await project.store.read(raw);
      if (found === undefined) throw new Error(`"${raw}" is not in this project's image directory`);
      data = found.data;
      originalName = found.entry.name;
    }
    if (data.length > settings.maxBytes) throw new Error(`the image exceeds the ${settings.maxBytes}-byte limit`);
    const media = sniffImageType(data) ?? (isImageName(originalName) ? mediaTypeOf(originalName) : undefined);
    if (media === undefined) throw new Error('the file is not a PNG, JPEG, WebP, or GIF image');
    const extension = extensionForMedia(media);
    const requested = typeof name === 'string' && name.trim() !== '' ? name.trim() : originalName;
    const stem = slugify(path.basename(requested, path.extname(requested))) || 'reference';
    const directory = path.join(project.dir, '.references');
    await fs.mkdir(directory, { recursive: true });
    let file = `${Date.now()}-${stem}${extension}`;
    for (let attempt = 2; attempt < 100; attempt += 1) {
      try {
        await fs.access(path.join(directory, file));
        file = `${Date.now()}-${stem}-${attempt}${extension}`;
      } catch {
        break;
      }
    }
    const absolute = path.join(directory, file);
    await fs.writeFile(absolute, data, { mode: 0o644 });
    return {
      id: path.relative(project.cwd, absolute).split(path.sep).join('/'),
      name: file,
      path: absolute,
      bytes: data.length,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Copy one gallery work into the project\'s reference library.
   * @param project - resolved project.
   * @param id - project-relative work path.
   * @returns the stored reference descriptor.
   */
  async function referenceFromWork(project, id) {
    const found = await project.store.read(id);
    if (found === undefined) throw new Error('that work no longer exists');
    const directory = path.join(project.dir, '.references');
    await fs.mkdir(directory, { recursive: true });
    const extension = path.extname(found.entry.name).toLowerCase();
    const stem = path.basename(found.entry.name, extension).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'reference';
    let file = `${Date.now()}-${stem}${extension}`;
    for (let attempt = 2; attempt < 100; attempt += 1) {
      try {
        await fs.access(path.join(directory, file));
        file = `${Date.now()}-${stem}-${attempt}${extension}`;
      } catch {
        break;
      }
    }
    const absolute = path.join(directory, file);
    await fs.writeFile(absolute, found.data, { mode: 0o644 });
    return {
      id: path.relative(project.cwd, absolute).split(path.sep).join('/'),
      name: file,
      path: absolute,
      bytes: found.data.length,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * List the project's stored reference images.
   * @param project - resolved project.
   * @returns reference descriptors, newest first.
   */
  async function listReferences(project) {
    const directory = path.join(project.dir, '.references');
    let items;
    try {
      items = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const references = [];
    for (const item of items) {
      if (!item.isFile() || !isImageName(item.name)) continue;
      const absolute = path.join(directory, item.name);
      try {
        const stat = await fs.stat(absolute);
        references.push({
          id: path.relative(project.cwd, absolute).split(path.sep).join('/'),
          name: item.name,
          path: absolute,
          bytes: stat.size,
          createdAt: new Date(stat.mtimeMs).toISOString(),
        });
      } catch {}
    }
    return references.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /**
   * Delete one stored reference image.
   * @param project - resolved project.
   * @param id - project-relative reference path.
   */
  async function deleteReference(project, id) {
    const found = await project.store.read(id);
    if (found === undefined) throw new Error('that reference image no longer exists');
    const directory = path.join(project.dir, '.references');
    let realDirectory;
    try {
      realDirectory = await fs.realpath(directory);
    } catch {
      throw new Error('that reference image no longer exists');
    }
    if (path.dirname(found.entry.path) !== realDirectory) throw new Error('only reference images can be deleted here');
    await fs.unlink(found.entry.path);
  }

  /**
   * Run the local Codex CLI once inside the Session project and return the
   * images it wrote there.
   * @param options.prompt - image request.
   * @param options.size - requested size.
   * @param options.signal - caller cancellation.
   * @param options.session - calling Session, whose project is the scope.
   * @param options.source - existing project image to edit, when editing.
   * @returns changed descriptors and the readable CLI tail.
   */
  async function generateImage({ prompt, size, signal, session, source, references = [] }) {
    if (!settings.generate) {
      throw new Error('Codex CLI generation is disabled in this profile (codex-images config.generate=false). Put generated images into the project image directory and refresh the gallery instead.');
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error('prompt must be a non-empty string');
    if (prompt.length > MAX_PROMPT_LENGTH) throw new Error(`prompt must not exceed ${MAX_PROMPT_LENGTH} characters`);
    if (generation !== undefined) throw new Error('a Codex CLI generation is already running');
    const project = projectOf(session);
    if (project === undefined) throw new Error('Codex image generation needs an open Session with a project directory');
    // Editing keeps the source canvas by default: an omitted size must not
    // silently turn a banner into the configured square default.
    const sourceDimensions = source === undefined ? undefined : await readImageSizeFile(source.path);
    const requestedSize =
      typeof size === 'string' && size.trim() !== ''
        ? size.trim()
        : sourceDimensions === undefined
          ? settings.size
          : sizeText(sourceDimensions);
    const target = parseSizeText(requestedSize);
    const promptSize = target === undefined ? requestedSize : sizeText(snapImageSize(target.width, target.height));
    generation = (async () => {
      await prepareProxy();
      await project.store.ensure();
      await ensureCodexHome(settings.codexHome);
      const before = await project.store.snapshot();
      const sandbox = sandboxFor(session);
      const argv = [
        settings.codexBin,
        'exec',
        '--skip-git-repo-check',
        '--color',
        'never',
        '-s',
        sandbox,
        ...(sandbox === 'workspace-write' ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
        ...(source === undefined ? [] : ['-i', source.path]),
        ...references.flatMap((reference) => ['-i', reference.path]),
        '-C',
        project.cwd,
        source === undefined
          ? buildPrompt(prompt.trim(), promptSize, project.dir, references.length)
          : buildEditPrompt(prompt.trim(), promptSize, project.dir, source.relPath, references.length),
      ];
      const result = await runProcess({
        subprocess: ctx.subprocess,
        argv,
        cwd: project.cwd,
        env: codexEnv(settings.codexHome, effectiveProxy),
        timeoutMs: settings.generateTimeoutMs,
        maxOutputBytes: MAX_CLI_BYTES,
        signal,
      });
      const output = tailText(`${result.output}\n${result.stderr}`);
      const after = await project.store.snapshot();
      const changed = new Set();
      for (const [rel, signature] of after) {
        if (before.get(rel) !== signature) changed.add(rel);
      }
      const all = await project.store.list();
      const entries = all.filter((entry) => changed.has(entry.relPath));
      if (entries.length === 0) {
        const reason = result.timedOut
          ? `Codex CLI did not finish within ${Math.round(settings.generateTimeoutMs / 1000)}s`
          : result.exitCode !== 0 && result.exitCode !== null
            ? `Codex CLI exited with code ${result.exitCode}`
            : `Codex CLI finished without writing an image into ${project.relative}`;
        throw new Error(`${reason}. ${output !== '' ? `Codex output:\n${output}` : 'No output was produced.'}`);
      }
      const finalSize = target === undefined ? requestedSize : sizeText(target);
      const achieved = [];
      let resizeWarning = '';
      for (const entry of entries) {
        let dimensions = await readImageSizeFile(entry.path);
        if (
          target !== undefined &&
          dimensions !== undefined &&
          (dimensions.width !== target.width || dimensions.height !== target.height)
        ) {
          // Resizing a wildly different aspect ratio would visibly distort the
          // result, so only correct near-misses from the model's 16px grid.
          const ratioGap = Math.abs(dimensions.width / dimensions.height - target.width / target.height) / (target.width / target.height);
          if (ratioGap > 0.05) {
            resizeWarning += `Codex returned ${sizeText(dimensions)} instead of ${finalSize}; kept it as-is to avoid distorting the image. `;
          } else {
            const resized = await resizeImageTo(entry.path, target.width, target.height);
            if (resized) {
              dimensions = { width: target.width, height: target.height };
            } else {
              resizeWarning += `Could not scale ${entry.relPath} to ${finalSize}; it is ${sizeText(dimensions)}. `;
            }
          }
        }
        achieved.push({ ...entry, prompt: prompt.trim(), size: finalSize, width: dimensions?.width, height: dimensions?.height });
      }
      await project.store.record(achieved, {
        prompt: prompt.trim(),
        size: finalSize,
        createdAt: new Date().toISOString(),
      });
      return {
        project,
        entries: achieved,
        resizeWarning: resizeWarning.trim(),
        output,
      };
    })();
    try {
      return await generation;
    } finally {
      generation = undefined;
    }
  }

  /**
   * Read the pixel dimensions of one image file from its header bytes.
   * @param file - absolute image path.
   * @returns dimensions, or undefined when the header is unreadable.
   */
  async function readImageSizeFile(file) {
    let handle;
    try {
      handle = await fs.open(file, 'r');
      const buffer = Buffer.alloc(512 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return imageSizeFromBuffer(buffer.subarray(0, bytesRead));
    } catch {
      return undefined;
    } finally {
      if (handle !== undefined) await handle.close().catch(() => {});
    }
  }

  /**
   * Scale one image to exact pixel dimensions with the first available CLI tool.
   * The model only accepts sizes on a 16px grid, so an exact request such as
   * 1080x1440 is rendered at 1088x1440 and then scaled back here.
   * @param file - absolute image path.
   * @param width - target width in pixels.
   * @param height - target height in pixels.
   * @returns whether the file now has the requested dimensions.
   */
  async function resizeImageTo(file, width, height) {
    const directory = path.dirname(file);
    const temporary = path.join(directory, `.resize-${randomBytes(6).toString('hex')}.png`);
    const attempts = [
      ['magick', [file, '-resize', `${width}x${height}!`, temporary]],
      ['convert', [file, '-resize', `${width}x${height}!`, temporary]],
      ['sips', ['-z', String(height), String(width), file, '--out', temporary]],
    ];
    for (const [program, args] of attempts) {
      try {
        const result = await runProcess({
          subprocess: ctx.subprocess,
          argv: [program, ...args],
          cwd: directory,
          timeoutMs: 60_000,
          maxOutputBytes: 64 * 1024,
        });
        if (result.exitCode === 0) {
          await fs.rename(temporary, file);
          return true;
        }
      } catch {}
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return false;
  }

  /**
   * Copy one project image to another project-relative path.
   * @param project - resolved project.
   * @param id - source image relative path.
   * @param target - destination relative path.
   * @returns the written absolute and relative paths.
   */
  async function exportImage(project, id, target) {
    if (typeof id !== 'string' || id === '') throw new Error('id must be a non-empty string');
    const fallback = path.basename(id);
    const destination = typeof target === 'string' && target.trim() !== '' ? target.trim() : fallback;
    return project.store.copyTo(id, destination);
  }

  /**
   * Read an arbitrary image path for preview.
   * @param filePath - absolute path supplied by the model.
   * @returns a read result shaped like the project scanner's.
   */
  async function readExternalImage(filePath) {
    const absolute = path.resolve(filePath);
    if (!isImageName(absolute)) throw new Error(`"${filePath}" does not have a PNG, JPEG, WebP, or GIF extension`);
    const data = await fs.readFile(absolute);
    if (data.length > settings.maxBytes) throw new Error(`"${filePath}" exceeds the ${settings.maxBytes}-byte preview limit`);
    return {
      entry: { id: absolute, relPath: absolute, name: path.basename(absolute), path: absolute },
      data,
      mediaType: mediaTypeOf(absolute) ?? 'application/octet-stream',
    };
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LIST_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const project = projectOfSession(new URL(request.url).searchParams.get('sessionId') ?? '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          try {
            const images = await project.store.list();
            return Response.json({
              images: images.map((entry) => ({
                ...describe(entry),
                url: `/api/codex-images/file?id=${encodeURIComponent(entry.relPath)}`,
              })),
              project: project.cwd,
              directory: project.dir,
              relative: project.relative,
              generate: settings.generate,
            });
          } catch (error) {
            return failure(500, 'list-failed', messageOf(error));
          }
        },
      }),
    'codex-images: list route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: FILE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const url = new URL(request.url);
          const project = projectOfSession(url.searchParams.get('sessionId') ?? '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          const found = await project.store.read(url.searchParams.get('id') ?? '');
          if (found === undefined) return failure(404, 'image-not-found', 'this image is no longer in the project image directory');
          const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
          return new Response(found.data, {
            status: 200,
            headers: {
              'content-type': found.mediaType,
              'content-length': String(found.data.length),
              'content-disposition': `${disposition}; filename="${encodeURIComponent(found.entry.name)}"`,
              'cache-control': 'private, max-age=60',
            },
          });
        },
      }),
    'codex-images: file route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: GENERATE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          const project = projectOfSession(typeof body.sessionId === 'string' ? body.sessionId : '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          let source;
          if (typeof body.sourceId === 'string' && body.sourceId !== '') {
            const found = await project.store.read(body.sourceId);
            if (found === undefined) return failure(404, 'image-not-found', 'the source image is no longer in the project image directory');
            source = { path: found.entry.path, relPath: found.entry.relPath };
          }
          try {
            const references = [];
            if (Array.isArray(body.references)) {
              for (const value of body.references.slice(0, 4)) references.push(await resolveReference(value, project));
            }
            const outcome = await generateImage({
              prompt: body.prompt,
              size: typeof body.size === 'string' && body.size.trim() !== '' ? body.size.trim() : undefined,
              signal: request.signal,
              session: project.session,
              source,
              references,
            });
            return Response.json({
              images: outcome.entries.map((entry) => ({
                ...describe(entry),
                url: `/api/codex-images/file?id=${encodeURIComponent(entry.relPath)}`,
              })),
              project: outcome.project.cwd,
              relative: outcome.project.relative,
              output: outcome.output,
            });
          } catch (error) {
            return failure(502, 'generate-failed', messageOf(error));
          }
        },
      }),
    'codex-images: generate route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: EXPORT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          const project = projectOfSession(typeof body.sessionId === 'string' ? body.sessionId : '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          try {
            const target = await exportImage(project, body.id, body.target);
            return Response.json(target);
          } catch (error) {
            return failure(400, 'export-failed', messageOf(error));
          }
        },
      }),
    'codex-images: export route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: RENAME_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          const project = projectOfSession(typeof body.sessionId === 'string' ? body.sessionId : '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          try {
            const renamed = await project.store.rename(body.id, body.target);
            return Response.json(renamed);
          } catch (error) {
            return failure(400, 'rename-failed', messageOf(error));
          }
        },
      }),
    'codex-images: rename route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: DELETE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          const project = projectOfSession(typeof body.sessionId === 'string' ? body.sessionId : '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          try {
            const removed = await project.store.delete(body.id);
            return Response.json(removed);
          } catch (error) {
            return failure(400, 'delete-failed', messageOf(error));
          }
        },
      }),
    'codex-images: delete route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ACCOUNT_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => {
          try {
            return Response.json(await accountSnapshot());
          } catch (error) {
            return failure(500, 'account-failed', messageOf(error));
          }
        },
      }),
    'codex-images: account route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LOGIN_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let method = 'device';
          try {
            const body = await request.json();
            if (body !== null && typeof body === 'object' && body.method === 'browser') method = 'browser';
          } catch {}
          try {
            await startLogin(method);
            return Response.json(await accountSnapshot());
          } catch (error) {
            return failure(502, 'login-failed', messageOf(error));
          }
        },
      }),
    'codex-images: login route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LOGIN_CALLBACK_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          try {
            await completeLogin(body.url);
            return Response.json(await accountSnapshot());
          } catch (error) {
            return failure(400, 'callback-failed', messageOf(error));
          }
        },
      }),
    'codex-images: login callback route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: IMPORT_AUTH_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          try {
            return Response.json(await importAuth(body.content));
          } catch (error) {
            return failure(400, 'import-failed', messageOf(error));
          }
        },
      }),
    'codex-images: auth import route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: REFERENCE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          const project = projectOfSession(typeof body.sessionId === 'string' ? body.sessionId : '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : 'reference.png';
          let data = typeof body.data === 'string' ? body.data : '';
          if (data === '') return failure(400, 'invalid-data', 'reference data is empty');
          if (data.length > 12 * 1024 * 1024) return failure(413, 'reference-too-large', 'reference image is too large');
          const comma = data.indexOf(',');
          if (data.startsWith('data:') && comma >= 0) data = data.slice(comma + 1);
          let buffer;
          try {
            buffer = Buffer.from(data, 'base64');
          } catch {
            return failure(400, 'invalid-data', 'reference data is not base64');
          }
          if (buffer.length === 0) return failure(400, 'invalid-data', 'reference data is empty');
          if (buffer.length > 8 * 1024 * 1024) return failure(413, 'reference-too-large', 'reference image must be at most 8 MiB');
          const extension = path.extname(name).toLowerCase();
          if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) {
            return failure(400, 'invalid-type', 'reference must be a PNG, JPEG, WebP, or GIF image');
          }
          try {
            const directory = path.join(project.dir, '.references');
            await fs.mkdir(directory, { recursive: true });
            const stem = path.basename(name, extension).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'reference';
            const file = `${Date.now()}-${stem}${extension}`;
            const absolute = path.join(directory, file);
            await fs.writeFile(absolute, buffer, { mode: 0o644 });
            return Response.json({ path: path.relative(project.cwd, absolute).split(path.sep).join('/'), name: file });
          } catch (error) {
            return failure(500, 'reference-failed', messageOf(error));
          }
        },
      }),
    'codex-images: reference route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: REFERENCES_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const project = projectOfSession(new URL(request.url).searchParams.get('sessionId') ?? '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          try {
            return Response.json({ references: await listReferences(project) });
          } catch (error) {
            return failure(500, 'references-failed', messageOf(error));
          }
        },
      }),
    'codex-images: references route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: REFERENCE_DELETE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          const project = projectOfSession(typeof body.sessionId === 'string' ? body.sessionId : '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          try {
            await deleteReference(project, body.id);
            return Response.json({ deleted: body.id });
          } catch (error) {
            return failure(400, 'reference-delete-failed', messageOf(error));
          }
        },
      }),
    'codex-images: reference delete route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: REFERENCE_FROM_WORK_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          const project = projectOfSession(typeof body.sessionId === 'string' ? body.sessionId : '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          try {
            return Response.json({ reference: await referenceFromWork(project, body.id) });
          } catch (error) {
            return failure(400, 'reference-failed', messageOf(error));
          }
        },
      }),
    'codex-images: reference from work route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: PROXY_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          try {
            return Response.json(await setProxy(body.url ?? ''));
          } catch (error) {
            return failure(400, 'proxy-failed', messageOf(error));
          }
        },
      }),
    'codex-images: proxy route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: PROXY_TEST_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          try {
            return Response.json(await testProxy(typeof body.url === 'string' ? body.url : ''));
          } catch (error) {
            return failure(400, 'proxy-test-failed', messageOf(error));
          }
        },
      }),
    'codex-images: proxy test route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: CDN_PATH,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const url = new URL(request.url);
          if (request.method === 'GET') {
            const project = projectOfSession(url.searchParams.get('sessionId') ?? '');
            try {
              return Response.json(await cdnSnapshot(project));
            } catch (error) {
              return failure(500, 'cdn-failed', messageOf(error));
            }
          }
          let body;
          try {
            body = await request.json();
          } catch {
            return failure(400, 'invalid-body', 'request body must be JSON');
          }
          if (body === null || typeof body !== 'object') return failure(400, 'invalid-body', 'request body must be an object');
          const project = projectOfSession(typeof body.sessionId === 'string' ? body.sessionId : '');
          if (project === undefined) return failure(404, 'project-unavailable', 'this Session is not open or has no project directory');
          try {
            return Response.json(await setCdn(project, body));
          } catch (error) {
            return failure(400, 'cdn-failed', messageOf(error));
          }
        },
      }),
    'codex-images: cdn route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LOGIN_CANCEL_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          try {
            await cancelLogin();
            return Response.json(await accountSnapshot());
          } catch (error) {
            return failure(500, 'cancel-failed', messageOf(error));
          }
        },
      }),
    'codex-images: login cancel route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LOGOUT_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          try {
            const result = await logoutAccount();
            return Response.json({ ...(await accountSnapshot()), output: result.output });
          } catch (error) {
            return failure(500, 'logout-failed', messageOf(error));
          }
        },
      }),
    'codex-images: logout route',
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'codex_image',
        description:
          'Create and manage raster image assets for the CURRENT PROJECT with the local Codex CLI. Use this when the user asks for a picture, poster, icon, illustration, texture, mockup, or other bitmap asset, or when a task needs one, instead of substituting a hand-drawn SVG/canvas placeholder. Images are project-scoped in the project image directory (default output/imagegen); another project\'s images are never visible. Actions: "generate" creates one image (optionally with reference images); "edit" applies a change to an existing project image, keeps its pixel size unless size is given, and saves a new file (optionally with extra references); "reference" stores a local image such as a chat attachment into the project\'s reference library; "list" and "show" read the project\'s images; "rename" changes a file name or path; "export" copies an image to another project path; "delete" removes an image file and is destructive, so use it only when the user explicitly asks to delete; "account" reports the isolated Codex sign-in state without changing it.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'generate', 'edit', 'show', 'rename', 'export', 'delete', 'reference', 'account'],
              description: 'Operation to perform.',
            },
            prompt: {
              type: 'string',
              description: 'For generate/edit: the image request or edit instruction. Include subject, style, composition, and any exact text to render; for edit, state what must stay unchanged.',
            },
            id: {
              type: 'string',
              description: 'For show/edit/rename/export/delete: the project-relative image path from a previous list or generate result, such as output/imagegen/hero.png.',
            },
            path: {
              type: 'string',
              description: 'For show/reference: an absolute image path. For reference, this may be a chat attachment normalized copy path (no file extension is needed).',
            },
            target: {
              type: 'string',
              description: 'For export: destination path relative to the project root, such as public/images/hero.png (defaults to the image name at the project root). For rename: the new project-relative path inside the image directory, such as output/imagegen/hero-v2.png; an existing file is never overwritten.',
            },
            size: {
              type: 'string',
              description: 'For generate/edit: exact output size such as 2048x768, 1080x1440, or 1024x1024. When editing, defaults to the source image\'s pixel size, so a banner keeps its canvas; when generating, defaults to the configured size (1024x1024). Values off the model\'s 16px grid are rendered at the nearest legal size and scaled back to exactly what you asked for.',
            },
            name: {
              type: 'string',
              description: 'For reference: preferred file name; the extension follows the source image.',
            },
            count: {
              type: 'integer',
              description: 'For list: maximum images to return, from 1 to 100. Defaults to 20.',
            },
            images: {
              type: 'array',
              items: { type: 'string' },
              description: 'For generate/edit: reference images as absolute paths or project-relative image ids, at most 4. Image order is preserved for the prompt.',
            },
          },
          required: ['action'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              images: { type: 'array', items: IMAGE_DESCRIPTOR },
            },
            required: ['text'],
          },
          render: (_args, value) => contentFor(value.text, Array.isArray(value.images) ? value.images : []),
        },
        async execute(args, exec) {
          if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
          const project = projectOfAgent(exec);
          const action = args.action;
          if (action === 'reference') {
            if (project === undefined) throw new Error('codex_image requires an open Session with a project directory');
            if (typeof args.path !== 'string' || args.path.trim() === '') throw new Error('reference requires an image path');
            const saved = await importReference(project, args.path, args.name);
            const found = await project.store.read(saved.id);
            const preview = found === undefined ? undefined : await withAttachment(found, saved.path);
            return {
              text: `Reference saved: ${saved.id}\nAbsolute: ${saved.path}`,
              images: preview !== undefined && preview.attachment !== undefined ? [preview] : [],
            };
          }
          if (action === 'account') {
            const snapshot = await accountSnapshot();
            const account = snapshot.account;
            const signedIn = account !== null && account.loggedIn === true;
            const lines = [
              `Codex home: ${snapshot.codexHome}`,
              `Provider: ${snapshot.provider.provider}${snapshot.provider.model === null ? '' : ` · ${snapshot.provider.model}`}`,
              `Proxy: ${snapshot.proxy === '' ? 'direct' : String(snapshot.proxy).replace(/\/\/[^@/]*@/, '//***@')}`,
              signedIn
                ? `Signed in: ${account.email ?? account.apiKeyHint ?? 'yes'}${account.plan === null ? '' : ` (${account.plan})`}${account.accountId === null ? '' : ` — account ${account.accountId}`}`
                : 'Signed in: no',
              ...(snapshot.rateLimits === null ? [] : [
                `Quota: ${snapshot.rateLimits.primary === null ? 'n/a' : `${snapshot.rateLimits.primary.usedPercent}% used${snapshot.rateLimits.primary.resetsAt === null ? '' : `, resets ${new Date(snapshot.rateLimits.primary.resetsAt * 1000).toISOString()}`}`}${snapshot.rateLimits.secondary === null ? '' : ` | ${snapshot.rateLimits.secondary.usedPercent}% used${snapshot.rateLimits.secondary.resetsAt === null ? '' : `, resets ${new Date(snapshot.rateLimits.secondary.resetsAt * 1000).toISOString()}`}`}${snapshot.rateLimits.resetCredits === null ? '' : ` | ${snapshot.rateLimits.resetCredits} reset(s)`}`,
              ]),
              ...(typeof account.subscriptionUntil === 'string' && account.subscriptionUntil !== '' ? [`Plan expires: ${account.subscriptionUntil}`] : []),
              snapshot.login.phase === 'idle'
                ? 'Login: idle'
                : `Login: ${snapshot.login.phase}${snapshot.login.method === 'device' && snapshot.login.userCode !== '' ? ` — device code ${snapshot.login.userCode}` : ''}${snapshot.login.url === '' ? '' : ` — ${snapshot.login.url}`}`,
            ];
            if (!signedIn) lines.push('The user signs in from the Codex images panel; do not attempt authorization yourself.');
            return { text: lines.join('\n'), images: [] };
          }
          if (action === 'list') {
            if (project === undefined) throw new Error('codex_image requires an open Session with a project directory');
            const all = await project.store.list();
            const limit = Math.min(100, Math.max(1, Number.isInteger(args.count) ? args.count : 20));
            const entries = all.slice(0, limit);
            const lines = [
              `Project: ${project.cwd}`,
              `Project image directory: ${project.relative} (${project.dir})`,
              all.length === 0
                ? 'No images yet. Generate one with action "generate", or place images in the directory above.'
                : `${all.length} image(s), newest first (id is the project-relative path):`,
              ...entries.map((entry, index) => `${index + 1}. ${entry.relPath} — ${entry.createdAt} — ${entry.bytes} bytes${entry.prompt === '' ? '' : ` — prompt: ${entry.prompt.slice(0, 160)}`}`),
              all.length > entries.length ? `… ${all.length - entries.length} more image(s) not shown; pass a larger count to list them.` : null,
            ].filter((line) => line !== null);
            return { text: lines.join('\n'), images: [] };
          }
          if (action === 'generate' || action === 'edit') {
            if (typeof args.prompt !== 'string' || args.prompt.trim() === '') throw new Error(`${action} requires a non-empty prompt`);
            let source;
            if (action === 'edit') {
              if (project === undefined) throw new Error('codex_image requires an open Session with a project directory');
              if (typeof args.id !== 'string' || args.id === '') throw new Error('edit requires the project-relative id of the image to edit');
              const found = await project.store.read(args.id);
              if (found === undefined) throw new Error(`image "${args.id}" is not in this project's image directory`);
              source = { path: found.entry.path, relPath: found.entry.relPath };
            }
            const references = [];
            if (Array.isArray(args.images)) {
              for (const value of args.images.slice(0, 4)) references.push(await resolveReference(value, project));
            }
            const outcome = await generateImage({
              prompt: args.prompt,
              size: args.size,
              signal: exec.signal,
              session: exec.agent?.session,
              source,
              references,
            });
            const preview = outcome.entries.slice(0, MAX_TOOL_IMAGES);
            const images = [];
            for (const entry of preview) {
              const found = await outcome.project.store.read(entry.relPath);
              if (found !== undefined) images.push(await withAttachment(found, entry.path));
            }
            const verb = action === 'edit' ? 'Edited' : 'Generated';
            const lines = [
              `${verb} ${outcome.entries.length} image(s) in this project.`,
              ...outcome.entries.map((entry) =>
                `- ${entry.relPath} — ${entry.path}${entry.width === undefined ? '' : ` — ${entry.width}x${entry.height}`}`,
              ),
              outcome.resizeWarning === '' ? '' : `Size note: ${outcome.resizeWarning}`,
              outcome.output === '' ? '' : `Codex output (tail):\n${outcome.output}`,
            ].filter((line) => line !== '');
            return {
              text: lines.join('\n'),
              images: images.map((image) => ({
                ...image,
                prompt: args.prompt,
                createdAt: new Date().toISOString(),
              })),
            };
          }
          if (action === 'show') {
            let found;
            let displayPath = '';
            if (typeof args.id === 'string' && args.id !== '') {
              if (project === undefined) throw new Error('codex_image requires an open Session with a project directory');
              found = await project.store.read(args.id);
              if (found !== undefined) displayPath = found.entry.path;
            } else if (typeof args.path === 'string' && args.path !== '') {
              found = await readExternalImage(args.path);
              if (found !== undefined) displayPath = found.entry.path;
            }
            if (found === undefined) throw new Error('show requires an existing project image id or an absolute path');
            const saved = await withAttachment(found, displayPath);
            const dimensions = imageSizeFromBuffer(found.data.subarray(0, 512 * 1024));
            return {
              text: `Image: ${found.entry.name}\nPath: ${displayPath}\nPixels: ${dimensions === undefined ? 'unknown' : `${dimensions.width}x${dimensions.height}`}\nSize: ${found.data.length} bytes`,
              images: [saved],
            };
          }
          if (action === 'rename') {
            if (project === undefined) throw new Error('codex_image requires an open Session with a project directory');
            if (typeof args.id !== 'string' || args.id === '') throw new Error('rename requires the project-relative id of the image');
            if (typeof args.target !== 'string' || args.target.trim() === '') throw new Error('rename requires a new target path inside the image directory');
            const renamed = await project.store.rename(args.id, args.target);
            return { text: `Renamed ${args.id} to ${renamed.relPath}`, images: [] };
          }
          if (action === 'delete') {
            if (project === undefined) throw new Error('codex_image requires an open Session with a project directory');
            if (typeof args.id !== 'string' || args.id === '') throw new Error('delete requires the project-relative id of the image');
            const removed = await project.store.delete(args.id);
            return { text: `Deleted ${removed.relPath} (${removed.path})`, images: [] };
          }
          if (action === 'export') {
            if (project === undefined) throw new Error('codex_image requires an open Session with a project directory');
            if (typeof args.id !== 'string' || args.id === '') throw new Error('export requires a project-relative image id');
            const target = await exportImage(project, args.id, args.target);
            return { text: `Copied to ${target.relative} (${target.path})`, images: [] };
          }
          throw new Error(`unknown action "${String(action)}"; use list, generate, edit, show, rename, export, delete, or account`);
        },
      }),
    'codex-images: tool',
  );

  const promptService = ctx.get('systemPrompt');
  if (promptService !== undefined) {
    ctx.effect(
      () =>
        promptService.section({
          name: 'tool:codex-image',
          order: 2750,
          text: ({ scope }) =>
            ctx.tools.get('codex_image', scope) === undefined
              ? ''
              : 'Raster image assets: when a task needs a generated bitmap (photo, illustration, poster, texture, mockup), use codex_image to create it in the project; do not substitute a hand-drawn SVG/canvas placeholder. For vector icons that must match an existing asset set, edit the native asset instead.',
        }),
      'codex-images: prompt guidance',
    );
  }

  ctx.effect(
    () => () => {
      clearTimeout(loginTimer);
      if (appServer !== undefined) {
        appServer.stop();
        appServer = undefined;
      }
      if (bridge !== undefined) {
        bridge.stop();
        bridge = undefined;
      }
      stopCdn();
    },
    'codex-images: app-server lifecycle',
  );
}

/**
 * Build one JSON failure response.
 * @param status - HTTP status.
 * @param code - machine-readable code.
 * @param message - human-readable message.
 * @returns the response.
 */
function failure(status, code, message) {
  return Response.json({ code, message }, { status });
}

/**
 * Flatten an unknown thrown value into one line.
 * @param error - thrown value.
 * @returns its message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}