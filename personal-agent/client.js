/**
 * Browser half of the Personal Agent bundle.
 *
 * The profile is presented as a set of identities, not as workspaces and
 * sessions:
 *
 * - the sidebar lists identities where the Workspace browser used to be, and
 *   clicking one opens its newest conversation (the Host creates one only when
 *   none exists);
 * - the shell's New Session button is hidden and the brand's new-session click
 *   is neutralised, so starting a conversation is not a user-facing action;
 * - the Personal agent page manages identities: create, edit, and per-identity
 *   memory, plus a "Talk to …" action.
 *
 * Everything is profile-scoped. The only host modifications are a string
 * stylesheet for this bundle's own classes and two narrowly targeted
 * compatibility rules that hide the shell's session controls (see `STYLE`).
 */

window.__ModuleLoader__.load({
  id: '@local/personal-agent',
  factory(require) {
    const React = require('react');
    const ReactDOMClient = require('react-dom/client');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'personalAgent';
    /** Identity state. */
    const STATE_URL = 'api/personal-agent/state';
    /** Create or update one identity. */
    const IDENTITY_URL = 'api/personal-agent/identity';
    /** Replace one identity's memory. */
    const MEMORY_URL = 'api/personal-agent/memory';
    /** Remove one identity and clean up its workspace. */
    const REMOVE_URL = 'api/personal-agent/identity/remove';
    /** Ensure one identity's home and return its newest conversation. */
    const OPEN_URL = 'api/personal-agent/open';
    /** Sidebar panel id; also the main-panel key. */
    const PANEL_ID = 'personal-agent';
    /** Accent choices shared with the Host's palette. */
    const ACCENTS = ['#5b5bd6', '#0f766e', '#b45309', '#9d174d', '#1d4ed8', '#3f3f46'];
    /** Fallback identity until the first state response arrives. */
    const FALLBACK_IDENTITY = { id: 'fallback', name: 'Personal agent', role: '', userName: '', persona: '', accent: ACCENTS[0], avatar: '' };
    /** Blank editor defaults for a new identity. */
    const NEW_IDENTITY = { name: '', role: 'personal assistant', userName: '', persona: '', accent: ACCENTS[0], avatar: '' };

    /** English dictionary; also the fallback for unknown locales. */
    const EN = {
      panel: 'Personal agent',
      'brand.fallback': 'Personal agent',
      loading: 'Loading identities…',
      'error.load': 'Could not load identities: {message}',
      retry: 'Try again',
      'page.title': 'Personal agents',
      'page.description': 'Identities are an extra layer: each has its own name, home, and memory, while project workspaces and sessions keep their original sidebar and controls.',
      'identities.title': 'Identities',
      'identities.manage': 'Manage identities',
      'identities.add': 'New identity',
      'identities.empty': 'No identities yet. Create one to start.',
      'identities.hint': 'Click an identity or project to continue your conversation.',
      'identities.count': '{count} identities',
      'identities.memoryCount': '{count} notes',
      'identities.none': 'No notes yet',
      'projects.title': 'Projects',
      'projects.count': '{count} conversations',
      'projects.history': 'All conversations',
      'projects.hideHistory': 'Hide conversations',
      'projects.untitled': 'Untitled',
      'projects.empty': 'No conversations yet.',
      'identity.newTitle': 'New identity',
      'identity.editTitle': 'Identity',
      'identity.description': 'How this identity introduces itself, speaks, and keeps notes.',
      'identity.name': 'Name',
      'identity.nameHint': 'How the agent introduces itself.',
      'identity.role': 'Role',
      'identity.roleHint': 'One short line, such as “personal assistant”.',
      'identity.userName': 'Your name',
      'identity.userNameHint': 'Optional. The name this identity uses for you.',
      'identity.avatar': 'Avatar',
      'identity.avatarHint': 'One emoji or letter. Empty draws the first letter of the name.',
      'identity.accent': 'Accent',
      'identity.persona': 'Persona notes',
      'identity.personaHint': 'Free text appended to the identity: tone, boundaries, habits, anything it should keep in mind.',
      'identity.save': 'Save identity',
      'identity.saving': 'Saving…',
      'identity.saved': 'Identity saved.',
      'identity.create': 'Create identity',
      'identity.creating': 'Creating…',
      'identity.created': 'Identity created.',
      'identity.saveFailed': 'Could not save the identity: {message}',
      'identity.createFailed': 'Could not create the identity: {message}',
      'identity.createCancel': 'Cancel',
      'identity.nameRequired': 'Enter a name.',
      'identity.notEditable': 'This profile has no configuration editor, so identities are read-only here.',
      'identity.unchanged': 'No changes to save.',
      'identity.remove': 'Remove identity',
      'identity.removeTitle': 'Remove {name}?',
      'identity.removeText': 'Its conversations will be archived and its home and memory moved to personal-agent/removed/. The identity disappears from the identity module and the workspace list.',
      'identity.removeNote': 'Files are retained under removed/; this cannot be undone from this page.',
      'identity.removeCancel': 'Cancel',
      'identity.removeConfirm': 'Remove identity',
      'identity.removing': 'Removing…',
      'identity.removed': 'Identity removed. Conversations archived; data moved to removed/.',
      'identity.removeFailed': 'Could not remove the identity: {message}',
      'identity.removeLast': 'At least one identity must remain.',
      'identity.home': 'Home',
      'identity.homeHint': 'Conversations with {name} open here.',
      'identity.homePending': 'The home is created when you save.',
      'identity.talk': 'Talk to {name}',
      'identity.talkStarting': 'Opening…',
      'identity.openFailed': 'Could not open the conversation: {message}',
      'memory.title': 'Memory',
      'memory.belongsTo': 'This memory belongs only to {name}.',
      'memory.description': 'This identity reads these notes in every conversation. It appends durable facts with remember, and you can edit or prune them here.',
      'memory.counter': '{notes} notes · {bytes} / {max} bytes',
      'memory.placeholder': 'Nothing remembered yet. The identity adds notes with remember; you can also write them here, one line per fact.',
      'memory.save': 'Save memory',
      'memory.saving': 'Saving…',
      'memory.saved': 'Memory saved.',
      'memory.saveFailed': 'Could not save memory: {message}',
      'memory.tooLarge': 'This memory is over the {max}-byte limit.',
      'how.title': 'How this profile works',
      'how.identity.title': 'One identity, one home',
      'how.identity.text': 'Every identity has its own home directory. Conversations with {name} open there, and the sidebar does not ask you to pick a workspace.',
      'how.memory.title': 'Separate memories',
      'how.memory.text': 'What one identity remembers, another does not see. Notes live in the profile, not in a session or a workspace.',
      'how.projects.title': 'Projects stay as they are',
      'how.projects.text': 'Your existing workspaces, session lists, search, drag, archive, and New Session keep working exactly as before. Identities are reached from the identity module directly above the workspace browser, or from this page.',
      'how.details': 'Details',
      'how.tools': 'Every identity can call remember and recall in any conversation.',
      footer: 'Personal Agent · scoped to this profile · no device-wide settings',
    };

    /** Simplified Chinese dictionary. */
    const ZH = {
      panel: '个人智能体',
      'brand.fallback': '个人智能体',
      loading: '正在读取身份…',
      'error.load': '无法读取身份：{message}',
      retry: '重试',
      'page.title': '个人智能体',
      'page.description': '身份是一层额外入口：每个身份有自己的名字、主页和记忆；项目工作区与会话保持原来的侧栏和操作。',
      'identities.title': '身份',
      'identities.manage': '管理身份',
      'identities.add': '新建身份',
      'identities.empty': '还没有身份。创建一个开始吧。',
      'identities.hint': '点击身份或项目，直接继续对话。',
      'identities.count': '{count} 个身份',
      'identities.memoryCount': '{count} 条记忆',
      'identities.none': '还没有记忆',
      'projects.title': '项目',
      'projects.count': '{count} 个对话',
      'projects.history': '全部对话',
      'projects.hideHistory': '收起对话',
      'projects.untitled': '未命名',
      'projects.empty': '还没有对话。',
      'identity.newTitle': '新建身份',
      'identity.editTitle': '身份',
      'identity.description': '这个身份如何自我介绍、说话和记录笔记。',
      'identity.name': '名称',
      'identity.nameHint': '智能体自我介绍时使用的名字。',
      'identity.role': '角色',
      'identity.roleHint': '一句话，例如「个人助理」。',
      'identity.userName': '你的称呼',
      'identity.userNameHint': '可选。这个身份对你的称呼。',
      'identity.avatar': '头像',
      'identity.avatarHint': '一个 emoji 或字母。留空时使用名称首字。',
      'identity.accent': '主色',
      'identity.persona': '人格备注',
      'identity.personaHint': '追加到身份描述的自由文本：语气、边界、习惯，或任何希望它记住的设定。',
      'identity.save': '保存身份',
      'identity.saving': '正在保存…',
      'identity.saved': '身份已保存。',
      'identity.create': '创建身份',
      'identity.creating': '正在创建…',
      'identity.created': '身份已创建。',
      'identity.saveFailed': '身份保存失败：{message}',
      'identity.createFailed': '身份创建失败：{message}',
      'identity.createCancel': '取消',
      'identity.nameRequired': '请填写名称。',
      'identity.notEditable': '当前 profile 没有配置编辑器，身份在此只读。',
      'identity.unchanged': '没有需要保存的更改。',
      'identity.remove': '移除身份',
      'identity.removeTitle': '移除 {name}？',
      'identity.removeText': '它的对话会被归档，主页和记忆会移到 personal-agent/removed/ 保留；这个身份会从身份模块和工作区列表消失。',
      'identity.removeNote': '文件会保留在 removed/ 下；此页面无法撤销。',
      'identity.removeCancel': '取消',
      'identity.removeConfirm': '确认移除',
      'identity.removing': '正在移除…',
      'identity.removed': '身份已移除。对话已归档，数据已移到 removed/。',
      'identity.removeFailed': '移除身份失败：{message}',
      'identity.removeLast': '至少保留一个身份。',
      'identity.home': '主页',
      'identity.homeHint': '与{name}的对话会在这里打开。',
      'identity.homePending': '保存后会自动建立主页。',
      'identity.talk': '和{name}聊聊',
      'identity.talkStarting': '正在打开…',
      'identity.openFailed': '无法打开对话：{message}',
      'memory.title': '记忆',
      'memory.belongsTo': '这份记忆只属于{name}。',
      'memory.description': '这个身份会在每次对话中读到这些笔记。它会用 remember 追加长期事实，你也可以在这里编辑或删减。',
      'memory.counter': '{notes} 条 · {bytes} / {max} 字节',
      'memory.placeholder': '还没有记忆。这个身份会用 remember 添加笔记；你也可以在这里按行写入事实。',
      'memory.save': '保存记忆',
      'memory.saving': '正在保存…',
      'memory.saved': '记忆已保存。',
      'memory.saveFailed': '记忆保存失败：{message}',
      'memory.tooLarge': '记忆超过了 {max} 字节的上限。',
      'how.title': '这个 profile 如何工作',
      'how.identity.title': '一个身份，一个主页',
      'how.identity.text': '每个身份都有自己的主页目录。与{name}的对话会在这里打开，侧栏不再要求你选择工作区。',
      'how.memory.title': '各自的记忆',
      'how.memory.text': '一个身份记住的内容，另一个看不到。笔记保存在 profile 里，而不是某次会话或某个工作区里。',
      'how.projects.title': '项目保持原样',
      'how.projects.text': '你原有的工作区、会话列表、搜索、拖拽、归档和新建会话都按原样工作；身份从工作区上方的身份模块或这个页面进入。',
      'how.details': '说明',
      'how.tools': '每个身份都可以在任何对话中调用 remember 和 recall。',
      footer: 'Personal Agent · 仅作用于当前 profile · 不写入设备全局设置',
    };

    /** Page chrome. Only theme tokens are used, so light and dark both work. */
    const STYLE = `
.pagent-page{box-sizing:border-box;display:flex;flex:1;min-height:0;height:100%;overflow:auto;padding:28px clamp(20px,4vw,48px) 48px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}
.pagent-page-inner{display:flex;flex-direction:column;gap:16px;width:100%;max-width:1040px;margin:0 auto}
.pagent-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;min-width:0;flex-wrap:wrap}
.pagent-page-title{margin:0;font-size:20px;line-height:1.35;font-weight:600;letter-spacing:-.01em}
.pagent-page-desc{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;max-width:60em}
.pagent-manager{display:grid;grid-template-columns:270px minmax(0,1fr);gap:16px;align-items:start}
.pagent-card{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:14px 15px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.pagent-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0}
.pagent-card-copy{min-width:0}
.pagent-card-title{margin:0;font-size:13.5px;line-height:1.5;font-weight:600}
.pagent-card-desc{margin:3px 0 0;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.55}
.pagent-count{flex:none;color:var(--dsw-alias-label-tertiary);font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
.pagent-stack{display:flex;flex-direction:column;gap:12px;min-width:0}
.pagent-avatar{display:inline-flex;align-items:center;justify-content:center;flex:none;border-radius:50%;font-weight:600;line-height:1;text-transform:uppercase;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);user-select:none}
.pagent-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;box-sizing:border-box;min-height:30px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:1.5;white-space:nowrap;flex:none}
.pagent-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.pagent-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.pagent-button:disabled{opacity:.5;cursor:default}
.pagent-button-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.pagent-button-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(1.06)}
.pagent-identity-picker{display:flex;flex-direction:column;gap:2px;min-width:0}
.pagent-pick{display:flex;align-items:center;gap:9px;box-sizing:border-box;width:100%;padding:7px 8px;border:1px solid transparent;border-radius:9px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.pagent-pick:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-pick[data-selected="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.pagent-pick:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-pick-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.pagent-pick-name{font-size:12.5px;line-height:1.45;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-pick-meta{font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-pick-count{flex:none;color:var(--dsw-alias-label-tertiary);font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.pagent-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 12px}
.pagent-grid-full{grid-column:1/-1}
.pagent-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.pagent-label{color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.5;font-weight:500}
.pagent-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5}
.pagent-input,.pagent-textarea{box-sizing:border-box;width:100%;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5}
.pagent-input{height:30px}
.pagent-textarea{min-height:72px;resize:vertical}
.pagent-mono{font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.pagent-input:focus-visible,.pagent-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}
.pagent-input[aria-invalid="true"],.pagent-textarea[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.pagent-input:disabled,.pagent-textarea:disabled{opacity:.6;cursor:default}
.pagent-swatches{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pagent-swatch{appearance:none;width:20px;height:20px;padding:0;border:2px solid transparent;border-radius:50%;background:var(--pagent-swatch);cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.pagent-swatch[aria-pressed="true"]{border-color:var(--dsw-alias-label-primary)}
.pagent-swatch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pagent-swatch:disabled{cursor:default;opacity:.6}
.pagent-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:2px}
.pagent-actions-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pagent-message{margin:0;font-size:11px;line-height:1.55;overflow-wrap:anywhere}
.pagent-message[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.pagent-message[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.pagent-error{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.55}
.pagent-home{display:flex;flex-direction:column;gap:2px;padding:8px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);min-width:0}
.pagent-home-label{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.5;text-transform:uppercase;letter-spacing:.04em}
.pagent-path{margin:0;color:var(--dsw-alias-label-secondary);font:10.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}
.pagent-list{display:flex;flex-direction:column;gap:9px;margin:0;padding:0;list-style:none}
.pagent-item{display:flex;gap:9px;min-width:0}
.pagent-item-dot{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font:10px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.pagent-item-copy{min-width:0}
.pagent-item-title{margin:0;font-size:11.5px;line-height:1.5;font-weight:600}
.pagent-item-text{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55}
.pagent-skeleton{display:flex;flex-direction:column;gap:10px;padding:8px 0}
.pagent-sk{height:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);animation:pagent-pulse 1.5s ease-in-out infinite}
.pagent-sk:nth-child(1){width:40%}
.pagent-sk:nth-child(2){width:72%}
.pagent-sk:nth-child(3){width:55%}
@keyframes pagent-pulse{0%,100%{opacity:.5}50%{opacity:1}}
.pagent-footer{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5;text-align:center}
.pagent-brand-name{display:inline-block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;letter-spacing:-.01em;line-height:1.4}

/* Sidebar identity list replaces the Workspace/Session browser. */
.pagent-idlist{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;height:100%;min-height:0;padding:0 4px 12px}
.pagent-idlist-head{display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:28px;padding:0 8px 0 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;flex:none}
.pagent-idlist-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.02em}
.pagent-idlist-manage{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:15px;line-height:1}
.pagent-idlist-manage:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-idlist-manage:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-idlist-rows{display:flex;flex-direction:column;gap:2px;min-height:0;overflow-y:auto;scrollbar-width:thin}
.pagent-idrow{appearance:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:40px;padding:6px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;flex:none}
.pagent-idrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-idrow[data-active="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.pagent-idrow:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-idrow:disabled{cursor:default;opacity:.6}
.pagent-idrow-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.pagent-idrow-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:1.4;font-weight:500}
.pagent-idrow-role{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.4}
.pagent-idrow-busy{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.pagent-idlist-hint{margin:0;padding:2px 8px 0 4px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.5}
.pagent-idlist-empty{margin:0;padding:8px 6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.55}
.pagent-idlist-error{margin:0;padding:6px 6px 0;color:var(--dsw-alias-state-error-primary);font-size:10.5px;line-height:1.5;overflow-wrap:anywhere}
.pagent-idlist-projects{display:flex;flex-direction:column;gap:2px;flex:none;margin-top:4px}
.pagent-idlist-subhead{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 8px 2px 4px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5;letter-spacing:.02em}
.pagent-project{display:flex;flex-direction:column;gap:1px;min-width:0;flex:none}
.pagent-project-row{display:flex;align-items:center;gap:1px;min-width:0}
.pagent-project-main{flex:1;width:auto;min-width:0;color:var(--dsw-alias-label-secondary)}
.pagent-project-main:hover{color:var(--dsw-alias-label-primary)}
.pagent-project-toggle{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.pagent-project-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-project-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-history{display:flex;flex-direction:column;gap:1px;margin:0 6px 4px 18px;padding-left:7px;border-left:1px solid var(--dsw-alias-border-l1);min-width:0}
.pagent-history-row{appearance:none;display:flex;align-items:baseline;justify-content:space-between;gap:6px;width:100%;box-sizing:border-box;padding:4px 5px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1.45;text-align:left;cursor:pointer;min-width:0}
.pagent-history-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-history-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-history-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.pagent-history-time{flex:none;color:var(--dsw-alias-label-tertiary);font:9.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.pagent-history-empty{margin:0;padding:3px 5px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5}
.pagent-idlist-rail{padding:0 0 12px;align-items:center}
.pagent-idlist-rail .pagent-idlist-rows{align-items:center;gap:8px;overflow:visible}
.pagent-idlist-rail .pagent-idrow{justify-content:center;width:36px;min-height:36px;height:36px;padding:0}
.pagent-idlist-rail .pagent-idrow-busy{display:none}
.pagent-idlist-rail .pagent-idlist-projects{width:100%;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.pagent-idlist-rail .pagent-project-main{justify-content:center;width:36px;min-height:36px;height:36px;padding:0}


.pagent-identity-host{box-sizing:border-box;flex:none;min-width:0;max-height:42vh;overflow:auto;overscroll-behavior:contain;padding:2px 4px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:2px}
.pagent-identity-block{display:flex;flex-direction:column;gap:2px;min-width:0}
.pagent-identity-head{display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:26px;padding:0 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4}
.pagent-identity-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.02em}
.pagent-identity-manage{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:14px;line-height:1}
.pagent-identity-manage:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-identity-manage:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-identity-rows{display:flex;flex-direction:column;gap:2px;min-width:0}
.pagent-identity-row{appearance:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:38px;padding:5px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;flex:none}
.pagent-identity-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-identity-row[data-active="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.pagent-identity-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-identity-row:disabled{cursor:default;opacity:.6}
.pagent-identity-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.pagent-identity-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:1.4;font-weight:600}
.pagent-identity-role{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.4}
.pagent-identity-busy{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.pagent-identity-empty{margin:0;padding:2px 6px 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
.pagent-identity-error{margin:0;padding:4px 6px 2px;color:var(--dsw-alias-state-error-primary);font-size:10.5px;line-height:1.5;overflow-wrap:anywhere}
[class*="_collapsed"] .pagent-identity-host{padding:0 0 8px;max-height:none;overflow:visible}
[class*="_collapsed"] .pagent-identity-head{justify-content:center;padding:0}
[class*="_collapsed"] .pagent-identity-title{display:none}
[class*="_collapsed"] .pagent-identity-row{justify-content:center;width:36px;min-height:36px;height:36px;padding:0}
[class*="_collapsed"] .pagent-identity-copy{display:none}
[class*="_collapsed"] .pagent-identity-busy{display:none}
.pagent-button-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.pagent-button-danger:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.pagent-remove{display:flex;flex-direction:column;gap:8px;padding:10px 11px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.pagent-remove-title{margin:0;font-size:12.5px;line-height:1.5;font-weight:600}
.pagent-remove-text{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55}
.pagent-remove-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.pagent-switcher{display:flex;flex-direction:column;gap:6px;min-width:0}
.pagent-switcher-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px}
.pagent-switcher-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;letter-spacing:.02em}
.pagent-switcher-rows{display:flex;align-items:stretch;flex-wrap:wrap;gap:8px;min-width:0}
.pagent-chip{appearance:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;max-width:100%;min-width:0;padding:6px 11px 6px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.pagent-chip:hover{background:var(--dsw-alias-bg-layer-2)}
.pagent-chip[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.pagent-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pagent-chip-copy{display:flex;flex-direction:column;gap:0;min-width:0}
.pagent-chip-name{font-size:12px;line-height:1.4;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-chip-role{font-size:10px;line-height:1.4;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-chip-ghost{border-style:dashed;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:default;font-size:11.5px;padding:6px 11px}
.pagent-home-inline{display:flex;align-items:baseline;gap:8px;min-width:0;padding:6px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2)}
.pagent-home-inline .pagent-home-label{flex:none}
.pagent-home-inline .pagent-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-help{padding:0}
.pagent-help-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;cursor:pointer;list-style:none;color:var(--dsw-alias-label-primary)}
.pagent-help-summary::-webkit-details-marker{display:none}
.pagent-help-summary:hover{background:var(--dsw-alias-bg-layer-2);border-radius:12px}
.pagent-help-summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:12px}
.pagent-help-summary::after{content:'▸';color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}
.pagent-help[open] .pagent-help-summary::after{content:'▾'}
.pagent-help-hint{color:var(--dsw-alias-label-tertiary);font-size:10.5px;flex:none}
.pagent-help[open] .pagent-help-hint{display:none}
.pagent-help-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 16px;padding:0 15px 15px;border-top:1px solid var(--dsw-alias-border-l1);margin-top:0;padding-top:12px}
.pagent-help-item{display:flex;flex-direction:column;gap:3px;min-width:0}
.pagent-empty-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:34px 18px;text-align:center}
.pagent-empty-title{margin:0;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.55}
@media (max-width:820px){.pagent-manager{grid-template-columns:minmax(0,1fr)}.pagent-page{padding:20px 16px 40px}.pagent-help-grid{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){.pagent-sk{animation:none}}
`;

    /**
     * Fill `{name}` placeholders in one dictionary string.
     * @param text - dictionary value.
     * @param vars - replacement values.
     * @returns the filled string.
     */
    function interpolate(text, vars) {
      if (typeof text !== 'string' || vars === undefined || vars === null) return text;
      return text.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : match));
    }

    /**
     * Read one JSON route without throwing on a non-2xx status.
     * @param url - document-relative route.
     * @param init - fetch options.
     * @returns status plus parsed body.
     */
    async function requestJson(url, init) {
      const response = await fetch(url, { ...init, cache: 'no-store' });
      const data = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, data };
    }

    /**
     * Describe a thrown value as one line.
     * @param error - thrown value.
     * @returns message text.
     */
    function messageOf(error) {
      return error instanceof Error ? error.message : String(error);
    }

    /**
     * Count UTF-8 bytes of one text.
     * @param text - text to measure.
     * @returns byte length.
     */
    function utf8Bytes(text) {
      return new TextEncoder().encode(String(text ?? '')).length;
    }

    /**
     * Count note lines in a draft memory text.
     * @param text - draft memory.
     * @returns number of note lines.
     */
    function countNoteLines(text) {
      return String(text ?? '')
        .split('\n')
        .filter((line) => line.startsWith('- ')).length;
    }

    /**
     * Build the shared identity store. One fetch per plugin load is enough for
     * the brand, the sidebar list, and the manager page; edits patch it so all
     * three update without a page reload.
     * @returns the store.
     */
    function createStore() {
      const listeners = new Set();
      let state = null;
      let error = null;
      let loading = null;
      let activeId = null;
      try {
        activeId = window.localStorage.getItem('pagent-active-identity');
      } catch {
        activeId = null;
      }

      const ensureActive = () => {
        if (state === null) return;
        if (activeId !== null && state.identities.some((identity) => identity.id === activeId)) return;
        activeId = state.identities[0]?.id ?? null;
      };
      const emit = () => {
        for (const listener of [...listeners]) listener();
      };
      return {
        snapshot: () => ({ state, error, activeId }),
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        load(force = false) {
          if (loading !== null && !force) return loading;
          const run = (async () => {
            try {
              const result = await requestJson(STATE_URL);
              if (!result.ok || result.data === null) {
                throw new Error(result.data?.message ?? `HTTP ${result.status}`);
              }
              state = result.data;
              error = null;
              ensureActive();
            } catch (failure) {
              error = messageOf(failure);
            }
            emit();
          })();
          loading = run.finally(() => {
            loading = null;
          });
          return loading;
        },
        setActive(id) {
          if (activeId === id) return;
          activeId = id;
          try {
            window.localStorage.setItem('pagent-active-identity', id);
          } catch {
            // A blocked storage API only loses the remembered identity.
          }
          emit();
        },
        setState(next) {
          state = next;
          ensureActive();
          emit();
        },
        patchMemory(identityId, memory) {
          if (state === null) return;
          state = {
            ...state,
            identities: state.identities.map((identity) => (identity.id === identityId ? { ...identity, memory: { ...identity.memory, ...memory } } : identity)),
          };
          emit();
        },
      };
    }

    /**
     * Subscribe one component to the shared identity store.
     * @returns the current store snapshot.
     */
    function useStoreSnapshot() {
      const [snapshot, setSnapshot] = React.useState(store.snapshot());
      React.useEffect(() => {
        const unsubscribe = store.subscribe(() => setSnapshot(store.snapshot()));
        if (store.snapshot().state === null) void store.load();
        return unsubscribe;
      }, []);
      return snapshot;
    }

    /**
     * Choose the glyph drawn inside an avatar.
     * @param identity - identity record.
     * @returns one letter or the configured emoji.
     */
    function avatarGlyph(identity) {
      if (typeof identity.avatar === 'string' && identity.avatar.trim() !== '') return identity.avatar.trim();
      const first = Array.from(String(identity.name ?? '').trim())[0];
      return first === undefined ? 'P' : first.toUpperCase();
    }

    /**
     * Pick readable text for one accent colour.
     * @param hex - `#rrggbb` colour.
     * @returns black or white.
     */
    function readableText(hex) {
      const match = /^#([0-9a-f]{6})$/i.exec(String(hex));
      if (match === null) return '#fff';
      const value = Number.parseInt(match[1], 16);
      const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
        const unit = channel / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      });
      const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      return luminance > 0.55 ? '#111318' : '#fff';
    }

    /**
     * Render an identity avatar.
     * @param props.identity - identity record.
     * @param props.size - square edge in pixels.
     */
    function Avatar(props) {
      const identity = props.identity ?? FALLBACK_IDENTITY;
      const size = props.size ?? 20;
      return h(
        'span',
        {
          className: 'pagent-avatar',
          style: {
            width: `${size}px`,
            height: `${size}px`,
            fontSize: `${Math.max(9, Math.round(size * 0.44))}px`,
            background: identity.accent,
            color: readableText(identity.accent),
          },
          'aria-hidden': true,
        },
        avatarGlyph(identity),
      );
    }

    /**
     * Render the folder glyph used by project rows.
     * @param props.size - square edge in pixels.
     */
    function ProjectIcon(props) {
      const size = props.size ?? 16;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { flex: 'none' },
        },
        h('path', { d: 'M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z' }),
      );
    }

    /**
     * Read the slot translator with a key-echo fallback.
     * @param props - slot props.
     * @returns translate function.
     */
    function translatorOf(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => '';
      return (key, vars) => {
        const text = t(key);
        return interpolate(typeof text === 'string' && text !== '' ? text : key, vars);
      };
    }

    /**
     * Find one identity in a state snapshot.
     * @param state - state payload.
     * @param id - identity id.
     * @returns the identity or null.
     */
    function identityOf(state, id) {
      return state?.identities.find((identity) => identity.id === id) ?? null;
    }

    /**
     * The identity shown by the brand and panel icon.
     * @param state - state payload.
     * @param activeId - active identity id.
     * @returns the identity or the fallback.
     */
    function activeIdentityOf(state, activeId) {
      return identityOf(state, activeId) ?? state?.identities[0] ?? FALLBACK_IDENTITY;
    }

    /**
     * Open one identity's newest conversation, or ask the Host for a fresh one
     * when the identity has no conversation yet.
     * @param ctx - client plugin context.
     * @param identityId - identity to open.
     * @returns when navigation was requested.
     */
    async function openIdentity(ctx, identityId) {
      const result = await requestJson(OPEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identityId }),
      });
      if (!result.ok || result.data?.ok !== true) {
        throw new Error(result.data?.message ?? `HTTP ${result.status}`);
      }
      const ui = ctx.get('uiWorkspace');
      if (ui === undefined) throw new Error('personal-agent: workspace navigation is unavailable');
      store.setActive(identityId);
      if (typeof result.data.sessionId === 'string' && result.data.sessionId !== '') {
        ui.openSession(result.data.sessionId);
      } else {
        ui.startSession(result.data.workspaceId, { agentPreset: 'personal' });
      }
    }

    /**
     * Open one existing project's newest conversation, or create a conversation
     * there when the project has none. Projects keep the profile's default
     * agent preset; only identities use the personal preset.
     * @param ctx - client plugin context.
     * @param workspaceId - project workspace id.
     * @returns when navigation was requested.
     */
    async function openProjectTarget(ctx, workspaceId) {
      const result = await requestJson(OPEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (!result.ok || result.data?.ok !== true) {
        throw new Error(result.data?.message ?? `HTTP ${result.status}`);
      }
      const ui = ctx.get('uiWorkspace');
      if (ui === undefined) throw new Error('personal-agent: workspace navigation is unavailable');
      if (typeof result.data.sessionId === 'string' && result.data.sessionId !== '') {
        ui.openSession(result.data.sessionId);
      } else {
        ui.startSession(result.data.workspaceId);
      }
    }

    /**
     * Reload state until one identity id appears (the Host plugin restarts
     * after a configuration save).
     * @param identityId - identity id to wait for.
     * @returns when it appeared, or after the last attempt.
     */
    async function awaitIdentity(identityId) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await store.load(true);
        if (store.snapshot().state?.identities.some((identity) => identity.id === identityId)) return;
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
    }

    /** The sidebar brand mark: the active identity avatar. */
    function BrandMark(props) {
      const { state, activeId } = useStoreSnapshot();
      return h(Avatar, { identity: activeIdentityOf(state, activeId), size: Math.max(16, props.size ?? 20) });
    }

    /** The sidebar brand name: the active identity name. */
    function BrandName(props) {
      const { state, activeId } = useStoreSnapshot();
      const tr = translatorOf(props);
      const name = activeIdentityOf(state, activeId).name;
      return h('span', { className: 'pagent-brand-name', title: name }, name);
    }

    /** The sidebar panel icon: the active identity avatar. */
    function PanelIcon(props) {
      const { state, activeId } = useStoreSnapshot();
      return h(Avatar, { identity: activeIdentityOf(state, activeId), size: props.size ?? 18 });
    }

    /**
     * Build the sidebar identity list that replaces the Workspace browser.
     * @param ctx - client plugin context.
     * @returns the list component.
     */
    function makeIdentityList(ctx) {
      return function IdentityList(props) {
        const tr = translatorOf(props);
        const { state, error, activeId } = useStoreSnapshot();
        const [busy, setBusy] = React.useState(null);
        const [projectBusy, setProjectBusy] = React.useState(null);
        const [failure, setFailure] = React.useState(null);
        const [expandedProject, setExpandedProject] = React.useState(null);
        const [history, setHistory] = React.useState(null);
        const wide = props.wide !== false;
        const disabled = busy !== null || projectBusy !== null;

        const open = async (identityId) => {
          setBusy(identityId);
          setFailure(null);
          try {
            await openIdentity(ctx, identityId);
          } catch (error_) {
            setFailure(messageOf(error_));
          } finally {
            setBusy(null);
          }
        };

        const openProject = async (workspaceId) => {
          setProjectBusy(workspaceId);
          setFailure(null);
          try {
            await openProjectTarget(ctx, workspaceId);
          } catch (error_) {
            setFailure(messageOf(error_));
          } finally {
            setProjectBusy(null);
          }
        };

        const toggleHistory = (project) => {
          if (expandedProject === project.workspaceId) {
            setExpandedProject(null);
            setHistory(null);
            return;
          }
          const sessions = ctx.get('sessions');
          const workspaces = ctx.get('workspaces');
          const workspaceSnapshot = workspaces?.list.getSnapshot();
          const workspace = workspaceSnapshot?.items.find((item) => item.workspaceId === project.workspaceId);
          const byId = sessions?.list.getSnapshot().byId ?? {};
          const archived = new Set(workspaceSnapshot?.archivedSessionIds ?? []);
          const rows = (workspace?.sessionIds ?? [])
            .filter((id) => !archived.has(id))
            .slice(0, 50)
            .map((id) => ({
              id,
              title: byId[id]?.title ?? tr('projects.untitled'),
              updatedAt: byId[id]?.updatedAt ?? 0,
            }));
          setHistory({ workspaceId: project.workspaceId, rows });
          setExpandedProject(project.workspaceId);
        };

        const openHistoryRow = (sessionId) => {
          const ui = ctx.get('uiWorkspace');
          if (ui === undefined) {
            setFailure(tr('identity.openFailed', { message: tr('projects.untitled') }));
            return;
          }
          setExpandedProject(null);
          setHistory(null);
          ui.openSession(sessionId);
        };

        const manage = () => {
          const layout = ctx.get('layout');
          if (layout !== undefined) layout.selectPanel(PANEL_ID);
        };

        const timeOf = (updatedAt) => {
          if (typeof updatedAt !== 'number' || updatedAt <= 0) return '';
          return new Date(updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        };

        const projectRow = (project) => {
          const expanded = expandedProject === project.workspaceId;
          const rows = expanded && history !== null && history.workspaceId === project.workspaceId ? history.rows : [];
          return h(
            'div',
            { className: 'pagent-project', key: project.workspaceId },
            h(
              'div',
              { className: 'pagent-project-row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'pagent-idrow pagent-project-main',
                  title: wide ? undefined : project.title,
                  disabled,
                  onClick: () => void openProject(project.workspaceId),
                },
                h(ProjectIcon, { size: wide ? 17 : 15 }),
                wide
                  ? h(
                      'span',
                      { className: 'pagent-idrow-copy' },
                      h('span', { className: 'pagent-idrow-name' }, project.title),
                      h('span', { className: 'pagent-idrow-role' }, tr('projects.count', { count: project.sessionCount })),
                    )
                  : null,
                wide && projectBusy === project.workspaceId ? h('span', { className: 'pagent-idrow-busy' }, '…') : null,
              ),
              wide
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'pagent-project-toggle',
                      title: expanded ? tr('projects.hideHistory') : tr('projects.history'),
                      'aria-label': expanded ? tr('projects.hideHistory') : tr('projects.history'),
                      'aria-expanded': expanded,
                      onClick: () => toggleHistory(project),
                    },
                    expanded ? '▾' : '▸',
                  )
                : null,
            ),
            expanded
              ? h(
                  'div',
                  { className: 'pagent-history' },
                  rows.length === 0
                    ? h('p', { className: 'pagent-history-empty' }, tr('projects.empty'))
                    : rows.map((row) =>
                        h(
                          'button',
                          {
                            key: row.id,
                            type: 'button',
                            className: 'pagent-history-row',
                            onClick: () => openHistoryRow(row.id),
                          },
                          h('span', { className: 'pagent-history-title' }, row.title === '' ? tr('projects.untitled') : row.title),
                          timeOf(row.updatedAt) === '' ? null : h('span', { className: 'pagent-history-time' }, timeOf(row.updatedAt)),
                        ),
                      ),
                )
              : null,
          );
        };

        if (state === null) {
          return h('div', { className: 'pagent-idlist' }, h('p', { className: 'pagent-idlist-empty' }, error === null ? tr('loading') : tr('error.load', { message: error })));
        }
        if (state.identities.length === 0) {
          return h(
            'div',
            { className: 'pagent-idlist' },
            h('p', { className: 'pagent-idlist-empty' }, tr('identities.empty')),
            h('button', { type: 'button', className: 'pagent-button', onClick: manage }, tr('identities.add')),
          );
        }

        const projects = Array.isArray(state.projects) ? state.projects : [];

        return h(
          'div',
          { className: `pagent-idlist${wide ? '' : ' pagent-idlist-rail'}` },
          wide
            ? h(
                'div',
                { className: 'pagent-idlist-head' },
                h('span', { className: 'pagent-idlist-label' }, tr('identities.title')),
                h(
                  'button',
                  { type: 'button', className: 'pagent-idlist-manage', title: tr('identities.manage'), 'aria-label': tr('identities.manage'), onClick: manage },
                  '＋',
                ),
              )
            : null,
          h(
            'div',
            { className: 'pagent-idlist-rows' },
            state.identities.map((identity) =>
              h(
                'button',
                {
                  key: identity.id,
                  type: 'button',
                  className: 'pagent-idrow',
                  'data-active': identity.id === activeId ? 'true' : 'false',
                  'aria-current': identity.id === activeId ? 'true' : undefined,
                  title: wide ? undefined : identity.name,
                  disabled,
                  onClick: () => void open(identity.id),
                },
                h(Avatar, { identity, size: wide ? 20 : 26 }),
                wide
                  ? h(
                      'span',
                      { className: 'pagent-idrow-copy' },
                      h('span', { className: 'pagent-idrow-name' }, identity.name),
                      h('span', { className: 'pagent-idrow-role' }, identity.role === '' ? tr('identity.editTitle') : identity.role),
                    )
                  : null,
                wide && busy === identity.id ? h('span', { className: 'pagent-idrow-busy' }, '…') : null,
              ),
            ),
            projects.length === 0
              ? null
              : h(
                  'div',
                  { className: 'pagent-idlist-projects' },
                  wide
                    ? h(
                        'div',
                        { className: 'pagent-idlist-subhead' },
                        h('span', null, tr('projects.title')),
                        h('span', null, String(projects.length)),
                      )
                    : null,
                  projects.map(projectRow),
                ),
          ),
          failure === null ? null : h('p', { className: 'pagent-idlist-error', role: 'alert' }, failure),
          wide ? h('p', { className: 'pagent-idlist-hint' }, tr('identities.hint')) : null,
        );
      };
    }

    /**
     * Build the identity manager page.
     * @param ctx - client plugin context.
     * @returns the page component.
     */
    function makeIdentityPage(ctx) {
      return function IdentityPage(props) {
        const tr = translatorOf(props);
        const { state, error, activeId } = useStoreSnapshot();
        const [selectedId, setSelectedId] = React.useState(null);
        const [pendingSelection, setPendingSelection] = React.useState(null);
        const [createMode, setCreateMode] = React.useState(false);
        const [removeConfirm, setRemoveConfirm] = React.useState(false);
        const [form, setForm] = React.useState(null);
        const [formDirty, setFormDirty] = React.useState(false);
        const [memoryDraft, setMemoryDraft] = React.useState('');
        const [memoryDirty, setMemoryDirty] = React.useState(false);
        const [busy, setBusy] = React.useState('');
        const [identityNotice, setIdentityNotice] = React.useState(null);
        const [memoryNotice, setMemoryNotice] = React.useState(null);
        const [talkError, setTalkError] = React.useState(null);

        const identities = state?.identities ?? [];
        const selected = identityOf(state, selectedId);

        // Select the active (or first) identity once state arrives. A save that
        // adds an identity names it as pending so this effect does not bounce
        // back to the old active identity before the reload lands.
        React.useEffect(() => {
          if (state === null) return;
          if (pendingSelection !== null) {
            if (state.identities.some((identity) => identity.id === pendingSelection)) {
              setSelectedId(pendingSelection);
              setCreateMode(false);
              setPendingSelection(null);
            }
            return;
          }
          if (createMode) return;
          if (selectedId !== null && state.identities.some((identity) => identity.id === selectedId)) return;
          setSelectedId(activeId ?? state.identities[0]?.id ?? null);
        }, [state === null ? '' : state.identities.map((identity) => identity.id).join(','), activeId, createMode, selectedId, pendingSelection]);

        // Seed the editor when the selected identity changes or after a save.
        const selectedIdentityKey = selected === null ? '' : [selected.id, selected.name, selected.role, selected.userName, selected.accent, selected.avatar, selected.persona].join('\u0000');
        React.useEffect(() => {
          if (createMode || selected === null || formDirty) return;
          setForm({
            name: selected.name,
            role: selected.role,
            userName: selected.userName,
            persona: selected.persona,
            accent: selected.accent,
            avatar: selected.avatar,
          });
        }, [selectedIdentityKey, createMode, formDirty]);

        // Memory notes can change behind the page (the agent's remember tool);
        // refresh the draft only while the user has not started editing it.
        React.useEffect(() => {
          if (createMode || selected === null || memoryDirty) return;
          setMemoryDraft(selected.memory.text);
        }, [selected === null ? '' : selected.memory.text, createMode, memoryDirty]);

        const editable = state?.editable !== false;
        const preview = form ?? NEW_IDENTITY;
        const draftStats = React.useMemo(
          () => ({ bytes: utf8Bytes(memoryDraft), notes: countNoteLines(memoryDraft) }),
          [memoryDraft],
        );
        const memoryMax = selected?.memory.maxBytes ?? state?.memoryPolicy?.maxBytes ?? 6000;

        const selectIdentity = (identity) => {
          setSelectedId(identity.id);
          setPendingSelection(null);
          setCreateMode(false);
          setRemoveConfirm(false);
          setFormDirty(false);
          setMemoryDirty(false);
          setIdentityNotice(null);
          setMemoryNotice(null);
          setTalkError(null);
          setForm({
            name: identity.name,
            role: identity.role,
            userName: identity.userName,
            persona: identity.persona,
            accent: identity.accent,
            avatar: identity.avatar,
          });
          setMemoryDraft(identity.memory.text);
        };

        const startCreate = () => {
          setCreateMode(true);
          setSelectedId(null);
          setPendingSelection(null);
          setRemoveConfirm(false);
          setFormDirty(false);
          setMemoryDirty(false);
          setIdentityNotice(null);
          setMemoryNotice(null);
          setTalkError(null);
          setForm({ ...NEW_IDENTITY });
          setMemoryDraft('');
        };

        const cancelCreate = () => {
          const target = identityOf(state, activeId) ?? identities[0] ?? null;
          if (target !== null) selectIdentity(target);
          else setCreateMode(false);
        };

        const edit = (key, value) => {
          setFormDirty(true);
          setIdentityNotice(null);
          setForm((current) => ({ ...(current ?? { ...preview }), [key]: value }));
        };

        const saveIdentity = async () => {
          if (form === null) return;
          if (String(form.name).trim() === '') {
            setIdentityNotice({ tone: 'error', text: tr('identity.nameRequired') });
            return;
          }
          setBusy('identity');
          setIdentityNotice(null);
          try {
            const clean = {
              name: form.name,
              role: form.role,
              userName: form.userName,
              avatar: form.avatar,
              accent: form.accent,
              persona: form.persona,
            };
            const result = await requestJson(IDENTITY_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(createMode ? { identity: clean } : { id: selectedId, identity: clean }),
            });
            if (!result.ok || result.data?.ok !== true) {
              throw new Error(result.data?.message ?? `HTTP ${result.status}`);
            }
            const saved = result.data.identity;
            setFormDirty(false);
            setCreateMode(false);
            setSelectedId(saved.id);
            setPendingSelection(saved.id);
            setIdentityNotice({ tone: 'ok', text: tr(createMode ? 'identity.created' : 'identity.saved') });
            await awaitIdentity(saved.id);
            setPendingSelection(null);
            setSelectedId(saved.id);
          } catch (failure) {
            setIdentityNotice({ tone: 'error', text: tr(createMode ? 'identity.createFailed' : 'identity.saveFailed', { message: messageOf(failure) }) });
          } finally {
            setBusy('');
          }
        };

        const saveMemory = async () => {
          if (selected === null) return;
          setBusy('memory');
          setMemoryNotice(null);
          try {
            const result = await requestJson(MEMORY_URL, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ identityId: selected.id, text: memoryDraft }),
            });
            if (!result.ok || result.data?.ok !== true) {
              throw new Error(result.data?.message ?? `HTTP ${result.status}`);
            }
            setMemoryDirty(false);
            store.patchMemory(selected.id, { text: result.data.text, bytes: result.data.bytes, notes: result.data.notes });
            setMemoryDraft(result.data.text);
            setMemoryNotice({ tone: 'ok', text: tr('memory.saved') });
          } catch (failure) {
            setMemoryNotice({ tone: 'error', text: tr('memory.saveFailed', { message: messageOf(failure) }) });
          } finally {
            setBusy('');
          }
        };

        const talk = async () => {
          if (selected === null) return;
          setBusy('talk');
          setTalkError(null);
          try {
            await openIdentity(ctx, selected.id);
          } catch (failure) {
            setTalkError(tr('identity.openFailed', { message: messageOf(failure) }));
            setBusy('');
          }
        };

        const removeIdentity = async () => {
          if (selected === null) return;
          const removingId = selected.id;
          setBusy('remove');
          setIdentityNotice(null);
          try {
            const result = await requestJson(REMOVE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: removingId }),
            });
            if (!result.ok || result.data?.ok !== true) {
              throw new Error(result.data?.message ?? `HTTP ${result.status}`);
            }
            setRemoveConfirm(false);
            setIdentityNotice({ tone: 'ok', text: tr('identity.removed') });
            const nextId = await awaitRemovedIdentity(removingId);
            setSelectedId(nextId);
            setPendingSelection(null);
            setFormDirty(false);
            setMemoryDirty(false);
            const layout = ctx.get('layout');
            if (layout !== undefined) layout.selectPanel(PANEL_ID);
          } catch (failure) {
            // The configuration edit restarts the Host plugin, so the response
            // can be cut after the removal committed. Treat a gone identity as
            // success; otherwise surface the failure.
            await store.load(true);
            const current = store.snapshot().state;
            if (current !== null && !current.identities.some((identity) => identity.id === removingId)) {
              setRemoveConfirm(false);
              setIdentityNotice({ tone: 'ok', text: tr('identity.removed') });
              setSelectedId(current.identities[0]?.id ?? null);
              const layout = ctx.get('layout');
              if (layout !== undefined) layout.selectPanel(PANEL_ID);
            } else {
              setIdentityNotice({ tone: 'error', text: tr('identity.removeFailed', { message: messageOf(failure) }) });
            }
          } finally {
            setBusy('');
          }
        };

        if (state === null) {
          if (error !== null) {
            return h(
              'div',
              { className: 'pagent-page' },
              h(
                'div',
                { className: 'pagent-page-inner' },
                h(
                  'div',
                  { className: 'pagent-error' },
                  h('p', { className: 'pagent-message', style: { margin: 0 } }, tr('error.load', { message: error })),
                  h('button', { type: 'button', className: 'pagent-button', onClick: () => void store.load(true) }, tr('retry')),
                ),
              ),
            );
          }
          return h(
            'div',
            { className: 'pagent-page' },
            h(
              'div',
              { className: 'pagent-page-inner' },
              h('p', { className: 'pagent-hint' }, tr('loading')),
              h('div', { className: 'pagent-skeleton', 'aria-hidden': true }, h('div', { className: 'pagent-sk' }), h('div', { className: 'pagent-sk' }), h('div', { className: 'pagent-sk' })),
            ),
          );
        }

        const showEditor = createMode || selected !== null;
        const editorTitle = createMode ? tr('identity.newTitle') : (selected === null ? tr('identity.editTitle') : selected.name);
        const editorSubtitle = tr('identity.description');

        const switcher = h(
          'section',
          { className: 'pagent-switcher' },
          h(
            'div',
            { className: 'pagent-switcher-head' },
            h('span', { className: 'pagent-switcher-label' }, tr('identities.title')),
            h('span', { className: 'pagent-count' }, tr('identities.count', { count: identities.length })),
          ),
          h(
            'div',
            { className: 'pagent-switcher-rows' },
            identities.length === 0
              ? null
              : identities.map((identity) =>
                  h(
                    'button',
                    {
                      key: identity.id,
                      type: 'button',
                      className: 'pagent-chip',
                      'data-selected': !createMode && identity.id === selectedId ? 'true' : 'false',
                      onClick: () => selectIdentity(identity),
                    },
                    h(Avatar, { identity, size: 22 }),
                    h(
                      'span',
                      { className: 'pagent-chip-copy' },
                      h('span', { className: 'pagent-chip-name' }, identity.name),
                      h('span', { className: 'pagent-chip-role' }, identity.role === '' ? tr('identity.editTitle') : identity.role),
                    ),
                  ),
                ),
          ),
        );

        const homeInline =
          !createMode && selected !== null
            ? h(
                'div',
                { className: 'pagent-home-inline', title: tr('identity.homeHint', { name: selected.name }) },
                h('span', { className: 'pagent-home-label' }, tr('identity.home')),
                h('span', { className: 'pagent-path' }, selected.home.path),
              )
            : createMode
              ? h('p', { className: 'pagent-hint' }, tr('identity.homePending'))
              : null;

        const editorCard = showEditor
          ? h(
              'section',
              { className: 'pagent-card' },
              h(
                'div',
                { className: 'pagent-card-head' },
                h(
                  'div',
                  { className: 'pagent-card-copy' },
                  h('h2', { className: 'pagent-card-title' }, editorTitle),
                  h('p', { className: 'pagent-card-desc' }, editorSubtitle),
                ),
                createMode
                  ? null
                  : h(
                      'button',
                      { type: 'button', className: 'pagent-button pagent-button-primary', onClick: () => void talk(), disabled: busy !== '' },
                      busy === 'talk' ? tr('identity.talkStarting') : tr('identity.talk', { name: preview.name }),
                    ),
              ),
              homeInline,
              h(
                'div',
                { className: 'pagent-grid' },
                h(
                  'label',
                  { className: 'pagent-field' },
                  h('span', { className: 'pagent-label' }, tr('identity.name')),
                  h('input', {
                    className: 'pagent-input',
                    value: preview.name,
                    maxLength: 64,
                    disabled: !editable,
                    'aria-invalid': String(preview.name).trim() === '' ? 'true' : undefined,
                    onChange: (event) => edit('name', event.target.value),
                  }),
                  h('p', { className: 'pagent-hint' }, tr('identity.nameHint')),
                ),
                h(
                  'label',
                  { className: 'pagent-field' },
                  h('span', { className: 'pagent-label' }, tr('identity.role')),
                  h('input', {
                    className: 'pagent-input',
                    value: preview.role,
                    maxLength: 160,
                    disabled: !editable,
                    onChange: (event) => edit('role', event.target.value),
                  }),
                  h('p', { className: 'pagent-hint' }, tr('identity.roleHint')),
                ),
                h(
                  'label',
                  { className: 'pagent-field' },
                  h('span', { className: 'pagent-label' }, tr('identity.userName')),
                  h('input', {
                    className: 'pagent-input',
                    value: preview.userName,
                    maxLength: 80,
                    disabled: !editable,
                    onChange: (event) => edit('userName', event.target.value),
                  }),
                  h('p', { className: 'pagent-hint' }, tr('identity.userNameHint')),
                ),
                h(
                  'label',
                  { className: 'pagent-field' },
                  h('span', { className: 'pagent-label' }, tr('identity.avatar')),
                  h('input', {
                    className: 'pagent-input',
                    value: preview.avatar,
                    maxLength: 16,
                    placeholder: Array.from(String(preview.name).trim())[0]?.toUpperCase() ?? 'A',
                    disabled: !editable,
                    onChange: (event) => edit('avatar', event.target.value),
                  }),
                  h('p', { className: 'pagent-hint' }, tr('identity.avatarHint')),
                ),
                h(
                  'div',
                  { className: 'pagent-field pagent-grid-full' },
                  h('span', { className: 'pagent-label' }, tr('identity.accent')),
                  h(
                    'div',
                    { className: 'pagent-swatches' },
                    ACCENTS.map((accent) =>
                      h('button', {
                        key: accent,
                        type: 'button',
                        className: 'pagent-swatch',
                        style: { '--pagent-swatch': accent },
                        'aria-label': accent,
                        'aria-pressed': preview.accent === accent,
                        disabled: !editable,
                        onClick: () => edit('accent', accent),
                      }),
                    ),
                  ),
                ),
                h(
                  'label',
                  { className: 'pagent-field pagent-grid-full' },
                  h('span', { className: 'pagent-label' }, tr('identity.persona')),
                  h('textarea', {
                    className: 'pagent-textarea',
                    value: preview.persona,
                    rows: 4,
                    maxLength: 6000,
                    disabled: !editable,
                    onChange: (event) => edit('persona', event.target.value),
                  }),
                  h('p', { className: 'pagent-hint' }, tr('identity.personaHint')),
                ),
              ),
              h(
                'div',
                { className: 'pagent-actions' },
                h(
                  'p',
                  { className: 'pagent-hint', style: { margin: 0 } },
                  !editable
                    ? tr('identity.notEditable')
                    : formDirty
                      ? ''
                      : tr('identity.unchanged'),
                ),
                h(
                  'div',
                  { className: 'pagent-actions-right' },
                  identityNotice === null
                    ? null
                    : h('p', { className: 'pagent-message', 'data-tone': identityNotice.tone, role: identityNotice.tone === 'error' ? 'alert' : 'status' }, identityNotice.text),
                  !createMode && selected !== null
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'pagent-button pagent-button-danger',
                          onClick: () => {
                            setRemoveConfirm(true);
                            setIdentityNotice(null);
                          },
                          disabled: busy !== '' || !editable,
                        },
                        tr('identity.remove'),
                      )
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'pagent-button pagent-button-primary',
                      onClick: () => void saveIdentity(),
                      disabled: !editable || busy !== '' || !formDirty,
                    },
                    busy === 'identity' ? tr(createMode ? 'identity.creating' : 'identity.saving') : tr(createMode ? 'identity.create' : 'identity.save'),
                  ),
                ),
              ),
              removeConfirm && selected !== null
                ? h(
                    'div',
                    { className: 'pagent-remove' },
                    h('p', { className: 'pagent-remove-title' }, tr('identity.removeTitle', { name: selected.name })),
                    h('p', { className: 'pagent-remove-text' }, tr('identity.removeText')),
                    h('p', { className: 'pagent-hint' }, tr('identity.removeNote')),
                    h(
                      'div',
                      { className: 'pagent-remove-actions' },
                      h(
                        'button',
                        { type: 'button', className: 'pagent-button', onClick: () => setRemoveConfirm(false), disabled: busy !== '' },
                        tr('identity.removeCancel'),
                      ),
                      h(
                        'button',
                        { type: 'button', className: 'pagent-button pagent-button-danger', onClick: () => void removeIdentity(), disabled: busy !== '' },
                        busy === 'remove' ? tr('identity.removing') : tr('identity.removeConfirm'),
                      ),
                    ),
                  )
                : null,
            )
          : h(
              'section',
              { className: 'pagent-card pagent-empty-card' },
              h('p', { className: 'pagent-empty-title' }, tr('identities.empty')),
              h('button', { type: 'button', className: 'pagent-button pagent-button-primary', onClick: startCreate }, tr('identities.add')),
            );

        const memoryCard =
          !createMode && selected !== null
            ? h(
                'section',
                { className: 'pagent-card' },
                h(
                  'div',
                  { className: 'pagent-card-head' },
                  h(
                    'div',
                    { className: 'pagent-card-copy' },
                    h('h2', { className: 'pagent-card-title' }, tr('memory.title')),
                    h('p', { className: 'pagent-card-desc' }, tr('memory.belongsTo', { name: selected.name }) + ' ' + tr('memory.description')),
                  ),
                  h('span', { className: 'pagent-count' }, tr('memory.counter', { notes: draftStats.notes, bytes: draftStats.bytes, max: memoryMax })),
                ),
                h('textarea', {
                  className: 'pagent-textarea pagent-mono',
                  value: memoryDraft,
                  rows: 8,
                  placeholder: tr('memory.placeholder'),
                  'aria-label': tr('memory.title'),
                  onChange: (event) => {
                    setMemoryDirty(true);
                    setMemoryNotice(null);
                    setMemoryDraft(event.target.value);
                  },
                }),
                h(
                  'div',
                  { className: 'pagent-actions' },
                  h(
                    'p',
                    { className: 'pagent-hint', style: { margin: 0 } },
                    draftStats.bytes > memoryMax
                      ? h('span', { className: 'pagent-message', 'data-tone': 'error' }, tr('memory.tooLarge', { max: memoryMax }))
                      : tr('how.tools'),
                  ),
                  h(
                    'div',
                    { className: 'pagent-actions-right' },
                    memoryNotice === null
                      ? null
                      : h('p', { className: 'pagent-message', 'data-tone': memoryNotice.tone, role: memoryNotice.tone === 'error' ? 'alert' : 'status' }, memoryNotice.text),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'pagent-button',
                        onClick: () => void saveMemory(),
                        disabled: busy !== '' || !memoryDirty || draftStats.bytes > memoryMax,
                      },
                      busy === 'memory' ? tr('memory.saving') : tr('memory.save'),
                    ),
                  ),
                ),
                memoryNotice !== null && memoryNotice.tone === 'error'
                  ? h('p', { className: 'pagent-error', style: { padding: '8px 10px' }, role: 'alert' }, h('span', { className: 'pagent-message', 'data-tone': 'error' }, memoryNotice.text))
                  : null,
              )
            : null;

        return h(
          'div',
          { className: 'pagent-page' },
          h(
            'div',
            { className: 'pagent-page-inner' },
            h(
              'header',
              { className: 'pagent-page-head' },
              h(
                'div',
                null,
                h('h1', { className: 'pagent-page-title' }, tr('page.title')),
                h('p', { className: 'pagent-page-desc' }, tr('page.description')),
              ),
              createMode
                ? h('button', { type: 'button', className: 'pagent-button', onClick: cancelCreate }, tr('identity.createCancel'))
                : identities.length === 0
                  ? null
                  : h('button', { type: 'button', className: 'pagent-button pagent-button-primary', onClick: startCreate }, tr('identities.add')),
            ),
            talkError === null ? null : h('p', { className: 'pagent-error', style: { padding: '8px 10px' }, role: 'alert' }, h('span', { className: 'pagent-message', 'data-tone': 'error' }, talkError)),
            switcher,
            editorCard,
            memoryCard,
            h(
              'details',
              { className: 'pagent-card pagent-help' },
              h(
                'summary',
                { className: 'pagent-help-summary' },
                h('span', { className: 'pagent-card-title' }, tr('how.title')),
                h('span', { className: 'pagent-help-hint' }, tr('how.details')),
              ),
              h(
                'div',
                { className: 'pagent-help-grid' },
                h(
                  'div',
                  { className: 'pagent-help-item' },
                  h('p', { className: 'pagent-item-title' }, tr('how.identity.title')),
                  h('p', { className: 'pagent-item-text' }, tr('how.identity.text', { name: preview.name })),
                ),
                h(
                  'div',
                  { className: 'pagent-help-item' },
                  h('p', { className: 'pagent-item-title' }, tr('how.memory.title')),
                  h('p', { className: 'pagent-item-text' }, tr('how.memory.text')),
                ),
                h(
                  'div',
                  { className: 'pagent-help-item' },
                  h('p', { className: 'pagent-item-title' }, tr('how.projects.title')),
                  h('p', { className: 'pagent-item-text' }, tr('how.projects.text')),
                ),
              ),
            ),
            h('p', { className: 'pagent-footer' }, tr('footer')),
          ),
        );
      };
    }

    /**
     * Render the section glyph for the identity header row.
     * @param props.size - square edge in pixels.
     */
    function IdentitySectionIcon(props) {
      const size = props.size ?? 18;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 9, cy: 8, r: 3.1 }),
        h('path', { d: 'M3.6 19c0-3 2.4-5 5.4-5s5.4 2 5.4 5' }),
        h('path', { d: 'M16.2 5.6a3.1 3.1 0 0 1 0 5.9' }),
        h('path', { d: 'M17.4 14.2c2 .6 3.4 2.3 3.4 4.8' }),
      );
    }

    /**
     * Reload state until one identity id disappears (the Host plugin restarts
     * after removing the identity from configuration).
     * @param identityId - removed identity id.
     * @returns the first remaining identity id, or null.
     */
    async function awaitRemovedIdentity(identityId) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await store.load(true);
        const state = store.snapshot().state;
        if (state !== null && !state.identities.some((identity) => identity.id === identityId)) {
          return state.identities[0]?.id ?? null;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return store.snapshot().state?.identities[0]?.id ?? null;
    }

    /**
     * Build the panellist icon for one identity row.
     * @param identity - identity record.
     * @returns the icon component.
     */
    function makeIdentityIcon(identity) {
      return function IdentityIcon(props) {
        return h(Avatar, { identity, size: props.size ?? 18 });
      };
    }

    /**
     * Build the main-panel opener behind one identity row. Selecting the row
     * opens this tiny panel; it asks the Host for the identity's newest
     * conversation and immediately returns the main area to the Conversation.
     * @param ctx - client plugin context.
     * @param identityId - identity to open.
     * @returns the opener component.
     */
    function makeIdentityOpener(ctx, identityId) {
      return function IdentityOpener() {
        React.useEffect(() => {
          void openIdentity(ctx, identityId)
            .catch((error) => {
              console.warn('personal-agent: could not open the identity:', messageOf(error));
            })
            .finally(() => {
              const layout = ctx.get('layout');
              if (layout !== undefined) layout.selectPanel(null);
            });
        }, []);
        return h('div', { className: 'pagent-opener', 'aria-hidden': true });
      };
    }

    /**
     * Render the identity module mounted directly above the shipped Workspace
     * browser. Rows open an identity conversation immediately; the header's
     * manage action opens the manager page.
     * @param props.ctx - client plugin context.
     */
    function IdentityModule(props) {
      const ctx = props.ctx;
      const { state, activeId } = useStoreSnapshot();
      const [busy, setBusy] = React.useState(null);
      const [failure, setFailure] = React.useState(null);
      const translate = ctx.locale.bind(NS);
      const tr = (key, vars) => interpolate(translate(key), vars);
      const identities = state?.identities ?? [];

      const manage = () => {
        const layout = ctx.get('layout');
        if (layout !== undefined) layout.selectPanel(PANEL_ID);
      };

      const open = async (identityId) => {
        setBusy(identityId);
        setFailure(null);
        try {
          await openIdentity(ctx, identityId);
        } catch (error) {
          setFailure(messageOf(error));
        } finally {
          setBusy(null);
        }
      };

      return h(
        'div',
        { className: 'pagent-identity-block' },
        h(
          'div',
          { className: 'pagent-identity-head' },
          h('span', { className: 'pagent-identity-title' }, tr('identities.title')),
          h(
            'button',
            {
              type: 'button',
              className: 'pagent-identity-manage',
              title: tr('identities.manage'),
              'aria-label': tr('identities.manage'),
              onClick: manage,
            },
            '＋',
          ),
        ),
        identities.length === 0
          ? h('p', { className: 'pagent-identity-empty' }, tr('identities.empty'))
          : h(
              'div',
              { className: 'pagent-identity-rows' },
              identities.map((identity) =>
                h(
                  'button',
                  {
                    key: identity.id,
                    type: 'button',
                    className: 'pagent-identity-row',
                    'data-active': identity.id === activeId ? 'true' : 'false',
                    'aria-current': identity.id === activeId ? 'true' : undefined,
                    disabled: busy !== null,
                    title: identity.role === '' ? identity.name : `${identity.name} — ${identity.role}`,
                    onClick: () => void open(identity.id),
                  },
                  h(Avatar, { identity, size: 20 }),
                  h(
                    'span',
                    { className: 'pagent-identity-copy' },
                    h('span', { className: 'pagent-identity-name' }, identity.name),
                    h('span', { className: 'pagent-identity-role' }, identity.role === '' ? tr('identity.editTitle') : identity.role),
                  ),
                  busy === identity.id ? h('span', { className: 'pagent-identity-busy' }, '…') : null,
                ),
              ),
            ),
        failure === null ? null : h('p', { className: 'pagent-identity-error', role: 'alert' }, failure),
      );
    }

    /**
     * Shared state, created once per loaded module generation.
     */
    const store = createStore();

    /** Client entry: dictionaries, chrome, brand, panel, and identity list. */
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'personal-agent: dictionaries');

        ctx.effect(() => {
          const tagId = '@local/personal-agent/page.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/personal-agent';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'personal-agent: styles');

        const translate = ctx.locale.bind(NS);
        const label = () => interpolate(translate('panel'), {});

        // Identity homes are ordinary workspaces underneath, but the shipped
        // Workspace/Session browser must not list them as projects. Hide exactly
        // those rows (and their session rows in the flat/search views) by the
        // semantic data-row-key the native browser publishes. Every other
        // workspace row, control, and interaction remains the shipped one.
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/personal-agent';
          tag.dataset.pluginCss = '@local/personal-agent/hidden-identities.css';
          document.head.appendChild(tag);
          const escapeKey = (value) => {
            if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
            return String(value).replace(/["\\]/g, '\\$&');
          };
          const sync = () => {
            const state = store.snapshot().state;
            const workspaceIds = new Set();
            for (const identity of state?.identities ?? []) {
              const workspaceId = identity.home?.workspaceId;
              if (typeof workspaceId === 'string' && workspaceId !== '') workspaceIds.add(workspaceId);
            }
            const workspaces = ctx.get('workspaces');
            const snapshot = workspaces?.list.getSnapshot?.();
            const sessionIds = new Set();
            for (const workspace of snapshot?.items ?? []) {
              if (!workspaceIds.has(workspace.workspaceId)) continue;
              for (const sessionId of workspace.sessionIds ?? []) sessionIds.add(sessionId);
            }
            const rules = [];
            for (const id of workspaceIds) rules.push(`[data-row-key="workspace:${escapeKey(id)}"]{display:none!important}`);
            for (const id of sessionIds) rules.push(`[data-row-key="session:${escapeKey(id)}"]{display:none!important}`);
            tag.textContent = rules.join('\n');
          };
          const disposers = [store.subscribe(sync)];
          disposers.push(
            ctx.inject(['workspaces'], (scope) => {
              const unsubscribe = scope.workspaces.list.subscribe?.(sync);
              sync();
              return () => unsubscribe?.();
            }),
            ctx.inject(['sessions'], (scope) => {
              const unsubscribe = scope.sessions.list.subscribe?.(sync);
              sync();
              return () => unsubscribe?.();
            }),
          );
          sync();
          return () => {
            for (const dispose of disposers) dispose();
            tag.remove();
          };
        }, 'personal-agent: hide identity workspaces');

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            makeIdentityPage(ctx),
          ),
        );

        // The identity module is a sibling above the shipped Workspace/Session
        // browser, inside the sidebar's own region column. The native browser
        // owns everything below it and keeps its original layout and behavior.
        ctx.effect(() => {
          let host = null;
          let root = null;
          let scheduled = false;
          const ensure = () => {
            const region = document.querySelector('[class*="_regionArea"]');
            if (region === null) return;
            if (host !== null && host.isConnected && host.parentElement === region) return;
            if (root !== null) {
              try {
                root.unmount();
              } catch {
                // The host may already be gone; recreation follows.
              }
              root = null;
            }
            if (host !== null) host.remove();
            host = document.createElement('div');
            host.className = 'pagent-identity-host';
            const wrapper = region.querySelector('[data-slot="sidebar.workspaces"]');
            if (wrapper !== null && wrapper.parentElement === region) region.insertBefore(host, wrapper);
            else region.insertBefore(host, region.firstChild);
            root = ReactDOMClient.createRoot(host);
            root.render(h(IdentityModule, { ctx }));
          };
          const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
              scheduled = false;
              ensure();
            });
          };
          ensure();
          const observer = new MutationObserver(schedule);
          observer.observe(document.body, { childList: true, subtree: true });
          return () => {
            observer.disconnect();
            if (root !== null) root.unmount();
            host?.remove();
            host = null;
            root = null;
          };
        }, 'personal-agent: identity module above workspaces');

        // Enter the active identity's newest conversation automatically, so a
        // fresh page lands in the conversation instead of the blank New Session
        // hero with its workspace picker. The Host creates a conversation only
        // when the identity has none. A click on the identity list does the same
        // thing; this is the startup path.
        ctx.effect(() => {
          let armed = false;
          let attempts = 0;
          let timer = null;
          const begin = () => {
            if (armed) return;
            const { state, activeId } = store.snapshot();
            if (state === null) {
              void store.load();
              return;
            }
            if (activeId === null) return;
            if (state.autoOpen === false) return;
            if (ctx.get('uiWorkspace') === undefined) {
              if (attempts < 20) {
                attempts += 1;
                timer = setTimeout(begin, 400);
              }
              return;
            }
            armed = true;
            timer = setTimeout(() => {
              void openIdentity(ctx, activeId).catch((error) => {
                console.warn('personal-agent: could not open the active identity:', messageOf(error));
              });
            }, 900);
          };
          const unsubscribe = store.subscribe(begin);
          begin();
          return () => {
            unsubscribe();
            if (timer !== null) clearTimeout(timer);
          };
        }, 'personal-agent: enter active identity');
      },
    };
  },
});