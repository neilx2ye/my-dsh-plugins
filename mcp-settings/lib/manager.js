/**
 * MCP connection manager for the MCP settings bundle.
 *
 * The bundle owns the browser-facing configuration UI and the runtime half of
 * the bridge: every saved server gets one SDK Client, its tool list is
 * registered into `ctx.tools`, and a short reconnect button rebuilds it. The
 * official `@deepseek-ai/dsh-mcp-client` package supplies the tool adapter
 * (`createMcpToolDefinition`) and the process-environment scrubbing used for
 * stdio transports; both are resolved from the DeepSeek Harness installation
 * because profile-installed bundles do not see the installation's modules
 * through ordinary Node resolution.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** DeepSeek function-name contract: at most 64 characters. */
const MAX_PUBLIC_NAME_LENGTH = 64;

/** Characters accepted by the DeepSeek function-name contract. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;

/**
 * Build the model-facing tool name for one server tool.
 *
 * The server namespace always prefixes the raw name. A lossy sanitization or
 * an over-long name appends a hash so two distinct identities never collapse.
 * @param serverName - configured server namespace.
 * @param rawName - tool name reported by the server.
 * @returns the public tool name.
 */
export function publicToolName(serverName, rawName) {
  const base = `mcp__${serverName}__${rawName}`;
  const sanitized = base.replace(INVALID_NAME_CHARS, '_');
  if (sanitized === base && sanitized.length <= MAX_PUBLIC_NAME_LENGTH) return sanitized;
  const hash = createHash('sha256').update(base).digest('hex').slice(0, 12);
  const prefix = sanitized.slice(0, MAX_PUBLIC_NAME_LENGTH - hash.length - 1);
  return `${prefix}_${hash}`;
}

/**
 * Render one thrown value as a bounded diagnostic.
 * @param error - thrown value.
 * @returns a single-line message.
 */
export function messageOf(error) {
  const message = error instanceof Error ? error.message : String(error);
  const single = message.replace(/\s+/g, ' ').trim();
  return single.length > 800 ? `${single.slice(0, 800)}…` : single;
}

/**
 * Resolve a `$NAME` indirection against the Harness process environment.
 * @param value - literal or `$ENV_NAME` value.
 * @returns the literal or the environment value; an absent variable becomes "".
 */
function resolveValue(value) {
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
  return match === null ? value : (process.env[match[1]] ?? '');
}

/**
 * Build the transport for one configured server.
 * @param deps - resolved SDK and bridge modules.
 * @param spec - normalized server configuration.
 * @returns a connected-ready MCP transport.
 */
function createTransport(deps, spec) {
  if (spec.transport === 'stdio') {
    const env = { ...deps.scrubbedParentEnv() };
    for (const [key, value] of Object.entries(spec.env ?? {})) env[key] = resolveValue(value);
    return new deps.StdioClientTransport({
      command: spec.command,
      args: spec.args ?? [],
      env,
      cwd: spec.cwd === '' ? undefined : spec.cwd,
    });
  }
  const headers = {};
  for (const [key, value] of Object.entries(spec.headers ?? {})) headers[key] = resolveValue(value);
  return new deps.StreamableHTTPClientTransport(new URL(spec.url), {
    requestInit: { headers },
  });
}

/**
 * One saved server plus its live connection state.
 */
export class McpManager {
  /**
   * @param ctx - the plugin Context; tool registrations and logs belong to it.
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.servers = [];
    this.runtimes = new Map();
    this.depsPromise = null;
    this.queue = Promise.resolve();
    this.signature = null;
    this.disposed = false;
  }

  /**
   * Resolve the MCP SDK and bridge modules from the Harness installation.
   * @returns the module table, cached after the first successful load.
   */
  loadDeps() {
    if (this.depsPromise !== null) return this.depsPromise;
    this.depsPromise = this.resolveDeps().catch((error) => {
      this.depsPromise = null;
      throw error;
    });
    return this.depsPromise;
  }

  /**
   * Resolve the module table from the profile's installation anchor.
   * @returns the module table.
   */
  async resolveDeps() {
    const profileContext = this.ctx.get('profileContext');
    const anchor = profileContext?.installAnchor;
    if (typeof anchor !== 'string' || anchor === '') {
      throw new Error('无法定位 DeepSeek Harness 安装目录（profileContext.installAnchor 缺失）');
    }
    const anchorRequire = createRequire(pathToFileURL(path.join(anchor, 'package.json')));
    const bridgeEntry = anchorRequire.resolve('@deepseek-ai/dsh-mcp-client');
    const bridgeRequire = createRequire(pathToFileURL(bridgeEntry));
    const url = (require, id) => pathToFileURL(require.resolve(id)).href;
    const [mcp, stdio, bridge, subprocess] = await Promise.all([
      import(url(anchorRequire, '@modelcontextprotocol/client')),
      import(url(anchorRequire, '@modelcontextprotocol/client/stdio')),
      import(pathToFileURL(bridgeEntry).href),
      import(url(bridgeRequire, '@deepseek-ai/dsh-subprocess')),
    ]);
    return {
      Client: mcp.Client,
      StreamableHTTPClientTransport: mcp.StreamableHTTPClientTransport,
      StdioClientTransport: stdio.StdioClientTransport,
      createMcpToolDefinition: bridge.createMcpToolDefinition,
      scrubbedParentEnv: subprocess.scrubbedParentEnv,
    };
  }

