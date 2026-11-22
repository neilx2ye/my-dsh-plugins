/**
 * Browser half of the Feishu bridge bundle.
 *
 * The page lives in Settings as its own section. It saves the App ID/Secret and
 * chat policy through the Host's profile config editor, tests a credential
 * draft before saving it, and polls the live long-connection status.
 */

window.__ModuleLoader__.load({
  id: '@local/feishu-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'feishuBridge';
    /** Host route for status and saved configuration. */
    const STATE_URL = 'api/feishu-bridge/state';
    /** Host route saving the Loader row. */
    const CONFIG_URL = 'api/feishu-bridge/config';
    /** Host route probing an unsaved credential draft. */
    const TEST_URL = 'api/feishu-bridge/test';
    /** Host route reconnecting the live socket. */
    const RECONNECT_URL = 'api/feishu-bridge/reconnect';
    /** Host route forgetting chat bindings. */
    const RESET_URL = 'api/feishu-bridge/reset';

    const EN = {
      nav: 'Feishu',
      title: 'Feishu long connection',
      description:
        'Answer Feishu messages from this Harness over a WebSocket long connection. Each chat keeps one durable Session; no public callback URL is needed.',
      loading: 'Loading Feishu status…',
      loadError: 'Could not load Feishu status',
      retry: 'Try again',
      notEditable: 'This profile has no configuration editor, so the credentials cannot be saved here.',
      statusTitle: 'Connection',
      statusConnected: 'Connected',
      statusConnecting: 'Connecting…',
      statusReconnecting: 'Reconnecting…',
      statusFailed: 'Failed',
      statusIdle: 'Not connected',
      statusNotConfigured: 'Not configured',
      statusDisabled: 'Disabled',
      bot: 'Bot',
      boundChats: 'Bound chats',
      connectedAt: 'Connected at',
      lastError: 'Last error',
      lastRejected: 'Last ignored message',
      dependencyMissing:
        'The Feishu SDK is not installed. Reinstall the bundle so its dependency @larksuiteoapi/node-sdk is present.',
      reasonNoMention: 'group message without @bot',
      reasonGroupNotAllowed: 'group not in the allowlist',
      reasonSenderNotAllowed: 'sender not in the allowlist',
      reasonDmDisabled: 'direct messages are disabled',
      reasonMentionAll: '@all is not answered',
      credentials: 'App credentials',
      appId: 'App ID',
      appIdHint: 'From the Feishu developer console, for example cli_a1b2c3d4e5f6g7h8.',
      appSecret: 'App secret',
      appSecretHint: 'Saved in this profile’s cordis.patch.yml. Use $FEISHU_APP_SECRET to read the process environment instead.',
      appSecretSaved: 'Saved. Leave blank to keep it.',
      domain: 'Domain',
      domainFeishu: 'Feishu',
      domainLark: 'Lark',
      enabled: 'Enable the bridge',
      behavior: 'Conversation',
      cwd: 'Working directory',
      cwdHint: 'Optional. New Feishu Sessions start here; blank uses the profile’s feishu-bridge/home.',
      preset: 'Agent preset',
      presetHint: 'Optional preset id for Feishu Sessions; blank uses the default preset.',
      dmMode: 'Direct messages',
      dmOpen: 'Anyone with the bot',
      dmAllowlist: 'Allowlisted senders',
      dmDisabled: 'Disabled',
      dmAllowlistLabel: 'Allowed open_ids',
      dmAllowlistHint: 'One sender open_id per line. Only used by the Allowlisted senders policy.',
      groupAllowlist: 'Allowed group chat_ids',
      groupAllowlistHint: 'One oc_… chat id per line. Empty allows every group.',
      requireMention: 'Only answer group messages that @ the bot',
      respondToMentionAll: 'Answer @all messages too',
      streaming: 'Stream replies into a Feishu card',
      markdown: 'Send markdown as rich text',
      replyInThread: 'Reply inside the topic thread',
      save: 'Save and connect',
      saving: 'Saving…',
      saved: 'Saved. Reconnecting the long connection…',
      saveFailed: 'Could not save the settings',
      test: 'Test connection',
      testing: 'Testing…',
      testOk: 'Connected as {bot}.',
      testFailed: 'Connection failed',
      reconnect: 'Reconnect',
      reconnecting: 'Reconnecting…',
      reconnectFailed: 'Could not reconnect',
      reset: 'Forget chat bindings',
      confirmReset: 'Confirm forget all',
      resetDone: 'Forgot {count} chat binding(s). The next message starts a new Session.',
      copy: 'Copy',
      copied: 'Copied',
      dismiss: 'Dismiss',
      missingCredentials: 'Enter both the App ID and the App secret first.',
      invalidCwd: 'The working directory must be an absolute path or start with ~/.',
      savedSecretPlaceholder: '•••••••• (saved)',
      setupTitle: 'Feishu app setup',
      setup:
        'In the Feishu developer console: add the Bot capability, grant message read/send and image resource scopes, subscribe im.message.receive_v1 through “long connection”, then publish a version. No request URL is needed.',
      refresh: 'Refresh',
      noChats: 'No chats bound yet',
      chats: 'Recent chats',
      secretSourceEnv: 'Read from the environment',
      secretSourceProfile: 'Saved in the profile',
      secretSourceNone: 'Not set',
    };

    const ZH = {
      nav: '飞书',
      title: '飞书长连接',
      description:
        '用 WebSocket 长连接让这个 Harness 接收并回复飞书消息。每个会话对应一个持久 Session，不需要公网回调地址。',
      loading: '正在加载飞书状态…',
      loadError: '无法加载飞书状态',
      retry: '重试',
      notEditable: '当前 profile 没有配置编辑器，无法在这里保存应用凭证。',
      statusTitle: '连接状态',
      statusConnected: '已连接',
      statusConnecting: '正在连接…',
      statusReconnecting: '正在重连…',
      statusFailed: '连接失败',
      statusIdle: '未连接',
      statusNotConfigured: '尚未配置',
      statusDisabled: '已停用',
      bot: '机器人',
      boundChats: '已绑定会话',
      connectedAt: '连接时间',
      lastError: '最近错误',
      lastRejected: '最近忽略的消息',
      dependencyMissing: '缺少飞书 SDK。请重新安装插件，确保依赖 @larksuiteoapi/node-sdk 已安装。',
      reasonNoMention: '群消息没有 @机器人',
      reasonGroupNotAllowed: '群不在白名单里',
      reasonSenderNotAllowed: '发送者不在白名单里',
      reasonDmDisabled: '已关闭私聊',
      reasonMentionAll: '不响应 @所有人',
      credentials: '应用凭证',
      appId: 'App ID',
      appIdHint: '飞书开放平台的应用凭证，例如 cli_a1b2c3d4e5f6g7h8。',
      appSecret: 'App Secret',
      appSecretHint: '保存在此 profile 的 cordis.patch.yml。也可以填 $FEISHU_APP_SECRET，从进程环境读取。',
      appSecretSaved: '已保存。留空保持不变。',
      domain: '域名',
      domainFeishu: '飞书',
      domainLark: 'Lark',
      enabled: '启用长连接',
      behavior: '会话设置',
      cwd: '工作目录',
      cwdHint: '可选。新建飞书会话时使用；留空使用 profile 下的 feishu-bridge/home。',
      preset: '智能体预设',
      presetHint: '可选。飞书会话使用的 preset id；留空使用默认预设。',
      dmMode: '私聊策略',
      dmOpen: '所有能找到机器人的人',
      dmAllowlist: '仅白名单发送者',
      dmDisabled: '关闭私聊',
      dmAllowlistLabel: '允许的 open_id',
      dmAllowlistHint: '每行一个发送者 open_id，仅在“仅白名单发送者”策略下生效。',
      groupAllowlist: '允许的群 chat_id',
      groupAllowlistHint: '每行一个 oc_… 群 id；留空表示不限制群。',
      requireMention: '群聊只处理 @机器人 的消息',
      respondToMentionAll: '也响应 @所有人 的消息',
      streaming: '把回复流式写入飞书卡片',
      markdown: '用富文本发送 Markdown',
      replyInThread: '在话题内回复',
      save: '保存并连接',
      saving: '正在保存…',
      saved: '已保存，正在重新建立长连接…',
      saveFailed: '无法保存设置',
      test: '测试连接',
      testing: '正在测试…',
      testOk: '连接成功，机器人：{bot}。',
      testFailed: '连接失败',
      reconnect: '重新连接',
      reconnecting: '正在重连…',
      reconnectFailed: '无法重新连接',
      reset: '清除会话绑定',
      confirmReset: '确认全部清除',
      resetDone: '已清除 {count} 个会话绑定。下一条消息会新建 Session。',
      copy: '复制',
      copied: '已复制',
      dismiss: '关闭',
      missingCredentials: '请先填写 App ID 和 App Secret。',
      invalidCwd: '工作目录必须是绝对路径，或以 ~/ 开头。',
      savedSecretPlaceholder: '••••••••（已保存）',
      setupTitle: '飞书应用配置',
      setup:
        '在飞书开放平台：添加机器人能力，开通消息读取/发送和图片资源权限，在“事件与回调”里用“长连接”订阅 im.message.receive_v1，然后发布版本。不需要填写请求地址。',
      refresh: '刷新',
      noChats: '还没有绑定会话',
      chats: '最近会话',
      secretSourceEnv: '从环境变量读取',
      secretSourceProfile: '已保存在 profile',
      secretSourceNone: '未设置',
    };

    const STYLE = `
.fsb-page{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;width:100%;max-width:780px;padding:4px 0 36px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.fsb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;min-width:0}
.fsb-title{margin:0;font-size:16px;line-height:1.45;font-weight:600;letter-spacing:-.005em}
.fsb-desc{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;max-width:58em}
.fsb-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;box-sizing:border-box;min-height:28px;padding:3px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:1.5;white-space:nowrap;flex:none}
.fsb-button:hover:not([disabled]){background:var(--dsw-alias-bg-layer-2)}
.fsb-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.fsb-button[disabled]{opacity:.5;cursor:default}
.fsb-button-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.fsb-button-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.fsb-card{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.fsb-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
.fsb-card-title{margin:0;font-size:13px;line-height:1.45;font-weight:600}
.fsb-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.fsb-pill{display:inline-flex;align-items:center;gap:4px;height:19px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1;white-space:nowrap}
.fsb-pill::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
.fsb-pill[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.fsb-pill[data-tone="pending"]{color:var(--dsw-alias-state-warn-primary)}
.fsb-pill[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.fsb-pill[data-tone="muted"]{color:var(--dsw-alias-label-tertiary)}
.fsb-meta{display:flex;align-items:baseline;gap:5px 14px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55}
.fsb-meta b{color:var(--dsw-alias-label-primary);font-weight:500}
.fsb-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.55;overflow-wrap:anywhere}
.fsb-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:11px 12px}
.fsb-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.fsb-full{grid-column:1/-1}
.fsb-label{color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.5;font-weight:500}
.fsb-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5}
.fsb-input,.fsb-textarea,.fsb-select{box-sizing:border-box;width:100%;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5}
.fsb-input,.fsb-select{height:30px}
.fsb-textarea{min-height:54px;resize:vertical;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.fsb-input:focus-visible,.fsb-textarea:focus-visible,.fsb-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}
.fsb-check{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-primary);align-self:flex-start}
.fsb-check input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary)}
.fsb-seg{display:inline-flex;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);gap:2px;align-self:flex-start}
.fsb-seg-item{appearance:none;padding:3px 9px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11.5px;line-height:1.5}
.fsb-seg-item[data-active="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-border-l1)}
.fsb-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding-top:2px}
.fsb-spacer{flex:1}
.fsb-alert{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.55}
.fsb-alert[data-tone="ok"]{border-left-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary)}
.fsb-alert-text{margin:0;min-width:0;overflow-wrap:anywhere}
.fsb-help{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.6}
.fsb-chats{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.fsb-chat{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:10.5px}
.fsb-chat-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fsb-chat-id{font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-tertiary);flex:none}
.fsb-loading{display:flex;flex-direction:column;gap:9px;padding:8px 0}
.fsb-sk{height:9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);animation:fsb-pulse 1.5s ease-in-out infinite}
.fsb-sk:nth-child(1){width:58%}
.fsb-sk:nth-child(2){width:82%}
.fsb-sk:nth-child(3){width:44%}
@keyframes fsb-pulse{0%,100%{opacity:.5}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.fsb-sk{animation:none}}
@media (max-width:620px){.fsb-grid{grid-template-columns:minmax(0,1fr)}.fsb-head{flex-direction:column;align-items:stretch}}
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
      return error instanceof Error ? error.message : String(error);
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
     * Render a string list as one line each.
     * @param {string[]} list - stored list.
     * @returns the text area content.
     */
    function listToLines(list) {
      return Array.isArray(list) ? list.join('\n') : '';
    }

    /**
     * Project the saved configuration into editable fields.
     * @param {object} config - Host configuration payload.
     * @returns the form draft.
     */
    function configToDraft(config) {
      return {
        enabled: config.enabled !== false,
        appId: config.appId ?? '',
        appSecret: '',
        hasSecret: config.hasSecret === true,
        secretSource: config.secretSource ?? 'none',
        domain: config.domain === 'lark' ? 'lark' : 'feishu',
        cwd: config.cwd ?? '',
        agentPreset: config.agentPreset ?? '',
        dmMode: ['open', 'allowlist', 'disabled'].includes(config.dmMode) ? config.dmMode : 'open',
        dmAllowlistText: listToLines(config.dmAllowlist),
        groupAllowlistText: listToLines(config.groupAllowlist),
        requireMention: config.requireMention !== false,
        respondToMentionAll: config.respondToMentionAll === true,
        streaming: config.streaming !== false,
        markdown: config.markdown !== false,
        replyInThread: config.replyInThread === true,
      };
    }

    /**
     * Convert the form draft into the Host save payload.
     * @param {object} draft - form fields.
     * @returns the payload.
     */
    function draftToPayload(draft) {
      return {
        enabled: draft.enabled,
        appId: draft.appId.trim(),
        ...(draft.appSecret.trim() === '' ? {} : { appSecret: draft.appSecret.trim() }),
        domain: draft.domain,
        cwd: draft.cwd.trim(),
        agentPreset: draft.agentPreset.trim(),
        dmMode: draft.dmMode,
        dmAllowlist: parseLines(draft.dmAllowlistText),
        groupAllowlist: parseLines(draft.groupAllowlistText),
        requireMention: draft.requireMention,
        respondToMentionAll: draft.respondToMentionAll,
        streaming: draft.streaming,
        markdown: draft.markdown,
        replyInThread: draft.replyInThread,
      };
    }

    /**
     * Validate the draft before saving or testing.
     * @param {object} draft - form fields.
     * @param {Function} t - translator.
     * @returns {string[]} validation messages.
     */
    function validateDraft(draft, t) {
      const issues = [];
      const appId = draft.appId.trim();
      const secret = draft.appSecret.trim();
      if ((appId === '') !== (secret === '' && !draft.hasSecret)) issues.push(t('missingCredentials'));
      if (secret !== '' && appId === '') issues.push(t('missingCredentials'));
      const cwd = draft.cwd.trim();
      if (cwd !== '' && !cwd.startsWith('/') && !cwd.startsWith('~')) issues.push(t('invalidCwd'));
      return issues;
    }

    /**
     * Format one ISO timestamp for the status line.
     * @param {string|undefined} value - ISO timestamp.
     * @returns a short local time, or an empty string.
     */
    function shortTime(value) {
      if (typeof value !== 'string' || value === '') return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
    }

    /**
     * Map the bridge state to a translated label and tone.
     * @param {string} state - Host state.
     * @param {Function} t - translator.
     * @returns `{ label, tone }`.
     */
    function stateMeta(state, t) {
      if (state === 'connected') return { label: t('statusConnected'), tone: 'ok' };
      if (state === 'connecting') return { label: t('statusConnecting'), tone: 'pending' };
      if (state === 'reconnecting') return { label: t('statusReconnecting'), tone: 'pending' };
      if (state === 'failed') return { label: t('statusFailed'), tone: 'error' };
      if (state === 'not-configured') return { label: t('statusNotConfigured'), tone: 'muted' };
      if (state === 'disabled') return { label: t('statusDisabled'), tone: 'muted' };
      return { label: t('statusIdle'), tone: 'muted' };
    }

    /**
     * Map a policy rejection reason to a translated line.
     * @param {object|undefined} rejected - Host status field.
     * @param {Function} t - translator.
     * @returns a translated reason, or an empty string.
     */
    function rejectText(rejected, t) {
      if (rejected === undefined || rejected === null) return '';
      const keys = {
        no_mention: 'reasonNoMention',
        group_not_allowed: 'reasonGroupNotAllowed',
        sender_not_allowed: 'reasonSenderNotAllowed',
        dm_disabled: 'reasonDmDisabled',
        mention_all_blocked: 'reasonMentionAll',
      };
      const key = keys[rejected.reason];
      return typeof key === 'string' ? t(key) : String(rejected.reason ?? '');
    }

    /**
     * Draw the section icon.
     * @param {{size?: number}} props - icon props.
     * @returns the SVG element.
     */
    function BridgeGlyph({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M3.5 11.2 20 4.5c.6-.2 1.1.3.9.9l-6.7 16.5c-.2.6-1.1.6-1.4 0l-2.4-6.4-6.4-2.4c-.6-.3-.6-1.2.5-1.9Z',
          stroke: 'currentColor',
          strokeWidth: '1.5',
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'm10.4 14.5 5-5.2', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
      );
    }

    /**
     * Render the Settings section.
     * @returns the page element.
     */
    function BridgeSection({ tr }) {
      const t = tr;
      const [page, setPage] = React.useState({ status: 'loading', data: null, error: null });
      const [draft, setDraft] = React.useState(null);
      const [dirty, setDirty] = React.useState(false);
      const [busy, setBusy] = React.useState('');
      const [notice, setNotice] = React.useState(null);
      const [confirmReset, setConfirmReset] = React.useState(false);
      const [issues, setIssues] = React.useState([]);

      /**
       * Load status silently unless nothing is rendered yet.
       * @param {boolean} force - show the loading skeleton.
       */
      const refresh = React.useCallback(async (force = false) => {
        if (force) setPage((previous) => ({ ...previous, status: previous.data === null ? 'loading' : previous.status }));
        try {
          const data = await requestJson(STATE_URL);
          setPage({ status: 'ready', data, error: null });
          setDraft((previous) => (previous === null || !dirty ? configToDraft(data.config) : previous));
        } catch (error) {
          setPage((previous) => ({
            status: previous.data === null ? 'error' : 'ready',
            data: previous.data,
            error: messageOf(error),
          }));
        }
      }, [dirty]);

      React.useEffect(() => {
        void refresh(true);
        return undefined;
      }, []);

      React.useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === 'hidden') return;
          void refresh(false);
        }, 5000);
        return () => clearInterval(timer);
      }, [refresh]);

      /**
       * Update one draft field.
       * @param {string} key - field name.
       * @param {unknown} value - field value.
       */
      function setField(key, value) {
        setDirty(true);
        setIssues([]);
        setDraft((previous) => (previous === null ? previous : { ...previous, [key]: value }));
      }

      /** Save the draft through the profile editor. */
      async function save() {
        if (draft === null) return;
        const found = validateDraft(draft, t);
        if (found.length > 0) {
          setIssues(found);
          return;
        }
        setBusy('save');
        setNotice(null);
        setIssues([]);
        try {
          await requestJson(CONFIG_URL, { method: 'PUT', body: JSON.stringify(draftToPayload(draft)) });
          setDirty(false);
          setNotice({ tone: 'ok', text: t('saved') });
          setPage((previous) => ({
            ...previous,
            data: previous.data === null ? previous.data : { ...previous.data, bridge: { ...previous.data.bridge, state: 'connecting' } },
          }));
          // The row restarts through HMR; poll until the new generation answers.
          for (let attempt = 0; attempt < 12; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            try {
              const data = await requestJson(STATE_URL);
              setPage({ status: 'ready', data, error: null });
              setDraft(configToDraft(data.config));
              if (data.bridge.state !== 'connecting') break;
            } catch {
              // The old generation may be disposing; keep waiting.
            }
          }
        } catch (error) {
          setNotice({ tone: 'error', text: `${t('saveFailed')}: ${messageOf(error)}` });
        } finally {
          setBusy('');
        }
      }

      /** Probe the draft credentials without saving. */
      async function test() {
        if (draft === null) return;
        const found = validateDraft(draft, t);
        const credentialIssue = draft.appId.trim() === '' || (draft.appSecret.trim() === '' && !draft.hasSecret);
        if (found.length > 0 || credentialIssue) {
          setIssues(credentialIssue ? [t('missingCredentials')] : found);
          return;
        }
        setBusy('test');
        setNotice(null);
        setIssues([]);
        try {
          const result = await requestJson(TEST_URL, {
            method: 'POST',
            body: JSON.stringify({ appId: draft.appId.trim(), appSecret: draft.appSecret.trim(), domain: draft.domain }),
          });
          const bot = result.bot?.name ?? result.bot?.openId ?? 'bot';
          setNotice({ tone: 'ok', text: t('testOk', { bot }) });
        } catch (error) {
          setNotice({ tone: 'error', text: `${t('testFailed')}: ${messageOf(error)}` });
        } finally {
          setBusy('');
        }
      }

      /** Reconnect the live socket. */
      async function reconnect() {
        setBusy('reconnect');
        setNotice(null);
        try {
          const result = await requestJson(RECONNECT_URL, { method: 'POST', body: '{}' });
          setPage((previous) => (previous.data === null ? previous : { ...previous, data: { ...previous.data, bridge: result.bridge } }));
          setNotice({ tone: 'ok', text: t('statusConnected') });
        } catch (error) {
          setNotice({ tone: 'error', text: `${t('reconnectFailed')}: ${messageOf(error)}` });
        } finally {
          setBusy('');
        }
      }

      /** Forget every chat binding. */
      async function reset() {
        setBusy('reset');
        setNotice(null);
        try {
          const result = await requestJson(RESET_URL, { method: 'POST', body: '{}' });
          setNotice({ tone: 'ok', text: t('resetDone', { count: result.removed ?? 0 }) });
          setConfirmReset(false);
          await refresh(false);
        } catch (error) {
          setNotice({ tone: 'error', text: messageOf(error) });
        } finally {
          setBusy('');
        }
      }

      if (page.status === 'loading') {
        return h(
          'div',
          { className: 'fsb-page' },
          h('div', { className: 'fsb-loading' }, h('div', { className: 'fsb-sk' }), h('div', { className: 'fsb-sk' }), h('div', { className: 'fsb-sk' })),
        );
      }

      if (page.status === 'error') {
        return h(
          'div',
          { className: 'fsb-page' },
          h(
            'div',
            { className: 'fsb-alert' },
            h('p', { className: 'fsb-alert-text' }, `${t('loadError')}: ${page.error ?? ''}`),
            h('button', { type: 'button', className: 'fsb-button', onClick: () => void refresh(true) }, t('retry')),
          ),
        );
      }

      const data = page.data;
      const bridge = data.bridge ?? {};
      const meta = stateMeta(bridge.state, t);
      const editable = data.editable === true;
      const current = draft ?? configToDraft(data.config);

      return h(
        'div',
        { className: 'fsb-page' },
        h(
          'div',
          { className: 'fsb-head' },
          h(
            'div',
            {},
            h('h3', { className: 'fsb-title' }, t('title')),
            h('p', { className: 'fsb-desc' }, t('description')),
          ),
          h('button', { type: 'button', className: 'fsb-button', disabled: busy !== '', onClick: () => void refresh(true) }, t('refresh')),
        ),

        notice === null
          ? null
          : h(
              'div',
              { className: 'fsb-alert', 'data-tone': notice.tone === 'ok' ? 'ok' : undefined },
              h('p', { className: 'fsb-alert-text' }, notice.text),
              h('button', { type: 'button', className: 'fsb-button', onClick: () => setNotice(null), 'aria-label': t('dismiss') }, '×'),
            ),

        editable ? null : h('div', { className: 'fsb-alert' }, h('p', { className: 'fsb-alert-text' }, t('notEditable'))),
        data.configured ? null : h('div', { className: 'fsb-alert' }, h('p', { className: 'fsb-alert-text' }, t('statusNotConfigured'))),
        bridge.dependency === 'missing'
          ? h('div', { className: 'fsb-alert' }, h('p', { className: 'fsb-alert-text' }, t('dependencyMissing')))
          : null,

        h(
          'div',
          { className: 'fsb-card' },
          h(
            'div',
            { className: 'fsb-card-head' },
            h('h4', { className: 'fsb-card-title' }, t('statusTitle')),
            h(
              'div',
              { className: 'fsb-status' },
              h('span', { className: 'fsb-pill', 'data-tone': meta.tone }, meta.label),
              h(
                'button',
                { type: 'button', className: 'fsb-button', disabled: busy !== '' || !data.configured, onClick: () => void reconnect() },
                busy === 'reconnect' ? t('reconnecting') : t('reconnect'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'fsb-meta' },
            h('span', {}, t('bot'), ': ', h('b', {}, bridge.bot?.name ?? bridge.bot?.openId ?? '—')),
            h('span', {}, t('boundChats'), ': ', h('b', {}, String(bridge.boundChats ?? 0))),
            bridge.connectedAt === undefined ? null : h('span', {}, t('connectedAt'), ': ', h('b', {}, shortTime(bridge.connectedAt))),
          ),
          bridge.lastError ? h('p', { className: 'fsb-error' }, `${t('lastError')}: ${bridge.lastError}`) : null,
          bridge.lastRejected
            ? h(
                'p',
                { className: 'fsb-hint' },
                `${t('lastRejected')}: ${rejectText(bridge.lastRejected, t)}${bridge.lastRejected.at ? ` · ${shortTime(bridge.lastRejected.at)}` : ''}`,
              )
            : null,
          Array.isArray(bridge.recentChats) && bridge.recentChats.length > 0
            ? h(
                'div',
                { className: 'fsb-field' },
                h('span', { className: 'fsb-label' }, t('chats')),
                h(
                  'ul',
                  { className: 'fsb-chats' },
                  bridge.recentChats.map((chat) =>
                    h(
                      'li',
                      { className: 'fsb-chat', key: chat.chatId },
                      h('span', { className: 'fsb-chat-name' }, chat.title ?? chat.chatId),
                      h('span', { className: 'fsb-chat-id' }, chat.chatId),
                    ),
                  ),
                ),
              )
            : h('p', { className: 'fsb-hint' }, t('noChats')),
          h(
            'div',
            { className: 'fsb-actions' },
            h(
              'button',
              {
                type: 'button',
                className: confirmReset ? 'fsb-button fsb-button-danger' : 'fsb-button',
                disabled: busy !== '' || (bridge.boundChats ?? 0) === 0,
                onClick: () => (confirmReset ? void reset() : setConfirmReset(true)),
              },
              confirmReset ? t('confirmReset') : t('reset'),
            ),
            confirmReset
              ? h('button', { type: 'button', className: 'fsb-button', onClick: () => setConfirmReset(false) }, t('dismiss'))
              : null,
          ),
        ),

        issues.length > 0
          ? h('div', { className: 'fsb-alert' }, h('p', { className: 'fsb-alert-text' }, issues.join(' ')))
          : null,

        h(
          'div',
          { className: 'fsb-card' },
          h('h4', { className: 'fsb-card-title' }, t('credentials')),
          h(
            'div',
            { className: 'fsb-grid' },
            h(
              'label',
              { className: 'fsb-field fsb-full' },
              h('span', { className: 'fsb-label' }, t('appId')),
              h('input', {
                className: 'fsb-input',
                value: current.appId,
                placeholder: 'cli_…',
                autoComplete: 'off',
                spellCheck: false,
                disabled: !editable,
                onChange: (event) => setField('appId', event.target.value),
              }),
              h('p', { className: 'fsb-hint' }, t('appIdHint')),
            ),
            h(
              'label',
              { className: 'fsb-field fsb-full' },
              h('span', { className: 'fsb-label' }, t('appSecret')),
              h('input', {
                className: 'fsb-input',
                type: 'password',
                value: current.appSecret,
                placeholder: current.hasSecret ? t('savedSecretPlaceholder') : '',
                autoComplete: 'new-password',
                spellCheck: false,
                disabled: !editable,
                onChange: (event) => setField('appSecret', event.target.value),
              }),
              h('p', { className: 'fsb-hint' }, current.hasSecret ? t('appSecretSaved') : t('appSecretHint')),
            ),
            h(
              'div',
              { className: 'fsb-field' },
              h('span', { className: 'fsb-label' }, t('domain')),
              h(
                'div',
                { className: 'fsb-seg' },
                ['feishu', 'lark'].map((domain) =>
                  h(
                    'button',
                    {
                      key: domain,
                      type: 'button',
                      className: 'fsb-seg-item',
                      'data-active': current.domain === domain ? 'true' : 'false',
                      disabled: !editable,
                      onClick: () => setField('domain', domain),
                    },
                    domain === 'lark' ? t('domainLark') : t('domainFeishu'),
                  ),
                ),
              ),
            ),
            h(
              'label',
              { className: 'fsb-check', style: { alignSelf: 'end', paddingBottom: '6px' } },
              h('input', {
                type: 'checkbox',
                checked: current.enabled,
                disabled: !editable,
                onChange: (event) => setField('enabled', event.target.checked),
              }),
              t('enabled'),
            ),
          ),
          h(
            'div',
            { className: 'fsb-actions' },
            h(
              'button',
              { type: 'button', className: 'fsb-button fsb-button-primary', disabled: !editable || busy !== '', onClick: () => void save() },
              busy === 'save' ? t('saving') : t('save'),
            ),
            h(
              'button',
              { type: 'button', className: 'fsb-button', disabled: busy !== '' || !editable, onClick: () => void test() },
              busy === 'test' ? t('testing') : t('test'),
            ),
          ),
        ),

        h(
          'div',
          { className: 'fsb-card' },
          h('h4', { className: 'fsb-card-title' }, t('behavior')),
          h(
            'div',
            { className: 'fsb-grid' },
            h(
              'label',
              { className: 'fsb-field' },
              h('span', { className: 'fsb-label' }, t('cwd')),
              h('input', {
                className: 'fsb-input',
                value: current.cwd,
                placeholder: '/path/to/project',
                disabled: !editable,
                onChange: (event) => setField('cwd', event.target.value),
              }),
              h('p', { className: 'fsb-hint' }, t('cwdHint')),
            ),
            h(
              'label',
              { className: 'fsb-field' },
              h('span', { className: 'fsb-label' }, t('preset')),
              h('input', {
                className: 'fsb-input',
                value: current.agentPreset,
                placeholder: 'standard',
                disabled: !editable,
                onChange: (event) => setField('agentPreset', event.target.value),
              }),
              h('p', { className: 'fsb-hint' }, t('presetHint')),
            ),
            h(
              'label',
              { className: 'fsb-field' },
              h('span', { className: 'fsb-label' }, t('dmMode')),
              h(
                'select',
                {
                  className: 'fsb-select',
                  value: current.dmMode,
                  disabled: !editable,
                  onChange: (event) => setField('dmMode', event.target.value),
                },
                h('option', { value: 'open' }, t('dmOpen')),
                h('option', { value: 'allowlist' }, t('dmAllowlist')),
                h('option', { value: 'disabled' }, t('dmDisabled')),
              ),
            ),
            h('div', { className: 'fsb-field' }),
            h(
              'label',
              { className: 'fsb-field' },
              h('span', { className: 'fsb-label' }, t('dmAllowlistLabel')),
              h('textarea', {
                className: 'fsb-textarea',
                value: current.dmAllowlistText,
                disabled: !editable || current.dmMode !== 'allowlist',
                onChange: (event) => setField('dmAllowlistText', event.target.value),
              }),
              h('p', { className: 'fsb-hint' }, t('dmAllowlistHint')),
            ),
            h(
              'label',
              { className: 'fsb-field' },
              h('span', { className: 'fsb-label' }, t('groupAllowlist')),
              h('textarea', {
                className: 'fsb-textarea',
                value: current.groupAllowlistText,
                disabled: !editable,
                onChange: (event) => setField('groupAllowlistText', event.target.value),
              }),
              h('p', { className: 'fsb-hint' }, t('groupAllowlistHint')),
            ),
            h(
              'div',
              { className: 'fsb-field fsb-full' },
              h(
                'label',
                { className: 'fsb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: current.requireMention,
                  disabled: !editable,
                  onChange: (event) => setField('requireMention', event.target.checked),
                }),
                t('requireMention'),
              ),
              h(
                'label',
                { className: 'fsb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: current.respondToMentionAll,
                  disabled: !editable,
                  onChange: (event) => setField('respondToMentionAll', event.target.checked),
                }),
                t('respondToMentionAll'),
              ),
              h(
                'label',
                { className: 'fsb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: current.streaming,
                  disabled: !editable,
                  onChange: (event) => setField('streaming', event.target.checked),
                }),
                t('streaming'),
              ),
              h(
                'label',
                { className: 'fsb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: current.markdown,
                  disabled: !editable,
                  onChange: (event) => setField('markdown', event.target.checked),
                }),
                t('markdown'),
              ),
              h(
                'label',
                { className: 'fsb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: current.replyInThread,
                  disabled: !editable,
                  onChange: (event) => setField('replyInThread', event.target.checked),
                }),
                t('replyInThread'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'fsb-actions' },
            h(
              'button',
              { type: 'button', className: 'fsb-button', disabled: !editable || busy !== '' || !dirty, onClick: () => void save() },
              busy === 'save' ? t('saving') : t('save'),
            ),
          ),
        ),

        h(
          'div',
          { className: 'fsb-card' },
          h('h4', { className: 'fsb-card-title' }, t('setupTitle')),
          h('p', { className: 'fsb-help' }, t('setup')),
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
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'feishu-bridge: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/feishu-bridge/settings.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/feishu-bridge';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'feishu-bridge: styles');

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'feishu',
              order: 35,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ tr: t }),
            },
            BridgeSection,
          ),
        );

        ctx.slots.inject('settings.section.icon', () =>
          ctx.slots.register(
            {
              name: 'settings.section.icon',
              id: 'feishu',
              locale: NS,
            },
            BridgeGlyph,
          ),
        );
      },
    };
  },
});