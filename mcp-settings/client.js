/**
 * Browser half of the MCP settings bundle.
 *
 * The page lives in Settings as its own section: it lists the MCP servers
 * saved in this profile, shows their live connection state, and offers an
 * inline form to add or edit one. Saving writes the plugin's own Loader row
 * through the Host, which restarts the connection manager; the page then
 * waits for the new list to come back before it reports the save.
 */

window.__ModuleLoader__.load({
  id: '@local/mcp-settings',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'mcpSettings';
    /** Host route for the saved server list. */
    const SERVERS_URL = 'api/mcp-settings/servers';
    /** Host route for a temporary connection probe. */
    const TEST_URL = 'api/mcp-settings/test';
    /** Host route for rebuilding live connections. */
    const RECONNECT_URL = 'api/mcp-settings/reconnect';

    const EN = {
      nav: 'MCP servers',
      title: 'MCP servers',
      description:
        'Add Model Context Protocol servers here. Their tools become available to every conversation in this profile as mcp__<server>__<tool>.',
      add: 'Add server',
      newServer: 'New MCP server',
      editServer: 'Edit MCP server',
      emptyTitle: 'No MCP servers yet',
      emptyHint:
        'Connect a local stdio program such as @modelcontextprotocol/server-filesystem, or a remote Streamable HTTP endpoint.',
      loading: 'Loading MCP servers…',
      loadError: 'Could not load MCP servers',
      retry: 'Try again',
      editableHint: 'This profile has no configuration editor, so changes cannot be saved.',
      serverName: 'Server name',
      serverNameHint: 'Used as the tool namespace: mcp__<name>__<tool>. Letters, digits, _ and -, at most 32 characters.',
      transport: 'Transport',
      stdio: 'Local (stdio)',
      http: 'Remote (HTTP)',
      command: 'Command',
      commandHint: 'For example npx.',
      args: 'Arguments',
      argsHint: 'One argument per line.',
      env: 'Environment variables',
      envHint:
        'One KEY=VALUE per line. A value that is exactly $NAME reads the Harness process environment instead of storing a secret.',
      cwd: 'Working directory',
      cwdHint: 'Optional. Defaults to the Harness working directory.',
      url: 'Endpoint URL',
      urlHint: 'Streamable HTTP endpoint, for example http://localhost:3000/mcp.',
      headers: 'Request headers',
      headersHint: 'One Name: Value per line. A value that is exactly $NAME reads the Harness process environment.',
      timeout: 'Tool call timeout (ms)',
      timeoutHint: 'Default 60000.',
      enabled: 'Enabled',
      advanced: 'Advanced',
      edit: 'Edit',
      delete: 'Delete',
      confirmDelete: 'Confirm delete',
      cancel: 'Cancel',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. Reconnecting servers…',
      saveFailed: 'Could not save the server list',
      applyPending: 'Saved, but the new list has not appeared yet. Refresh the page to check.',
      test: 'Test connection',
      testing: 'Testing…',
      testOk: 'Connected. The server exposes {count} tools.',
      testOkNone: 'Connected, but the server exposes no tools.',
      testFailed: 'Connection failed',
      reconnect: 'Reconnect',
      connected: 'Connected',
      connecting: 'Connecting…',
      failed: 'Failed',
      disabled: 'Disabled',
      starting: 'Starting…',
      toolsOne: '1 tool',
      toolsCount: '{count} tools',
      toolsNone: 'No tools',
      nameRequired: 'Enter a server name.',
      nameInvalid: 'Use only letters, digits, underscore and hyphen, at most 32 characters.',
      nameDuplicate: 'Another server already uses this name.',
      commandRequired: 'Enter a command.',
      urlRequired: 'Enter an http(s) URL.',
      timeoutInvalid: 'The timeout must be a whole number of at least 1000 ms.',
      dismiss: 'Dismiss',
      configured: '{count} configured',
      toolsTitle: 'Registered tools',
    };

    const ZH = {
      nav: 'MCP 服务器',
      title: 'MCP 服务器',
      description:
        '在这里添加 Model Context Protocol 服务器。它们的工具会以 mcp__<服务器>__<工具> 的形式提供给此 profile 里的所有对话。',
      add: '添加服务器',
      newServer: '新建 MCP 服务器',
      editServer: '编辑 MCP 服务器',
      emptyTitle: '还没有 MCP 服务器',
      emptyHint: '可以连接本地 stdio 程序（例如 @modelcontextprotocol/server-filesystem），或远程 Streamable HTTP 端点。',
      loading: '正在加载 MCP 服务器…',
      loadError: '无法加载 MCP 服务器',
      retry: '重试',
      editableHint: '当前 profile 没有配置编辑器，无法保存更改。',
      serverName: '服务器名称',
      serverNameHint: '作为工具命名空间：mcp__<名称>__<工具>。只允许字母、数字、下划线和连字符，最多 32 个字符。',
      transport: '传输方式',
      stdio: '本地（stdio）',
      http: '远程（HTTP）',
      command: '命令',
      commandHint: '例如 npx。',
      args: '参数',
      argsHint: '每行一个参数。',
      env: '环境变量',
      envHint: '每行一个 KEY=VALUE。值恰好为 $NAME 时，会读取 Harness 进程环境变量，而不是把密钥存进配置。',
      cwd: '工作目录',
      cwdHint: '可选。默认使用 Harness 的工作目录。',
      url: '端点 URL',
      urlHint: 'Streamable HTTP 端点，例如 http://localhost:3000/mcp。',
      headers: '请求头',
      headersHint: '每行一个 Name: Value。值恰好为 $NAME 时，会读取 Harness 进程环境变量。',
      timeout: '工具调用超时（毫秒）',
      timeoutHint: '默认 60000。',
      enabled: '启用',
      advanced: '高级',
      edit: '编辑',
      delete: '删除',
      confirmDelete: '确认删除',
      cancel: '取消',
      save: '保存',
      saving: '正在保存…',
      saved: '已保存，正在重新连接服务器…',
      saveFailed: '无法保存服务器列表',
      applyPending: '已保存，但新列表尚未出现。可以刷新页面查看。',
      test: '测试连接',
      testing: '正在测试…',
      testOk: '连接成功，服务器提供 {count} 个工具。',
      testOkNone: '连接成功，但服务器没有提供工具。',
      testFailed: '连接失败',
      reconnect: '重新连接',
      connected: '已连接',
      connecting: '正在连接…',
      failed: '失败',
      disabled: '已停用',
      starting: '正在启动…',
      toolsOne: '1 个工具',
      toolsCount: '{count} 个工具',
      toolsNone: '没有工具',
      nameRequired: '请输入服务器名称。',
      nameInvalid: '只能使用字母、数字、下划线和连字符，最多 32 个字符。',
      nameDuplicate: '已有服务器使用这个名称。',
      commandRequired: '请输入命令。',
      urlRequired: '请输入 http(s) URL。',
      timeoutInvalid: '超时时间必须是不小于 1000 的整数毫秒。',
      dismiss: '关闭',
      configured: '已配置 {count} 个',
      toolsTitle: '已注册工具',
    };

    const STYLE = `
.mcp-page{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;padding:4px 0 36px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.mcp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;min-width:0}
.mcp-head-copy{min-width:0}
.mcp-title{margin:0;font-size:16px;line-height:1.45;font-weight:600;letter-spacing:-.005em}
.mcp-desc{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;max-width:56em}
.mcp-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.mcp-count{color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.mcp-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;box-sizing:border-box;min-height:28px;padding:3px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:1.5;white-space:nowrap;flex:none}
.mcp-button:hover{background:var(--dsw-alias-bg-layer-2)}
.mcp-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mcp-button[disabled]{opacity:.5;cursor:default}
.mcp-button-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.mcp-button-primary:hover:not([disabled]){background:var(--dsw-alias-brand-primary)}
.mcp-button-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.mcp-button-danger:hover:not([disabled]){background:var(--dsw-alias-bg-layer-2)}
.mcp-link{appearance:none;padding:3px 4px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11.5px;line-height:1.5;flex:none}
.mcp-link:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.mcp-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mcp-link-danger{color:var(--dsw-alias-state-error-primary)}
.mcp-card{box-sizing:border-box;display:flex;flex-direction:column;gap:7px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.mcp-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0}
.mcp-card-title{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
.mcp-name{margin:0;font-size:13px;line-height:1.45;font-weight:600;overflow-wrap:anywhere}
.mcp-chip{display:inline-flex;align-items:center;height:17px;padding:0 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:9.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
.mcp-pill{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1;white-space:nowrap}
.mcp-pill::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
.mcp-pill[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.mcp-pill[data-tone="pending"]{color:var(--dsw-alias-state-warn-primary)}
.mcp-pill[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.mcp-pill[data-tone="muted"]{color:var(--dsw-alias-label-tertiary)}
.mcp-card-actions{display:flex;align-items:center;gap:2px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.mcp-card-meta{display:flex;align-items:baseline;gap:6px 10px;flex-wrap:wrap;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
.mcp-mono{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.mcp-card-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:1.55;overflow-wrap:anywhere}
.mcp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:190px;padding:26px 18px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;text-align:center}
.mcp-empty-icon{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin-bottom:2px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.mcp-empty-title{margin:0;font-size:12.5px;line-height:1.5;font-weight:600}
.mcp-empty-text{max-width:330px;margin:0;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.55}
.mcp-form{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:13px 13px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.mcp-form-title{margin:0;font-size:13px;line-height:1.5;font-weight:600}
.mcp-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 12px}
.mcp-grid-full{grid-column:1/-1}
.mcp-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.mcp-label{color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.5;font-weight:500}
.mcp-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5}
.mcp-input,.mcp-textarea{box-sizing:border-box;width:100%;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5}
.mcp-input{height:30px}
.mcp-textarea{min-height:58px;resize:vertical;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.mcp-input:focus-visible,.mcp-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}
.mcp-input[aria-invalid="true"],.mcp-textarea[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.mcp-seg{display:inline-flex;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);gap:2px;align-self:flex-start}
.mcp-seg-item{appearance:none;padding:3px 9px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11.5px;line-height:1.5}
.mcp-seg-item[data-active="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-border-l1)}
.mcp-seg-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mcp-check{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-primary);align-self:flex-start}
.mcp-check input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary)}
.mcp-form-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:2px}
.mcp-form-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.mcp-issues{display:flex;flex-direction:column;gap:3px;margin:0;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:1.55;list-style:none}
.mcp-test{display:flex;flex-direction:column;gap:4px;padding:8px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:1.55;overflow-wrap:anywhere}
.mcp-test[data-ok="true"]{border-left:2px solid var(--dsw-alias-state-success-primary)}
.mcp-test[data-ok="false"]{border-left:2px solid var(--dsw-alias-state-error-primary)}
.mcp-test-title{margin:0;font-weight:600;color:var(--dsw-alias-label-primary)}
.mcp-test[data-ok="false"] .mcp-test-title{color:var(--dsw-alias-state-error-primary)}
.mcp-test-text{margin:0;color:var(--dsw-alias-label-secondary)}
.mcp-tools{display:flex;flex-direction:column;gap:2px;margin:2px 0 0;padding:0;list-style:none}
.mcp-tool{display:flex;align-items:baseline;gap:6px;min-width:0}
.mcp-tool-name{font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary);flex:none}
.mcp-tool-desc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10.5px}
.mcp-alert{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.55}
.mcp-alert[data-tone="ok"]{border-left-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary)}
.mcp-alert-text{margin:0;min-width:0;overflow-wrap:anywhere}
.mcp-alert button{flex:none}
.mcp-loading{display:flex;flex-direction:column;gap:9px;padding:8px 0}
.mcp-sk{height:9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);animation:mcp-pulse 1.5s ease-in-out infinite}
.mcp-sk:nth-child(1){width:58%}
.mcp-sk:nth-child(2){width:82%}
.mcp-sk:nth-child(3){width:44%}
@keyframes mcp-pulse{0%,100%{opacity:.5}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.mcp-sk{animation:none}}
@media (max-width:600px){.mcp-grid{grid-template-columns:minmax(0,1fr)}.mcp-card-actions{justify-content:flex-start}.mcp-card-top{flex-direction:column;align-items:stretch}}
`;

    /**
     * Fetch a JSON route and surface its structured failure.
     * @param {string} url - route path.
     * @param {object} [options] - fetch options.
     * @returns {Promise<object>} parsed payload.
     */
    async function requestJson(url, options = {}) {
      const response = await fetch(url, {
        ...options,
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.headers ?? {}),
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
            ? payload.message
            : `HTTP ${response.status}`;
        const error = new Error(message);
        error.code =
          payload !== null && typeof payload === 'object' && typeof payload.code === 'string'
            ? payload.code
            : 'http-error';
        throw error;
      }
      return payload ?? {};
    }

    /**
     * Render one thrown value as a short message.
     * @param {unknown} error - thrown value.
     * @returns a message string.
     */
    function messageOf(error) {
      if (error instanceof Error) return error.message;
      return String(error);
    }

    /**
     * Split a text area into trimmed non-empty lines.
     * @param {string} text - raw text.
     * @returns the lines.
     */
    function parseLines(text) {
      return String(text ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    }

    /**
     * Parse KEY=VALUE or Name: Value lines.
     * @param {string} text - raw text.
     * @param {string} separator - first separator.
     * @returns a plain string dictionary.
     */
    function parseKeyValues(text, separator) {
      const out = {};
      for (const line of String(text ?? '').split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf(separator);
        if (index <= 0) continue;
        const key = trimmed.slice(0, index).trim();
        if (key === '') continue;
        out[key] = trimmed.slice(index + separator.length).trim();
      }
      return out;
    }

    /**
     * Render a string dictionary as editable lines.
     * @param {object} mapping - string dictionary.
     * @param {string} separator - separator to place between key and value.
     * @returns the text area content.
     */
    function dictToLines(mapping, separator) {
      if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping)) return '';
      return Object.entries(mapping)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => `${key}${separator}${value}`)
        .join('\n');
    }

    /**
     * Generate a stable key for a new server row.
     * @returns a unique string.
     */
    function newKey() {
      try {
        return globalThis.crypto.randomUUID();
      } catch {
        return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }
    }

    /**
     * Create an empty form draft.
     * @returns the draft.
     */
    function emptyDraft() {
      return {
        key: newKey(),
        serverName: '',
        transport: 'stdio',
        command: 'npx',
        argsText: '',
        envText: '',
        cwd: '',
        url: '',
        headersText: '',
        toolCallTimeoutMs: '60000',
        enabled: true,
      };
    }

    /**
     * Project one saved server into editable form fields.
     * @param {object} server - saved server row.
     * @returns the draft.
     */
    function serverToDraft(server) {
      return {
        key: typeof server.key === 'string' && server.key !== '' ? server.key : newKey(),
        serverName: typeof server.serverName === 'string' ? server.serverName : '',
        transport: server.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
        command: typeof server.command === 'string' ? server.command : 'npx',
        argsText: Array.isArray(server.args) ? server.args.join('\n') : '',
        envText: dictToLines(server.env, '='),
        cwd: typeof server.cwd === 'string' ? server.cwd : '',
        url: typeof server.url === 'string' ? server.url : '',
        headersText: dictToLines(server.headers, ': '),
        toolCallTimeoutMs: String(server.toolCallTimeoutMs ?? 60000),
        enabled: server.enabled !== false,
      };
    }

    /**
     * Convert one form draft into the stored configuration shape.
     * @param {object} draft - form fields.
     * @returns the server configuration.
     */
    function draftToServer(draft) {
      const base = {
        key: draft.key,
        serverName: draft.serverName.trim(),
        transport: draft.transport,
        enabled: draft.enabled !== false,
        toolCallTimeoutMs: Number(draft.toolCallTimeoutMs),
      };
      if (draft.transport === 'stdio') {
        return {
          ...base,
          command: draft.command.trim(),
          args: parseLines(draft.argsText),
          env: parseKeyValues(draft.envText, '='),
          cwd: draft.cwd.trim(),
        };
      }
      return {
        ...base,
        url: draft.url.trim(),
        headers: parseKeyValues(draft.headersText, ':'),
      };
    }

    /**
     * Project a saved server into the payload accepted by the Host.
     * @param {object} server - saved or optimistic server row.
     * @returns the stored configuration.
     */
    function toStored(server) {
      const base = {
        key: server.key,
        serverName: server.serverName,
        transport: server.transport,
        enabled: server.enabled !== false,
        toolCallTimeoutMs: Number(server.toolCallTimeoutMs ?? 60000),
      };
      if (server.transport === 'streamable-http') {
        return { ...base, url: server.url ?? '', headers: server.headers ?? {} };
      }
      return {
        ...base,
        command: server.command ?? '',
        args: Array.isArray(server.args) ? server.args : [],
        env: server.env ?? {},
        cwd: server.cwd ?? '',
      };
    }

    /**
     * Validate one draft before saving or probing.
     * @param {object} draft - form fields.
     * @param {object[]} servers - currently saved rows.
     * @param {string|null} editingKey - key being edited, if any.
     * @param {Function} t - translator.
     * @returns {string[]} validation messages.
     */
    function validateDraft(draft, servers, editingKey, t) {
      const issues = [];
      const name = draft.serverName.trim();
      if (name === '') issues.push(t('nameRequired'));
      else if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) issues.push(t('nameInvalid'));
      else if (servers.some((server) => server.key !== editingKey && server.serverName === name)) {
        issues.push(t('nameDuplicate'));
      }

      if (draft.transport === 'stdio') {
        if (draft.command.trim() === '') issues.push(t('commandRequired'));
      } else {
        let valid = false;
        try {
          const parsed = new URL(draft.url.trim());
          valid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          valid = false;
        }
        if (!valid) issues.push(t('urlRequired'));
      }

      const timeout = Number(draft.toolCallTimeoutMs);
      if (!Number.isFinite(timeout) || timeout < 1000 || !Number.isInteger(timeout)) issues.push(t('timeoutInvalid'));
      return issues;
    }

    /**
     * Compare the applied server list with the optimistic expectation.
     * @param {object[]} actual - servers reported by the Host.
     * @param {object[]} expected - servers the page just saved.
     * @returns whether the Host has applied the list.
     */
    function sameServers(actual, expected) {
      if (!Array.isArray(actual) || actual.length !== expected.length) return false;
      return expected.every((want) =>
        actual.some(
          (have) =>
            have.key === want.key &&
            have.serverName === want.serverName &&
            have.transport === want.transport &&
            have.enabled === want.enabled &&
            (want.transport === 'stdio' ? have.command === want.command : have.url === want.url),
        ),
      );
    }

    /**
     * Wait briefly for a new list to become visible after a profile save.
     * @param {object[]} expected - servers the page just saved.
     * @returns {Promise<object|null>} the Host payload, or null on timeout.
     */
    async function waitForApplied(expected) {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 400 : 600));
        try {
          const payload = await requestJson(SERVERS_URL);
          if (sameServers(payload.servers, expected)) return payload;
        } catch {
          // The Host plugin restarts while the profile write is applied.
        }
      }
      return null;
    }

    /**
     * Render the small network glyph used by the section and empty state.
     * @param {object} props - requested size.
     * @returns the SVG element.
     */
    function McpGlyph({ size = 16 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        [
          h('circle', { key: 'a', cx: 6, cy: 7, r: 2.1 }),
          h('circle', { key: 'b', cx: 18, cy: 7, r: 2.1 }),
          h('circle', { key: 'c', cx: 12, cy: 17.5, r: 2.1 }),
          h('path', { key: 'l1', d: 'M8.2 8.2 10.3 15.6' }),
          h('path', { key: 'l2', d: 'M15.8 8.2 13.7 15.6' }),
          h('path', { key: 'l3', d: 'M8.3 7h7.4' }),
        ],
      );
    }

    /**
     * Render one form field with its label and hint.
     * @param {object} props - label, hint, and control.
     * @returns the field block.
     */
    function Field({ label, hint, children }) {
      return h(
        'div',
        { className: 'mcp-field' },
        h('span', { className: 'mcp-label' }, label),
        children,
        hint === undefined ? null : h('p', { className: 'mcp-hint' }, hint),
      );
    }

    /**
     * Render one server's live-state pill.
     * @param {object} props - server and translator.
     * @returns the pill element.
     */
    function StatusPill({ server, t }) {
      const state = server.state ?? 'idle';
      const meta =
        state === 'connected'
          ? { label: t('connected'), tone: 'ok' }
          : state === 'error'
            ? { label: t('failed'), tone: 'error' }
            : state === 'disabled'
              ? { label: t('disabled'), tone: 'muted' }
              : state === 'connecting'
                ? { label: t('connecting'), tone: 'pending' }
                : { label: t('starting'), tone: 'pending' };
      return h('span', { className: 'mcp-pill', 'data-tone': meta.tone }, meta.label);
    }

    /**
     * Render the test-result block for one form.
     * @param {object} props - probe state and translator.
     * @returns the result block.
     */
    function TestResult({ state, t }) {
      if (state.status === 'testing') {
        return h('div', { className: 'mcp-test', role: 'status' }, h('p', { className: 'mcp-test-text' }, t('testing')));
      }
      if (state.status !== 'done' || state.result === null) return null;
      const result = state.result;
      if (result.ok !== true) {
        return h(
          'div',
          { className: 'mcp-test', 'data-ok': 'false', role: 'alert' },
          h('p', { className: 'mcp-test-title' }, t('testFailed')),
          h('p', { className: 'mcp-test-text' }, String(result.error ?? '')),
        );
      }
      const tools = Array.isArray(result.tools) ? result.tools : [];
      return h(
        'div',
        { className: 'mcp-test', 'data-ok': 'true' },
        h(
          'p',
          { className: 'mcp-test-title' },
          tools.length === 0 ? t('testOkNone') : t('testOk', { count: String(tools.length) }),
        ),
        tools.length === 0
          ? null
          : h(
              'ul',
              { className: 'mcp-tools' },
              tools.slice(0, 12).map((tool) =>
                h(
                  'li',
                  { className: 'mcp-tool', key: tool.name },
                  h('span', { className: 'mcp-tool-name' }, tool.name),
                  typeof tool.description === 'string' && tool.description !== ''
                    ? h('span', { className: 'mcp-tool-desc', title: tool.description }, tool.description)
                    : null,
                ),
              ),
            ),
      );
    }

    /**
     * Render the inline add/edit form.
     * @param {object} props - draft, saved rows, handlers, and translator.
     * @returns the form element.
     */
    function ServerForm({ draft, setDraft, servers, editingKey, t, busy, onSave, onCancel }) {
      const [issues, setIssues] = React.useState([]);
      const [probe, setProbe] = React.useState({ status: 'idle', result: null });

      const update = (patch) => {
        setProbe({ status: 'idle', result: null });
        setDraft((previous) => ({ ...previous, ...patch }));
      };

      const collect = () => {
        const problems = validateDraft(draft, servers, editingKey, t);
        setIssues(problems);
        return problems.length === 0;
      };

      const runTest = async () => {
        if (busy || !collect()) return;
        setProbe({ status: 'testing', result: null });
        try {
          const result = await requestJson(TEST_URL, {
            method: 'POST',
            body: JSON.stringify({ server: draftToServer(draft) }),
          });
          setProbe({ status: 'done', result });
        } catch (error) {
          setProbe({ status: 'done', result: { ok: false, error: messageOf(error) } });
        }
      };

      const submit = () => {
        if (busy || !collect()) return;
        onSave(draftToServer(draft));
      };

      const stdio = draft.transport === 'stdio';
      return h(
        'div',
        { className: 'mcp-form' },
        h('h3', { className: 'mcp-form-title' }, editingKey === null ? t('newServer') : t('editServer')),
        issues.length > 0
          ? h(
              'ul',
              { className: 'mcp-issues', role: 'alert' },
              issues.map((issue, index) => h('li', { key: index }, issue)),
            )
          : null,
        h(
          'div',
          { className: 'mcp-grid' },
          h(
            Field,
            { label: t('serverName'), hint: t('serverNameHint') },
            h('input', {
              className: 'mcp-input',
              value: draft.serverName,
              placeholder: 'filesystem',
              spellCheck: false,
              autoComplete: 'off',
              'aria-invalid': issues.some((issue) => issue === t('nameRequired') || issue === t('nameInvalid') || issue === t('nameDuplicate')) ? 'true' : 'false',
              onChange: (event) => update({ serverName: event.target.value }),
            }),
          ),
          h(
            Field,
            { label: t('transport') },
            h(
              'div',
              { className: 'mcp-seg', role: 'radiogroup', 'aria-label': t('transport') },
              h(
                'button',
                {
                  type: 'button',
                  role: 'radio',
                  'aria-checked': stdio ? 'true' : 'false',
                  'data-active': stdio ? 'true' : 'false',
                  className: 'mcp-seg-item',
                  onClick: () => update({ transport: 'stdio' }),
                },
                t('stdio'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  role: 'radio',
                  'aria-checked': stdio ? 'false' : 'true',
                  'data-active': stdio ? 'false' : 'true',
                  className: 'mcp-seg-item',
                  onClick: () => update({ transport: 'streamable-http' }),
                },
                t('http'),
              ),
            ),
          ),
          stdio
            ? h(
                'div',
                { className: 'mcp-grid-full mcp-grid', style: { gap: '10px 12px' } },
                h(
                  Field,
                  { label: t('command'), hint: t('commandHint') },
                  h('input', {
                    className: 'mcp-input',
                    value: draft.command,
                    placeholder: 'npx',
                    spellCheck: false,
                    onChange: (event) => update({ command: event.target.value }),
                  }),
                ),
                h(
                  Field,
                  { label: t('cwd'), hint: t('cwdHint') },
                  h('input', {
                    className: 'mcp-input',
                    value: draft.cwd,
                    placeholder: '/home/user/project',
                    spellCheck: false,
                    onChange: (event) => update({ cwd: event.target.value }),
                  }),
                ),
                h(
                  'div',
                  { className: 'mcp-grid-full' },
                  h(
                    Field,
                    { label: t('args'), hint: t('argsHint') },
                    h('textarea', {
                      className: 'mcp-textarea',
                      value: draft.argsText,
                      rows: 3,
                      spellCheck: false,
                      placeholder: '-y\n@modelcontextprotocol/server-filesystem\n/home/user/Documents',
                      onChange: (event) => update({ argsText: event.target.value }),
                    }),
                  ),
                ),
                h(
                  'div',
                  { className: 'mcp-grid-full' },
                  h(
                    Field,
                    { label: t('env'), hint: t('envHint') },
                    h('textarea', {
                      className: 'mcp-textarea',
                      value: draft.envText,
                      rows: 3,
                      spellCheck: false,
                      placeholder: 'GITHUB_TOKEN=$GITHUB_TOKEN',
                      onChange: (event) => update({ envText: event.target.value }),
                    }),
                  ),
                ),
              )
            : h(
                'div',
                { className: 'mcp-grid-full mcp-grid', style: { gap: '10px 12px' } },
                h(
                  'div',
                  { className: 'mcp-grid-full' },
                  h(
                    Field,
                    { label: t('url'), hint: t('urlHint') },
                    h('input', {
                      className: 'mcp-input',
                      value: draft.url,
                      placeholder: 'http://localhost:3000/mcp',
                      spellCheck: false,
                      onChange: (event) => update({ url: event.target.value }),
                    }),
                  ),
                ),
                h(
                  'div',
                  { className: 'mcp-grid-full' },
                  h(
                    Field,
                    { label: t('headers'), hint: t('headersHint') },
                    h('textarea', {
                      className: 'mcp-textarea',
                      value: draft.headersText,
                      rows: 3,
                      spellCheck: false,
                      placeholder: 'Authorization: Bearer $MCP_TOKEN',
                      onChange: (event) => update({ headersText: event.target.value }),
                    }),
                  ),
                ),
              ),
        ),
        h(
          'div',
          { className: 'mcp-grid' },
          h(
            Field,
            { label: t('enabled') },
            h(
              'label',
              { className: 'mcp-check' },
              h('input', {
                type: 'checkbox',
                checked: draft.enabled,
                onChange: (event) => update({ enabled: event.target.checked }),
              }),
              draft.enabled ? t('enabled') : t('disabled'),
            ),
          ),
          h(
            Field,
            { label: t('timeout'), hint: t('timeoutHint') },
            h('input', {
              className: 'mcp-input',
              type: 'number',
              min: 1000,
              step: 1000,
              value: draft.toolCallTimeoutMs,
              onChange: (event) => update({ toolCallTimeoutMs: event.target.value }),
            }),
          ),
        ),
        h(TestResult, { state: probe, t }),
        h(
          'div',
          { className: 'mcp-form-foot' },
          h(
            'div',
            { className: 'mcp-form-actions' },
            h(
              'button',
              { type: 'button', className: 'mcp-button', disabled: busy, onClick: runTest },
              probe.status === 'testing' ? t('testing') : t('test'),
            ),
          ),
          h(
            'div',
            { className: 'mcp-form-actions' },
            h('button', { type: 'button', className: 'mcp-link', disabled: busy, onClick: onCancel }, t('cancel')),
            h(
              'button',
              { type: 'button', className: 'mcp-button mcp-button-primary', disabled: busy, onClick: submit },
              busy ? t('saving') : t('save'),
            ),
          ),
        ),
      );
    }

    /**
     * Render one saved server card.
     * @param {object} props - server, confirmation, handlers, and translator.
     * @returns the card.
     */
    function ServerCard({ server, confirm, t, busy, onEdit, onDelete, onConfirm, onCancelConfirm, onReconnect }) {
      const stdio = server.transport !== 'streamable-http';
      const summary = stdio ? `${server.command ?? ''} ${(server.args ?? []).join(' ')}`.trim() : String(server.url ?? '');
      const tools = Array.isArray(server.tools) ? server.tools : [];
      return h(
        'div',
        { className: 'mcp-card' },
        h(
          'div',
          { className: 'mcp-card-top' },
          h(
            'div',
            { className: 'mcp-card-title' },
            h('h3', { className: 'mcp-name' }, server.serverName),
            h('span', { className: 'mcp-chip' }, stdio ? 'stdio' : 'http'),
            h(StatusPill, { server, t }),
          ),
          h(
            'div',
            { className: 'mcp-card-actions' },
            h('button', { type: 'button', className: 'mcp-link', disabled: busy, onClick: onEdit }, t('edit')),
            server.enabled === false
              ? null
              : h('button', { type: 'button', className: 'mcp-link', disabled: busy, onClick: onReconnect }, t('reconnect')),
            confirm
              ? h(
                  React.Fragment,
                  null,
                  h('button', { type: 'button', className: 'mcp-link mcp-link-danger', disabled: busy, onClick: onDelete }, t('confirmDelete')),
                  h('button', { type: 'button', className: 'mcp-link', disabled: busy, onClick: onCancelConfirm }, t('cancel')),
                )
              : h('button', { type: 'button', className: 'mcp-link mcp-link-danger', disabled: busy, onClick: onConfirm }, t('delete')),
          ),
        ),
        h(
          'div',
          { className: 'mcp-card-meta' },
          h('span', { className: 'mcp-mono', title: summary }, summary === '' ? '—' : summary),
          h(
            'span',
            { title: tools.length > 0 ? tools.join('\n') : t('toolsNone') },
            tools.length === 0 ? t('toolsNone') : tools.length === 1 ? t('toolsOne') : t('toolsCount', { count: String(tools.length) }),
          ),
        ),
        typeof server.error === 'string' && server.error !== ''
          ? h('p', { className: 'mcp-card-error', title: server.error }, server.error)
          : null,
        confirm
          ? h('p', { className: 'mcp-hint' }, t('confirmDelete') + ': ' + server.serverName)
          : null,
      );
    }

    /**
     * The Settings section page: list, add, edit, delete, test.
     * @param {object} props - translator injected by the registration.
     * @returns the section content.
     */
    function McpSection(props) {
      const t = props.tr ?? props.t ?? ((key) => key);
      const [page, setPage] = React.useState({ status: 'loading', servers: [], editable: true, error: null, notice: null });
      const [editing, setEditing] = React.useState(null);
      const [draft, setDraft] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [confirmKey, setConfirmKey] = React.useState(null);
      const pollCount = React.useRef(0);

      const load = React.useCallback(
        async (silent = false) => {
          if (!silent) setPage((previous) => ({ ...previous, status: 'loading', error: null }));
          try {
            const payload = await requestJson(SERVERS_URL);
            setPage((previous) => ({
              status: 'ready',
              servers: Array.isArray(payload.servers) ? payload.servers : [],
              editable: payload.editable !== false,
              error: null,
              notice: previous.notice,
            }));
          } catch (error) {
            setPage((previous) => ({ ...previous, status: 'error', error: messageOf(error) }));
          }
        },
        [],
      );

      React.useEffect(() => {
        void load();
      }, [load]);

      const connecting = page.servers.some((server) => server.state === 'connecting' || server.state === 'idle');
      React.useEffect(() => {
        if (!connecting) {
          pollCount.current = 0;
          return undefined;
        }
        if (pollCount.current >= 30) return undefined;
        const timer = setTimeout(() => {
          pollCount.current += 1;
          void load(true);
        }, 2000);
        return () => clearTimeout(timer);
      }, [connecting, page.servers, load]);

      const startAdd = () => {
        setConfirmKey(null);
        setEditing({ key: null });
        setDraft(emptyDraft());
      };

      const startEdit = (server) => {
        setConfirmKey(null);
        setEditing({ key: server.key });
        setDraft(serverToDraft(server));
      };

      const cancelEdit = () => {
        setEditing(null);
        setDraft(null);
      };

      const persist = async (nextServers) => {
        setBusy(true);
        setPage((previous) => ({ ...previous, error: null, notice: null }));
        const expected = nextServers.map(toStored);
        const optimistic = expected.map((server) => ({
          ...server,
          state: server.enabled === false ? 'disabled' : 'connecting',
          tools: [],
          error: null,
        }));
        setPage((previous) => ({ ...previous, servers: optimistic }));
        let failure = null;
        try {
          await requestJson(SERVERS_URL, { method: 'PUT', body: JSON.stringify({ servers: expected }) });
        } catch (error) {
          failure = error;
        }
        const applied = await waitForApplied(optimistic);
        if (applied !== null) {
          setPage({
            status: 'ready',
            servers: applied.servers,
            editable: applied.editable !== false,
            error: null,
            notice: t('saved'),
          });
          setEditing(null);
          setDraft(null);
          setConfirmKey(null);
        } else if (failure !== null) {
          setPage((previous) => ({ ...previous, error: failure.message }));
          await load(true);
        } else {
          setPage((previous) => ({ ...previous, notice: t('applyPending') }));
        }
        setBusy(false);
      };

      const saveDraft = (server) => {
        const current = page.servers.map(toStored);
        const existing = editing === null ? -1 : current.findIndex((entry) => entry.key === server.key);
        const next = existing === -1 ? [...current, server] : current.map((entry) => (entry.key === server.key ? server : entry));
        void persist(next);
      };

      const removeServer = (server) => {
        void persist(page.servers.map(toStored).filter((entry) => entry.key !== server.key));
      };

      const reconnect = async (server) => {
        setBusy(true);
        setPage((previous) => ({ ...previous, error: null, notice: null }));
        try {
          await requestJson(RECONNECT_URL, { method: 'POST', body: JSON.stringify({ key: server.key }) });
          await load(true);
        } catch (error) {
          setPage((previous) => ({ ...previous, error: messageOf(error) }));
        } finally {
          setBusy(false);
        }
      };

      if (page.status === 'loading') {
        return h(
          'div',
          { className: 'mcp-page' },
          h(
            'div',
            { className: 'mcp-loading', role: 'status', 'aria-label': t('loading') },
            h('span', { className: 'mcp-sk' }),
            h('span', { className: 'mcp-sk' }),
            h('span', { className: 'mcp-sk' }),
          ),
        );
      }

      if (page.status === 'error') {
        return h(
          'div',
          { className: 'mcp-page' },
          h(
            'div',
            { className: 'mcp-alert', role: 'alert' },
            h('p', { className: 'mcp-alert-text' }, `${t('loadError')}: ${page.error ?? ''}`),
            h('button', { type: 'button', className: 'mcp-button', onClick: () => void load() }, t('retry')),
          ),
        );
      }

      const editingKey = editing === null ? null : editing.key;
      return h(
        'div',
        { className: 'mcp-page' },
        h(
          'header',
          { className: 'mcp-head' },
          h(
            'div',
            { className: 'mcp-head-copy' },
            h('h2', { className: 'mcp-title' }, t('title')),
            h('p', { className: 'mcp-desc' }, t('description')),
          ),
          h(
            'button',
            { type: 'button', className: 'mcp-button mcp-button-primary', disabled: busy || !page.editable, onClick: startAdd },
            t('add'),
          ),
        ),
        page.editable
          ? null
          : h(
              'div',
              { className: 'mcp-alert' },
              h('p', { className: 'mcp-alert-text' }, t('editableHint')),
            ),
        page.notice === null
          ? null
          : h(
              'div',
              { className: 'mcp-alert', 'data-tone': 'ok', role: 'status' },
              h('p', { className: 'mcp-alert-text' }, page.notice),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mcp-link',
                  onClick: () => setPage((previous) => ({ ...previous, notice: null })),
                },
                t('dismiss'),
              ),
            ),
        page.error === null
          ? null
          : h(
              'div',
              { className: 'mcp-alert', role: 'alert' },
              h('p', { className: 'mcp-alert-text' }, `${t('saveFailed')}: ${page.error}`),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mcp-link',
                  onClick: () => setPage((previous) => ({ ...previous, error: null })),
                },
                t('dismiss'),
              ),
            ),
        h(
          'div',
          { className: 'mcp-toolbar' },
          h(
            'span',
            { className: 'mcp-count' },
            t('configured', { count: String(page.servers.length) }),
          ),
        ),
        editing !== null && draft !== null && editingKey === null
          ? h(ServerForm, {
              draft,
              setDraft,
              servers: page.servers,
              editingKey: null,
              t,
              busy,
              onSave: saveDraft,
              onCancel: cancelEdit,
            })
          : null,
        page.servers.length === 0 && editing === null
          ? h(
              'div',
              { className: 'mcp-empty' },
              h('span', { className: 'mcp-empty-icon' }, h(McpGlyph, { size: 18 })),
              h('p', { className: 'mcp-empty-title' }, t('emptyTitle')),
              h('p', { className: 'mcp-empty-text' }, t('emptyHint')),
              h(
                'button',
                { type: 'button', className: 'mcp-button', disabled: !page.editable || busy, onClick: startAdd },
                t('add'),
              ),
            )
          : null,
        page.servers.map((server) =>
          editingKey === server.key && draft !== null
            ? h(ServerForm, {
                key: `edit:${server.key}`,
                draft,
                setDraft,
                servers: page.servers,
                editingKey,
                t,
                busy,
                onSave: saveDraft,
                onCancel: cancelEdit,
              })
            : h(ServerCard, {
                key: server.key,
                server,
                confirm: confirmKey === server.key,
                t,
                busy,
                onEdit: () => startEdit(server),
                onConfirm: () => setConfirmKey(server.key),
                onCancelConfirm: () => setConfirmKey(null),
                onDelete: () => removeServer(server),
                onReconnect: () => void reconnect(server),
              }),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the Settings page and its navigation icon.
       * @param {object} ctx - Client plugin context.
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'mcp-settings: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/mcp-settings/settings.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/mcp-settings';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'mcp-settings: styles');

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'mcp',
              order: 30,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ tr: t }),
            },
            McpSection,
          ),
        );

        ctx.slots.inject('settings.section.icon', () =>
          ctx.slots.register(
            {
              name: 'settings.section.icon',
              id: 'mcp',
              locale: NS,
            },
            McpGlyph,
          ),
        );
      },
    };
  },
});