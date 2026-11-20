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
    const ReactDOM = require('react-dom');
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
    /** Create a multi-agent group. */
    const GROUP_URL = 'api/personal-agent/group';
    /** Close a group and archive its conversations. */
    const GROUP_REMOVE_URL = 'api/personal-agent/group/remove';
    /** Rename one group. */
    const GROUP_RENAME_URL = 'api/personal-agent/group/rename';
    /** Read a multi-agent group feed and participant status. */
    const GROUP_STATE_URL = 'api/personal-agent/group/state';
    /** Post one message to a multi-agent group. */
    const GROUP_SEND_URL = 'api/personal-agent/group/send';
    /** Main-panel key for the group feed. */
    const GROUP_PANEL_ID = 'personal-agent-group';
    /** Clear the pending fresh-conversation marker after auto-switching. */
    const FRESH_CONSUME_URL = 'api/personal-agent/fresh/consume';
    /** Read the previous conversation for the display-only history block. */
    const TRANSCRIPT_URL = 'api/personal-agent/transcript';
    /** Clear unread assistant messages for an identity or group. */
    const READ_URL = 'api/personal-agent/read';

    /** Local visibility preference for the identity chat work details. */
    const THINKING_KEY = 'personal-agent:show-thinking';
    let thinkingVisible = false;
    try {
      thinkingVisible = window.localStorage.getItem(THINKING_KEY) === 'true';
    } catch {
      thinkingVisible = false;
    }
    const thinkingListeners = new Set();
    /**
     * Persist and broadcast the reasoning visibility preference.
     * @param visible - whether reasoning content should be visible.
     */
    function setThinkingVisible(visible) {
      thinkingVisible = visible;
      try {
        window.localStorage.setItem(THINKING_KEY, visible ? 'true' : 'false');
      } catch {
        // A storage-restricted browser keeps the in-memory preference.
      }
      for (const listener of thinkingListeners) listener();
    }
    /** Subscribe one component to the reasoning visibility preference. */
    function useThinkingVisible() {
      const [visible, setVisible] = React.useState(thinkingVisible);
      React.useEffect(() => {
        const listener = () => setVisible(thinkingVisible);
        thinkingListeners.add(listener);
        listener();
        return () => thinkingListeners.delete(listener);
      }, []);
      return visible;
    }
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
      'progress.working': 'Working',
      'progress.busy1': 'Working on it',
      'progress.busy2': 'Thinking it over',
      'progress.busy3': 'Digging around',
      'progress.tasks': 'Tasks',
      'progress.running': 'In progress…',
      'progress.idle': 'No active task',
      'progress.other': '+{count} other sessions',
      'progress.completed': '{done}/{total} done',
      'groups.title': 'Groups',
      'groups.create': 'Start a group chat',
      'groups.needTwo': 'Create at least two identities first.',
      'groups.memberCount': '{count} participants',
      'groups.pickTitle': 'Start a group chat',
      'groups.pickHint': 'Choose at least two identities. Each one is its own agent and replies to the group.',
      'groups.host': 'Host',
      'groups.name': 'Group name',
      'groups.namePlaceholder': 'Uses the selected names',
      'groups.start': 'Start',
      'groups.starting': 'Starting…',
      'groups.cancel': 'Cancel',
      'groups.close': 'Close group',
      'groups.closeTitle': 'Close {name}?',
      'groups.closeText': "The group leaves the list and its conversation is archived. Each identity's own conversations are untouched.",
      'groups.closeConfirm': 'Close group',
      'groups.closing': 'Closing…',
      'groups.closeFailed': 'Could not close the group: {message}',
      'groups.rename': 'Rename group',
      'groups.renameTitle': 'Rename {name}',
      'groups.renameLabel': 'Group name',
      'groups.renameSave': 'Save',
      'groups.renaming': 'Saving…',
      'groups.renameFailed': 'Could not rename the group: {message}',
      'groups.empty': 'Select a group from the identity module.',
      'groups.emptyFeed': 'No messages yet. Say something to the group.',
      'groups.composePlaceholder': 'Message the group… every participant replies unless you @mention one',
      'groups.mentionHint': 'Everyone answers by default — type @ to pick one member',
      'groups.mentionPick': 'Pick a member to @',
      'groups.send': 'Send',
      'groups.sending': 'Sending…',
      'groups.sendFailed': 'Could not send: {message}',
      'groups.sendPartial': '{count} participant(s) could not be prompted',
      'history.open': 'Conversation history',
      'history.title': 'Conversations with {name}',
      'history.empty': 'No earlier conversations yet.',
      'history.close': 'Close',
      'history.displayTitle': 'Previous conversation · display only',
      'history.displayCount': '{count} messages',
      'history.displayEmpty': 'No text messages to show.',
      'history.displayFailed': 'Could not load the previous conversation.',
      'history.you': 'You',
      'thinking.show': 'Show process',
      'thinking.hide': 'Hide process',
      'unread.title': '{count} unread messages',
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
      'progress.working': '正在处理',
      'progress.busy1': '正在忙活',
      'progress.busy2': '正在琢磨',
      'progress.busy3': '正在翻资料',
      'progress.tasks': '任务',
      'progress.running': '进行中…',
      'progress.idle': '暂无进行中的任务',
      'progress.other': '另外 {count} 个会话',
      'progress.completed': '{done}/{total} 完成',
      'groups.title': '群聊',
      'groups.create': '开始群聊',
      'groups.needTwo': '至少先创建两个身份。',
      'groups.memberCount': '{count} 位成员',
      'groups.pickTitle': '开始群聊',
      'groups.pickHint': '至少选两个身份。每个身份都是独立的智能体，会各自回复群聊。',
      'groups.host': '主持',
      'groups.name': '群聊名称',
      'groups.namePlaceholder': '留空则使用选中的名字',
      'groups.start': '开始',
      'groups.starting': '正在创建…',
      'groups.cancel': '取消',
      'groups.close': '关闭群聊',
      'groups.closeTitle': '关闭 {name}？',
      'groups.closeText': '群聊会从列表消失，群聊对话会被归档；各身份自己的对话不受影响。',
      'groups.closeConfirm': '确认关闭',
      'groups.closing': '正在关闭…',
      'groups.closeFailed': '关闭群聊失败：{message}',
      'groups.rename': '修改群名',
      'groups.renameTitle': '修改 {name} 的名称',
      'groups.renameLabel': '群聊名称',
      'groups.renameSave': '保存',
      'groups.renaming': '正在保存…',
      'groups.renameFailed': '修改群名失败：{message}',
      'groups.empty': '从身份模块选择一个群聊。',
      'groups.emptyFeed': '还没有消息，直接对群里说点什么。',
      'groups.composePlaceholder': '发到群里…默认所有身份都会回复，用 @名字 只叫某一位',
      'groups.mentionHint': '默认发给所有成员，输入 @ 可点名某一位',
      'groups.mentionPick': '选择要 @ 的成员',
      'groups.send': '发送',
      'groups.sending': '发送中…',
      'groups.sendFailed': '发送失败：{message}',
      'groups.sendPartial': '{count} 位成员未能收到消息',
      'history.open': '历史对话',
      'history.title': '与 {name} 的历史对话',
      'history.empty': '还没有更早的对话。',
      'history.close': '关闭',
      'history.displayTitle': '上一段对话 · 仅展示',
      'history.displayCount': '{count} 条消息',
      'history.displayEmpty': '没有可展示的文字消息。',
      'history.displayFailed': '上一段对话加载失败。',
      'history.you': '你',
      'thinking.show': '显示过程',
      'thinking.hide': '隐藏过程',
      'unread.title': '{count} 条未读消息',
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
.pagent-identity-head-actions{display:flex;align-items:center;gap:2px}
.pagent-identity-thinking{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.pagent-identity-thinking:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-identity-thinking:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-identity-thinking[data-hidden="true"]{color:var(--dsw-alias-label-caption)}
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="tool-call"]:not(:has([data-tool="ask_user_question"])),
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="turn-process"],
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="model-retry"],
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="command"],
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="compaction"],
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="context"],
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="assistant-step"][data-chat-group-part="reasoning"],
.pagent-identity-mode.pagent-hide-process [data-step-process="true"],
.pagent-identity-mode.pagent-hide-process [data-variant="think"],
.pagent-identity-mode.pagent-hide-process [data-chat-running]{display:none!important}
/* PA identity chat: group-chat bubbles instead of the project transcript. */
.pagent-identity-mode [data-chat-flow-kind="user"] [class*="_userStack"]{width:100%;max-width:none}
.pagent-identity-mode [data-chat-flow-kind="user"] [class*="_bubble_"]{box-sizing:border-box;max-width:60%;margin-left:auto;padding:9px 12px;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}
.pagent-identity-mode [data-chat-flow-kind="assistant-step"][data-chat-group-part="response"]{display:grid;grid-template-columns:24px minmax(0,1fr);grid-template-rows:auto auto;column-gap:8px;row-gap:3px;align-items:start;padding:2px 0;max-width:100%}
.pagent-identity-mode [data-chat-flow-kind="assistant-step"][data-chat-group-part="response"]::before{content:var(--pagent-avatar,"🙂");grid-column:1;grid-row:1 / span 2;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-top:1px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);background:var(--pagent-avatar-bg,var(--dsw-alias-bg-layer-2));color:var(--pagent-avatar-color,var(--dsw-alias-label-secondary));font-size:12px;font-weight:600;line-height:1;text-transform:uppercase}
.pagent-identity-mode [data-chat-flow-kind="assistant-step"][data-chat-group-part="response"]::after{content:var(--pagent-name,"");grid-column:2;grid-row:1;padding-left:2px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-identity-mode header [data-conversation-tabs],.pagent-identity-mode header [class*="_viewsMore"]{display:none!important}
.pagent-identity-mode [data-chat-flow-kind="assistant-step"][data-chat-group-part="response"] > [data-slot] > div:first-child{grid-column:2;grid-row:2;box-sizing:border-box;justify-self:start;width:auto;max-width:60%;min-width:0;padding:9px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.6}
.pagent-identity-mode [data-chat-flow-kind="assistant-step"][data-chat-group-part="response"] .md-table-wide{box-sizing:border-box;width:100%!important;max-width:100%!important;margin-left:0!important;padding-left:0!important;--dsh-table-spare:0px}
.pagent-identity-mode [data-chat-flow-kind="assistant-step"][data-chat-group-part="response"] [class*="_tableScroll"]{box-sizing:border-box;width:100%!important;max-width:100%!important;overflow-x:auto}
.pagent-identity-mode [data-chat-flow-kind="turn-trigger"]{display:flex;justify-content:center;padding:4px 0 2px}
.pagent-identity-mode [data-chat-flow-kind="turn-trigger"] > [data-slot] > section{box-sizing:border-box;width:auto;max-width:min(700px,92%);padding:2px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2)}
.pagent-identity-mode [data-chat-flow-kind="turn-trigger"] [class*="_header"]{gap:6px;padding:2px 0}
.pagent-identity-mode [data-chat-flow-kind="turn-trigger"] [class*="_title"]{color:var(--dsw-alias-label-tertiary);font-size:10.5px}
.pagent-identity-mode [data-chat-flow-kind="turn-trigger"] [class*="_time"]{color:var(--dsw-alias-label-tertiary);font-size:10px}
.pagent-identity-mode [data-chat-flow-kind="turn-trigger"] [class*="_body"]{margin-top:2px}
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="turn-tail"]{display:flex;justify-content:center;padding:2px 0 10px}
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="turn-tail"] > [data-slot] > div{display:flex;justify-content:center;background:transparent;border:0;padding:0}
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="turn-tail"] [class*="_actions"],
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="turn-tail"] [class*="_card"],
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="turn-tail"] [class*="_endInfo"] > span:not([class*="_timeEnd"]){display:none!important}
.pagent-identity-mode.pagent-hide-process [data-chat-flow-kind="turn-tail"] [class*="_endInfo"]{background:transparent;border:0;padding:0;color:var(--dsw-alias-label-tertiary);font-size:10.5px}
.pagent-identity-mode [data-composer-stat="activity"],.pagent-identity-mode [data-composer-stat="usage"]{display:none!important}
/* PA identity chat: span the whole conversation like the group chat page.
   The shipped transcript centres a fixed column; here the column and the composer
   use the available width, so the feed starts at the pane edge instead of floating
   in the middle. Bubbles keep their own readable caps. */