  /**
   * Replace the configured server set. Previous connections are closed before
   * the next generation starts; calls are serialized.
   * @param servers - normalized configurations.
   * @returns fulfillment after the old generation is closed.
   */
  applyServers(servers) {
    // Publish the saved list synchronously so a page that reloads right after
    // a profile save never sees an empty list while connections are rebuilt.
    this.servers = servers;
    const task = this.queue.then(() => this.reconcile(servers));
    this.queue = task.catch(() => {});
    return task;
  }

  /**
   * Reconcile one server generation.
   * @param servers - normalized configurations.
   * @returns fulfillment after reconciliation.
   */
  async reconcile(servers) {
    if (this.disposed) return;
    const signature = JSON.stringify(servers);
    if (signature === this.signature) return;
    this.signature = signature;
    this.servers = servers;

    const previous = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.all(previous.map((runtime) => this.stop(runtime)));

    for (const spec of servers) {
      if (spec.enabled === false) {
        this.runtimes.set(spec.key, {
          key: spec.key,
          spec,
          state: 'disabled',
          error: null,
          tools: [],
          disposers: [],
          client: null,
          transport: null,
          disposed: true,
          refreshTimer: null,
        });
        continue;
      }
      this.start(spec);
    }
  }

  /**
   * Start one server connection in the background.
   * @param spec - normalized configuration.
   * @returns the runtime record.
   */
  start(spec) {
    const runtime = {
      key: spec.key,
      spec,
      state: 'connecting',
      error: null,
      tools: [],
      disposers: [],
      client: null,
      transport: null,
      disposed: false,
      refreshTimer: null,
    };
    this.runtimes.set(spec.key, runtime);
    void this.connect(runtime).catch((error) => {
      if (runtime.disposed) return;
      runtime.state = 'error';
      runtime.error = messageOf(error);
      this.ctx.logger?.error?.(`mcp-settings(${spec.serverName}): ${runtime.error}`);
      void this.stop(runtime).catch(() => {});
    });
    return runtime;
  }

  /**
   * Connect one runtime and publish its tool generation.
   * @param runtime - runtime record.
   * @returns fulfillment once connected and synchronized.
   */
  async connect(runtime) {
    const deps = await this.loadDeps();
    if (runtime.disposed) return;

    const transport = createTransport(deps, runtime.spec);
    const client = new deps.Client(
      { name: 'dsh-mcp-settings', version: '0.1.0' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'auto' },
        listChanged: {
          tools: {
            autoRefresh: false,
            debounceMs: 0,
            onChanged: () => {
              if (!runtime.disposed) this.scheduleRefresh(runtime);
            },
          },
        },
      },
    );
    runtime.transport = transport;
    runtime.client = client;
    client.onclose = () => {
      if (runtime.disposed || runtime.state !== 'connected') return;
      runtime.state = 'error';
      runtime.error = '与服务器的连接已关闭';
    };

