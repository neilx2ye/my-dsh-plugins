/**
 * Configuration schema and normalization for the Feishu bridge.
 *
 * One Loader row holds everything the Host needs: the Feishu app credentials,
 * the long-connection policy, and the directory and preset used for the
 * Sessions that chat with people in Feishu. Credentials may instead name a
 * process environment variable with `$NAME`, which is how a deployment keeps
 * the app secret out of the profile patch.
 */

/** Accepted Feishu domains. */
const DOMAINS = new Set(['feishu', 'lark']);
/** Accepted direct-message policies. */
const DM_MODES = new Set(['open', 'allowlist', 'disabled']);
/** Longest accepted working directory text. */
const MAX_PATH = 4096;
/** Longest accepted app secret text. */
const MAX_SECRET = 512;

/** Defaults used for a row that omits a field. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  appId: '',
  appSecret: '',
  domain: 'feishu',
  cwd: '',
  agentPreset: '',
  dmMode: 'open',
  dmAllowlist: [],
  groupAllowlist: [],
  requireMention: true,
  respondToMentionAll: false,
  streaming: true,
  markdown: true,
  replyInThread: false,
});

/**
 * Convert one unknown value into a clean string list.
 * @param value - candidate list.
 * @returns trimmed, de-duplicated strings.
 */
function stringList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' && typeof entry !== 'number') continue;
    const text = String(entry).trim();
    if (text === '' || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * Read a boolean with a default.
 * @param value - candidate.
 * @param fallback - default when the value is not a boolean.
 * @returns the boolean.
 */
function booleanOf(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Validate and normalize one complete configuration object.
 * @param input - raw Loader row configuration.
 * @returns `{ value }` for an accepted configuration, otherwise `{ issues }`.
 */
export function normalizeConfig(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { issues: [{ message: 'configuration must be an object' }] };
  }

  const issues = [];
  const appId = typeof input.appId === 'string' ? input.appId.trim() : '';
  if (appId !== '' && /\s/.test(appId)) {
    issues.push({ message: 'App ID must not contain whitespace', path: ['appId'] });
  }

  const appSecret = typeof input.appSecret === 'string' ? input.appSecret.trim() : '';
  if (appSecret.length > MAX_SECRET) {
    issues.push({ message: 'App secret is too long', path: ['appSecret'] });
  }

  const domain = typeof input.domain === 'string' ? input.domain.trim().toLowerCase() : DEFAULTS.domain;
  if (!DOMAINS.has(domain)) {
    issues.push({ message: 'domain must be "feishu" or "lark"', path: ['domain'] });
  }

  const cwd = typeof input.cwd === 'string' ? input.cwd.trim() : '';
  if (cwd.length > MAX_PATH) {
    issues.push({ message: 'Working directory is too long', path: ['cwd'] });
  }

  const agentPreset = typeof input.agentPreset === 'string' ? input.agentPreset.trim() : '';
  if (agentPreset !== '' && !/^[A-Za-z0-9._-]{1,64}$/.test(agentPreset)) {
    issues.push({ message: 'Preset id may contain only letters, digits, dot, underscore and hyphen', path: ['agentPreset'] });
  }

  const dmMode = typeof input.dmMode === 'string' ? input.dmMode.trim() : DEFAULTS.dmMode;
  if (!DM_MODES.has(dmMode)) {
    issues.push({ message: 'dmMode must be "open", "allowlist" or "disabled"', path: ['dmMode'] });
  }

  if (issues.length > 0) return { issues };

  return {
    value: {
      enabled: booleanOf(input.enabled, DEFAULTS.enabled),
      appId,
      appSecret,
      domain,
      cwd,
      agentPreset,
      dmMode,
      dmAllowlist: stringList(input.dmAllowlist),
      groupAllowlist: stringList(input.groupAllowlist),
      requireMention: booleanOf(input.requireMention, DEFAULTS.requireMention),
      respondToMentionAll: booleanOf(input.respondToMentionAll, DEFAULTS.respondToMentionAll),
      streaming: booleanOf(input.streaming, DEFAULTS.streaming),
      markdown: booleanOf(input.markdown, DEFAULTS.markdown),
      replyInThread: booleanOf(input.replyInThread, DEFAULTS.replyInThread),
    },
  };
}

/**
 * Resolve the app secret from the environment when the saved value is a
 * `$NAME` reference.
 * @param config - normalized configuration.
 * @param env - environment map, defaulting to `process.env`.
 * @returns the secret text, or an empty string.
 */
export function resolveAppSecret(config, env = process.env) {
  const stored = typeof config.appSecret === 'string' ? config.appSecret : '';
  if (!stored.startsWith('$')) return stored;
  const name = stored.slice(1).trim();
  if (name === '') return '';
  return typeof env[name] === 'string' ? env[name] : '';
}

/**
 * Describe whether the credentials are present.
 * @param config - normalized configuration.
 * @param env - environment map.
 * @returns true when both an App ID and a non-empty secret resolve.
 */
export function hasCredentials(config, env = process.env) {
  return typeof config.appId === 'string' && config.appId !== '' && resolveAppSecret(config, env) !== '';
}

/** Standard Schema surface shared by Cordis and the profile config editor. */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'schemastery',
    /**
     * Validate one raw Loader row configuration.
     * @param value - raw configuration from the profile patch.
     * @returns the normalized value or the validation issues.
     */
    validate(value) {
      const result = normalizeConfig(value);
      return result.issues === undefined ? { value: result.value } : { issues: result.issues };
    },
  },
  type: 'object',
  dict: {
    enabled: { type: 'boolean' },
    appId: { type: 'string' },
    appSecret: { type: 'string' },
    domain: { type: 'string' },
    cwd: { type: 'string' },
    agentPreset: { type: 'string' },
    dmMode: { type: 'string' },
    dmAllowlist: { type: 'array' },
    groupAllowlist: { type: 'array' },
    requireMention: { type: 'boolean' },
    respondToMentionAll: { type: 'boolean' },
    streaming: { type: 'boolean' },
    markdown: { type: 'boolean' },
    replyInThread: { type: 'boolean' },
  },
  meta: {},
};

/**
 * Format validation issues for a human-readable error message.
 * @param issues - Standard Schema issues.
 * @returns one semicolon-joined line.
 */
export function describeIssues(issues) {
  return issues.map((issue) => (Array.isArray(issue.path) && issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message)).join('; ');
}