/**
 * Configuration schema and normalization for the MCP settings bundle.
 *
 * The plugin stores one `servers` list in its own Loader row. `Config` is a
 * minimal Standard Schema implementation understood by both Cordis and the
 * config editor, so profile writes are validated before they reach disk.
 */

/** DeepSeek function-name-safe server namespace, shared with the MCP bridge. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Default per-call timeout in milliseconds. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;

/** Lowest accepted per-call timeout in milliseconds. */
const MIN_TOOL_CALL_TIMEOUT_MS = 1_000;

/** Highest accepted per-call timeout in milliseconds. */
const MAX_TOOL_CALL_TIMEOUT_MS = 600_000;

/**
 * Convert one unknown value into a string mapping, ignoring unusable entries.
 * @param value - candidate mapping.
 * @returns a plain string dictionary.
 */
function stringDict(value) {
  const out = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
    else if (typeof entry === 'number' || typeof entry === 'boolean') out[key] = String(entry);
  }
  return out;
}

/**
 * Convert one unknown value into a string list.
 * @param value - candidate list.
 * @returns a plain string array.
 */
function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string' || typeof entry === 'number')
    .map((entry) => String(entry));
}

/**
 * Clamp a configured per-call timeout.
 * @param value - candidate timeout.
 * @returns a whole number of milliseconds inside the accepted range.
 */
function toolTimeout(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TOOL_CALL_TIMEOUT_MS;
  return Math.min(MAX_TOOL_CALL_TIMEOUT_MS, Math.max(MIN_TOOL_CALL_TIMEOUT_MS, Math.round(value)));
}

/**
 * Validate and normalize a complete `{ servers }` configuration.
 *
 * The returned value is the exact object persisted to the profile: unknown
 * keys and transport-irrelevant fields are dropped so the stored YAML stays
 * small and the runtime never reads a stale field.
 * @param input - raw candidate configuration.
 * @returns `{ value }` for a valid configuration, otherwise `{ issues }`.
 */
export function validateServers(input) {
  const issues = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { issues: [{ message: 'configuration must be an object' }] };
  }
  const raw = input.servers === undefined ? [] : input.servers;
  if (!Array.isArray(raw)) {
    return { issues: [{ message: 'servers must be a list', path: ['servers'] }] };
  }

  const servers = [];
  const keys = new Set();
  const names = new Set();

  raw.forEach((entry, index) => {
    const path = ['servers', index];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({ message: 'each server must be an object', path });
      return;
    }

    const transport = entry.transport === 'stdio' || entry.transport === 'streamable-http' ? entry.transport : null;
    if (transport === null) {
      issues.push({ message: 'transport must be "stdio" or "streamable-http"', path: [...path, 'transport'] });
      return;
    }

    const serverName = typeof entry.serverName === 'string' ? entry.serverName.trim() : '';
    if (!SERVER_NAME_PATTERN.test(serverName)) {
      issues.push({ message: 'server name must match [A-Za-z0-9_-]{1,32}', path: [...path, 'serverName'] });
    } else if (names.has(serverName)) {
      issues.push({ message: `server name "${serverName}" is used twice`, path: [...path, 'serverName'] });
    } else {
      names.add(serverName);
    }

    const key = typeof entry.key === 'string' && entry.key !== '' ? entry.key : serverName;
    if (keys.has(key)) {
      issues.push({ message: `server key "${key}" is used twice`, path: [...path, 'key'] });
    } else {
      keys.add(key);
    }

    const server = {
      key,
      serverName,
      transport,
      enabled: entry.enabled !== false,
      toolCallTimeoutMs: toolTimeout(entry.toolCallTimeoutMs),
    };

    if (transport === 'stdio') {
      const command = typeof entry.command === 'string' ? entry.command.trim() : '';
      if (command === '') {
        issues.push({ message: 'command is required for a stdio server', path: [...path, 'command'] });
      }
      server.command = command;
      server.args = stringArray(entry.args);
      server.env = stringDict(entry.env);
      server.cwd = typeof entry.cwd === 'string' ? entry.cwd : '';
    } else {
      const url = typeof entry.url === 'string' ? entry.url.trim() : '';
      let valid = false;
      try {
        const parsed = new URL(url);
        valid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        valid = false;
      }
      if (!valid) {
        issues.push({ message: 'url must be an http(s) URL', path: [...path, 'url'] });
      }
      server.url = url;
      server.headers = stringDict(entry.headers);
    }

    servers.push(server);
  });

  if (issues.length > 0) return { issues };
  return { value: { servers } };
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
      const result = validateServers(value);
      return result.issues === undefined ? { value: result.value } : { issues: result.issues };
    },
  },
  type: 'object',
  dict: {
    servers: {
      type: 'array',
      /** Marker kept for Loader diffing; this field is not volatile. */
      meta: {},
    },
  },
  meta: {},
};

/**
 * Format validation issues for a human-readable error message.
 * @param issues - Standard Schema issues.
 * @returns one semicolon-joined line.
 */
export function describeIssues(issues) {
  return issues
    .map((issue) => (Array.isArray(issue.path) && issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}