.pagent-identity-mode [data-conversation-content]{--dsh-chat-content-width:100%;--dsh-composer-card-max-width:calc(100% - 32px)}
.pagent-identity-mode [data-conversation-content] > [class*="_widthHandle"]{display:none!important}
/* Working bubble above the composer. */
.pagent-working-host{display:block;min-width:0}
.pagent-working{box-sizing:border-box;display:flex;align-items:flex-start;gap:8px;width:100%;margin:0;padding:2px 0 8px}
.pagent-working-avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);font-size:12px;font-weight:600;line-height:1;margin-top:1px;text-transform:uppercase}
.pagent-working-main{display:flex;flex-direction:column;gap:3px;min-width:0;max-width:60%}
.pagent-working-name{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:1.4;padding-left:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-working-bubble{box-sizing:border-box;display:flex;flex-direction:column;gap:3px;align-self:flex-start;max-width:100%;padding:9px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.pagent-working-text{display:inline-flex;align-items:center;gap:1px}
.pagent-working-dots::after{content:'…';animation:pagent-working-dots 1.2s steps(3,end) infinite}
.pagent-working-task{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;
overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px}
@keyframes pagent-working-dots{0%,20%{content:'.'}40%{content:'..'}60%,100%{content:'...'}}
.pagent-identity-group{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.pagent-identity-group:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-identity-group:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-identity-group:disabled{cursor:default;opacity:.4}
.pagent-group-section{display:flex;flex-direction:column;gap:2px;margin-top:4px;min-width:0}
.pagent-group-label{padding:2px 4px 0;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.4;letter-spacing:.02em}
.pagent-group-row-wrap{position:relative;display:flex;min-width:0}
.pagent-group-row-wrap .pagent-group-row{padding-right:56px;flex:1}
.pagent-group-rename,.pagent-group-delete{appearance:none;position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s ease}
.pagent-group-rename{right:27px}
.pagent-group-delete{right:3px}
.pagent-group-row-wrap:hover .pagent-group-rename,.pagent-group-row-wrap:hover .pagent-group-delete,.pagent-group-row-wrap:focus-within .pagent-group-rename,.pagent-group-row-wrap:focus-within .pagent-group-delete{opacity:1}
.pagent-group-rename:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-group-rename:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;opacity:1}
.pagent-group-delete:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-state-error-primary)}
.pagent-group-delete:focus-visible{outline:2px solid var(--dsw-alias-state-error-primary);outline-offset:-2px;opacity:1}
.pagent-group-page{display:flex;flex-direction:column;min-height:0;height:100%;box-sizing:border-box;padding:18px clamp(16px,4vw,40px) 14px;gap:12px}
.pagent-group-page-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding-bottom:10px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.pagent-group-page-title{display:flex;align-items:center;gap:8px;min-width:0}
.pagent-group-page-glyph{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);flex:none}
.pagent-group-page-name{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-group-page-people{display:flex;align-items:center;gap:4px;flex:none}
.pagent-group-page-person{display:inline-flex}
.pagent-group-feed{flex:1;min-height:120px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding:4px 2px 10px;scrollbar-gutter:stable}
.pagent-group-feed-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center;margin:auto}
.pagent-group-message{display:flex;gap:8px;align-items:flex-start;max-width:100%}
.pagent-group-message[data-role=user]{flex-direction:column;align-items:flex-end}
.pagent-group-message-body{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:min(680px,86%)}
.pagent-group-message-meta{display:flex;align-items:baseline;gap:8px;padding-left:2px}
.pagent-group-message-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.pagent-group-bubble{background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:9px 12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;max-width:min(720px,90%);box-sizing:border-box}
.pagent-group-bubble-user{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,var(--dsw-alias-bg-layer-2));border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent)}
.pagent-group-message-text{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.pagent-group-message-text a{color:var(--dsw-alias-state-business-primary);text-decoration:underline;text-underline-offset:2px}
.pagent-group-inline-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.16));border-radius:4px;padding:1px 4px}
.pagent-group-message-time{font-size:10.5px;color:var(--dsw-alias-label-tertiary);padding:0 2px}
.pagent-group-typing{display:flex;flex-wrap:wrap;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:12px;padding:2px 4px}
.pagent-group-typing span::after{content:'…';animation:pagent-group-dots 1.2s steps(3,end) infinite}
@keyframes pagent-group-dots{0%,20%{content:'.'}40%{content:'..'}60%,100%{content:'...'}}
.pagent-group-page-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:0}
.pagent-group-composer{position:relative;display:flex;flex-direction:column;gap:8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px}
.pagent-group-input{width:100%;resize:vertical;min-height:56px;max-height:220px;background:transparent;border:0;outline:0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.6}
.pagent-group-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.pagent-group-composer-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pagent-group-composer-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-group-mentions{position:absolute;left:8px;right:8px;bottom:calc(100% + 8px);z-index:30;display:flex;flex-direction:column;gap:2px;box-sizing:border-box;max-height:224px;overflow-y:auto;padding:4px;border:.5px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 14px 38px rgba(0,0,0,.36);scrollbar-gutter:stable}
.pagent-group-mention{appearance:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:34px;padding:4px 8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;min-width:0}
.pagent-group-mention:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-group-mention[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-group-mention[data-active="true"] .pagent-group-mention-name{color:var(--dsw-alias-brand-primary)}
.pagent-group-mention-copy{display:flex;flex-direction:column;gap:0;min-width:0;flex:1}
.pagent-group-mention-name{font-size:12.5px;line-height:1.4;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-group-mention-role{font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:640px){.pagent-group-page{padding:12px}.pagent-group-page-name{font-size:14px}.pagent-group-composer-hint{display:none}}
@media (hover:none){.pagent-group-delete,.pagent-group-rename{opacity:.65}}
.pagent-group-row{appearance:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:36px;padding:4px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;min-width:0}
.pagent-group-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-group-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-group-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.pagent-group-copy{display:flex;flex-direction:column;gap:0;min-width:0;flex:1}
.pagent-dialog-mask{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.5)}
.pagent-dialog{box-sizing:border-box;width:min(430px,100%);max-height:min(78vh,720px);overflow:auto;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 48px rgba(0,0,0,.35)}
.pagent-dialog-head{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.pagent-dialog-title{margin:0;color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.5;font-weight:600}
.pagent-dialog-text{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.55}
.pagent-group-options{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow:auto;margin-bottom:8px;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}
.pagent-group-option{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;cursor:pointer;min-width:0}
.pagent-group-option:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-group-option[data-selected="true"]{background:var(--dsw-alias-bg-layer-2)}
.pagent-group-option input{accent-color:var(--dsw-alias-brand-primary);flex:none}
.pagent-group-option-copy{display:flex;flex-direction:column;gap:0;min-width:0}
.pagent-group-option-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.4;font-weight:600}
.pagent-group-option-role{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.4}
.pagent-dialog-field{display:flex;flex-direction:column;gap:4px;margin:8px 0}
.pagent-select{appearance:auto}
.pagent-dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:12px}
.pagent-history-list{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}
.pagent-history-item{appearance:none;display:flex;flex-direction:column;align-items:flex-start;gap:1px;box-sizing:border-box;width:100%;padding:7px 9px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;min-width:0}
.pagent-history-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-history-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-history-title{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.4;font-weight:600}
.pagent-history-time{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.4}
.pagent-group-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.4;font-weight:600}
.pagent-group-members{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.4}
.pagent-identity-manage{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:14px;line-height:1}
.pagent-identity-manage:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-identity-manage:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-identity-rows{display:flex;flex-direction:column;gap:2px;min-width:0}
.pagent-identity-row-wrap{position:relative;display:flex;min-width:0}
.pagent-identity-row-wrap .pagent-identity-row{padding-right:30px;flex:1}
.pagent-identity-history{appearance:none;position:absolute;right:3px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s ease}
.pagent-identity-row-wrap:hover .pagent-identity-history,.pagent-identity-row-wrap:focus-within .pagent-identity-history{opacity:1}
.pagent-identity-history:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-identity-history:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;opacity:1}
@media (hover:none){.pagent-identity-history{opacity:.65}}
.pagent-identity-row{appearance:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:38px;padding:5px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;flex:none}
.pagent-identity-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-identity-row[data-active="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.pagent-identity-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-identity-row:disabled{cursor:default;opacity:.6}
.pagent-identity-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.pagent-identity-name-row,.pagent-group-name-row{display:flex;align-items:center;gap:6px;min-width:0}
.pagent-identity-name-row .pagent-identity-name,.pagent-group-name-row .pagent-group-name{min-width:0;flex:0 1 auto}
.pagent-unread{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#e5484d;color:#fff;font-size:10px;line-height:1;font-weight:650;letter-spacing:0;box-shadow:0 0 0 1px var(--dsw-alias-bg-layer-1)}
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
[class*="_collapsed"] .pagent-identity-history{display:none}
[class*="_collapsed"] .pagent-identity-row-wrap{justify-content:center}
[class*="_collapsed"] .pagent-group-label{display:none}
[class*="_collapsed"] .pagent-group-row{justify-content:center;width:36px;min-height:36px;height:36px;padding:0}
[class*="_collapsed"] .pagent-group-copy{display:none}
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
.pagent-progress{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;max-width:100%;margin:0 auto;padding:5px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
.pagent-progress-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.pagent-progress[data-running="true"] .pagent-progress-dot{background:var(--dsw-alias-brand-primary);animation:pagent-pulse 1.35s ease-in-out infinite}
@keyframes pagent-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.8)}}
.pagent-progress-label{flex:none;font-weight:600;color:var(--dsw-alias-label-secondary)}
.pagent-progress-task{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.pagent-progress-count{flex:none;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.pagent-progress-other{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px}
.pagent-hero-mode [class*="_headline"]{display:none}
.pagent-hero-mode [class*="_heroWorkspaceRow"]{display:none}
.pagent-hero-host{display:flex;justify-content:center;align-items:center;width:100%;box-sizing:border-box;padding:8px 16px 18px}
.pagent-hero-identity{display:flex;align-items:center;gap:10px;min-width:0;max-width:min(92%,520px);padding:9px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 6px 18px rgba(0,0,0,.12)}
.pagent-hero-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:17px;line-height:1.4;font-weight:600;letter-spacing:.01em}
.pagent-hero-group-avatar{display:inline-flex;align-items:center;justify-content:center;flex:none;width:40px;height:40px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.pagent-hero-rename{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.pagent-hero-rename:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.pagent-hero-rename:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-header-mode [class*="_crumbs"],.pagent-header-mode [class*="_headerActions"]{display:none}
.pagent-header-host{display:flex;align-items:center;min-width:0;flex:none}
.pagent-header-identity{display:flex;align-items:center;gap:8px;min-width:0;max-width:min(48vw,420px)}
.pagent-header-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.4;font-weight:600;letter-spacing:.01em}
.pagent-header-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.pagent-display-history{box-sizing:border-box;width:100%;margin:0 auto 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.pagent-display-history-head{appearance:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:34px;padding:6px 11px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer}
.pagent-display-history-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.pagent-display-history-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pagent-display-history-title{flex:none;font-size:11.5px;line-height:1.4;font-weight:600;letter-spacing:.01em}
.pagent-display-history-count{flex:1;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.4;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pagent-display-history-chevron{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1}
.pagent-display-history-body{display:flex;flex-direction:column;gap:10px;max-height:min(38vh,420px);overflow:auto;padding:2px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.pagent-display-message{display:flex;flex-direction:column;gap:3px;padding:6px 0 6px 9px;border-left:2px solid var(--dsw-alias-border-l1);min-width:0}
.pagent-display-message[data-role="assistant"]{border-left-color:var(--dsw-alias-brand-primary)}
.pagent-display-role{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1.4;font-weight:600;letter-spacing:.02em}
.pagent-display-text{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap}
.pagent-display-history-empty{margin:0;padding:8px 0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
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
      let activeGroupId = null;
      try {
        activeId = window.localStorage.getItem('pagent-active-identity');
        activeGroupId = window.localStorage.getItem('pagent-active-group');
      } catch {
        activeId = null;
        activeGroupId = null;
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
        snapshot: () => ({ state, error, activeId, activeGroupId }),
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
        setActiveGroup(id) {
          if (activeGroupId === id) return;
          activeGroupId = id;
          try {
            if (id === null) window.localStorage.removeItem('pagent-active-group');
            else window.localStorage.setItem('pagent-active-group', id);
          } catch {
            // A blocked storage API only loses the remembered group.
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
     * Render the small, safe subset of Markdown group replies commonly use:
     * bold, inline code, and http(s) links. Everything else stays literal text.
     * @param text - message text.
     * @returns React nodes with preserved line breaks.
     */
    function renderMessageText(text) {
      const lines = String(text ?? '').split('\n');
      const inline = (line, keyPrefix) => {
        const nodes = [];
        const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
        let last = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          if (match.index > last) nodes.push(line.slice(last, match.index));
          if (match[1] !== undefined) nodes.push(h('strong', { key: `${keyPrefix}-b-${match.index}` }, match[1]));
          else if (match[2] !== undefined) nodes.push(h('code', { key: `${keyPrefix}-c-${match.index}`, className: 'pagent-group-inline-code' }, match[2]));
          else if (match[3] !== undefined) {
            nodes.push(
              h('a', { key: `${keyPrefix}-a-${match.index}`, href: match[4], target: '_blank', rel: 'noreferrer' }, match[3]),
            );
          }
          last = match.index + match[0].length;
        }
        if (last < line.length) nodes.push(line.slice(last));
        return nodes;
      };
      return lines.map((line, index) =>
        h(
          'span',
          { key: index },
          inline(line, index),
          index < lines.length - 1 ? h('br', { key: `br-${index}` }) : null,
        ),
      );
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
    /**
     * Prefer a real conversation over a blank Session the shipped New Session
     * hero may have created in an identity workspace. The client catalog knows
     * which rows are blank; walk the workspace newest-first.
     * @param ctx - client plugin context.
     * @param workspaceId - identity workspace.
     * @param fallback - Session id returned by the Host.
     * @returns a private, non-blank Session id, or null when only group,
     *   archived, subagent, or blank Sessions are available.
     */
    function realSessionFor(ctx, workspaceId, fallback) {
      if (typeof workspaceId !== 'string') return fallback;
      const list = ctx.get('sessions')?.list.getSnapshot();
      const workspaceSnapshot = ctx.get('workspaces')?.list.getSnapshot();
      const workspace = workspaceSnapshot?.items?.find((item) => item.workspaceId === workspaceId);
      if (list === undefined || workspace === undefined) return fallback;
      const groupSessions = new Set((store.snapshot().state?.groups ?? []).map((group) => group.id ?? group.sessionId));
      const archived = new Set(workspaceSnapshot?.archivedSessionIds ?? []);
      // A group Session and a subagent turn are never an identity's private
      // conversation. An archived Session is never opened either: the shipped
      // sidebar holds a released reference and fails the navigation.
      const rejected = (id) =>
        groupSessions.has(id) ||
        archived.has(id) ||
        list.byId[id]?.origin === 'subagent' ||
        list.byId[id]?.parentSessionId !== undefined;
      const identity = store.snapshot().state?.identities?.find((item) => item.home.workspaceId === workspaceId);
      if (identity?.freshSessionId === fallback && !rejected(fallback)) return fallback;
      const usable = workspace.sessionIds.find(
        (id) => !rejected(id) && list.byId[id] !== undefined && list.byId[id].blank === false,
      );
      if (usable !== undefined) return usable;
      if (typeof fallback === 'string' && fallback !== '' && !rejected(fallback)) return fallback;
      return null;
    }

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
      store.setActiveGroup(null);
      const sessionId = typeof result.data.sessionId === 'string' && result.data.sessionId !== ''
        ? realSessionFor(ctx, result.data.workspaceId, result.data.sessionId)
        : null;
      if (typeof sessionId === 'string' && sessionId !== '') {
        ui.openSession(sessionId);
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
      store.setActiveGroup(null);
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

        const openHistory = (identity) => {
        const workspace = workspaceList?.items?.find((item) => item.workspaceId === identity.home.workspaceId);
        const groupIds = new Set(groups.map((group) => group.id ?? group.sessionId));
        const sessions = (workspace?.sessionIds ?? [])
          .map((id) => sessionList?.byId?.[id])
          .filter(
            (session) =>
              session !== undefined &&
              session.blank !== true &&
              !groupIds.has(session.id) &&
              session.id !== conversationFocus.sessionId,
          )
          .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
        setHistoryIdentity(identity);
        setHistorySessions(sessions);
      };

      const openHistorySession = (sessionId) => {
        conversationFocus.historySessionId = sessionId;
        const ui = ctx.get('uiWorkspace');
        if (ui !== undefined) ui.openSession(sessionId);
        setHistoryIdentity(null);
      };

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

    /** Most participants the `@` menu lists at once. */
    const MENTION_LIMIT = 8;

    /**
     * Find the live `@mention` token under the caret of a composer draft. A
     * token starts at an `@` that does not continue a word (so `name@host`
     * stays an address) and runs to the caret without whitespace, so a closed
     * mention never reopens the picker.
     * @param {string} value - composer draft.
     * @param {number} caret - caret offset in the draft.
     * @returns {{ start: number, end: number, query: string } | null} token span, or null when no mention is live.
     */
    function mentionTokenAt(value, caret) {
      if (typeof value !== 'string' || !Number.isInteger(caret) || caret < 0 || caret > value.length) return null;
      const before = value.slice(0, caret);
      const at = before.lastIndexOf('@');
      if (at === -1) return null;
      const query = before.slice(at + 1);
      if (/[\s@]/.test(query)) return null;
      // Only an email-like preceding character suppresses the picker, so
      // CJK text can open it without a space: `请@成员` works.
      if (at > 0 && /[A-Za-z0-9._%+-]/.test(before[at - 1])) return null;
      return { start: at, end: caret, query };
    }

    /**
     * Filter a group's participants for the `@` menu by name, id, or role.
     * @param {readonly object[]} participants - group participants.
     * @param {string} query - text typed after `@`.
     * @returns {object[]} matching participants, capped at MENTION_LIMIT.
     */
    function mentionCandidates(participants, query) {
      const list = Array.isArray(participants) ? participants : [];
      const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
      const matched = needle === ''
        ? list
        : list.filter((participant) => {
            if (participant === null || participant === undefined) return false;
            return [participant.name, participant.id, participant.role].some((field) => typeof field === 'string' && field.toLowerCase().includes(needle));
          });
      return matched.slice(0, MENTION_LIMIT);
    }

    /**
     * Replace one mention token with `@name ` and report the caret to restore.
     * @param {string} value - composer draft.
     * @param {{ start: number, end: number }} token - span from mentionTokenAt.
     * @param {{ name: string }} participant - chosen participant.
     * @returns {{ text: string, caret: number }} rewritten draft and caret offset.
     */
    function applyMention(value, token, participant) {
      const insert = `@${participant.name} `;
      return { text: value.slice(0, token.start) + insert + value.slice(token.end), caret: token.start + insert.length };
    }

    /**
     * Build the multi-agent group feed page. Every participant is its own
     * agent; the page shows one merged feed and never inserts a host voice.
     * @param ctx - client plugin context.
     * @returns the page component.
     */
    function makeGroupPage(ctx) {
      return function GroupPage(props) {
        const tr = translatorOf(props);
        const { state, activeGroupId } = useStoreSnapshot();
        const group = state?.groups?.find((candidate) => candidate.mode === 'multi' && candidate.id === activeGroupId) ?? null;
        const [feed, setFeed] = React.useState(null);
        const [draft, setDraft] = React.useState('');
        const [sending, setSending] = React.useState(false);
        const [failure, setFailure] = React.useState(null);
        /** Live `@` picker: token span under the caret plus the highlighted row. */
        const [mention, setMention] = React.useState(null);
        const feedRef = React.useRef(null);
        const inputRef = React.useRef(null);

        const groupId = group?.id ?? null;
        React.useEffect(() => {
          setFeed(null);
          if (groupId === null) return undefined;
          let cancelled = false;
          let busy = false;
          const tick = async () => {
            if (cancelled || busy) return;
            busy = true;
            try {
              const result = await requestJson(GROUP_STATE_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ groupId }),
              });
              if (!cancelled && result.ok && result.data?.ok === true) {
                setFeed(result.data);
                setFailure(null);
              }
            } catch (error) {
              if (!cancelled) setFailure(messageOf(error));
            } finally {
              busy = false;
            }
          };
          void tick();
          const timer = setInterval(() => void tick(), 1000);
          return () => {
            cancelled = true;
            clearInterval(timer);
          };
        }, [groupId]);

        const messages = Array.isArray(feed?.messages) ? feed.messages : [];
        const participants = Array.isArray(feed?.group?.participants) ? feed.group.participants : (group?.participants ?? []);
        const running = participants.filter((participant) => participant.running === true);
        const messageCount = messages.length;
        const mentionChoices = mention === null ? [] : mentionCandidates(participants, mention.token.query);
        const mentionIndex = mentionChoices.length === 0 ? -1 : Math.min(Math.max(mention.index, 0), mentionChoices.length - 1);
        React.useEffect(() => {
          const node = feedRef.current;
          if (node !== null) node.scrollTop = node.scrollHeight;
        }, [messageCount, running.length]);

        if (group === null) {
          return h(
            'div',
            { className: 'pagent-page' },
            h('div', { className: 'pagent-page-inner' }, h('p', { className: 'pagent-page-empty' }, tr('groups.empty'))),
          );
        }

        /**
         * Track the draft and the `@` token under the caret in one step, so the
         * picker opens on `@` and narrows as the name is typed.
         * @param {string} value - next draft.
         * @param {number} caret - caret offset after the edit.
         */
        const updateDraft = (value, caret) => {
          setDraft(value);
          const token = mentionTokenAt(value, caret);
          const choices = token === null ? [] : mentionCandidates(participants, token.query);
          if (choices.length === 0) {
            setMention(null);
            return;
          }
          setMention((current) => ({
            token,
            index: current !== null && current.token.query === token.query ? Math.min(current.index, choices.length - 1) : 0,
          }));
        };

        /**
         * Replace the live `@` token with the chosen participant's name and put
         * the caret after the inserted mention.
         * @param {object | undefined} participant - chosen participant.
         */
        const pickMention = (participant) => {
          if (mention === null || participant === undefined) return;
          const next = applyMention(draft, mention.token, participant);
          setDraft(next.text);
          setMention(null);
          window.requestAnimationFrame(() => {
            const node = inputRef.current;
            if (node === null) return;
            node.focus();
            node.setSelectionRange(next.caret, next.caret);
          });
        };

        const send = async () => {
          const text = draft.trim();
          if (text === '' || sending) return;
          setSending(true);
          setFailure(null);
          setMention(null);
          try {
            const result = await requestJson(GROUP_SEND_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ groupId: group.id, text }),
            });
            if (!result.ok || result.data?.ok !== true) {
              throw new Error(result.data?.message ?? `HTTP ${result.status}`);
            }
            setDraft('');
            if (result.data.message !== undefined) {
              setFeed((current) => (current === null ? current : { ...current, messages: [...(current.messages ?? []), result.data.message] }));
            }
            if (Array.isArray(result.data.failures) && result.data.failures.length > 0) {
              setFailure(tr('groups.sendPartial', { count: result.data.failures.length }));
            }
          } catch (error) {
            setFailure(tr('groups.sendFailed', { message: messageOf(error) }));
          } finally {
            setSending(false);
          }
        };

        const identityOfMessage = (message) => participants.find((participant) => participant.id === message.identityId) ?? { name: message.name ?? '—', accent: '#5b5bd6', avatar: '' };
        const timeOf = (value) => {
          const date = new Date(value);
          return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        };

        return h(
          'div',
          { className: 'pagent-group-page' },
          h(
            'div',
            { className: 'pagent-group-page-head' },
            h(
              'div',
              { className: 'pagent-group-page-title' },
              h('span', { className: 'pagent-group-page-glyph' }, h(IdentitySectionIcon, { size: 18 })),
              h('span', { className: 'pagent-group-page-name', title: group.name }, group.name),
            ),
            h(
              'div',
              { className: 'pagent-group-page-people' },
              participants.map((participant) =>
                h('span', { key: participant.id, className: 'pagent-group-page-person', title: participant.role ?? '' }, h(Avatar, { identity: participant, size: 18 })),
              ),
            ),
          ),
          h(
            'div',
            { className: 'pagent-group-feed', ref: feedRef, role: 'log', 'aria-live': 'polite' },
            messages.length === 0
              ? h('p', { className: 'pagent-group-feed-empty' }, tr('groups.emptyFeed'))
              : messages.map((message) =>
                  message.role === 'user'
                    ? h(
                        'div',
                        { key: message.id, className: 'pagent-group-message', 'data-role': 'user' },
                        h('div', { className: 'pagent-group-bubble pagent-group-bubble-user' }, h('div', { className: 'pagent-group-message-text' }, renderMessageText(message.text))),
                        h('time', { className: 'pagent-group-message-time' }, timeOf(message.time)),
                      )
                    : h(
                        'div',
                        { key: message.id, className: 'pagent-group-message', 'data-role': 'assistant' },
                        h(Avatar, { identity: identityOfMessage(message), size: 24 }),
                        h(
                          'div',
                          { className: 'pagent-group-message-body' },
                          h(
                            'div',
                            { className: 'pagent-group-message-meta' },
                            h('span', { className: 'pagent-group-message-name' }, message.name ?? identityOfMessage(message).name),
                            h('time', { className: 'pagent-group-message-time' }, timeOf(message.time)),
                          ),
                          h('div', { className: 'pagent-group-bubble' }, h('div', { className: 'pagent-group-message-text' }, renderMessageText(message.text))),
                        ),
                      ),
                ),
            running.length > 0
              ? h(
                  'div',
                  { className: 'pagent-group-typing' },
                  running.map((participant) => h('span', { key: participant.id }, `${participant.name} 正在回复…`)),
                )
              : null,
          ),
          failure === null ? null : h('p', { className: 'pagent-group-page-error', role: 'alert' }, failure),
          h(
            'div',
            { className: 'pagent-group-composer' },
            mentionChoices.length === 0
              ? null
              : h(
                  'div',
                  { className: 'pagent-group-mentions', role: 'listbox', 'aria-label': tr('groups.mentionPick') },
                  mentionChoices.map((participant, index) =>
                    h(
                      'button',
                      {
                        key: participant.id,
                        type: 'button',
                        role: 'option',
                        'aria-selected': index === mentionIndex,
                        'data-active': index === mentionIndex ? 'true' : 'false',
                        className: 'pagent-group-mention',
                        onMouseDown: (event) => {
                          event.preventDefault();
                          pickMention(participant);
                        },
                      },
                      h(Avatar, { identity: participant, size: 20 }),
                      h(
                        'span',
                        { className: 'pagent-group-mention-copy' },
                        h('span', { className: 'pagent-group-mention-name' }, participant.name),
                        typeof participant.role === 'string' && participant.role !== ''
                          ? h('span', { className: 'pagent-group-mention-role' }, participant.role)
                          : null,
                      ),
                    ),
                  ),
                ),
            h('textarea', {
              className: 'pagent-group-input',
              ref: inputRef,
              value: draft,
              rows: 3,
              placeholder: tr('groups.composePlaceholder'),
              onChange: (event) => updateDraft(event.target.value, event.target.selectionStart ?? event.target.value.length),
              onClick: (event) => updateDraft(event.target.value, event.target.selectionStart ?? 0),
              onBlur: () => setMention(null),
              onKeyDown: (event) => {
                if (event.nativeEvent?.isComposing === true) return;
                if (mentionChoices.length > 0) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    setMention((current) => (current === null ? current : { ...current, index: (mentionIndex + step + mentionChoices.length) % mentionChoices.length }));
                    return;
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    pickMention(mentionChoices[mentionIndex]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMention(null);
                    return;
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              },
            }),
            h(
              'div',
              { className: 'pagent-group-composer-actions' },
              h('span', { className: 'pagent-group-composer-hint' }, tr('groups.mentionHint')),
              h(
                'button',
                { type: 'button', className: 'pagent-button pagent-button-primary', onClick: () => void send(), disabled: sending || draft.trim() === '' },
                sending ? tr('groups.sending') : tr('groups.send'),
              ),
            ),
          ),
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
     * Render one modal dialog over the app. The mask closes on click; Escape
     * closes; content is a normal themed card.
     * @param props.onClose - dismiss handler.
     * @param props.label - accessible dialog name.
     * @param props.children - dialog content.
     */
    function Modal(props) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') props.onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [props.onClose]);
      return ReactDOM.createPortal(
        h(
          'div',
          {
            className: 'pagent-dialog-mask',
            role: 'presentation',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) props.onClose();
            },
          },
          h(
            'div',
            { className: 'pagent-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': props.label },
            props.children,
          ),
        ),
        document.body,
      );
    }

    /**
     * Choose the participants of a new group conversation.
     * @param props - identities, selection, name, busy/error, handlers, translator.
     */
    function GroupPickerDialog(props) {
      const selectedIdentities = props.identities.filter((identity) => props.selected.includes(identity.id));
      const members = selectedIdentities.map((identity) => identity.name).join(' + ');
      return h(
        Modal,
        { onClose: props.onClose, label: props.tr('groups.pickTitle') },
        h(
          'div',
          { className: 'pagent-dialog-head' },
          h('h2', { className: 'pagent-dialog-title' }, props.tr('groups.pickTitle')),
          h('p', { className: 'pagent-dialog-text' }, props.tr('groups.pickHint')),
        ),
        h(
          'div',
          { className: 'pagent-group-options' },
          props.identities.map((identity) =>
            h(
              'label',
              {
                key: identity.id,
                className: 'pagent-group-option',
                'data-selected': props.selected.includes(identity.id) ? 'true' : 'false',
              },
              h('input', {
                type: 'checkbox',
                checked: props.selected.includes(identity.id),
                onChange: () => props.onToggle(identity.id),
              }),
              h(Avatar, { identity, size: 24 }),
              h(
                'span',
                { className: 'pagent-group-option-copy' },
                h('span', { className: 'pagent-group-option-name' }, identity.name),
                h('span', { className: 'pagent-group-option-role' }, identity.role === '' ? props.tr('identity.editTitle') : identity.role),
              ),
            ),
          ),
        ),
        h(
          'label',
          { className: 'pagent-dialog-field' },
          h('span', { className: 'pagent-label' }, props.tr('groups.name')),
          h('input', {
            className: 'pagent-input',
            value: props.name,
            placeholder: members === '' ? props.tr('groups.namePlaceholder') : members,
            maxLength: 120,
            onChange: (event) => props.onNameChange(event.target.value),
          }),
        ),
        props.error === null ? null : h('p', { className: 'pagent-message', 'data-tone': 'error', role: 'alert' }, props.error),
        h(
          'div',
          { className: 'pagent-dialog-actions' },
          h('button', { type: 'button', className: 'pagent-button', onClick: props.onClose, disabled: props.busy }, props.tr('groups.cancel')),
          h(
            'button',
            {
              type: 'button',
              className: 'pagent-button pagent-button-primary',
              onClick: props.onStart,
              disabled: props.busy || selectedIdentities.length < 2,
            },
            props.busy ? props.tr('groups.starting') : props.tr('groups.start'),
          ),
        ),
      );
    }

    /**
     * Confirm closing one group and archiving its conversation.
     * @param props - group, busy/error, handlers, translator.
     */
    function CloseGroupDialog(props) {
      return h(
        Modal,
        { onClose: props.onClose, label: props.tr('groups.closeTitle', { name: props.group.name }) },
        h(
          'div',
          { className: 'pagent-dialog-head' },
          h('h2', { className: 'pagent-dialog-title' }, props.tr('groups.closeTitle', { name: props.group.name })),
          h('p', { className: 'pagent-dialog-text' }, props.tr('groups.closeText')),
        ),
        props.error === null ? null : h('p', { className: 'pagent-message', 'data-tone': 'error', role: 'alert' }, props.error),
        h(
          'div',
          { className: 'pagent-dialog-actions' },
          h('button', { type: 'button', className: 'pagent-button', onClick: props.onClose, disabled: props.busy }, props.tr('groups.cancel')),
          h(
            'button',
            {
              type: 'button',
              className: 'pagent-button pagent-button-danger',
              onClick: props.onConfirm,
              disabled: props.busy,
            },
            props.busy ? props.tr('groups.closing') : props.tr('groups.closeConfirm'),
          ),
        ),
      );
    }

    /**
     * Rename one group.
     * @param props.group - group row.
     * @param props.value - draft name.
     * @param props.onChange - draft handler.
     * @param props.busy / props.error - save state.
     * @param props.onClose / props.onSave - handlers.
     * @param props.tr - translator.
     */
    function RenameGroupDialog(props) {
      return h(
        Modal,
        { onClose: props.onClose, label: props.tr('groups.renameTitle', { name: props.group.name }) },
        h(
          'div',
          { className: 'pagent-dialog-head' },
          h('h2', { className: 'pagent-dialog-title' }, props.tr('groups.renameTitle', { name: props.group.name })),
        ),
        h(
          'label',
          { className: 'pagent-dialog-field' },
          h('span', { className: 'pagent-label' }, props.tr('groups.renameLabel')),
          h('input', {
            className: 'pagent-input',
            value: props.value,
            maxLength: 120,
            autoFocus: true,
            onChange: (event) => props.onChange(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') props.onSave();
            },
          }),
        ),
        props.error === null ? null : h('p', { className: 'pagent-message', 'data-tone': 'error', role: 'alert' }, props.error),
        h(
          'div',
          { className: 'pagent-dialog-actions' },
          h('button', { type: 'button', className: 'pagent-button', onClick: props.onClose, disabled: props.busy }, props.tr('groups.cancel')),
          h(
            'button',
            {
              type: 'button',
              className: 'pagent-button pagent-button-primary',
              onClick: props.onSave,
              disabled: props.busy || props.value.trim() === '',
            },
            props.busy ? props.tr('groups.renaming') : props.tr('groups.renameSave'),
          ),
        ),
      );
    }

    /**
     * List an identity's earlier conversations and reopen one read-only in the
     * normal Chat view. Opening does not change any model context.
     * @param props.identity - identity whose sessions are listed.
     * @param props.sessions - non-blank non-group Session summaries, newest first.
     * @param props.onOpen / props.onClose - handlers.
     * @param props.tr - translator.
     */
    function HistoryDialog(props) {
      return h(
        Modal,
        { onClose: props.onClose, label: props.tr('history.title', { name: props.identity.name }) },
        h(
          'div',
          { className: 'pagent-dialog-head' },
          h('h2', { className: 'pagent-dialog-title' }, props.tr('history.title', { name: props.identity.name })),
        ),
        props.sessions.length === 0
          ? h('p', { className: 'pagent-dialog-text' }, props.tr('history.empty'))
          : h(
              'div',
              { className: 'pagent-history-list' },
              props.sessions.map((session) => {
                const at = typeof session.updatedAt === 'number' ? new Date(session.updatedAt) : null;
                return h(
                  'button',
                  {
                    key: session.id,
                    type: 'button',
                    className: 'pagent-history-item',
                    onClick: () => props.onOpen(session.id),
                  },
                  h('span', { className: 'pagent-history-title' }, session.displayTitle ?? session.title ?? session.id),
                  h('span', { className: 'pagent-history-time' }, at === null ? '' : at.toLocaleString()),
                );
              }),
            ),
        h(
          'div',
          { className: 'pagent-dialog-actions' },
          h('button', { type: 'button', className: 'pagent-button', onClick: props.onClose }, props.tr('history.close')),
        ),
      );
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
     * Current Session/identity focus reported by the composer status component.
     * The auto-switch poll reads it and only switches while an identity
     * conversation is on screen.
     */
    const conversationFocus = { identityId: null, sessionId: null, historySessionId: null, switching: false };

    /**
     * Subscribe to one client observable snapshot.
     * @param source - observable with getSnapshot/subscribe, or undefined.
     * @returns its current snapshot.
     */
    function useObservable(source) {
      const subscribe = React.useCallback(
        (onChange) => {
          if (typeof source?.subscribe !== 'function') return () => {};
          return source.subscribe(onChange);
        },
        [source],
      );
      const read = React.useCallback(() => source?.getSnapshot?.() ?? null, [source]);
      return React.useSyncExternalStore(subscribe, read, read);
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
      const [groupBusy, setGroupBusy] = React.useState(false);
      const [groupError, setGroupError] = React.useState(null);
      const [groupPicker, setGroupPicker] = React.useState(false);
      const [groupSelected, setGroupSelected] = React.useState([]);
      const [groupName, setGroupName] = React.useState('');
      const [pendingDelete, setPendingDelete] = React.useState(null);
      const [deleteBusy, setDeleteBusy] = React.useState(false);
      const [deleteError, setDeleteError] = React.useState(null);
      const [renamingGroup, setRenamingGroup] = React.useState(null);
      const [renameValue, setRenameValue] = React.useState('');
      const [renameBusy, setRenameBusy] = React.useState(false);
      const [renameError, setRenameError] = React.useState(null);
      const translate = ctx.locale.bind(NS);
      const tr = (key, vars) => interpolate(translate(key), vars);
      const identities = state?.identities ?? [];
      const groups = state?.groups ?? [];
      const [historyIdentity, setHistoryIdentity] = React.useState(null);
      const [historySessions, setHistorySessions] = React.useState([]);
      const [activeGroupId, setActiveGroupId] = React.useState(null);
      const sessionSource = ctx.get('sessions');
      const workspaceSource = ctx.get('workspaces');
      const sessionList = useObservable(sessionSource?.list);
      const workspaceList = useObservable(workspaceSource?.list);
      const thinking = useThinkingVisible();

      React.useEffect(() => {
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') void store.load();
        }, 2000);
        return () => clearInterval(timer);
      }, []);

      React.useEffect(() => {
        if (activeGroupId === null) return undefined;
        let cancelled = false;
        const mark = async () => {
          if (cancelled) return;
          await requestJson(READ_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ groupId: activeGroupId }),
          }).catch(() => undefined);
          if (!cancelled) await store.load(true).catch(() => undefined);
        };
        void mark();
        const timer = setInterval(() => void mark(), 2000);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [activeGroupId]);

      const manage = () => {
        const layout = ctx.get('layout');
        if (layout !== undefined) layout.selectPanel(PANEL_ID);
      };

      const openGroupPicker = () => {
        if (identities.length < 2) return;
        setGroupSelected(identities.map((identity) => identity.id));
        setGroupName('');
        setGroupError(null);
        setGroupPicker(true);
      };

      const toggleGroupIdentity = (identityId) => {
        setGroupSelected((current) =>
          current.includes(identityId) ? current.filter((id) => id !== identityId) : [...current, identityId],
        );
      };

      const startGroup = async () => {
        const selected = identities.filter((identity) => groupSelected.includes(identity.id));
        if (selected.length < 2 || groupBusy) {
          setGroupError(tr('groups.needTwo'));
          return;
        }
        setGroupBusy(true);
        setGroupError(null);
        try {
          const result = await requestJson(GROUP_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              participantIds: selected.map((identity) => identity.id),
              name: groupName.trim() === '' ? selected.map((identity) => identity.name).join(' + ') : groupName.trim(),
            }),
          });
          if (!result.ok || result.data?.ok !== true) {
            throw new Error(result.data?.message ?? `HTTP ${result.status}`);
          }
          setGroupPicker(false);
          await store.load(true);
          if (typeof result.data.groupId === 'string') {
            store.setActiveGroup(result.data.groupId);
            const layout = ctx.get('layout');
            if (layout !== undefined) layout.selectPanel(GROUP_PANEL_ID);
          } else if (typeof result.data.sessionId === 'string') {
            const ui = ctx.get('uiWorkspace');
            if (ui !== undefined) ui.openSession(result.data.sessionId);
          }
        } catch (error) {
          setGroupError(messageOf(error));
        } finally {
          setGroupBusy(false);
        }
      };

      const closeGroup = async () => {
        if (pendingDelete === null) return;
        const group = pendingDelete;
        setDeleteBusy(true);
        setDeleteError(null);
        try {
          const result = await requestJson(GROUP_REMOVE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ groupId: group.id ?? group.sessionId }),
          });
          if (!result.ok || result.data?.ok !== true) {
            throw new Error(result.data?.message ?? `HTTP ${result.status}`);
          }
          setPendingDelete(null);
          await store.load(true);
          const nextIdentity = Array.isArray(group.participants)
            ? group.participants[0]?.id
            : typeof group.host?.id === 'string'
              ? group.host.id
              : undefined;
          if (typeof nextIdentity === 'string') {
            try {
              await openIdentity(ctx, nextIdentity);
            } catch {
              // The identity may have been removed with the group.
            }
          } else {
            store.setActiveGroup(null);
          }
        } catch (error) {
          setDeleteError(tr('groups.closeFailed', { message: messageOf(error) }));
        } finally {
          setDeleteBusy(false);
        }
      };

      const openGroup = (group) => {
        if (group.mode === 'multi' && typeof group.id === 'string') {
          store.setActiveGroup(group.id);
          const layout = ctx.get('layout');
          if (layout !== undefined) layout.selectPanel(GROUP_PANEL_ID);
          return;
        }
        store.setActiveGroup(null);
        const ui = ctx.get('uiWorkspace');
        if (ui !== undefined) ui.openSession(group.sessionId);
      };

      const saveGroupRename = async () => {
        if (renamingGroup === null) return;
        const value = renameValue.trim();
        if (value === '') return;
        setRenameBusy(true);
        setRenameError(null);
        try {
          await renameGroup(ctx, renamingGroup.id ?? renamingGroup.sessionId, value);
          setRenamingGroup(null);
        } catch (error) {
          setRenameError(tr('groups.renameFailed', { message: messageOf(error) }));
        } finally {
          setRenameBusy(false);
        }
      };

      const openHistory = (identity) => {
        const workspace = workspaceList?.items?.find((item) => item.workspaceId === identity.home.workspaceId);
        const groupIds = new Set(groups.map((group) => group.id ?? group.sessionId));
        const sessions = (workspace?.sessionIds ?? [])
          .map((id) => sessionList?.byId?.[id])
          .filter(
            (session) =>
              session !== undefined &&
              session.blank !== true &&
              !groupIds.has(session.id) &&
              session.id !== conversationFocus.sessionId,
          )
          .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
        setHistoryIdentity(identity);
        setHistorySessions(sessions);
      };

      const openHistorySession = (sessionId) => {
        conversationFocus.historySessionId = sessionId;
        const ui = ctx.get('uiWorkspace');
        if (ui !== undefined) ui.openSession(sessionId);
        setHistoryIdentity(null);
      };

      const open = async (identityId) => {
        setActiveGroupId(null);
        setBusy(identityId);
        setFailure(null);
        try {
          await requestJson(READ_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identityId }),
          }).catch(() => undefined);
          await store.load(true).catch(() => undefined);
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
            'div',
            { className: 'pagent-identity-head-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'pagent-identity-thinking',
                title: thinking ? tr('thinking.hide') : tr('thinking.show'),
                'aria-label': thinking ? tr('thinking.hide') : tr('thinking.show'),
                'aria-pressed': thinking ? 'true' : 'false',
                'data-hidden': thinking ? 'false' : 'true',
                onClick: () => setThinkingVisible(!thinking),
              },
              thinking ? '◉' : '◎',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'pagent-identity-group',
                title: identities.length < 2 ? tr('groups.needTwo') : tr('groups.create'),
                'aria-label': tr('groups.create'),
                disabled: identities.length < 2 || groupBusy,
                onClick: () => openGroupPicker(),
              },
              h(IdentitySectionIcon, { size: 15 }),
            ),
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
        ),
        identities.length === 0
          ? h('p', { className: 'pagent-identity-empty' }, tr('identities.empty'))
          : h(
              'div',
              { className: 'pagent-identity-rows' },
              identities.map((identity) =>
                h(
                  'div',
                  { key: identity.id, className: 'pagent-identity-row-wrap' },
                  h(
                    'button',
                    {
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
                      h(
                        'span',
                        { className: 'pagent-identity-name-row' },
                        h('span', { className: 'pagent-identity-name' }, identity.name),
                        (identity.unread ?? 0) > 0
                          ? h(
                              'span',
                              {
                                className: 'pagent-unread',
                                title: tr('unread.title', { count: identity.unread }),
                                'aria-label': tr('unread.title', { count: identity.unread }),
                              },
                              identity.unread > 99 ? '99+' : identity.unread,
                            )
                          : null,
                      ),
                      h('span', { className: 'pagent-identity-role' }, identity.role === '' ? tr('identity.editTitle') : identity.role),
                    ),
                    busy === identity.id ? h('span', { className: 'pagent-identity-busy' }, '…') : null,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'pagent-identity-history',
                      title: tr('history.open'),
                      'aria-label': tr('history.open'),
                      onClick: () => openHistory(identity),
                    },
                    '↺',
                  ),
                ),
              ),
            ),
        groups.length === 0
          ? null
          : h(
              'div',
              { className: 'pagent-group-section' },
              h('div', { className: 'pagent-group-label' }, tr('groups.title')),
              groups.map((group) =>
                h(
                  'div',
                  { key: group.id ?? group.sessionId, className: 'pagent-group-row-wrap' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'pagent-group-row',
                      title: group.name,
                      onClick: () => openGroup(group),
                    },
                    h('span', { className: 'pagent-group-glyph' }, h(IdentitySectionIcon, { size: 14 })),
                    h(
                      'span',
                      { className: 'pagent-group-copy' },
                      h(
                        'span',
                        { className: 'pagent-group-name-row' },
                        h('span', { className: 'pagent-group-name' }, group.name),
                        (group.unread ?? 0) > 0
                          ? h(
                              'span',
                              {
                                className: 'pagent-unread',
                                title: tr('unread.title', { count: group.unread }),
                                'aria-label': tr('unread.title', { count: group.unread }),
                              },
                              group.unread > 99 ? '99+' : group.unread,
                            )
                          : null,
                      ),
                      h(
                        'span',
                        { className: 'pagent-group-members' },
                        tr('groups.memberCount', { count: group.mode === 'multi' ? (group.participants?.length ?? 0) : 1 + (group.guests?.length ?? 0) }),
                      ),
                    ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'pagent-group-rename',
                      title: tr('groups.rename'),
                      'aria-label': tr('groups.rename'),
                      onClick: () => {
                        setRenamingGroup(group);
                        setRenameValue(group.name);
                        setRenameError(null);
                      },
                    },
                    '✎',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'pagent-group-delete',
                      title: tr('groups.close'),
                      'aria-label': tr('groups.close'),
                      onClick: () => {
                        setPendingDelete(group);
                        setDeleteError(null);
                      },
                    },
                    '×',
                  ),
                ),
              ),
            ),
        groupError === null ? null : h('p', { className: 'pagent-identity-error', role: 'alert' }, groupError),
        failure === null ? null : h('p', { className: 'pagent-identity-error', role: 'alert' }, failure),
        groupPicker
          ? h(GroupPickerDialog, {
              identities,
              selected: groupSelected,
              name: groupName,
              busy: groupBusy,
              error: groupError,
              tr,
              onToggle: toggleGroupIdentity,
              onNameChange: setGroupName,
              onClose: () => setGroupPicker(false),
              onStart: () => void startGroup(),
            })
          : null,
        pendingDelete === null
          ? null
          : h(CloseGroupDialog, {
              group: pendingDelete,
              busy: deleteBusy,
              error: deleteError,
              tr,
              onClose: () => setPendingDelete(null),
              onConfirm: () => void closeGroup(),
            }),
        renamingGroup === null
          ? null
          : h(RenameGroupDialog, {
              group: renamingGroup,
              value: renameValue,
              busy: renameBusy,
              error: renameError,
              tr,
              onChange: setRenameValue,
              onClose: () => setRenamingGroup(null),
              onSave: () => void saveGroupRename(),
            }),
        historyIdentity === null
          ? null
          : h(HistoryDialog, {
              identity: historyIdentity,
              sessions: historySessions,
              tr,
              onOpen: openHistorySession,
              onClose: () => setHistoryIdentity(null),
            }),
      );
    }

    /**
     * Working bubble above the composer for the focused identity. It shows the
     * avatar, a playful status line, and the active todo while any of the
     * identity's Sessions runs, and reports the current Session so the
     * auto-switch poll knows where the user is.
     * @param props.ctx - client plugin context.
     * @param props.sessionId - the Session owning this composer.
     */
    function PersonalProgress(props) {
      const ctx = props.ctx;
      const tr = translatorOf(props);
      const { state } = useStoreSnapshot();
      const sessions = ctx.get('sessions');
      const workspaces = ctx.get('workspaces');
      const sessionList = useObservable(sessions?.list);
      const workspaceList = useObservable(workspaces?.list);
      const projectedTodos = typeof props.useProjection === 'function' ? props.useProjection('todos') : null;
      const sessionId = props.sessionId;

      React.useEffect(() => {
        if (state === null) void store.load();
      }, [state === null]);

      const workspace = workspaceList?.items?.find(
        (item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId),
      );
      const groupSession = state?.groups?.some((group) => group.sessionId === sessionId) === true;
      const identity = groupSession
        ? null
        : state?.identities?.find((item) => item.home.workspaceId === workspace?.workspaceId) ?? null;

      React.useEffect(() => {
        if (identity === null) return undefined;
        let cancelled = false;
        const mark = async () => {
          if (cancelled) return;
          await requestJson(READ_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identityId: identity.id }),
          }).catch(() => undefined);
          if (!cancelled) await store.load(true).catch(() => undefined);
        };
        void mark();
        const timer = setInterval(() => void mark(), 2000);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [identity?.id]);

      React.useEffect(() => {
        if (typeof sessionId !== 'string') return undefined;
        conversationFocus.identityId = identity?.id ?? null;
        conversationFocus.sessionId = sessionId;
        if (conversationFocus.historySessionId !== null && conversationFocus.historySessionId !== sessionId) {
          conversationFocus.historySessionId = null;
        }
        return () => {
          if (conversationFocus.sessionId === sessionId) {
            conversationFocus.identityId = null;
            conversationFocus.sessionId = null;
          }
        };
      }, [identity?.id, sessionId]);

      const sessionIds = workspace?.sessionIds ?? [];
      const summaries = sessionIds.map((id) => sessionList?.byId?.[id]).filter((item) => item !== undefined);
      const running = summaries.filter((item) => item.running);
      const currentRunning = sessionList?.byId?.[sessionId]?.running === true;
      const thinking = useThinkingVisible();
      const currentTodos = Array.isArray(projectedTodos) && projectedTodos.length > 0
        ? projectedTodos
        : sessionList?.projectionsBySession?.[sessionId]?.values?.todos;
      const todos =
        Array.isArray(currentTodos) && currentTodos.length > 0
          ? currentTodos
          : (sessionIds
              .map((id) => sessionList?.projectionsBySession?.[id]?.values?.todos)
              .find((items) => Array.isArray(items) && items.length > 0) ?? []);
      const working = running.length > 0;
      const [busyIndex, setBusyIndex] = React.useState(0);
      React.useEffect(() => {
        if (!working) return undefined;
        setBusyIndex(0);
        const timer = setInterval(() => setBusyIndex((index) => (index + 1) % 3), 3800);
        return () => clearInterval(timer);
      }, [working]);
      const showWorking = typeof sessionId === 'string' && identity !== null && working && !thinking;
      // The working bubble belongs to the transcript, not to the composer dock:
      // a dock bubble floats over the feed and hides messages while scrolling back.
      // A portal host at the end of the chat column keeps it in the flow, so it
      // scrolls away with the conversation and never covers earlier messages.
      const [workingHost, setWorkingHost] = React.useState(null);
      React.useEffect(() => {
        if (!showWorking) {
          setWorkingHost(null);
          return undefined;
        }
        let cancelled = false;
        let timer = null;
        let attempts = 0;
        let host = null;
        let observer = null;
        const pinToTail = () => {
          const scope = document.querySelector('[data-conversation-content]');
          if (scope === null || scope.querySelector('[data-chat-following-tail]') === null) return;
          const scroller = scope.querySelector('[class*="_scrollBody"]');
          if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
        };
        const attach = () => {
          if (cancelled) return;
          const scope = document.querySelector('[data-conversation-content]');
          const column = scope?.querySelector('[class*="_column"]') ?? null;
          const flow = scope?.querySelector('[data-slot="conversation.chat.flow"]') ?? null;
          const parent = column ?? flow?.parentElement ?? null;
          if (parent === null) {
            if (attempts < 20) {
              attempts += 1;
              timer = setTimeout(attach, 150);
            }
            return;
          }
          host = document.createElement('div');
          host.className = 'pagent-working-host';
          parent.appendChild(host);
          setWorkingHost(host);
          // Reveal the bubble once, and whenever its text wraps to another line,
          // but only while the reader is already following the tail.
          observer = new ResizeObserver(pinToTail);
          observer.observe(host);
          window.requestAnimationFrame(pinToTail);
        };
        attach();
        return () => {
          cancelled = true;
          if (timer !== null) clearTimeout(timer);
          if (observer !== null) observer.disconnect();
          if (host !== null) host.remove();
        };
      }, [showWorking, sessionId]);
      if (!showWorking || identity === null || workingHost === null) return null;
      const active = todos.find((item) => item.status === 'in_progress') ?? null;
      const otherRunning = Math.max(0, running.length - (currentRunning ? 1 : 0));
      const busyKey = ['progress.busy1', 'progress.busy2', 'progress.busy3'][busyIndex] ?? 'progress.busy1';
      return ReactDOM.createPortal(h(
        'div',
        {
          className: 'pagent-working',
          'data-running': 'true',
          role: 'status',
          'aria-live': 'polite',
        },
        h(
          'span',
          {
            className: 'pagent-working-avatar',
            'aria-hidden': true,
            style: { background: identity.accent, color: readableText(identity.accent) },
          },
          avatarGlyph(identity),
        ),
        h(
          'div',
          { className: 'pagent-working-main' },
          h('span', { className: 'pagent-working-name' }, identity.name),
          h(
            'div',
            { className: 'pagent-working-bubble' },
            h('span', { className: 'pagent-working-text' }, tr(busyKey), h('span', { className: 'pagent-working-dots', 'aria-hidden': true })),
            active?.content ? h('span', { className: 'pagent-working-task' }, active.content) : null,
            otherRunning > 0
              ? h('span', { className: 'pagent-working-task' }, tr('progress.other', { count: otherRunning }))
              : null,
          ),
        ),
      ), workingHost);
    }

    /**
     * Rename one group through the Host and refresh state.
     * @param ctx - client plugin context.
     * @param groupKey - group id or legacy host Session id.
     * @param name - new name.
     * @returns the accepted name.
     */
    async function renameGroup(ctx, groupKey, name) {
      const result = await requestJson(GROUP_RENAME_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: groupKey, name }),
      });
      if (!result.ok || result.data?.ok !== true) {
        throw new Error(result.data?.message ?? `HTTP ${result.status}`);
      }
      await store.load(true);
      return result.data.name;
    }

    /**
     * Personalize the blank-session hero: hide the shipped brand, workspace and
     * preset chrome for an identity or group Session, and show only the agent's
     * avatar/name (or the group name). Project Sessions keep the native hero.
     * @param props.sessionId - current Session.
     * @param props.ctx - client plugin context.
     */
    function HeroIdentity(props) {
      const ctx = props.ctx;
      const tr = translatorOf(props);
      const { state } = useStoreSnapshot();
      const sessions = ctx.get('sessions');
      const workspaces = ctx.get('workspaces');
      const sessionList = useObservable(sessions?.list);
      const workspaceList = useObservable(workspaces?.list);
      const sessionId = props.sessionId;
      const markerRef = React.useRef(null);
      const [host, setHost] = React.useState(null);
      const [renameOpen, setRenameOpen] = React.useState(false);
      const [renameValue, setRenameValue] = React.useState('');
      const [renameBusy, setRenameBusy] = React.useState(false);
      const [renameError, setRenameError] = React.useState(null);

      React.useEffect(() => {
        if (state === null) void store.load();
      }, [state === null]);

      const workspace = workspaceList?.items?.find(
        (item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId),
      );
      const group = state?.groups?.find((candidate) => candidate.sessionId === sessionId) ?? null;
      const identity = group === null
        ? state?.identities?.find((candidate) => candidate.home.workspaceId === workspace?.workspaceId) ?? null
        : null;

      React.useEffect(() => {
        if ((group === null && identity === null) || markerRef.current === null) {
          setHost(null);
          return undefined;
        }
        const root = markerRef.current.closest('[data-phase="hero"]');
        if (root === null) {
          setHost(null);
          return undefined;
        }
        const headline = root.querySelector('[class*="_headline"]');
        const stack = headline?.parentElement ?? null;
        const body = stack?.querySelector('[class*="_body"]') ?? null;
        const target = body ?? stack ?? root;
        const element = document.createElement('div');
        element.className = 'pagent-hero-host';
        target.appendChild(element);
        root.classList.add('pagent-hero-mode');
        setHost(element);
        return () => {
          element.remove();
          root.classList.remove('pagent-hero-mode');
          setHost(null);
        };
      }, [sessionId, group === null ? '' : group.sessionId, identity === null ? '' : identity.id]);

      const saveRename = async () => {
        if (group === null) return;
        const value = renameValue.trim();
        if (value === '') return;
        setRenameBusy(true);
        setRenameError(null);
        try {
          await renameGroup(ctx, group.sessionId, value);
          setRenameOpen(false);
        } catch (error) {
          setRenameError(tr('groups.renameFailed', { message: messageOf(error) }));
        } finally {
          setRenameBusy(false);
        }
      };

      const header = group !== null
        ? h(
            'div',
            { className: 'pagent-hero-identity' },
            h('span', { className: 'pagent-hero-avatar pagent-hero-group-avatar' }, h(IdentitySectionIcon, { size: 22 })),
            h('span', { className: 'pagent-hero-name', title: group.name }, group.name),
            h(
              'button',
              {
                type: 'button',
                className: 'pagent-hero-rename',
                title: tr('groups.rename'),
                'aria-label': tr('groups.rename'),
                onClick: () => {
                  setRenameValue(group.name);
                  setRenameError(null);
                  setRenameOpen(true);
                },
              },
              '✎',
            ),
          )
        : identity !== null
          ? h(
              'div',
              { className: 'pagent-hero-identity' },
              h(Avatar, { identity, size: 40 }),
              h('span', { className: 'pagent-hero-name', title: identity.name }, identity.name),
            )
          : null;

      return h(
        'span',
        { ref: markerRef, style: { display: 'none' } },
        host !== null && header !== null ? ReactDOM.createPortal(header, host) : null,
        renameOpen && group !== null
          ? h(RenameGroupDialog, {
              group,
              value: renameValue,
              busy: renameBusy,
              error: renameError,
              tr,
              onChange: setRenameValue,
              onClose: () => setRenameOpen(false),
              onSave: () => void saveRename(),
            })
          : null,
      );
    }
    /**
     * Personalize the active conversation header: hide the Session title and
     * preset controls for identity and group Sessions, and show the agent's
     * avatar/name or the group name in their place. Project headers are native.
     * @param props.sessionId - current Session.
     * @param props.ctx - client plugin context.
     */
    function HeaderIdentity(props) {
      const ctx = props.ctx;
      const { state } = useStoreSnapshot();
      const sessions = ctx.get('sessions');
      const workspaces = ctx.get('workspaces');
      const workspaceList = useObservable(workspaces?.list);
      const sessionId = props.sessionId;
      const markerRef = React.useRef(null);
      const [host, setHost] = React.useState(null);
      const thinking = useThinkingVisible();

      React.useEffect(() => {
        if (state === null) void store.load();
      }, [state === null]);

      const workspace = workspaceList?.items?.find(
        (item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId),
      );
      const group = state?.groups?.find((candidate) => candidate.sessionId === sessionId) ?? null;
      const identity = group === null
        ? state?.identities?.find((candidate) => candidate.home.workspaceId === workspace?.workspaceId) ?? null
        : null;
      const groupReadId = group?.id ?? group?.sessionId ?? null;
      const identityReadId = identity?.id ?? null;

      React.useEffect(() => {
        if (groupReadId === null && identityReadId === null) return undefined;
        let cancelled = false;
        const mark = async () => {
          if (cancelled) return;
          await requestJson(READ_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(groupReadId !== null ? { groupId: groupReadId } : { identityId: identityReadId }),
          }).catch(() => undefined);
          if (!cancelled) await store.load(true).catch(() => undefined);
        };
        void mark();
        const timer = setInterval(() => void mark(), 2000);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [groupReadId, identityReadId]);

      React.useEffect(() => {
        if (group === null && identity === null) {
          setHost(null);
          return undefined;
        }
        let cancelled = false;
        let timer = null;
        let attempts = 0;
        let element = null;
        let header = null;
        let root = null;
        const attach = () => {
          if (cancelled) return;
          const marker = markerRef.current;
          if (marker === null) return;
          const candidate = marker.closest('header');
          const cluster = candidate?.querySelector('[class*="_titleCluster"]');
          if (candidate === null || cluster === undefined || cluster === null) {
            if (attempts < 40) {
              attempts += 1;
              timer = setTimeout(attach, 150);
            }
            return;
          }
          header = candidate;
          root = marker.closest('[data-phase]');
          element = document.createElement('div');
          element.className = 'pagent-header-host';
          cluster.prepend(element);
          header.classList.add('pagent-header-mode');
          if (root !== null) {
            root.classList.toggle('pagent-identity-mode', identity !== null);
            root.classList.toggle('pagent-hide-process', !thinking);
            if (identity !== null) {
              root.style.setProperty('--pagent-avatar', JSON.stringify(avatarGlyph(identity)));
              root.style.setProperty('--pagent-name', JSON.stringify(identity.name || ''));
              root.style.setProperty('--pagent-avatar-bg', identity.accent || '#5b5bd6');
              root.style.setProperty('--pagent-avatar-color', readableText(identity.accent || '#5b5bd6'));
            } else {
              root.style.removeProperty('--pagent-avatar');
              root.style.removeProperty('--pagent-name');
              root.style.removeProperty('--pagent-avatar-bg');
              root.style.removeProperty('--pagent-avatar-color');
            }
          }
          setHost(element);
        };
        attach();
        return () => {
          cancelled = true;
          if (timer !== null) clearTimeout(timer);
          if (element !== null) element.remove();
          if (header !== null) header.classList.remove('pagent-header-mode');
          if (root !== null) {
            root.classList.remove('pagent-identity-mode');
            root.classList.remove('pagent-hide-process');
            root.style.removeProperty('--pagent-avatar');
            root.style.removeProperty('--pagent-name');
            root.style.removeProperty('--pagent-avatar-bg');
            root.style.removeProperty('--pagent-avatar-color');
          }
          setHost(null);
        };
      }, [sessionId, group === null ? '' : group.sessionId, identity === null ? '' : identity.id, thinking]);

      const content = group !== null
        ? h(
            'div',
            { className: 'pagent-header-identity' },
            h('span', { className: 'pagent-header-icon' }, h(IdentitySectionIcon, { size: 15 })),
            h('span', { className: 'pagent-header-name', title: group.name }, group.name),
          )
        : identity !== null
          ? h(
              'div',
              { className: 'pagent-header-identity' },
              h(Avatar, { identity, size: 24 }),
              h('span', { className: 'pagent-header-name', title: identity.name }, identity.name),
            )
          : null;

      return h(
        'span',
        { ref: markerRef, style: { display: 'none' } },
        host !== null && content !== null ? ReactDOM.createPortal(content, host) : null,
      );
    }

    /**
     * Display-only history for a fresh conversation. It fetches the previous
     * conversation's text from the Host and renders it above the composer; the
     * text never enters the new Session's model context.
     * @param props.sessionId - current fresh Session.
     * @param props.ctx - client plugin context.
     */
    function FreshHistoryDock(props) {
      const ctx = props.ctx;
      const tr = translatorOf(props);
      const { state } = useStoreSnapshot();
      const workspaces = ctx.get('workspaces');
      const workspaceList = useObservable(workspaces?.list);
      const sessionId = props.sessionId;
      const [open, setOpen] = React.useState(true);
      const [messages, setMessages] = React.useState(null);
      const [failure, setFailure] = React.useState(false);

      React.useEffect(() => {
        if (state === null) void store.load();
      }, [state === null]);

      const workspace = workspaceList?.items?.find(
        (item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId),
      );
      const identity = state?.identities?.find(
        (candidate) =>
          candidate.home.workspaceId === workspace?.workspaceId &&
          candidate.freshSessionId === sessionId,
      ) ?? null;
      const source = identity?.historySessionId ?? null;

      React.useEffect(() => {
        if (source === null) {
          setMessages(null);
          setFailure(false);
          return undefined;
        }
        let cancelled = false;
        setMessages(null);
        setFailure(false);
        void requestJson(TRANSCRIPT_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: source }),
        })
          .then((result) => {
            if (cancelled) return;
            if (!result.ok || result.data?.ok !== true || !Array.isArray(result.data.messages)) {
              throw new Error(result.data?.message ?? `HTTP ${result.status}`);
            }
            setMessages(result.data.messages);
          })
          .catch(() => {
            if (!cancelled) setFailure(true);
          });
        return () => {
          cancelled = true;
        };
      }, [source]);

      if (identity === null || source === null) return null;
      const list = messages ?? [];
      return h(
        'section',
        { className: 'pagent-display-history', 'data-open': open ? 'true' : 'false' },
        h(
          'button',
          {
            type: 'button',
            className: 'pagent-display-history-head',
            'aria-expanded': open,
            onClick: () => setOpen((value) => !value),
          },
          h('span', { className: 'pagent-display-history-title' }, tr('history.displayTitle')),
          h(
            'span',
            { className: 'pagent-display-history-count' },
            tr('history.displayCount', { count: list.length }),
          ),
          h('span', { className: 'pagent-display-history-chevron', 'aria-hidden': true }, open ? '▾' : '▸'),
        ),
        open
          ? h(
              'div',
              { className: 'pagent-display-history-body' },
              failure
                ? h('p', { className: 'pagent-display-history-empty' }, tr('history.displayFailed'))
                : messages === null
                  ? h('p', { className: 'pagent-display-history-empty' }, '…')
                  : list.length === 0
                    ? h('p', { className: 'pagent-display-history-empty' }, tr('history.displayEmpty'))
                    : list.map((message) =>
                        h(
                          'div',
                          { key: message.seq, className: 'pagent-display-message', 'data-role': message.role },
                          h(
                            'span',
                            { className: 'pagent-display-role' },
                            message.role === 'user' ? tr('history.you') : identity.name,
                          ),
                          h('p', { className: 'pagent-display-text' }, message.text),
                        ),
                      ),
            )
          : null,
      );
    }

    /**
     * Shared state, created once per loaded module generation.
     */
    const store = createStore();

    /** Client entry: dictionaries, chrome, brand, panel, and identity list. */
    return {
      inject: ['slots', 'locale'],
      /** Pure group-composer `@` picker logic, exported for the node test suite. */
      __mentions: { mentionTokenAt, mentionCandidates, applyMention },
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
            for (const group of state?.groups ?? []) {
              const workspaceId = group.workspaceId;
              if (typeof workspaceId === 'string' && workspaceId !== '') workspaceIds.add(workspaceId);
            }
            const workspaces = ctx.get('workspaces');
            const snapshot = workspaces?.list.getSnapshot?.();
            const sessionIds = new Set();
            for (const workspace of snapshot?.items ?? []) {
              if (!workspaceIds.has(workspace.workspaceId)) continue;
              for (const sessionId of workspace.sessionIds ?? []) sessionIds.add(sessionId);
            }
            // Identity and group homes keep their conversations out of every
            // project. Sessions can be detached from their home workspace (for
            // example legacy group conversations renamed after a group), so
            // hide by working directory as well, not only by workspace member
            // lists; otherwise those rows leak into the Ungrouped bucket.
            const personalDirs = new Set();
            const addPersonalHome = (path) => {
              if (typeof path !== 'string') return;
              const match = /^(.*)\/(identities|groups)\/[^/]+\/home$/.exec(path);
              if (match === null) return;
              personalDirs.add(`${match[1]}/identities/`);
              personalDirs.add(`${match[1]}/groups/`);
            };
            for (const identity of state?.identities ?? []) addPersonalHome(identity.home?.path);
            for (const group of state?.groups ?? []) addPersonalHome(group.home);
            const insidePersonal = (cwd) => {
              if (typeof cwd !== 'string' || cwd === '') return false;
              for (const dir of personalDirs) if (cwd === dir.slice(0, -1) || cwd.startsWith(dir)) return true;
              return false;
            };
            const summaries = ctx.get('sessions')?.list.getSnapshot?.()?.byId ?? {};
            const personalSessions = new Set();
            for (const [id, summary] of Object.entries(summaries)) {
              if (insidePersonal(summary?.cwd)) personalSessions.add(id);
            }
            const rules = [];
            for (const id of workspaceIds) rules.push(`[data-row-key="workspace:${escapeKey(id)}"]{display:none!important}`);
            for (const id of sessionIds) rules.push(`[data-row-key="session:${escapeKey(id)}"]{display:none!important}`);
            for (const id of personalSessions) rules.push(`[data-row-key="session:${escapeKey(id)}"]{display:none!important}`);
            // The Ungrouped bucket only exists for Sessions outside every
            // Workspace. When all of them are identity/group conversations the
            // bucket is wholly ours and is hidden too, so the browser shows no
            // empty group header left behind.
            const accounted = new Set();
            for (const workspace of snapshot?.items ?? []) for (const id of workspace.sessionIds ?? []) accounted.add(id);
            const strays = Object.keys(summaries).filter((id) => !accounted.has(id));
            const renderable = strays.filter((id) => {
              const summary = summaries[id];
              if (summary === undefined) return false;
              if (summary.origin === 'subagent') return false;
              if (summary.blank === true) return false;
              return true;
            });
            if (renderable.length > 0 && renderable.every((id) => personalSessions.has(id))) rules.push('[data-row-key="workspace:"]{display:none!important}');
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

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: GROUP_PANEL_ID,
              locale: NS,
            },
            makeGroupPage(ctx),
          ),
        );

        // Blank-session hero personalization: identities show their avatar and
        // name, groups show the group name, and the shipped brand/workspace/
        // preset chrome is hidden only while one of those is on screen.
        ctx.slots.inject('conversation.hero.options', () =>
          ctx.slots.register(
            {
              name: 'conversation.hero.options',
              id: 'personal-agent-hero',
              order: 40,
              locale: NS,
              inject: (sessionId) => ({ sessionId }),
            },
            (props) => h(HeroIdentity, { ...props, ctx }),
          ),
        );

        // Active conversation header personalization: identity avatar/name or
        // group name, with the shipped session title/preset hidden only for
        // those Sessions.
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'personal-agent-header',
              order: 5,
              locale: NS,
              inject: (sessionId) => ({ sessionId }),
            },
            (props) => h(HeaderIdentity, { ...props, ctx }),
          ),
        );

        // Display-only history for a fresh conversation. It is a client-side
        // transcript, not part of the new Session's model context.
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'personal-agent-display-history',
              order: 20,
              locale: NS,
              inject: (sessionId) => ({ sessionId }),
            },
            (props) => h(FreshHistoryDock, { ...props, ctx }),
          ),
        );

        // Working bubble above the composer. It also reports the current
        // identity Session to the auto-switch poll.
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'personal-agent-working',
              order: 30,
              locale: NS,
              inject: (sessionId) => ({ sessionId }),
            },
            (props) => h(PersonalProgress, { ...props, ctx }),
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

        // Follow a newly forked conversation automatically. The status
        // component above reports which identity Session is on screen; when
        // the Host state's newest Session for that identity changes and the
        // current Session is idle, open the new one. The fork carries the full
        // transcript, so history stays visible across the switch.
        ctx.effect(() => {
          let cancelled = false;
          let polling = false;
          const timer = setInterval(async () => {
            if (cancelled || polling) return;
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            const focus = conversationFocus;
            if (focus.identityId === null || focus.sessionId === null || focus.switching) return;
            const sessions = ctx.get('sessions');
            const current = sessions?.list.getSnapshot().byId[focus.sessionId];
            if (current?.running === true) return;
            polling = true;
            try {
              const result = await requestJson(STATE_URL);
              if (!result.ok) return;
              if (focus.historySessionId === focus.sessionId) return;
              const identity = result.data?.identities?.find((item) => item.id === focus.identityId);
              const fresh = identity?.freshSessionId;
              if (typeof fresh !== 'string' || fresh === focus.sessionId) return;
              const freshSummary = sessions?.list.getSnapshot().byId[fresh];
              if (freshSummary?.origin === 'subagent') return;
              const ui = ctx.get('uiWorkspace');
              if (ui === undefined) return;
              focus.switching = true;
              console.debug(`personal-agent: auto-switching to fresh conversation ${fresh}`);
              await ui.openSession(fresh);
              focus.sessionId = fresh;
              await store.load(true).catch(() => undefined);
            } catch (error) {
              console.warn('personal-agent: auto-switch failed:', messageOf(error));
            } finally {
              focus.switching = false;
              polling = false;
            }
          }, 900);
          return () => {
            cancelled = true;
            clearInterval(timer);
          };
        }, 'personal-agent: auto-switch to new conversations');

        // Restore an open group feed after a page refresh. Clicking an identity
        // clears the active group, so this never overrides an explicit choice.
        ctx.effect(() => {
          let opened = null;
          const begin = () => {
            const { state, activeGroupId } = store.snapshot();
            if (state === null || activeGroupId === null) return;
            const group = state.groups?.find((candidate) => candidate.mode === 'multi' && candidate.id === activeGroupId);
            if (group === undefined) {
              store.setActiveGroup(null);
              return;
            }
            if (opened === activeGroupId) return;
            const layout = ctx.get('layout');
            if (layout === undefined) return;
            opened = activeGroupId;
            layout.selectPanel(GROUP_PANEL_ID);
          };
          const unsubscribe = store.subscribe(begin);
          begin();
          return unsubscribe;
        }, 'personal-agent: restore group feed');

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