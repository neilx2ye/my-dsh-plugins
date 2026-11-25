/**
 * Browser half of the Shopify GraphQL workbench.
 *
 * A persistent right-side panel with three views:
 * - Pending: inspect a mutation's human summary, variables, field tree, and raw
 *   document, then approve or reject the exact stored request.
 * - History: inspect recent executions and turn one into a reusable tool.
 * - Tools: enable/disable/delete saved tools and invoke them with parameters.
 *
 * The panel polls the Host for compact state every two seconds and lazily loads
 * one request, history entry, or tool definition on selection.
 */
window.__ModuleLoader__.load({
  id: '@local/shopify-graphql',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'shopifyGraphql'
    const TAB_ID = '@local/shopify-graphql/panel'
    const TAB_KIND = 'shopifyGraphql'
    const API = 'api/shopify-graphql/'

    const EN = {
      'tab.title': 'Shopify',
      'tab.guide': 'Approve Shopify writes and manage saved GraphQL tools',
      'tab.pending': 'Pending',
      'tab.history': 'History',
      'tab.tools': 'Tools',
      'tab.policy': 'Settings',
      'empty.pending': 'No write operation is waiting for approval.',
      'empty.history': 'No GraphQL execution yet.',
      'empty.tools': 'No saved tool yet. Run something first, then save it from History.',
      'header.pendingCount': 'waiting',
      'header.read': 'read',
      'header.write': 'write',
      'header.configured': 'configured',
      'header.missing': 'missing',
      'header.infisical': 'Infisical',
      'action.approve': 'Approve and run',
      'action.reject': 'Reject',
      'action.save': 'Save as tool',
      'action.run': 'Run now',
      'action.enable': 'Enable',
      'action.disable': 'Disable',
      'action.delete': 'Delete',
      'action.confirmDelete': 'Confirm delete',
      'action.cancel': 'Cancel',
      'action.viewDocument': 'Raw GraphQL',
      'action.openSettings': 'Open Settings',
      'label.summary': 'Summary',
      'label.store': 'Store',
      'label.operation': 'Operation',
      'label.created': 'Created',
      'label.expires': 'Expires',
      'label.resources': 'Resources',
      'label.variables': 'Variables',
      'label.fields': 'Fields',
      'label.risk': 'Risk',
      'label.requestId': 'Request',
      'label.duration': 'Duration',
      'label.decision': 'Decision',
      'label.status': 'Status',
      'label.params': 'Parameters',
      'label.result': 'Result',
      'label.fixed': 'fixed',
      'label.expose': 'Expose as parameter',
      'label.description': 'Description',
      'label.name': 'Tool name',
      'label.title': 'Title',
      'label.operationType': 'Type',
      'label.enabled': 'Enabled',
      'label.readOnly': 'Read only',
      'label.blocked': 'Blocked fields',
      'label.policyPath': 'File',
      'label.policyHash': 'Hash',
      'section.stores': 'Stores',
      'settings.advanced': 'Advanced settings',
      'settings.settingsFile': 'Store configuration file',
      'settings.configureVault': 'Configure Infisical',
      'settings.vaultPath': 'Write secret',
      'settings.vaultUnavailable': 'Save the Infisical connection before adding a vault-backed store.',
      'settings.confirmRemove': 'Remove this store from the panel?',
      'settings.confirmClear': 'Clear the Infisical connection?',
      'settings.confirmClearToken': 'Clear this saved token?',
      'settings.tokenCleared': 'Token cleared',
      'settings.vaultInUse': 'Remove stores that use this vault before clearing its connection.',
      'settings.tokenHint': 'Saved in the local credential store and not displayed again.',
      'settings.configureTokens': 'Store added. Set its credentials below.',
      'settings.storeKeyPreview': 'Local store key:',
      'settings.badDomain': 'Enter a valid myshopify.com domain.',
      'settings.badStoreKey': 'Use 1–41 lowercase letters, digits, hyphens or underscores. Start with a letter or digit.',
      'settings.existingStoreKey': 'This local key is already in use.',
      'settings.baseUrl': 'Base URL',
      'settings.projectId': 'Project ID',
      'settings.environment': 'Environment',
      'settings.pathPrefix': 'Secret path prefix',
      'settings.clientIdRef': 'Client ID reference',
      'settings.clientSecretRef': 'Client secret reference',
      'store.empty': 'Start with your Shopify domain. Settings apply only to this DSH user.',
      'store.configManaged': 'bundle config',
      'store.remove': 'Remove',
      'store.add': 'Add a store',
      'store.addButton': 'Add store',
      'store.removed': 'Store removed',
      'store.id': 'Local store key',
      'store.idHint': 'Defaults to the domain prefix. To reuse a write token, enter the key used by the old project.',
      'store.domain': 'Shopify domain',
      'store.label': 'Display name (optional)',
      'store.apiVersion': 'API version',
      'store.writeProvider': 'Where to read the write token',
      'store.local': 'Local credential store',
      'infisical.configured': 'Connection settings saved. Authentication is checked when the vault is used.',
      'infisical.missing': 'Set up Infisical here to use a vault-managed write token.',
      'infisical.save': 'Save connection',
      'infisical.clear': 'Clear',
      'infisical.saved': 'Connection saved',
      'infisical.cleared': 'Connection cleared',
      'section.identity': 'Machine identity',
      'identity.clientId': 'Client ID',
      'identity.clientSecret': 'Client secret',
      'identity.hint': 'Stored in this device credential store; used only to log in to Infisical.',
      'section.tokens': 'Access tokens',
      'section.policy': 'Store policy',
      'section.infisical': 'Infisical',
      'token.read': 'Read token',
      'token.write': 'Write token',
      'token.save': 'Save',
      'token.clear': 'Clear',
      'token.configured': 'configured',
      'token.missing': 'not set',
      'token.placeholder': 'Paste a token',
      'token.saved': 'Token saved',
      'token.managed': 'managed by Infisical',
      'token.externalHint': 'Read on demand from Infisical; edit it there.',
      'risk.write': 'write',
      'risk.destructive': 'destructive',
      'risk.publish': 'publish',
      'risk.bulk': 'bulk',
      'risk.large': 'large',
      'risk.introspection': 'introspection',
      'risk.unresolved-variable': 'unresolved variable',
      'status.ok': 'ok',
      'status.error': 'error',
      'status.rejected': 'rejected',
      'status.timeout': 'timeout',
      'status.cancelled': 'cancelled',
      'status.running': 'running',
      'status.loading': 'loading',
      'decision.auto': 'read: auto',
      'decision.approved': 'approved',
      'decision.rejected': 'rejected',
      'decision.timeout': 'timeout',
      'decision.cancelled': 'cancelled',
      'decision.manual': 'manual run',
      'note.writeWarning': 'This is a write operation. Approval binds to the exact document and variables below.',
      'note.manualWrite': 'This is a write operation. Clicking Run now uses the write token immediately.',
      'note.noWriteToken': 'No write token is configured for this store; mutations will fail before approval.',
      'note.noReadToken': 'No read token is configured for this store; queries will fail.',
      'form.name': 'Tool name (shopify_ prefix added if missing)',
      'form.title': 'Display title',
      'form.description': 'Description shown to the model',
      'form.variable': 'Variable',
      'form.type': 'Type',
      'form.value': 'Current value',
      'form.exposed': 'Expose',
      'form.paramDescription': 'Parameter description',
      'form.save': 'Save',
      'form.saving': 'Saving…',
      'form.running': 'Running…',
      'form.invokeVariables': 'Parameters',
      'form.required': 'required',
      'error.title': 'The panel could not refresh',
      'error.save': 'Save failed',
      'error.decide': 'Decision failed',
      'error.invoke': 'Run failed',
      'error.load': 'Load failed',
      'misc.noStore': 'No Shopify store is configured.',
      'misc.storeFileHint': 'Add your Shopify domain and credentials in Settings.',
      'misc.pendingHint': 'The agent is waiting for your decision.',
      'misc.saved': 'Saved',
      'misc.select': 'Select an item',
      'misc.bytes': 'bytes',
    }

    const ZH = {
      'tab.title': 'Shopify',
      'tab.guide': '审批 Shopify 写操作，管理已保存的 GraphQL 工具',
      'tab.pending': '待审批',
      'tab.history': '历史',
      'tab.tools': '工具',
      'tab.policy': '设置',
      'empty.pending': '没有等待审批的写操作。',
      'empty.history': '还没有执行过 GraphQL。',
      'empty.tools': '还没有保存的工具。先执行一次，然后在历史里保存。',
      'header.pendingCount': '待批',
      'header.read': '读',
      'header.write': '写',
      'header.configured': '已配置',
      'header.missing': '未配置',
      'header.infisical': 'Infisical',
      'action.approve': '批准并执行',
      'action.reject': '拒绝',
      'action.save': '保存为工具',
      'action.run': '立即执行',
      'action.enable': '启用',
      'action.disable': '禁用',
      'action.delete': '删除',
      'action.confirmDelete': '确认删除',
      'action.cancel': '取消',
      'action.viewDocument': '原始 GraphQL',
      'action.openSettings': '打开设置',
      'label.summary': '摘要',
      'label.store': '店铺',
      'label.operation': '操作',
      'label.created': '创建时间',
      'label.expires': '过期时间',
      'label.resources': '资源',
      'label.variables': '变量',
      'label.fields': '字段',
      'label.risk': '风险',
      'label.requestId': '请求',
      'label.duration': '耗时',
      'label.decision': '决策',
      'label.status': '状态',
      'label.params': '参数',
      'label.result': '结果',
      'label.fixed': '固定值',
      'label.expose': '暴露为参数',
      'label.description': '描述',
      'label.name': '工具名',
      'label.title': '标题',
      'label.operationType': '类型',
      'label.enabled': '启用',
      'label.readOnly': '只读',
      'label.blocked': '禁止字段',
      'label.policyPath': '文件',
      'label.policyHash': '哈希',
      'section.stores': '店铺',
      'settings.advanced': '高级设置',
      'settings.settingsFile': '店铺配置文件',
      'settings.configureVault': '配置 Infisical',
      'settings.vaultPath': '写令牌位置',
      'settings.vaultUnavailable': '使用 Infisical 写令牌前，请先保存连接参数。',
      'settings.confirmRemove': '确定从面板移除此店铺？',
      'settings.confirmClear': '确定清除 Infisical 连接？',
      'settings.confirmClearToken': '确定清除已保存的令牌？',
      'settings.tokenCleared': '令牌已清除',
      'settings.vaultInUse': '清除连接前，请先移除使用此 Vault 的店铺。',
      'settings.tokenHint': '保存到本机凭据库，保存后不再显示。',
      'settings.configureTokens': '店铺已添加，可在下方配置令牌。',
      'settings.storeKeyPreview': '本地标识：',
      'settings.badDomain': '请输入有效的 myshopify.com 域名。',
      'settings.badStoreKey': '用 1–41 位小写字母、数字、连字符或下划线，首位须为字母或数字。',
      'settings.existingStoreKey': '此本地标识已被使用。',
      'settings.baseUrl': '服务地址',
      'settings.projectId': '项目 ID',
      'settings.environment': '环境',
      'settings.pathPrefix': '密钥路径前缀',
      'settings.clientIdRef': 'Client ID 引用名',
      'settings.clientSecretRef': 'Client Secret 引用名',
      'store.empty': '先填 Shopify 域名。配置仅对当前 DSH 用户可见。',
      'store.configManaged': 'bundle 配置',
      'store.remove': '移除',
      'store.add': '添加店铺',
      'store.addButton': '添加',
      'store.removed': '店铺已移除',
      'store.id': '本地店铺标识',
      'store.idHint': '默认取域名前缀。复用旧写令牌时，填旧项目使用的标识。',
      'store.domain': 'Shopify 店铺域名',
      'store.label': '显示名（选填）',
      'store.apiVersion': 'API 版本',
      'store.writeProvider': '写令牌从哪里读取',
      'store.local': '本机凭据库',
      'infisical.configured': '连接参数已保存，实际用到 Vault 时才会验证身份。',
      'infisical.missing': '要使用 Vault 中的写令牌，请先在这里配置 Infisical。',
      'infisical.save': '保存连接',
      'infisical.clear': '清除',
      'infisical.saved': '连接已保存',
      'infisical.cleared': '连接已清除',
      'section.identity': '机器身份',
      'identity.clientId': 'Client ID',
      'identity.clientSecret': 'Client secret',
      'identity.hint': '存在本机凭据库，仅用于登录 Infisical。',
      'section.tokens': '访问 token',
      'section.policy': '店铺策略',
      'section.infisical': 'Infisical',
      'token.read': '只读 token',
      'token.write': '可写 token',
      'token.save': '保存',
      'token.clear': '清除',
      'token.configured': '已配置',
      'token.missing': '未配置',
      'token.placeholder': '粘贴令牌',
      'token.saved': 'Token 已保存',
      'token.managed': '由 Infisical 管理',
      'token.externalHint': '按需从 Infisical 读取；请到 Infisical 修改。',
      'risk.write': '写操作',
      'risk.destructive': '破坏性',
      'risk.publish': '发布',
      'risk.bulk': '批量',
      'risk.large': '体积大',
      'risk.introspection': '内省',
      'risk.unresolved-variable': '变量未解析',
      'status.ok': '成功',
      'status.error': '错误',
      'status.rejected': '已拒绝',
      'status.timeout': '已超时',
      'status.cancelled': '已取消',
      'status.running': '执行中',
      'status.loading': '加载中',
      'decision.auto': '只读：自动执行',
      'decision.approved': '已批准',
      'decision.rejected': '已拒绝',
      'decision.timeout': '超时',
      'decision.cancelled': '已取消',
      'decision.manual': '手动执行',
      'note.writeWarning': '这是写操作。批准只对下面这份文档和变量生效，执行前请确认。',
      'note.manualWrite': '这是写操作。点击“立即执行”会立刻使用写 token。',
      'note.noWriteToken': '该店铺没有配置写 token；写操作会在审批之前失败。',
      'note.noReadToken': '该店铺没有配置读 token；查询会失败。',
      'form.name': '工具名（缺少 shopify_ 前缀会自动补上）',
      'form.title': '显示标题',
      'form.description': '给模型看的描述',
      'form.variable': '变量',
      'form.type': '类型',
      'form.value': '当前值',
      'form.exposed': '暴露',
      'form.paramDescription': '参数描述',
      'form.save': '保存',
      'form.saving': '保存中…',
      'form.running': '执行中…',
      'form.invokeVariables': '参数',
      'form.required': '必填',
      'error.title': '面板刷新失败',
      'error.save': '保存失败',
      'error.decide': '决策失败',
      'error.invoke': '执行失败',
      'error.load': '加载失败',
      'misc.noStore': '还没有配置 Shopify 店铺。',
      'misc.storeFileHint': '在设置里添加 Shopify 店铺域名和凭据。',
      'misc.pendingHint': 'Agent 正在等待你的决定。',
      'misc.saved': '已保存',
      'misc.select': '请选择一项',
      'misc.bytes': '字节',
    }

    const STYLE = `
.sq-root { display:flex; flex-direction:column; height:100%; min-height:0; font-size:12px; color:var(--dsw-alias-label-primary); }
.sq-header { padding:8px 10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.sq-title-row { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
.sq-title { font-weight:600; font-size:13px; flex:1; }
.sq-tokens { display:flex; gap:4px; flex-wrap:wrap; }
.sq-token { font-size:10px; padding:1px 5px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-tertiary); }
.sq-token.on { color:var(--dsw-alias-label-secondary); }
.sq-tabs { display:flex; gap:2px; }
.sq-tab { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-tertiary); padding:6px 8px; font-size:12px; cursor:pointer; border-bottom:2px solid transparent; }
.sq-tab.active { color:var(--dsw-alias-label-primary); border-bottom-color:var(--dsw-alias-brand-primary); }
.sq-count { display:inline-block; min-width:14px; padding:0 4px; margin-left:4px; border-radius:999px; background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground); font-size:10px; line-height:14px; text-align:center; }
.sq-body { flex:1; min-height:0; overflow:auto; padding:8px 10px 16px; }
.sq-card { border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-2); padding:8px; margin-bottom:8px; }
.sq-card.clickable { cursor:pointer; }
.sq-card.clickable:hover { background:var(--dsw-alias-card-fill-hover); }
.sq-card.selected { border-color:var(--dsw-alias-border-selected); }
.sq-row { display:flex; gap:6px; align-items:baseline; margin:3px 0; }
.sq-k { color:var(--dsw-alias-label-tertiary); min-width:52px; flex:none; }
.sq-v { flex:1; min-width:0; word-break:break-word; }
.sq-summary { font-weight:600; line-height:1.45; margin-bottom:4px; }
.sq-meta { color:var(--dsw-alias-label-tertiary); font-size:11px; }
.sq-chips { display:flex; gap:4px; flex-wrap:wrap; margin:4px 0; }
.sq-chip { font-size:10px; padding:1px 6px; border-radius:999px; border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); }
.sq-chip.red { color:var(--dsw-alias-state-error-primary); border-color:currentColor; }
.sq-chip.blue { color:var(--dsw-alias-link); border-color:currentColor; }
.sq-chip.amber { color:var(--dsw-alias-state-warn-primary); border-color:currentColor; }
.sq-chip.purple { color:var(--dsw-alias-json-tree-keyword); border-color:currentColor; }
.sq-warn { border:1px solid var(--dsw-alias-state-warn-primary); background:var(--dsw-alias-state-warn-tertiary); color:var(--dsw-alias-state-warn-label); border-radius:6px; padding:6px 8px; margin:6px 0; line-height:1.5; }
.sq-pre { margin:6px 0 0; padding:8px; border-radius:6px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); overflow:auto; max-height:260px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; line-height:1.5; white-space:pre; }
.sq-token-k { color:var(--dsw-alias-json-tree-keyword); }
.sq-token-s { color:var(--dsw-alias-json-tree-string); }
.sq-token-v { color:var(--dsw-alias-json-tree-property); }
.sq-token-c { color:var(--dsw-alias-label-tertiary); font-style:italic; }
.sq-token-n { color:var(--dsw-alias-json-tree-number); }
.sq-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
.sq-btn { appearance:none; border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-primary); border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer; }
.sq-btn:hover { background:var(--dsw-alias-interactive-bg-hover); }
.sq-btn.primary { background:var(--dsw-alias-button-primary-fill); border-color:transparent; color:var(--dsw-alias-label-primary-foreground); }
.sq-btn.primary:hover { background:var(--dsw-alias-button-primary-hover); }
.sq-btn.danger { color:var(--dsw-alias-state-error-primary); border-color:currentColor; }
.sq-btn:disabled { opacity:.5; cursor:default; }
.sq-btn.link { border:0; background:transparent; padding:2px 4px; color:var(--dsw-alias-link); }
.sq-empty { color:var(--dsw-alias-label-tertiary); text-align:center; padding:28px 12px; line-height:1.6; }
.sq-error { color:var(--dsw-alias-state-error-primary); border:1px solid currentColor; border-radius:6px; padding:6px 8px; margin:6px 0; line-height:1.5; }
.sq-field { display:flex; flex-direction:column; gap:3px; margin:6px 0; }
.sq-field > span { color:var(--dsw-alias-label-tertiary); font-size:11px; }
.sq-input, .sq-textarea, .sq-select { width:100%; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l1); border-radius:6px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); padding:4px 6px; font-size:12px; }
.sq-textarea { min-height:54px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; resize:vertical; }
.sq-var-row { display:flex; gap:6px; align-items:center; }
.sq-var-row .sq-input { flex:1; }
.sq-check { display:flex; gap:4px; align-items:center; color:var(--dsw-alias-label-secondary); font-size:11px; }
.sq-tree { margin:4px 0 0; padding-left:10px; border-left:1px dashed var(--dsw-alias-border-l1); }
.sq-tree-node { margin:2px 0; }
.sq-tree-name { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; }
.sq-divider { height:1px; background:var(--dsw-alias-border-l1); margin:8px 0; }
.sq-toolbar { display:flex; gap:6px; align-items:center; margin-bottom:8px; }
.sq-toolbar .sq-input { flex:1; }
.sq-note { color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:1.5; margin:4px 0; }
.sq-badge { font-size:10px; border:1px solid var(--dsw-alias-border-l2); border-radius:4px; padding:0 4px; color:var(--dsw-alias-label-tertiary); }
.sq-settings { display:grid; gap:14px; min-width:0; font-size:13px; line-height:1.5; }
.sq-settings-panel { min-width:0; padding:14px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-card-fill); }
.sq-settings-title { margin:0; font-size:14px; font-weight:600; }
.sq-settings .sq-note, .sq-settings .sq-meta { font-size:12px; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }
.sq-settings .sq-field { gap:5px; margin:0; min-width:0; }
.sq-settings .sq-field > span { font-size:12px; color:var(--dsw-alias-label-secondary); }
.sq-settings .sq-input, .sq-settings .sq-select, .sq-settings .sq-btn { min-height:34px; min-width:0; font-size:13px; }
.sq-settings .sq-input, .sq-settings .sq-select { padding:6px 9px; }
.sq-settings .sq-select { color-scheme:light; }
body[data-ds-dark-theme] .sq-settings .sq-select { color-scheme:dark; }
.sq-settings .sq-input::placeholder { color:var(--dsw-alias-label-secondary); }
.sq-settings :is(button, input, select, summary):focus-visible { outline:2px solid var(--dsw-alias-label-primary); outline-offset:2px; }
.sq-settings .sq-btn.primary:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover); }
.sq-settings .sq-actions { gap:8px; margin-top:0; }
.sq-settings-form { display:grid; gap:10px; margin-top:12px; }
.sq-settings-details { min-width:0; }
.sq-settings-details > summary { width:fit-content; max-width:100%; padding:4px 0; cursor:pointer; font-weight:500; }
.sq-settings-details[open] > summary { margin-bottom:8px; }
.sq-settings-details .sq-settings-form { margin-top:0; }
.sq-settings-stores { list-style:none; padding:0; margin:10px 0; }
.sq-settings-store { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.sq-settings-store > button:first-child { flex:1 1 12em; text-align:start; padding:5px 8px; overflow-wrap:anywhere; }
.sq-settings-store [aria-pressed="true"] { border-color:var(--dsw-alias-border-selected); background:var(--dsw-alias-interactive-bg-active); }
.sq-settings-store .sq-meta { display:block; }
.sq-settings .sq-var-row { flex-wrap:wrap; gap:8px; }
.sq-settings .sq-var-row > .sq-field { flex:1 1 12em; }
.sq-settings .sq-var-row > .sq-btn { flex:none; align-self:end; }
.sq-settings .sq-divider { margin:12px 0; }
.sq-settings .sq-notice { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-interactive-bg-active); border-radius:6px; padding:6px 8px; margin:8px 0; }
.sq-settings code { overflow-wrap:anywhere; }

`

    /**
     * Fetch JSON and surface the Host's code/message on failure.
     * @param {string} url - relative URL.
     * @param {RequestInit} [init] - fetch options.
     * @returns parsed JSON.
     */
    async function requestJson(url, init) {
      const response = await fetch(url, init)
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const error = new Error(data?.message || `HTTP ${response.status}`)
        error.code = data?.code
        throw error
      }
      return data
    }

    /**
     * POST one JSON body.
     * @param {string} route - route under the plugin prefix.
     * @param {object} body - JSON body.
     * @returns parsed JSON.
     */
    function post(route, body) {
      return requestJson(`${API}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    /**
     * Read a field from a lazy tool argument reader without throwing.
     * @returns text or an empty string.
     */
    function formatTime(value) {
      if (typeof value !== 'string') return ''
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
    }

    /** @returns pretty JSON with a length cap. */
    function pretty(value, max = 4000) {
      let text
      try {
        text = JSON.stringify(value, null, 2)
      } catch {
        text = String(value)
      }
      if (text === undefined) return ''
      return text.length > max ? `${text.slice(0, max)}…[truncated]` : text
    }

    /** @returns a short single-line value. */
    function inline(value) {
      if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 160)}…` : value
      const text = pretty(value, 160)
      return text.replace(/\s+/g, ' ').trim()
    }

    /**
     * Build a tiny observable store.
     * @returns get/set/subscribe.
     */
    function createStore() {
      let snapshot = { status: 'loading', data: null, error: null }
      const listeners = new Set()
      return {
        get: () => snapshot,
        set: next => {
          snapshot = next
          for (const listener of listeners) listener()
        },
        subscribe: listener => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    /**
     * Subscribe a component to a store.
     * @param store - observable store.
     * @returns current snapshot.
     */
    function useSnapshot(store) {
      const [snapshot, setSnapshot] = React.useState(store.get())
      React.useEffect(() => {
        const unsubscribe = store.subscribe(() => setSnapshot(store.get()))
        return () => {
          unsubscribe()
        }
      }, [store])
      return snapshot
    }

    /**
     * Load one detail resource on selection.
     * @param route - route name.
     * @param id - selected id.
     * @param key - payload key.
     * @returns detail value.
     */
    function useDetail(route, id, key) {
      const [detail, setDetail] = React.useState(null)
      const [error, setError] = React.useState(null)
      React.useEffect(() => {
        if (typeof id !== 'string' || id === '') {
          setDetail(null)
          setError(null)
          return undefined
        }
        let alive = true
        setError(null)
        requestJson(`${API}${route}?id=${encodeURIComponent(id)}`)
          .then(data => {
            if (alive) setDetail(data[key] ?? null)
          })
          .catch(cause => {
            if (alive) setError(cause.message)
          })
        return () => {
          alive = false
        }
      }, [route, id, key])
      return { detail, error }
    }

    /**
     * Highlight a GraphQL document without trusting it as HTML.
     * @param document - GraphQL text.
     * @returns React nodes.
     */
    function highlight(document) {
      const pattern = /("(?:\\.|[^"\\])*"|#[^\n]*|\$[A-Za-z_][A-Za-z0-9_]*|\b(?:query|mutation|fragment|on|true|false|null)\b|\b\d+(?:\.\d+)?\b)/g
      const parts = String(document ?? '').split(pattern)
      return parts.map((part, index) => {
        if (part === '') return null
        let className = ''
        if (part.startsWith('"')) className = 'sq-token-s'
        else if (part.startsWith('#')) className = 'sq-token-c'
        else if (part.startsWith('$')) className = 'sq-token-v'
        else if (/^(query|mutation|fragment|on|true|false|null)$/.test(part)) className = 'sq-token-k'
        else if (/^\d/.test(part)) className = 'sq-token-n'
        return className === ''
          ? part
          : h('span', { key: index, className }, part)
      })
    }

    /**
     * The Shopify tab glyph: a shopping bag with a small node graph inside.
     * Monochrome and currentColor so it follows the host theme.
     * @param props - size and optional class from the slot or guide renderer.
     * @returns inline SVG.
     */
    function ShopifyGlyph(props) {
      const size = props?.size ?? 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 20 20',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: props?.className,
        'aria-hidden': true,
        style: { flex: 'none', display: 'block' },
      },
      h('path', { d: 'M4.5 7.5h11l-1 8.4a1.6 1.6 0 0 1-1.6 1.4H7.1a1.6 1.6 0 0 1-1.6-1.4L4.5 7.5Z' }),
      h('path', { d: 'M7.4 7.5V6a2.6 2.6 0 0 1 5.2 0v1.5' }),
      h('path', { d: 'M9.8 12.2 12 13.4' }),
      h('circle', { cx: '8.6', cy: '11.4', r: '1.4', fill: 'currentColor', stroke: 'none' }),
      h('circle', { cx: '12.4', cy: '13.6', r: '1.1', fill: 'currentColor', stroke: 'none' }),
      )
    }

    function Chip({ tone, children }) {
      return h('span', { className: `sq-chip ${tone ?? ''}` }, children)
    }

    function Empty({ children }) {
      return h('div', { className: 'sq-empty' }, children)
    }

    function Row({ label, children }) {
      return h('div', { className: 'sq-row' }, h('span', { className: 'sq-k' }, label), h('div', { className: 'sq-v' }, children))
    }

    function Field({ label, children }) {
      return h('label', { className: 'sq-field' }, h('span', null, label), children)
    }

    function Tree({ node, t }) {
      if (node === null || typeof node !== 'object') return null
      return h('div', { className: 'sq-tree-node' },
        h('div', { className: 'sq-tree-name' }, node.name),
        Array.isArray(node.children) && node.children.length > 0
          ? h('div', { className: 'sq-tree' }, node.children.map((child, index) => h(Tree, { key: index, node: child, t })))
          : null,
      )
    }

    /**
     * Build the panel component bound to the plugin's store and refresh.
     * @param ctx - client context.
     * @param store - state store.
     * @param refresh - state refresh function.
     * @returns panel component.
     */
    function makePanel(ctx, store, refresh) {
      /**
       * The panel shell. All hooks live here; detail views are separate
       * components so their own hooks keep stable identities.
       */
      function Panel(props) {
        const t = props.t ?? (key => key)
        const snapshot = useSnapshot(store)
        const data = snapshot.data
        const [tab, setTab] = React.useState('pending')
        const [selectedRequest, setSelectedRequest] = React.useState(null)
        const [selectedHistory, setSelectedHistory] = React.useState(null)
        const [selectedTool, setSelectedTool] = React.useState(null)
        const [notice, setNotice] = React.useState(null)
        const previousPending = React.useRef(0)

        const pending = data?.pending ?? []
        const history = data?.history ?? []
        const tools = data?.tools ?? []
        const stores = data?.stores ?? []

        React.useEffect(() => {
          if (pending.length === 0) {
            setSelectedRequest(null)
          } else if (selectedRequest === null || !pending.some(item => item.id === selectedRequest)) {
            setSelectedRequest(pending[0].id)
          }
          if (pending.length > previousPending.current) setTab('pending')
          previousPending.current = pending.length
        }, [data?.pending, selectedRequest])

        const requestState = useDetail('request', selectedRequest, 'request')
        const historyState = useDetail('history', selectedHistory, 'entry')
        const toolState = useDetail('tool', selectedTool, 'tool')

        const readConfigured = stores.some(row => row.read?.provider === 'infisical' || row.read?.configured === true)
        const writeConfigured = stores.some(row => row.write?.provider === 'infisical' || row.write?.configured === true)
        const writeExternal = stores.some(row => row.write?.provider === 'infisical')

        async function decide(id, decision) {
          try {
            await post('decide', { id, decision })
            setNotice(null)
            await refresh()
          } catch (error) {
            setNotice({ kind: 'error', text: `${t('error.decide')}: ${error.message}` })
          }
        }

        const tabs = [
          ['pending', t('tab.pending'), pending.length],
          ['history', t('tab.history'), null],
          ['tools', t('tab.tools'), null],
          ['policy', t('tab.policy'), null],
        ]

        function renderNoStore() {
          return h(Empty, null,
            h('div', null, t('misc.noStore')),
            h('div', { className: 'sq-note', style: { marginTop: 8 } }, t('misc.storeFileHint')),
            h('div', { className: 'sq-actions', style: { justifyContent: 'center' } },
              h('button', { className: 'sq-btn primary', onClick: () => setTab('policy') }, t('action.openSettings'))),
          )
        }

        function renderPending() {
          if (stores.length === 0) return renderNoStore()
          if (!writeConfigured) return h(Empty, null, t('note.noWriteToken'))
          if (pending.length === 0) return h(Empty, null, t('empty.pending'))
          const request = requestState.detail
          return h('div', null,
            requestState.error !== null ? h('div', { className: 'sq-error' }, requestState.error) : null,
            pending.map(item => h('div', {
              key: item.id,
              className: `sq-card clickable ${selectedRequest === item.id ? 'selected' : ''}`,
              onClick: () => setSelectedRequest(item.id),
            },
            h('div', { className: 'sq-summary' }, item.summary ?? item.operationName),
            h('div', { className: 'sq-meta' }, `${item.storeId} · ${item.operationName} · ${formatTime(item.createdAt)}`),
            h('div', { className: 'sq-chips' }, (item.risk ?? []).map(risk => h(Chip, { key: risk, tone: risk === 'destructive' ? 'red' : risk === 'publish' ? 'amber' : risk === 'bulk' ? 'purple' : 'blue' }, t(`risk.${risk}`)))),
            )),
            request === null ? null : h(RequestDetail, { request, t, onDecide: decide }),
          )
        }

        function renderHistory() {
          if (history.length === 0) return h(Empty, null, t('empty.history'))
          const entry = historyState.detail
          return h('div', null,
            historyState.error !== null ? h('div', { className: 'sq-error' }, historyState.error) : null,
            history.map(item => h('div', {
              key: item.id,
              className: `sq-card clickable ${selectedHistory === item.id ? 'selected' : ''}`,
              onClick: () => setSelectedHistory(item.id),
            },
            h('div', { className: 'sq-summary' }, item.summary ?? item.operationName),
            h('div', { className: 'sq-meta' }, `${item.storeId} · ${t(`status.${item.status}`)} · ${formatTime(item.at)}`),
            )),
            entry === null ? null : h(HistoryDetail, {
              entry,
              t,
              refresh,
              setNotice,
              onSaved: tool => {
                setTab('tools')
                setSelectedTool(tool.id)
              },
            }),
          )
        }

        function renderTools() {
          if (tools.length === 0) return h(Empty, null, t('empty.tools'))
          const tool = toolState.detail
          return h('div', null,
            toolState.error !== null ? h('div', { className: 'sq-error' }, toolState.error) : null,
            tools.map(item => h('div', {
              key: item.id,
              className: `sq-card clickable ${selectedTool === item.id ? 'selected' : ''}`,
              onClick: () => setSelectedTool(item.id),
            },
            h('div', { className: 'sq-summary' }, item.title ?? item.name),
            h('div', { className: 'sq-meta' }, `${item.name} · ${item.operationType} · ${item.storeId}${item.enabled ? '' : ' · disabled'}`),
            h('div', { className: 'sq-chips' }, (item.params ?? []).map(param => h(Chip, { key: param.name }, param.name))),
            )),
            tool === null ? null : h(ToolDetail, {
              tool,
              t,
              refresh,
              setNotice,
              onDeleted: () => setSelectedTool(null),
            }),
          )
        }

        function renderPolicy() {
          if (data === null) return h(Empty, null, snapshot.error ?? t('status.loading'))
          return h(PolicyView, { stores, t, refresh, config: data.config })
        }

        return h('div', { className: 'sq-root' },
          h('div', { className: 'sq-header' },
            h('div', { className: 'sq-title-row' },
              h('div', { className: 'sq-title' }, t('tab.title')),
              tab === 'policy' ? null : h('div', { className: 'sq-tokens' },
                h('span', { className: `sq-token ${readConfigured ? 'on' : ''}` }, `${t('header.read')}: ${readConfigured ? t('header.configured') : t('header.missing')}`),
                h('span', { className: `sq-token ${writeConfigured ? 'on' : ''}` }, `${t('header.write')}: ${writeExternal ? t('header.infisical') : writeConfigured ? t('header.configured') : t('header.missing')}`),
              ),
            ),
            h('div', { className: 'sq-tabs' }, tabs.map(([key, label, count]) => h('button', {
              key,
              className: `sq-tab ${tab === key ? 'active' : ''}`,
              onClick: () => setTab(key),
            }, label, count !== null && count > 0 ? h('span', { className: 'sq-count' }, count) : null))),
          ),
          notice === null ? null : h('div', { className: notice.kind === 'error' ? 'sq-error' : 'sq-warn' }, notice.text),
          h('div', { className: 'sq-body' },
            tab === 'pending' ? renderPending() : null,
            tab === 'history' ? renderHistory() : null,
            tab === 'tools' ? renderTools() : null,
            tab === 'policy' ? renderPolicy() : null,
          ),
        )
      }

      /** One pending mutation: summary, resources, variables, tree, raw document, decision. */
      function RequestDetail({ request, t, onDecide }) {
        const [busy, setBusy] = React.useState(null)
        const visual = request.visual ?? {}
        const answer = async decision => {
          setBusy(decision)
          try {
            await onDecide(request.id, decision)
          } finally {
            setBusy(null)
          }
        }
        return h('div', { className: 'sq-card' },
          h('div', { className: 'sq-summary' }, visual.summary ?? request.operationName),
          h('div', { className: 'sq-chips' },
            h(Chip, { tone: 'blue' }, request.operationType),
            (visual.risk ?? []).map(risk => h(Chip, { key: risk, tone: risk === 'destructive' ? 'red' : risk === 'publish' ? 'amber' : risk === 'bulk' ? 'purple' : 'blue' }, t(`risk.${risk}`))),
          ),
          h('div', { className: 'sq-warn' }, t('note.writeWarning')),
          h('div', { className: 'sq-note' }, t('misc.pendingHint')),
          Row({ label: t('label.store'), children: request.storeId }),
          Row({ label: t('label.requestId'), children: h('span', { className: 'sq-meta' }, request.id) }),
          Row({ label: t('label.expires'), children: formatTime(request.expiresAt) }),
          Array.isArray(visual.resources) && visual.resources.length > 0
            ? Row({ label: t('label.resources'), children: h('div', { className: 'sq-chips' }, visual.resources.map(resource => h(Chip, { key: resource.gid }, resource.label))) })
            : null,
          Array.isArray(visual.rootFields) && visual.rootFields.length > 0
            ? h('div', null,
              h('div', { className: 'sq-note' }, t('label.fields')),
              visual.rootFields.map((field, index) => h('div', { key: index, className: 'sq-card' },
                h('div', { className: 'sq-summary' }, `${field.name}${field.label !== field.name ? ` · ${field.label}` : ''}`),
                Array.isArray(field.args) && field.args.length > 0
                  ? field.args.map((argument, argumentIndex) => h(Row, { key: argumentIndex, label: argument.name, children: h('span', { className: 'sq-meta' }, inline(argument.value ?? argument.raw)) }))
                  : null,
                Array.isArray(field.children) && field.children.length > 0
                  ? h(Tree, { node: { name: 'selection', children: field.children }, t })
                  : null,
              )),
            )
            : null,
          Array.isArray(visual.variables) && visual.variables.length > 0
            ? h('div', null,
              h('div', { className: 'sq-note' }, t('label.variables')),
              visual.variables.map(variable => h(Row, { key: variable.name, label: variable.name, children: h('span', { className: 'sq-meta' }, `${variable.type} = ${inline(variable.value)}`) })),
            )
            : null,
          h('details', null,
            h('summary', { className: 'sq-note' }, t('action.viewDocument')),
            h('pre', { className: 'sq-pre' }, highlight(request.document)),
          ),
          h('div', { className: 'sq-actions' },
            h('button', { className: 'sq-btn', disabled: busy !== null, onClick: () => { void answer('reject') } }, t('action.reject')),
            h('button', { className: 'sq-btn primary', disabled: busy !== null, onClick: () => { void answer('approve') } }, t('action.approve')),
          ),
        )
      }

      /** One history entry plus the save-as-tool form. */
      function HistoryDetail({ entry, t, refresh, setNotice, onSaved }) {
        const [saving, setSaving] = React.useState(false)
        const [name, setName] = React.useState(defaultToolName(entry))
        const [title, setTitle] = React.useState(entry.summary ?? 'Shopify tool')
        const [description, setDescription] = React.useState('')
        const [exposed, setExposed] = React.useState(() => {
          const map = {}
          for (const variable of entry.variableDefs ?? []) map[variable.name] = true
          return map
        })
        const [descriptions, setDescriptions] = React.useState({})
        const savable = entry.status === 'ok' || entry.status === 'error'
        return h('div', { className: 'sq-card' },
          h('div', { className: 'sq-summary' }, entry.summary ?? entry.operationName),
          Row({ label: t('label.operation'), children: `${entry.operationType} ${entry.operationName}` }),
          Row({ label: t('label.status'), children: t(`status.${entry.status}`) }),
          Row({ label: t('label.decision'), children: t(`decision.${entry.decision}`) }),
          Row({ label: t('label.duration'), children: `${entry.durationMs ?? 0} ms` }),
          h('details', null,
            h('summary', { className: 'sq-note' }, t('action.viewDocument')),
            h('pre', { className: 'sq-pre' }, highlight(entry.document)),
          ),
          !savable ? null : h('div', null,
            h('div', { className: 'sq-divider' }),
            h('div', { className: 'sq-summary' }, t('action.save')),
            Field({ label: t('form.name'), children: h('input', { className: 'sq-input', value: name, onChange: event => setName(event.target.value) }) }),
            Field({ label: t('form.title'), children: h('input', { className: 'sq-input', value: title, onChange: event => setTitle(event.target.value) }) }),
            Field({ label: t('form.description'), children: h('textarea', { className: 'sq-textarea', value: description, onChange: event => setDescription(event.target.value) }) }),
            (entry.variableDefs ?? []).length === 0 ? null : h('div', null,
              h('div', { className: 'sq-note' }, t('label.variables')),
              entry.variableDefs.map(variable => h('div', { key: variable.name, className: 'sq-card' },
                h('div', { className: 'sq-var-row' },
                  h('label', { className: 'sq-check' },
                    h('input', {
                      type: 'checkbox',
                      checked: exposed[variable.name] === true,
                      onChange: event => setExposed({ ...exposed, [variable.name]: event.target.checked }),
                    }),
                    `${t('form.exposed')} ${variable.name}`,
                  ),
                  h('span', { className: 'sq-meta' }, `${variable.type}${variable.required ? ` · ${t('form.required')}` : ''}`),
                ),
                exposed[variable.name] === true
                  ? h('input', {
                    className: 'sq-input',
                    placeholder: t('form.paramDescription'),
                    value: descriptions[variable.name] ?? '',
                    onChange: event => setDescriptions({ ...descriptions, [variable.name]: event.target.value }),
                  })
                  : h('div', { className: 'sq-note' }, `${t('label.fixed')}: ${inline(entry.variables?.[variable.name])}`),
              )),
            ),
            h('div', { className: 'sq-actions' },
              h('button', {
                className: 'sq-btn primary',
                disabled: saving,
                onClick: async () => {
                  setSaving(true)
                  setNotice(null)
                  try {
                    const params = Object.entries(exposed)
                      .filter(([, checked]) => checked)
                      .map(([variable]) => ({ name: variable, description: descriptions[variable] ?? '' }))
                    const result = await post('save-tool', { historyId: entry.id, name, title, description, params })
                    setNotice({ kind: 'info', text: `${t('misc.saved')}: ${result.tool.name}` })
                    await refresh()
                    onSaved(result.tool)
                  } catch (error) {
                    setNotice({ kind: 'error', text: `${t('error.save')}: ${error.message}` })
                  } finally {
                    setSaving(false)
                  }
                },
              }, saving ? t('form.saving') : t('action.save')),
            ),
          ),
          Array.isArray(entry.errors) && entry.errors.length > 0
            ? h('div', { className: 'sq-error' }, entry.errors.map(item => item.message).join('\n'))
            : null,
        )
      }

      /** One saved tool: enable/disable, delete, and a parameterized manual run. */
      function ToolDetail({ tool, t, refresh, setNotice, onDeleted }) {
        const [running, setRunning] = React.useState(false)
        const [values, setValues] = React.useState({})
        const [result, setResult] = React.useState(null)
        const [confirmDelete, setConfirmDelete] = React.useState(false)
        const defs = new Map((tool.variableDefs ?? []).map(variable => [variable.name, variable]))
        const rows = (tool.params ?? []).map(param => ({ param, variable: defs.get(param.name) }))
        const isMutation = tool.operationType === 'mutation'
        return h('div', { className: 'sq-card' },
          h('div', { className: 'sq-summary' }, tool.title ?? tool.name),
          h('div', { className: 'sq-note' }, tool.description),
          Row({ label: t('label.name'), children: h('span', { className: 'sq-meta' }, tool.name) }),
          Row({ label: t('label.operation'), children: `${tool.operationType} ${tool.operationName}` }),
          Row({ label: t('label.store'), children: tool.storeId }),
          isMutation ? h('div', { className: 'sq-warn' }, t('note.manualWrite')) : null,
          h('div', { className: 'sq-actions' },
            h('button', {
              className: 'sq-btn',
              onClick: async () => {
                try {
                  await post('tool', { action: 'update', id: tool.id, enabled: !tool.enabled })
                  await refresh()
                } catch (error) {
                  setNotice({ kind: 'error', text: error.message })
                }
              },
            }, tool.enabled ? t('action.disable') : t('action.enable')),
            h('button', {
              className: confirmDelete ? 'sq-btn danger' : 'sq-btn',
              onClick: async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true)
                  return
                }
                try {
                  await post('tool', { action: 'delete', id: tool.id })
                  onDeleted()
                  await refresh()
                } catch (error) {
                  setNotice({ kind: 'error', text: error.message })
                }
              },
            }, confirmDelete ? t('action.confirmDelete') : t('action.delete')),
          ),
          h('div', { className: 'sq-divider' }),
          h('div', { className: 'sq-summary' }, t('form.invokeVariables')),
          rows.length === 0
            ? h('div', { className: 'sq-note' }, '—')
            : rows.map(({ param, variable }) => h(Field, {
              key: param.name,
              label: `${param.name}${variable?.type !== undefined ? ` (${variable.type})` : ''}${variable?.required ? ` · ${t('form.required')}` : ''}`,
            }, renderInput(variable, values[param.name], value => setValues({ ...values, [param.name]: value })))),
          h('div', { className: 'sq-actions' },
            h('button', {
              className: 'sq-btn primary',
              disabled: running,
              onClick: async () => {
                setRunning(true)
                setResult(null)
                setNotice(null)
                try {
                  const parsed = {}
                  for (const { param, variable } of rows) {
                    const raw = values[param.name]
                    if (raw === undefined || raw === '') continue
                    parsed[param.name] = parseInput(variable, raw)
                  }
                  const response = await post('invoke', { id: tool.id, variables: parsed })
                  setResult(response.result)
                  await refresh()
                } catch (error) {
                  setNotice({ kind: 'error', text: `${t('error.invoke')}: ${error.message}` })
                } finally {
                  setRunning(false)
                }
              },
            }, running ? t('form.running') : t('action.run')),
          ),
          result === null ? null : h('div', null,
            h('div', { className: 'sq-note' }, `${t('label.result')} · ${t(`status.${result.status}`)}`),
            h('pre', { className: 'sq-pre' }, pretty(result.data ?? result, 6000)),
          ),
        )
      }

      /** Render one parameter input by its JSON Schema type. */
      function renderInput(variable, value, onChange) {
        const schema = variable?.schema ?? {}
        if (schema.type === 'boolean') {
          return h('select', { className: 'sq-select', value: value ?? '', onChange: event => onChange(event.target.value) },
            h('option', { value: '' }, '—'),
            h('option', { value: 'true' }, 'true'),
            h('option', { value: 'false' }, 'false'),
          )
        }
        if (schema.type === 'integer' || schema.type === 'number') {
          return h('input', { className: 'sq-input', type: 'number', value: value ?? '', onChange: event => onChange(event.target.value) })
        }
        if (schema.type === 'array' || schema.type === 'object' || schema.type === undefined) {
          return h('textarea', {
            className: 'sq-textarea',
            placeholder: schema.type === undefined ? 'JSON value' : schema.type,
            value: value ?? '',
            onChange: event => onChange(event.target.value),
          })
        }
        return h('input', { className: 'sq-input', value: value ?? '', onChange: event => onChange(event.target.value) })
      }

      /** Parse a manual-invocation input value according to its schema. */
      function parseInput(variable, raw) {
        const schema = variable?.schema ?? {}
        if (schema.type === 'integer') return Number.parseInt(raw, 10)
        if (schema.type === 'number') return Number(raw)
        if (schema.type === 'boolean') return raw === 'true'
        if (schema.type === 'array' || schema.type === 'object' || schema.type === undefined) return JSON.parse(raw)
        return raw
      }

      return Panel
    }

    /**
     * Build a default tool name from an execution.
     * @param entry - history entry.
     * @returns suggested name.
     */
    function defaultToolName(entry) {
      const base = String(entry.operationName ?? 'tool')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
      return `shopify_${base || 'tool'}`
    }

    function SettingsNotice({ notice }) {
      if (notice === null) return null
      const error = notice.kind === 'error'
      return h('div', { className: error ? 'sq-error' : 'sq-notice', role: error ? 'alert' : 'status' }, notice.text)
    }

    function storeDomainPrefix(value) {
      const host = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      return /^([a-z0-9][a-z0-9-]*)(?:\.myshopify\.com)?$/.exec(host)?.[1] ?? ''
    }

    function StoresCard({ stores, config, t, refresh, selected, onSelect, onAdded, onConfigureVault }) {
      const [form, setForm] = React.useState({ id: '', domain: '', label: '', apiVersion: '' })
      const [writeProvider, setWriteProvider] = React.useState('infisical')
      const [adding, setAdding] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [removeId, setRemoveId] = React.useState(null)
      const advanced = React.useRef(null)
      const domainInput = React.useRef(null)
      const keyInput = React.useRef(null)
      const prefix = storeDomainPrefix(form.domain)
      const storeId = form.id.trim() || prefix
      const vaultReady = Boolean(config?.infisical)
      const needsVault = writeProvider === 'infisical' && !vaultReady
      const secretPath = config?.infisical?.secretPathPrefix ?? '/stores'
      const showForm = stores.length === 0 || adding
      const update = key => event => setForm({ ...form, [key]: event.target.value })

      async function addStore(event) {
        event.preventDefault()
        if (busy || !config || needsVault) return
        if (!prefix) {
          setNotice({ kind: 'error', text: t('settings.badDomain') })
          domainInput.current?.focus()
          return
        }
        const validId = /^[a-z0-9][a-z0-9_-]{0,40}$/.test(storeId)
        if (!validId || stores.some(store => store.id === storeId)) {
          setNotice({ kind: 'error', text: t(validId ? 'settings.existingStoreKey' : 'settings.badStoreKey') })
          if (advanced.current) advanced.current.open = true
          keyInput.current?.focus()
          return
        }
        setBusy(true)
        setNotice(null)
        try {
          const result = await post('store', { action: 'add', ...form, id: storeId, writeProvider })
          setForm({ id: '', domain: '', label: '', apiVersion: '' })
          setWriteProvider('infisical')
          setAdding(false)
          setNotice({ kind: 'info', text: t('settings.configureTokens') })
          await refresh()
          onAdded(result.store.id)
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }

      async function removeStore(id) {
        setBusy(true)
        setNotice(null)
        try {
          await post('store', { action: 'remove', id })
          setRemoveId(null)
          setNotice({ kind: 'info', text: t('store.removed') })
          await refresh()
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }

      return h('section', { className: 'sq-settings-panel' },
        h('h2', { className: 'sq-settings-title' }, t('section.stores')),
        stores.length === 0 ? h('p', { className: 'sq-note' }, t('store.empty')) : h('ul', { className: 'sq-settings-stores' },
          stores.map(store => h('li', { key: store.id, className: 'sq-settings-store' },
            h('button', { type: 'button', className: 'sq-btn', 'aria-pressed': selected === store.id, onClick: () => onSelect(store.id) },
              store.label ?? store.id,
              h('span', { className: 'sq-meta' }, store.domain),
            ),
            store.source === 'runtime' ? h('button', { type: 'button', className: 'sq-btn', disabled: busy,
              onClick: () => setRemoveId(removeId === store.id ? null : store.id) }, t('store.remove'))
              : h('span', { className: 'sq-meta' }, t('store.configManaged')),
            removeId === store.id ? h('div', { className: 'sq-settings-form', style: { flexBasis: '100%' } },
              h('div', null, t('settings.confirmRemove'), ' ', store.label ?? store.id),
              h('div', { className: 'sq-actions' },
                h('button', { type: 'button', className: 'sq-btn danger', disabled: busy, onClick: () => { void removeStore(store.id) } }, t('store.remove')),
                h('button', { type: 'button', className: 'sq-btn', disabled: busy, onClick: () => setRemoveId(null) }, t('action.cancel')),
              ),
            ) : null,
          )),
        ),
        h(SettingsNotice, { notice }),
        !showForm ? h('button', { type: 'button', className: 'sq-btn', onClick: () => setAdding(true) }, t('store.add')) :
          h('form', { className: 'sq-settings-form', onSubmit: addStore },
            Field({ label: t('store.domain'), children: h('input', { ref: domainInput, className: 'sq-input', value: form.domain,
              placeholder: 'your-store.myshopify.com', required: true, autoCapitalize: 'none', spellCheck: false, onChange: update('domain') }) }),
            Field({ label: t('store.label'), children: h('input', { className: 'sq-input', value: form.label, onChange: update('label') }) }),
            Field({ label: t('store.writeProvider'), children: h('select', { className: 'sq-select', value: writeProvider,
              onChange: event => setWriteProvider(event.target.value) },
            h('option', { value: 'infisical' }, 'Infisical'), h('option', { value: 'local' }, t('store.local'))) }),
            needsVault ? h('div', null,
              h('p', { className: 'sq-note' }, t('settings.vaultUnavailable')),
              h('button', { type: 'button', className: 'sq-btn', onClick: onConfigureVault }, t('settings.configureVault')),
            ) : null,
            h('details', { className: 'sq-settings-details', ref: advanced },
              h('summary', null, t('settings.advanced')),
              h('div', { className: 'sq-settings-form' },
                Field({ label: t('store.id'), children: h('input', { ref: keyInput, className: 'sq-input', value: form.id,
                  placeholder: prefix || 'your-store', autoCapitalize: 'none', spellCheck: false, onChange: update('id') }) }),
                h('p', { className: 'sq-note' }, t('store.idHint')),
                Field({ label: t('store.apiVersion'), children: h('input', { className: 'sq-input', value: form.apiVersion,
                  placeholder: '2026-04', onChange: update('apiVersion') }) }),
              ),
            ),
            storeId ? h('p', { className: 'sq-note' },
              writeProvider === 'infisical' ? t('settings.vaultPath') + ': ' : t('settings.storeKeyPreview') + ' ',
              h('code', null, writeProvider === 'infisical' ? `${secretPath.replace(/\/$/, '')}/${storeId}/shopify · ADMIN_ACCESS_TOKEN` : storeId),
              writeProvider === 'infisical' ? h('span', { className: 'sq-meta' }, t('store.idHint')) : null,
            ) : null,
            h('div', { className: 'sq-actions' },
              h('button', { type: 'submit', className: 'sq-btn primary', disabled: busy || !config || needsVault }, busy ? t('form.saving') : t('store.addButton')),
              adding && stores.length > 0 ? h('button', { type: 'button', className: 'sq-btn', disabled: busy, onClick: () => setAdding(false) }, t('action.cancel')) : null,
            ),
          ),
      )
    }

    function CredentialRow({ label, value, onChange, placeholder, busy, onSave, extra, inputRef, t }) {
      return h('form', { className: 'sq-var-row', onSubmit: event => {
        event.preventDefault()
        if (!busy && value.trim() !== '') void onSave()
      } },
        Field({ label, children: h('input', {
          className: 'sq-input', type: 'password', autoComplete: 'off', placeholder, value, onChange, disabled: busy, ref: inputRef,
        }) }),
        h('button', { className: 'sq-btn primary', type: 'submit', disabled: busy || value.trim() === '' }, t('token.save')),
        extra,
      )
    }

    /** Local and Infisical-managed token slots for one store. */
    function TokensCard({ store, t, refresh, vaultReady, onConfigureVault, readInput }) {
      const [values, setValues] = React.useState({ read: '', write: '' })
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [clearKind, setClearKind] = React.useState(null)

      async function save(kind, clear = false) {
        setSaving(true)
        setNotice(null)
        try {
          await post('credential', { storeId: store.id, kind, value: clear ? '' : values[kind] })
          setValues(current => ({ ...current, [kind]: '' }))
          setClearKind(null)
          setNotice({ kind: 'info', text: t(clear ? 'settings.tokenCleared' : 'token.saved') })
          await refresh()
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        } finally {
          setSaving(false)
        }
      }

      return h('section', { className: 'sq-settings-panel' },
        h('h2', { className: 'sq-settings-title' }, t('section.tokens')),
        h('p', { className: 'sq-meta' }, `${store.label ?? store.id} · ${store.domain}`),
        h('p', { className: 'sq-note' }, t('settings.tokenHint')),
        h(SettingsNotice, { notice }),
        h('div', { className: 'sq-settings-form' }, ['read', 'write'].map(kind => {
          const slot = store[kind]
          const external = slot?.provider === 'infisical'
          const status = external ? t('token.managed') : t(slot?.configured ? 'token.configured' : 'token.missing')
          const label = `${t(`token.${kind}`)} · ${status}`
          if (external) return h('div', { key: kind },
            h('strong', null, label),
            h('p', { className: 'sq-note' }, slot.label ? h('code', null, slot.label) : null),
            h('p', { className: 'sq-note' }, t(vaultReady ? 'token.externalHint' : 'infisical.missing')),
            !vaultReady ? h('button', { type: 'button', className: 'sq-btn', onClick: onConfigureVault }, t('settings.configureVault')) : null,
          )
          return h('div', { key: kind },
            h(CredentialRow, {
              label, value: values[kind], placeholder: t('token.placeholder'), busy: saving, inputRef: kind === 'read' ? readInput : undefined,
              onChange: event => setValues({ ...values, [kind]: event.target.value }), onSave: () => save(kind), t,
              extra: slot?.configured ? h('button', { type: 'button', className: 'sq-btn', disabled: saving,
                onClick: () => setClearKind(clearKind === kind ? null : kind) }, t('token.clear')) : null,
            }),
            clearKind === kind ? h('div', { className: 'sq-settings-form' },
              h('div', null, t('settings.confirmClearToken')),
              h('div', { className: 'sq-actions' },
                h('button', { type: 'button', className: 'sq-btn danger', disabled: saving, onClick: () => { void save(kind, true) } }, t('token.clear')),
                h('button', { type: 'button', className: 'sq-btn', disabled: saving, onClick: () => setClearKind(null) }, t('action.cancel')),
              ),
            ) : null,
          )
        })),
      )
    }

    /** Infisical connection and its machine identity. */
    function InfisicalCard({ config, t, refresh, vaultInUse, detailsRef, summaryRef }) {
      const current = config?.infisical
      const [form, setForm] = React.useState({
        baseUrl: current?.baseUrl ?? 'https://app.infisical.com',
        projectId: current?.projectId ?? '',
        environment: current?.environment ?? 'prod',
        secretPathPrefix: current?.secretPathPrefix ?? '/stores',
        clientIdRef: current?.clientIdRef ?? 'INFISICAL_CLIENT_ID',
        clientSecretRef: current?.clientSecretRef ?? 'INFISICAL_CLIENT_SECRET',
      })
      const [busy, setBusy] = React.useState(false)
      const [identity, setIdentity] = React.useState({ id: '', secret: '' })
      const [confirmClear, setConfirmClear] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const currentKey = current === null || current === undefined
        ? ''
        : [current.baseUrl, current.projectId, current.environment, current.secretPathPrefix, current.clientIdRef, current.clientSecretRef].join('|')

      React.useEffect(() => {
        if (current === null || current === undefined) return
        setForm({
          baseUrl: current.baseUrl,
          projectId: current.projectId,
          environment: current.environment,
          secretPathPrefix: current.secretPathPrefix,
          clientIdRef: current.clientIdRef,
          clientSecretRef: current.clientSecretRef,
        })
      }, [currentKey])

      async function save() {
        setBusy(true)
        setNotice(null)
        try {
          await post('infisical', form)
          setNotice({ kind: 'info', text: t('infisical.saved') })
          await refresh()
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }

      async function clear() {
        setBusy(true)
        setNotice(null)
        try {
          await post('infisical', { action: 'clear' })
          setConfirmClear(false)
          setNotice({ kind: 'info', text: t('infisical.cleared') })
          await refresh()
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }

      async function saveIdentity(kind) {
        setBusy(true)
        setNotice(null)
        try {
          const value = kind === 'id' ? identity.id : identity.secret
          await post('credential', { kind: kind === 'id' ? 'infisical-id' : 'infisical-secret', value })
          setIdentity({ ...identity, [kind]: '' })
          setNotice({ kind: 'info', text: t('token.saved') })
          await refresh()
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        } finally {
          setBusy(false)
        }
      }

      const update = key => event => setForm({ ...form, [key]: event.target.value })
      const field = (key, input = {}) => Field({ label: t(`settings.${key}`), children: h('input', {
        className: 'sq-input', value: form[key], onChange: update(key), ...input,
      }) })

      return h('details', { className: 'sq-settings-panel sq-settings-details', ref: detailsRef },
        h('summary', { ref: summaryRef }, t('section.infisical'), ' · ', t(current ? 'token.configured' : 'token.missing')),
        h('p', { className: 'sq-note' }, t(current ? 'infisical.configured' : 'infisical.missing')),
        h(SettingsNotice, { notice }),
        h('form', { className: 'sq-settings-form', onSubmit: event => {
          event.preventDefault()
          if (!busy && config && form.projectId.trim()) void save()
        } },
          field('projectId', { required: true, spellCheck: false }),
          field('environment', { required: true, spellCheck: false }),
          h('details', { className: 'sq-settings-details' },
            h('summary', null, t('settings.advanced')),
            h('div', { className: 'sq-settings-form' },
              field('baseUrl', { inputMode: 'url', spellCheck: false }),
              field('secretPathPrefix', { spellCheck: false }),
              field('clientIdRef', { spellCheck: false }),
              field('clientSecretRef', { spellCheck: false }),
            ),
          ),
          h('div', { className: 'sq-actions' },
            h('button', { className: 'sq-btn primary', type: 'submit', disabled: busy || !config || !form.projectId.trim() }, t('infisical.save')),
            current && !vaultInUse ? h('button', { className: 'sq-btn', type: 'button', disabled: busy,
              onClick: () => setConfirmClear(!confirmClear) }, t('infisical.clear')) : null,
          ),
        ),
        current && vaultInUse ? h('p', { className: 'sq-note' }, t('settings.vaultInUse')) : null,
        current && !vaultInUse && confirmClear ? h('div', { className: 'sq-settings-form' },
          h('div', null, t('settings.confirmClear')),
          h('div', { className: 'sq-actions' },
            h('button', { className: 'sq-btn danger', type: 'button', disabled: busy, onClick: () => { void clear() } }, t('infisical.clear')),
            h('button', { className: 'sq-btn', type: 'button', disabled: busy, onClick: () => setConfirmClear(false) }, t('action.cancel')),
          ),
        ) : null,
        current ? h('div', null,
          h('div', { className: 'sq-divider' }),
          h('h3', { className: 'sq-settings-title' }, t('section.identity')),
          h('p', { className: 'sq-note' }, t('identity.hint')),
          h('div', { className: 'sq-settings-form' }, ['id', 'secret'].map(kind => {
            const isId = kind === 'id'
            const state = current.identity?.[isId ? 'clientId' : 'clientSecret']
            return h(CredentialRow, {
              key: kind,
              label: `${t(isId ? 'identity.clientId' : 'identity.clientSecret')} · ${t(state?.configured ? 'token.configured' : 'token.missing')}`,
              value: identity[kind],
              placeholder: isId ? current.clientIdRef : current.clientSecretRef,
              onChange: event => setIdentity({ ...identity, [kind]: event.target.value }),
              onSave: () => saveIdentity(kind), busy, t,
            })
          })),
        ) : null,
      )
    }

    /** One store's effective policy file. */
    function PolicyCard({ storeId, t }) {
      const [policy, setPolicy] = React.useState(null)
      const [error, setError] = React.useState(null)
      React.useEffect(() => {
        if (storeId === '') return undefined
        let alive = true
        setError(null)
        requestJson(`${API}policy?storeId=${encodeURIComponent(storeId)}`)
          .then(data => {
            if (alive) setPolicy(data)
          })
          .catch(cause => {
            if (alive) setError(cause.message)
          })
        return () => {
          alive = false
        }
      }, [storeId])
      return h('details', { className: 'sq-settings-panel sq-settings-details' },
        h('summary', null, t('section.policy'), error === null ? '' : ` · ${t('error.load')}`),
        error !== null ? h('div', { className: 'sq-error' }, error) : null,
        policy === null ? (error === null ? h('div', { className: 'sq-note' }, t('status.loading')) : null) : h('div', null,
          Row({ label: t('label.readOnly'), children: policy.policy.readOnly ? 'true' : 'false' }),
          Row({ label: t('label.blocked'), children: (policy.policy.blockedRootFields ?? []).join(', ') || '—' }),
          Row({ label: t('label.policyPath'), children: h('span', { className: 'sq-meta' }, policy.path) }),
          Row({ label: t('label.policyHash'), children: h('span', { className: 'sq-meta' }, policy.hash) }),
          h('pre', { className: 'sq-pre' }, pretty(policy.policy, 3000)),
        ),
      )
    }

    /** Settings composition in the order users set up a store. */
    function PolicyView({ stores, t, refresh, config }) {
      const [selected, setSelected] = React.useState(null)
      const vaultDetails = React.useRef(null)
      const vaultSummary = React.useRef(null)
      const readInput = React.useRef(null)
      const [focusStore, setFocusStore] = React.useState(null)
      const store = stores.find(row => row.id === selected) ?? stores[0]
      const vaultInUse = stores.some(row => row.write?.provider === 'infisical' || row.read?.provider === 'infisical')

      React.useEffect(() => {
        if (focusStore === null || focusStore !== store?.id) return
        readInput.current?.focus()
        setFocusStore(null)
      }, [focusStore, store?.id])

      function configureVault() {
        if (vaultDetails.current) vaultDetails.current.open = true
        vaultSummary.current?.focus()
      }

      return h('div', { className: 'sq-settings' },
        h(StoresCard, { stores, config, t, refresh, selected: store?.id, onSelect: setSelected, onAdded: id => { setSelected(id); setFocusStore(id) }, onConfigureVault: configureVault }),
        store ? h(TokensCard, { key: store.id, store, t, refresh, vaultReady: Boolean(config?.infisical), onConfigureVault: configureVault, readInput }) : null,
        h(InfisicalCard, { config, t, refresh, vaultInUse, detailsRef: vaultDetails, summaryRef: vaultSummary }),
        store ? h(PolicyCard, { key: store.id, storeId: store.id, t }) : null,
        config?.storeFile ? h('details', { className: 'sq-settings-panel sq-settings-details' },
          h('summary', null, t('settings.settingsFile')),
          h('code', { className: 'sq-meta' }, config.storeFile),
        ) : null,
      )
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],

      /**
       * Register dictionaries, styles, the tab type, the panel, and the poll.
       * @param ctx - client root Context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'shopify-graphql: dictionaries')
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/shopify-graphql'
          tag.textContent = STYLE
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'shopify-graphql: styles')

        const t = ctx.locale.bind(NS)
        const store = createStore()
        const seen = new Set()
        let refreshing = null

        async function refresh() {
          if (refreshing !== null) return refreshing
          refreshing = (async () => {
            try {
              const data = await requestJson(`${API}state`)
              store.set({ status: 'ready', data, error: null })
              for (const request of data.pending ?? []) {
                if (seen.has(request.id)) continue
                seen.add(request.id)
                try {
                  ctx.sidebarRight.openTab(TAB_KIND)
                } catch {
                  // The sidebar may not have an active session yet; the panel still shows the request when opened.
                }
              }
            } catch (error) {
              store.set({ status: 'error', data: store.get().data, error: error.message })
            } finally {
              refreshing = null
            }
          })()
          return refreshing
        }

        ctx.effect(() => {
          void refresh()
          const timer = setInterval(() => {
            if (!document.hidden) void refresh()
          }, 2000)
          return () => clearInterval(timer)
        }, 'shopify-graphql: poll')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          keepMounted: true,
          title: () => t('tab.title'),
          guide: [{
            id: 'shopify-graphql',
            order: 45,
            title: () => t('tab.title'),
            description: () => t('tab.guide'),
            icon: ShopifyGlyph,
          }],
        }), 'shopify-graphql: tab type')

        const Panel = makePanel(ctx, store, refresh)

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
        }, Panel))

        function TabTitle(props) {
          const snapshot = useSnapshot(store)
          const count = snapshot.data?.pending?.length ?? 0
          const label = `${(props.t ?? t)('tab.title')}${count > 0 ? ` (${count})` : ''}`
          return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h(ShopifyGlyph, { size: 14 }),
            label,
          )
        }

        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
          locale: NS,
        }, TabTitle))
      },
    }
  },
})