    await client.connect(transport);
    if (runtime.disposed) {
      await this.stop(runtime);
      return;
    }
    await this.syncTools(runtime);
    runtime.state = 'connected';
    runtime.error = null;
  }

  /**
   * Queue one tool-list refresh from a server notification.
   * @param runtime - runtime record.
   */
  scheduleRefresh(runtime) {
    if (runtime.refreshTimer !== null) return;
    runtime.refreshTimer = setTimeout(() => {
      runtime.refreshTimer = null;
      if (runtime.disposed) return;
      void this.syncTools(runtime).catch((error) => {
        this.ctx.logger?.warn?.(`mcp-settings(${runtime.spec.serverName}): tool refresh failed: ${messageOf(error)}`);
      });
    }, 100);
  }

  /**
   * Discover the server's tools and atomically replace the registered set.
   * @param runtime - runtime record with a connected client.
   * @returns fulfillment after registration.
   */
  async syncTools(runtime) {
    const client = runtime.client;
    if (client === null) throw new Error('服务器尚未连接');
    const deps = await this.loadDeps();
    const capabilities = client.getServerCapabilities?.();
    const response =
      capabilities?.tools === undefined ? { tools: [] } : await client.listTools(undefined, { cacheMode: 'refresh' });

    const definitions = new Map();
    for (const tool of response.tools ?? []) {
      if (tool === null || typeof tool !== 'object' || typeof tool.name !== 'string') continue;
      const name = publicToolName(runtime.spec.serverName, tool.name);
      if (definitions.has(name)) {
        throw new Error(`服务器重复列出了工具 "${tool.name}"，工具列表无效`);
      }
      definitions.set(
        name,
        deps.createMcpToolDefinition(this.ctx, {
          name,
          rawName: tool.name,
          description: typeof tool.description === 'string' ? tool.description : '',
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          taskRequired: tool.execution?.taskSupport === 'required',
          call: (args, execution) =>
            client.callTool(
              { name: tool.name, arguments: args },
              { signal: execution.signal, timeout: runtime.spec.toolCallTimeoutMs, toolDefinition: tool },
            ),
        }),
      );
    }

    const disposers = [];
    // Release the previous generation first: registering a second tool with the
    // same public name in the same layer would be rejected.
    const previous = runtime.disposers;
    runtime.disposers = [];
    for (const dispose of previous) {
      try {
        dispose();
      } catch {
        // Continue releasing the remaining tools.
      }
    }
    try {
      for (const definition of definitions.values()) disposers.push(this.ctx.tools.register(definition));
    } catch (error) {
      for (const dispose of disposers) dispose();
      throw error;
    }
    runtime.disposers = disposers;
    runtime.tools = [...definitions.keys()];
  }

  /**
   * Close one runtime and unregister its tools.
   * @param runtime - runtime record.
   * @returns fulfillment after cleanup.
   */
  async stop(runtime) {
    runtime.disposed = true;
    if (runtime.refreshTimer !== null) {
      clearTimeout(runtime.refreshTimer);
      runtime.refreshTimer = null;
    }
    const disposers = runtime.disposers;
    runtime.disposers = [];
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // A failing disposer must not keep the remaining tools registered.
      }
    }
    const client = runtime.client;
    runtime.client = null;
    if (client !== null) {
      try {
        await client.close();
      } catch {
        // Closing an already-closed client is not actionable.
      }
    }
    const transport = runtime.transport;
    runtime.transport = null;
    if (transport !== null && client === null) {
      try {
        await transport.close();
      } catch {
        // Transport may never have opened.
      }
    }
  }

  /**
   * Reconnect one server, or every server when no key is given.
   * @param key - optional configured server key.
   * @returns a small status object.
   */
  async reconnect(key) {
    const targets =
      typeof key === 'string' && key !== ''
        ? [...this.runtimes.values()].filter((runtime) => runtime.key === key)
        : [...this.runtimes.values()];
    if (targets.length === 0) return { ok: false, error: '没有找到这个服务器' };
    for (const runtime of targets) {
      const spec = runtime.spec;
      await this.stop(runtime);
      this.runtimes.delete(spec.key);
      if (spec.enabled === false) continue;
      this.start(spec);
    }
    return { ok: true };
  }

  /**
   * Probe one server without registering its tools.
   * @param spec - normalized configuration.
   * @returns its tool names or a bounded failure.
   */
  async test(spec) {
    const deps = await this.loadDeps();
    const transport = createTransport(deps, spec);
    const client = new deps.Client(
      { name: 'dsh-mcp-settings-test', version: '0.1.0' },
      { capabilities: {}, versionNegotiation: { mode: 'auto' } },
    );
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('连接超时（20 秒）')), 20_000);
      });
      await Promise.race([client.connect(transport), timeout]);
      const capabilities = client.getServerCapabilities?.();
      const tools =
        capabilities?.tools === undefined ? [] : ((await client.listTools()).tools ?? []);
      return {
        ok: true,
        tools: tools
          .filter((tool) => tool !== null && typeof tool === 'object' && typeof tool.name === 'string')
          .slice(0, 100)
          .map((tool) => ({
            name: tool.name,
            description: typeof tool.description === 'string' ? tool.description : '',
          })),
      };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    } finally {
      clearTimeout(timer);
      try {
        await client.close();
      } catch {
        // The probe client may never have connected.
      }
    }
  }

  /**
   * Report saved configuration with live connection state.
   * @returns one detached row per configured server.
   */
  snapshot() {
    return this.servers.map((spec) => {
      const runtime = this.runtimes.get(spec.key);
      return {
        ...spec,
        state: runtime?.state ?? 'idle',
        tools: runtime?.tools ?? [],
        error: runtime?.error ?? null,
      };
    });
  }

  /**
   * Close every runtime; the manager will not accept new generations.
   * @returns fulfillment after cleanup.
   */
  async disposeAll() {
    this.disposed = true;
    const runtimes = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.all(runtimes.map((runtime) => this.stop(runtime)));
  }
}