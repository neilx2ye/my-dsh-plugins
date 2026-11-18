/**
 * Browser half of the Git explorer bundle.
 *
 * The Git view lives beside the conversation, not in the main column: a
 * conversation-header toggle opens a session-scoped right-Sidebar tab, and the
 * tab reads the repository of the workspace owning that Session. The built-in
 * right column supplies resizing and its own collapse control; the panel also
 * puts a collapse button in its header. Each commit is one node on a vertical
 * line, with the subject as the node's description.
 */

window.__ModuleLoader__.load({
  id: '@local/git-explorer',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'gitExplorer';
    /** Tab kind opened by the conversation-header control. */
    const TAB_KIND = 'gitExplorer';
    /** This implementation's identity in the tab registry and slot seats. */
    const TAB_ID = '@local/git-explorer/tab';
    /** Host route that reports one registered Workspace's repository. */
    const WORKSPACE_URL = 'api/git-explorer/workspace';
    /** Host route returning one changed file's unified diff. */
    const DIFF_URL = 'api/git-explorer/diff';
    /** Host route staging all changes and creating one commit. */
    const COMMIT_URL = 'api/git-explorer/commit';

    const EN = {
      tabTitle: 'Git',
      toggle: 'Toggle Git panel',
      collapse: 'Collapse Git panel',
      refreshHint: 'Re-read branches and commits',
      remote: 'Remote ({count})',
      current: 'Current',
      detached: 'Detached @{sha}',
      changes: 'Changes',
      history: 'History',
      views: 'Git views',
      clean: 'No uncommitted changes',
      cleanHint: 'The working tree matches the last commit.',
      filesOne: '1 file',
      filesCount: '{count} files',
      filesMore: '{count}+ files',
      changesMore: 'More changed files are not shown',
      diffLoading: 'Loading diff…',
      diffEmpty: 'No diff content',
      diffError: 'Could not read this diff',
      diffTruncated: 'Diff truncated',
      diffLabel: 'File diff',
      commit: 'Commit',
      commitHint: 'Commit all changes',
      commitTitle: 'Commit changes',
      commitScope: 'All working-tree changes',
      commitMessage: 'Commit message',
      commitPlaceholder: 'Describe this change',
      commitAll: 'Stages all {count} changed files and commits them.',
      commitCancel: 'Cancel',
      commitSubmit: 'Commit',
      commitSubmitting: 'Committing…',
      commitNeedsMessage: 'Enter a commit message',
      commitNoChanges: 'Nothing to commit',
      commitError: 'Commit failed',
      commitSuccess: 'Committed {sha}',
      commitSuccessGeneric: 'Committed',
      loadingRepo: 'Reading branches and commits…',
      notRepo: 'Not a Git repository',
      notRepoHint: 'This workspace has no Git metadata, so there are no branches or commits to show.',
      emptyRepo: 'No commits yet',
      emptyRepoHint: 'This repository has a branch but no commit has been created.',
      noBranches: 'No branches',
      noCommits: 'No commits on this branch',
      noCommitsHint: 'Choose another branch above, or create the first commit.',
      commitsShown: '{count} commits',
      commitsMore: 'Older commits not shown',
      commitsLabel: 'Commit timeline',
      errorTitle: 'Could not read this repository',
      errorUnknownRef: 'That branch is no longer available. Choose another one.',
      retry: 'Try again',
      noWorkspace: 'No workspace for this conversation',
      noWorkspaceHint: 'This conversation is not attached to a workspace, so there is no Git repository to read.',
      untitledCommit: '(no commit message)',
    };

    const ZH = {
      tabTitle: 'Git',
      toggle: '开关 Git 侧栏',
      collapse: '收起 Git 侧栏',
      refreshHint: '重新读取分支与提交',
      remote: '远程（{count}）',
      current: '当前',
      detached: '游离 HEAD @{sha}',
      changes: '更改',
      history: '提交历史',
      views: 'Git 视图',
      clean: '没有未提交的更改',
      cleanHint: '工作区与最后一次提交一致。',
      filesOne: '1 个文件',
      filesCount: '{count} 个文件',
      filesMore: '{count}+ 个文件',
      changesMore: '还有更多更改未列出',
      diffLoading: '正在加载 diff…',
      diffEmpty: '没有 diff 内容',
      diffError: '无法读取这个 diff',
      diffTruncated: 'diff 已截断',
      diffLabel: '文件 diff',
      commit: '提交',
      commitHint: '提交全部更改',
      commitTitle: '提交更改',
      commitScope: '全部工作区更改',
      commitMessage: '提交说明',
      commitPlaceholder: '描述这次更改',
      commitAll: '将暂存全部 {count} 个更改文件并提交。',
      commitCancel: '取消',
      commitSubmit: '提交',
      commitSubmitting: '提交中…',
      commitNeedsMessage: '请输入提交说明',
      commitNoChanges: '没有可提交的更改',
      commitError: '提交失败',
      commitSuccess: '已提交 {sha}',
      commitSuccessGeneric: '已提交',
      loadingRepo: '正在读取分支与提交…',
      notRepo: '不是 Git 仓库',
      notRepoHint: '这个工作区没有 Git 元数据，因此没有分支或提交可显示。',
      emptyRepo: '还没有提交',
      emptyRepoHint: '这个仓库已有分支，但还没有创建第一次提交。',
      noBranches: '还没有分支',
      noCommits: '这个分支还没有提交',
      noCommitsHint: '在上方选择其他分支，或创建第一次提交。',
      commitsShown: '{count} 次提交',
      commitsMore: '没有显示更早的提交',
      commitsLabel: '提交时间线',
      errorTitle: '无法读取这个仓库',
      errorUnknownRef: '这个分支已经不存在了，请选择其他分支。',
      retry: '重试',
      noWorkspace: '这个对话没有关联工作区',
      noWorkspaceHint: '这个对话没有挂载到工作区，因此没有可读取的 Git 仓库。',
      untitledCommit: '（无提交说明）',
    };

    const STYLE = `
.gx-panel{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}
.gx-head{flex:none;padding:10px 10px 9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.gx-head-top{display:flex;align-items:flex-start;gap:8px;min-width:0}
.gx-mark{display:inline-flex;flex:none;align-items:center;justify-content:center;width:16px;height:20px;color:var(--dsw-alias-brand-primary)}
.gx-mark svg{display:block}
.gx-head-copy{flex:1;min-width:0;padding-top:1px}
.gx-ws-title{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.45;font-weight:600;letter-spacing:-.005em}
.gx-path{margin:1px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.9}
.gx-head-actions{display:flex;flex:none;align-items:center;gap:1px;margin-top:-4px;margin-right:-4px}
.gx-icon-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1;flex:none}
.gx-icon-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gx-icon-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.gx-icon-button:disabled{opacity:.45;cursor:default}
.gx-icon-button svg{display:block}
.gx-tabs{flex:none;display:flex;align-items:stretch;gap:2px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.gx-tab{appearance:none;position:relative;display:inline-flex;align-items:center;gap:5px;padding:8px 8px 7px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11.5px;line-height:1.5;white-space:nowrap}
.gx-tab:hover{color:var(--dsw-alias-label-primary)}
.gx-tab[data-active="true"]{color:var(--dsw-alias-label-primary);font-weight:600}
.gx-tab[data-active="true"]::after{content:"";position:absolute;left:7px;right:7px;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-brand-primary)}
.gx-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:4px}
.gx-tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:14px;height:14px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.gx-tab[data-active="true"] .gx-tab-count{color:var(--dsw-alias-brand-primary)}
.gx-notice{flex:none;margin:8px 8px 0;padding:6px 9px;border:1px solid var(--dsw-alias-state-success-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-success-primary);font-size:10.5px;line-height:1.5;overflow-wrap:anywhere}
.gx-commitbar{display:flex;align-items:center;gap:8px;padding:0 0 9px;margin:0 0 9px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.gx-commitbar-hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.5}
.gx-commit-open{appearance:none;flex:none;margin-left:auto;padding:4px 11px;border:1px solid var(--dsw-alias-brand-primary);border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;line-height:1.5;white-space:nowrap}
.gx-commit-open:hover{opacity:.92}
.gx-commit-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.gx-commitbox{padding:0 0 10px;margin:0 0 9px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.gx-commitbox-head{display:flex;align-items:baseline;gap:6px;margin-bottom:6px}
.gx-commitbox-title{color:var(--dsw-alias-label-primary);font-size:11.5px;font-weight:600;line-height:1.5}
.gx-commitbox-scope{margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:1.5;white-space:nowrap}
.gx-commit-input{box-sizing:border-box;display:block;width:100%;min-height:62px;max-height:140px;resize:vertical;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:11.5px;line-height:1.5}
.gx-commit-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.8}
.gx-commit-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.gx-commit-input:disabled{opacity:.6;cursor:default}
.gx-commit-hint{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:1.5}
.gx-commit-error{margin:4px 0 0;color:var(--dsw-alias-state-error-primary);font-size:10px;line-height:1.5;overflow-wrap:anywhere}
.gx-commit-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:7px}
.gx-commit-cancel{appearance:none;padding:3px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;font-size:10.5px;line-height:1.5}
.gx-commit-cancel:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gx-commit-cancel:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.gx-commit-cancel:disabled{opacity:.5;cursor:default}
.gx-commit-submit{appearance:none;padding:3px 10px;border:1px solid var(--dsw-alias-brand-primary);border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:600;line-height:1.5}
.gx-commit-submit:hover:not(:disabled){opacity:.92}
.gx-commit-submit:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.gx-commit-submit:disabled{opacity:.45;cursor:default}
.gx-branchbar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 10px 7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.gx-branch-scroll{display:flex;align-items:center;gap:4px;flex:1 1 120px;min-width:0;padding:1px 0;overflow-x:auto;scrollbar-width:thin}
.gx-branch{appearance:none;display:inline-flex;align-items:center;flex:none;padding:3px 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
.gx-branch:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gx-branch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.gx-branch[data-current="true"]{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.gx-branch[data-current="true"]::before{content:"";width:5px;height:5px;margin-right:5px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none}
.gx-branch[data-selected="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.gx-branch[data-current="true"][data-selected="true"]{color:var(--dsw-alias-brand-primary)}
.gx-branch-note{flex:none;color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.5;white-space:nowrap}
.gx-branch-note-warn{color:var(--dsw-alias-state-warn-primary)}
.gx-muted{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5;white-space:nowrap}
.gx-remote{flex-basis:100%;min-width:0}
.gx-remote-summary{display:inline-flex;align-items:center;gap:4px;padding:1px 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:10.5px;line-height:1.5;list-style:none}
.gx-remote-summary::-webkit-details-marker{display:none}
.gx-remote-summary::before{content:"+";font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-brand-primary)}
.gx-remote[open] .gx-remote-summary::before{content:"−"}
.gx-remote-summary:hover{color:var(--dsw-alias-label-primary)}
.gx-remote-summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-radius:4px}
.gx-remote-list{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:5px;padding-top:5px;border-top:1px dashed var(--dsw-alias-border-l1)}
.gx-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 12px 18px;scrollbar-width:thin}
.gx-skeleton{display:flex;flex-direction:column;gap:12px;padding:4px 0}
.gx-skel-line{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);animation:gx-pulse 1.5s ease-in-out infinite}
.gx-skel-line:nth-child(1){width:75%}
.gx-skel-line:nth-child(2){width:52%}
.gx-skel-line:nth-child(3){width:88%}
.gx-skel-line:nth-child(4){width:61%}
.gx-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:200px;padding:26px 18px;text-align:center}
.gx-empty-icon{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin-bottom:2px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.gx-empty-title{margin:0;font-size:12.5px;line-height:1.5;font-weight:600}
.gx-empty-text{max-width:230px;margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55}
.gx-error{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:10px 11px 11px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.gx-error-title{margin:0;color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.5;font-weight:600}
.gx-error-text{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55;overflow-wrap:anywhere}
.gx-retry{appearance:none;margin-top:3px;padding:3px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:10.5px;line-height:1.5}
.gx-retry:hover{background:var(--dsw-alias-bg-overlay)}
.gx-retry:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.gx-changes{margin:0;padding:0}
.gx-change-list{display:flex;flex-direction:column;gap:1px}
.gx-change{appearance:none;display:flex;align-items:center;gap:7px;width:100%;min-width:0;padding:4px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
.gx-change:hover{background:var(--dsw-alias-bg-layer-2)}
.gx-change:focus-visible{outline:none;box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.gx-change-status{display:inline-flex;flex:none;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.gx-change-status[data-kind="added"],.gx-change-status[data-kind="untracked"]{color:var(--dsw-alias-state-success-primary)}
.gx-change-status[data-kind="deleted"],.gx-change-status[data-kind="conflict"]{color:var(--dsw-alias-state-error-primary)}
.gx-change-status[data-kind="modified"],.gx-change-status[data-kind="renamed"],.gx-change-status[data-kind="copied"]{color:var(--dsw-alias-state-warn-primary)}
.gx-change-path{display:flex;align-items:baseline;gap:6px;flex:1;min-width:0;overflow:hidden}
.gx-change-name{flex:0 1 auto;min-width:0;max-width:75%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:1.5}
.gx-change-dir{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:1.5;opacity:.85}
.gx-change-more{margin:5px 0 0 2px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1.5}
.gx-diff-pop{position:fixed;z-index:100;box-sizing:border-box;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 16px 42px rgba(0,0,0,.38));overflow:hidden}
.gx-diff-head{display:flex;flex:none;align-items:center;gap:7px;min-width:0;padding:9px 11px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.gx-diff-head .gx-change-status{width:17px;height:17px}
.gx-diff-paths{display:flex;flex-direction:column;min-width:0;gap:1px}
.gx-diff-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font:10.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.gx-diff-old{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font:9.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.8}
.gx-diff-body{flex:1 1 auto;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);padding:7px 0 9px;scrollbar-width:thin}
.gx-diff-pre{margin:0;padding:0 11px;color:var(--dsw-alias-label-secondary);font:10.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;min-width:max-content}
.gx-diff-line{display:block;white-space:pre}
.gx-diff-add{color:var(--dsw-alias-state-success-primary)}
.gx-diff-del{color:var(--dsw-alias-state-error-primary)}
.gx-diff-hunk{color:var(--dsw-alias-brand-primary)}
.gx-diff-meta{color:var(--dsw-alias-label-secondary);opacity:.72}
.gx-diff-message{margin:0;padding:11px 12px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55}
.gx-diff-foot{flex:none;padding:5px 11px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:9.5px;line-height:1.5}
.gx-timeline{position:relative;list-style:none;margin:0;padding:0}
.gx-timeline::before{content:"";position:absolute;left:6.5px;top:7px;bottom:12px;width:1px;background:linear-gradient(var(--dsw-alias-border-l2),var(--dsw-alias-border-l1) 76%,transparent)}
.gx-commit{position:relative;padding:0 0 16px 24px}
.gx-commit:last-child{padding-bottom:0}
.gx-node{position:absolute;left:1px;top:4px;z-index:1;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2);border-radius:50%;background:var(--dsw-alias-bg-base);box-shadow:0 0 0 2px var(--dsw-alias-bg-base)}
.gx-commit:first-child .gx-node{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary)}
.gx-subject{margin:0;overflow-wrap:anywhere;font-size:12.5px;line-height:1.5;font-weight:500;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.gx-meta{display:flex;align-items:center;gap:4px 8px;flex-wrap:wrap;min-width:0;margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.5}
.gx-hash{flex:none;padding:0 4px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-layer-2);font:9.5px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.gx-author{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gx-sep{opacity:.55}
.gx-time{font-variant-numeric:tabular-nums}
.gx-refs{display:inline-flex;align-items:center;gap:3px;flex-wrap:wrap;min-width:0}
.gx-ref{padding:0 4px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:9px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}
.gx-ref[data-kind="head"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.gx-ref[data-kind="tag"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.gx-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:14px 0 0 24px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.5}
.gx-foot-more{opacity:.7}
.gx-trigger{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.gx-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gx-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.gx-trigger svg{display:block}
.gx-tab-title{display:inline-flex;align-items:center;gap:5px;min-width:0}
.gx-tab-title svg{display:block;flex:none}
@keyframes gx-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.gx-skel-line{animation:none}}
`;

    /** Locale-aware day formatter; the browser's locale follows the host. */
    const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
    /** Full timestamp shown in the hover title. */
    const FULL_FORMAT = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    /**
     * Format a Git instant as a local day.
     * @param {string} value - ISO-8601 instant.
     * @returns the formatted day, or an empty string.
     */
    function formatDay(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : DAY_FORMAT.format(date);
    }

    /**
     * Format a Git instant as a local date and time.
     * @param {string} value - ISO-8601 instant.
     * @returns the formatted timestamp, or an empty string.
     */
    function formatFull(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : FULL_FORMAT.format(date);
    }

    /**
     * Strip the decoration syntax Git uses around a ref.
     * @param {string} raw - one `%D` entry.
     * @returns the display label.
     */
    function refLabel(raw) {
      if (raw.startsWith('HEAD -> ')) return raw.slice(8);
      if (raw.startsWith('tag: ')) return raw.slice(5);
      return raw;
    }

    /**
     * Classify one decoration entry for styling.
     * @param {string} raw - one `%D` entry.
     * @returns the ref kind.
     */
    function refKind(raw) {
      if (raw.startsWith('HEAD -> ')) return 'head';
      if (raw.startsWith('tag: ')) return 'tag';
      if (raw.includes('/')) return 'remote';
      return 'branch';
    }

    /**
     * Fetch one Workspace's repository snapshot.
     * @param {string | null} workspaceId - registered Workspace identity, or null.
     * @param {string | null} ref - requested branch, or null for HEAD.
     * @param {number} tick - refresh generation.
     * @returns the request state.
     */
    function useRepository(workspaceId, ref, tick) {
      const [state, setState] = React.useState({
        status: workspaceId === null ? 'idle' : 'loading',
        data: null,
        error: null,
      });

      React.useEffect(() => {
        if (workspaceId === null) {
          setState({ status: 'idle', data: null, error: null });
          return undefined;
        }

        const controller = new AbortController();
        let live = true;
        setState({ status: 'loading', data: null, error: null });

        const params = new URLSearchParams({ workspaceId });
        if (ref !== null && ref !== '') params.set('ref', ref);

        fetch(`${WORKSPACE_URL}?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
          .then(async (response) => {
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              const error = new Error(
                payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
                  ? payload.message
                  : `HTTP ${response.status}`,
              );
              error.code =
                payload !== null && typeof payload === 'object' && typeof payload.code === 'string'
                  ? payload.code
                  : 'http-error';
              throw error;
            }
            if (payload === null || typeof payload !== 'object') {
              throw new Error('invalid repository response');
            }
            return payload;
          })
          .then((payload) => {
            if (live) setState({ status: 'ready', data: payload, error: null });
          })
          .catch((error) => {
            if (!live || controller.signal.aborted) return;
            setState({
              status: 'error',
              data: null,
              error: {
                code: typeof error?.code === 'string' ? error.code : 'network',
                message: error instanceof Error ? error.message : String(error),
              },
            });
          });

        return () => {
          live = false;
          controller.abort();
        };
      }, [workspaceId, ref, tick]);

      return state;
    }

    /**
     * Render the branch glyph used by the trigger, panel, and tab title.
     * @param {object} props - `size` in pixels.
     * @returns the SVG element.
     */
    function GitGlyph({ size = 16 }) {
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
          h('circle', { key: 'a', cx: 6, cy: 5, r: 2.1 }),
          h('circle', { key: 'b', cx: 6, cy: 19, r: 2.1 }),
          h('circle', { key: 'c', cx: 18, cy: 7, r: 2.1 }),
          h('path', { key: 'line', d: 'M6 7.1v9.8' }),
          h('path', { key: 'curve', d: 'M6 11.5c0 3.1 2.1 4.2 5.1 4.2H12a6 6 0 0 0 6-6V9.1' }),
        ],
      );
    }

    /**
     * Render the refresh glyph.
     * @returns the SVG element.
     */
    function RefreshGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 15,
          height: 15,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        [
          h('path', { key: 'arc', d: 'M20 6v5h-5' }),
          h('path', { key: 'path', d: 'M19.2 11a7.5 7.5 0 1 0-1.6 6.4' }),
        ],
      );
    }

    /**
     * Render the collapse glyph.
     * @returns the SVG element.
     */
    function CollapseGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 15,
          height: 15,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        [h('path', { key: 'chevron', d: 'M9 6l6 6-6 6' })],
      );
    }

    /**
     * Render the clean-working-tree glyph.
     * @returns the SVG element.
     */
    function CheckGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        [
          h('circle', { key: 'circle', cx: 12, cy: 12, r: 8.5 }),
          h('path', { key: 'check', d: 'M8.2 12.3l2.5 2.5 5-5.2' }),
        ],
      );
    }

    /**
     * Render the repository glyph.
     * @returns the SVG element.
     */
    function RepositoryGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        [
          h('path', { key: 'book', d: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z' }),
          h('path', { key: 'fold', d: 'M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3' }),
          h('path', { key: 'line', d: 'M9 7h6' }),
        ],
      );
    }

    /**
     * Render one branch button.
     * @param {object} props - branch, translator, and selection state.
     * @returns the button element.
     */
    function BranchButton({ branch, t, selected, onSelect }) {
      const title = [branch.name, branch.current ? t('current') : '', branch.subject]
        .filter((part) => part !== '')
        .join(' · ');
      return h(
        'button',
        {
          type: 'button',
          className: 'gx-branch',
          title,
          'data-current': branch.current ? 'true' : 'false',
          'data-selected': selected ? 'true' : 'false',
          'aria-pressed': selected ? 'true' : 'false',
          onClick: () => onSelect(branch.name),
        },
        branch.name,
      );
    }

    /**
     * Render one commit as a node on the vertical line.
     * @param {object} props - commit and translator.
     * @returns the list item.
     */
    function CommitRow({ commit, t }) {
      const author = typeof commit.author === 'string' && commit.author !== '' ? commit.author : '—';
      const shortHash =
        typeof commit.shortHash === 'string' && commit.shortHash !== ''
          ? commit.shortHash
          : String(commit.hash).slice(0, 7);
      const allRefs = Array.isArray(commit.refs) ? commit.refs : [];
      const refs = allRefs.slice(0, 2);
      const hiddenRefs = Math.max(0, allRefs.length - refs.length);
      const hasDate = typeof commit.date === 'string' && commit.date !== '';
      return h(
        'li',
        { className: 'gx-commit' },
        h('span', { className: 'gx-node', 'aria-hidden': 'true' }),
        h(
          'p',
          {
            className: 'gx-subject',
            title: typeof commit.subject === 'string' && commit.subject !== '' ? commit.subject : t('untitledCommit'),
          },
          typeof commit.subject === 'string' && commit.subject !== '' ? commit.subject : t('untitledCommit'),
        ),
        h(
          'div',
          { className: 'gx-meta' },
          [
            h('code', { key: 'hash', className: 'gx-hash', title: commit.hash }, shortHash),
            h('span', { key: 'author', className: 'gx-author', title: commit.email === '' ? author : commit.email }, author),
            hasDate ? h('span', { key: 'sep1', className: 'gx-sep', 'aria-hidden': 'true' }, '·') : null,
            hasDate
              ? h(
                  'time',
                  {
                    key: 'time',
                    className: 'gx-time',
                    dateTime: commit.date,
                    title: formatFull(commit.date),
                  },
                  formatDay(commit.date),
                )
              : null,
            refs.length > 0 ? h('span', { key: 'sep2', className: 'gx-sep', 'aria-hidden': 'true' }, '·') : null,
            refs.length > 0
              ? h(
                  'span',
                  { key: 'refs', className: 'gx-refs' },
                  refs.map((raw) =>
                    h(
                      'span',
                      {
                        key: raw,
                        className: 'gx-ref',
                        'data-kind': refKind(raw),
                        title: raw,
                      },
                      refLabel(raw),
                    ),
                  ),
                )
              : null,
            hiddenRefs > 0
              ? h('span', { key: 'more', className: 'gx-ref', title: allRefs.slice(2).join(', ') }, `+${hiddenRefs}`)
              : null,
          ].filter(Boolean),
        ),
      );
    }

    /**
     * Render a quiet empty state.
     * @param {object} props - icon, title, hint, and optional retry.
     * @returns the state element.
     */
    function EmptyState({ icon, title, hint, retryLabel, onRetry }) {
      return h(
        'div',
        { className: 'gx-empty' },
        h('span', { className: 'gx-empty-icon' }, icon),
        h('p', { className: 'gx-empty-title' }, title),
        h('p', { className: 'gx-empty-text' }, hint),
        retryLabel !== undefined && onRetry !== undefined
          ? h('button', { type: 'button', className: 'gx-retry', onClick: onRetry }, retryLabel)
          : null,
      );
    }

    /**
     * Render the loading, error, empty, or commit body for one workspace.
     * @param {object} props - request state, translator, retry callback, and workspace presence.
     * @returns the body content.
     */
    function RepoBody({ state, t, onRetry, hasWorkspace }) {
      if (!hasWorkspace) {
        return h(EmptyState, {
          icon: h(RepositoryGlyph),
          title: t('noWorkspace'),
          hint: t('noWorkspaceHint'),
        });
      }

      if (state.status === 'loading' || state.status === 'idle') {
        return h(
          'div',
          { className: 'gx-skeleton', 'aria-label': t('loadingRepo'), role: 'status' },
          [
            h('span', { key: '1', className: 'gx-skel-line' }),
            h('span', { key: '2', className: 'gx-skel-line' }),
            h('span', { key: '3', className: 'gx-skel-line' }),
            h('span', { key: '4', className: 'gx-skel-line' }),
          ],
        );
      }

      if (state.status === 'error') {
        const message =
          state.error?.code === 'unknown-ref' ? t('errorUnknownRef') : state.error?.message ?? t('errorTitle');
        return h(
          'div',
          { className: 'gx-error', role: 'alert' },
          h('p', { className: 'gx-error-title' }, t('errorTitle')),
          h('p', { className: 'gx-error-text' }, message),
          h('button', { type: 'button', className: 'gx-retry', onClick: onRetry }, t('retry')),
        );
      }

      const data = state.data;
      if (data === null || data === undefined) return null;

      if (data.isRepo !== true) {
        return h(EmptyState, {
          icon: h(RepositoryGlyph),
          title: t('notRepo'),
          hint: t('notRepoHint'),
        });
      }

      const commits = Array.isArray(data.commits) ? data.commits : [];
      if (commits.length === 0) {
        const emptyRepo = !Array.isArray(data.branches) || data.branches.length === 0;
        return h(EmptyState, {
          icon: h(GitGlyph, { size: 16 }),
          title: emptyRepo ? t('emptyRepo') : t('noCommits'),
          hint: emptyRepo ? t('emptyRepoHint') : t('noCommitsHint'),
        });
      }

      return h(
        React.Fragment,
        null,
        h(
          'ol',
          { className: 'gx-timeline', 'aria-label': t('commitsLabel') },
          commits.map((commit) => h(CommitRow, { key: commit.hash, commit, t })),
        ),
        h(
          'div',
          { className: 'gx-foot' },
          h('span', null, t('commitsShown', { count: String(commits.length) })),
          data.hasMore === true ? h('span', { className: 'gx-foot-more' }, t('commitsMore')) : null,
        ),
      );
    }

    /**
     * Fetch one changed file's unified diff for the hover card.
     * @param {string | null} workspaceId - registered Workspace identity.
     * @param {object | null} change - changed-file record.
     * @returns the request state.
     */
    function useChangedFileDiff(workspaceId, change) {
      const [state, setState] = React.useState({
        status: 'idle',
        diff: '',
        truncated: false,
        error: null,
      });

      React.useEffect(() => {
        if (workspaceId === null || change === null) {
          setState({ status: 'idle', diff: '', truncated: false, error: null });
          return undefined;
        }

        const controller = new AbortController();
        let live = true;
        setState({ status: 'loading', diff: '', truncated: false, error: null });

        const params = new URLSearchParams({ workspaceId, path: change.path });
        if (typeof change.oldPath === 'string' && change.oldPath !== '') params.set('oldPath', change.oldPath);

        fetch(`${DIFF_URL}?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
          .then(async (response) => {
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              const error = new Error(
                payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
                  ? payload.message
                  : `HTTP ${response.status}`,
              );
              error.code =
                payload !== null && typeof payload === 'object' && typeof payload.code === 'string'
                  ? payload.code
                  : 'http-error';
              throw error;
            }
            return payload;
          })
          .then((payload) => {
            if (!live) return;
            setState({
              status: 'ready',
              diff: payload !== null && typeof payload === 'object' && typeof payload.diff === 'string' ? payload.diff : '',
              truncated: payload !== null && typeof payload === 'object' && payload.truncated === true,
              error: null,
            });
          })
          .catch((error) => {
            if (!live || controller.signal.aborted) return;
            setState({
              status: 'error',
              diff: '',
              truncated: false,
              error: {
                code: typeof error?.code === 'string' ? error.code : 'network',
                message: error instanceof Error ? error.message : String(error),
              },
            });
          });

        return () => {
          live = false;
          controller.abort();
        };
      }, [workspaceId, change?.path, change?.oldPath, change?.status]);

      return state;
    }

    /**
     * Describe one changed file for the status badge.
     * @param {object} change - changed-file record.
     * @returns its kind and one-letter marker.
     */
    function changeStatus(change) {
      const kind = typeof change.kind === 'string' ? change.kind : 'modified';
      const marker =
        kind === 'untracked'
          ? 'U'
          : kind === 'added'
            ? 'A'
            : kind === 'deleted'
              ? 'D'
              : kind === 'renamed'
                ? 'R'
                : kind === 'copied'
                  ? 'C'
                  : kind === 'conflict'
                    ? '!'
                    : 'M';
      return { kind, marker };
    }

    /**
     * Split a repository-relative path into a filename and its directory prefix.
     * @param {string} path - full changed path.
     * @returns the display parts.
     */
    function splitChangePath(path) {
      const slash = path.lastIndexOf('/');
      return slash === -1
        ? { name: path, dir: '' }
        : { name: path.slice(slash + 1), dir: path.slice(0, slash + 1) };
    }

    /**
     * Classify one unified-diff line for tinting.
     * @param {string} line - diff line.
     * @returns the line kind.
     */
    function diffLineKind(line) {
      if (line.startsWith('@@')) return 'hunk';
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) return 'meta';
      if (line.startsWith('new file ') || line.startsWith('deleted file ') || line.startsWith('similarity ') || line.startsWith('rename ') || line.startsWith('Binary files ')) return 'meta';
      if (line.startsWith('+')) return 'add';
      if (line.startsWith('-')) return 'del';
      if (line.startsWith('\\')) return 'meta';
      return 'context';
    }

    /**
     * Position the floating diff card beside its file row, inside the viewport.
     * @param {DOMRect} anchor - hovered file row.
     * @returns fixed-position style values.
     */
    function diffPopoverStyle(anchor) {
      const margin = 8;
      const viewportWidth = window.innerWidth || 1024;
      const viewportHeight = window.innerHeight || 768;
      const maxWidth = Math.min(560, Math.max(200, viewportWidth - margin * 2));
      const leftWidth = Math.max(200, anchor.left - margin * 2);
      const rightRoom = viewportWidth - anchor.right - margin * 2;
      const width = rightRoom >= maxWidth ? maxWidth : Math.min(maxWidth, leftWidth);
      const maxHeight = Math.min(420, Math.max(180, viewportHeight - margin * 2));
      const left =
        rightRoom >= maxWidth
          ? anchor.right + margin
          : Math.max(margin, Math.min(anchor.left - width - margin, viewportWidth - width - margin));
      const top = Math.max(margin, Math.min(anchor.top - margin, viewportHeight - maxHeight - margin));
      return { left, top, width, maxHeight };
    }

    /**
     * Render the diff card with tinted added, removed, hunk, and metadata lines.
     * @param {object} props - workspace, change, anchor, translator, and hover handlers.
     * @returns the portaled diff card.
     */
    function DiffPopover({ workspaceId, change, anchor, t, onKeep, onLeave }) {
      const state = useChangedFileDiff(workspaceId, change);
      const status = changeStatus(change);
      const style = diffPopoverStyle(anchor);
      const lines = React.useMemo(() => {
        if (state.diff === '') return [];
        const all = state.diff.replace(/\n$/, '').split('\n');
        return all.slice(0, 800);
      }, [state.diff]);
      const lineCapped = state.diff !== '' && state.diff.replace(/\n$/, '').split('\n').length > 800;
      const truncated = state.truncated || lineCapped;

      let body;
      if (state.status === 'error') {
        body = h(
          'p',
          { className: 'gx-diff-message' },
          state.error?.message === undefined ? t('diffError') : `${t('diffError')}: ${state.error.message}`,
        );
      } else if (state.status !== 'ready') {
        body = h('p', { className: 'gx-diff-message', role: 'status' }, t('diffLoading'));
      } else if (lines.length === 0) {
        body = h('p', { className: 'gx-diff-message' }, t('diffEmpty'));
      } else {
        body = h(
          'pre',
          { className: 'gx-diff-pre' },
          lines.map((line, index) =>
            h(
              'span',
              {
                key: index,
                className: `gx-diff-line gx-diff-${diffLineKind(line)}`,
              },
              line === '' ? ' ' : line,
            ),
          ),
        );
      }

      return ReactDOM.createPortal(
        h(
          'div',
          {
            className: 'gx-diff-pop',
            style,
            role: 'dialog',
            'aria-label': `${t('diffLabel')}: ${change.path}`,
            'aria-busy': state.status === 'loading' ? 'true' : 'false',
            onMouseEnter: onKeep,
            onMouseLeave: onLeave,
          },
          [
            h(
              'div',
              { key: 'head', className: 'gx-diff-head' },
              h('span', { className: 'gx-change-status', 'data-kind': status.kind, title: change.status }, status.marker),
              h(
                'div',
                { className: 'gx-diff-paths' },
                h('span', { className: 'gx-diff-path', title: change.path }, change.path),
                typeof change.oldPath === 'string' && change.oldPath !== ''
                  ? h('span', { className: 'gx-diff-old', title: change.oldPath }, `← ${change.oldPath}`)
                  : null,
              ),
            ),
            h('div', { key: 'body', className: 'gx-diff-body' }, body),
            truncated ? h('div', { key: 'foot', className: 'gx-diff-foot' }, t('diffTruncated')) : null,
          ],
        ),
        document.body,
      );
    }

    /**
     * Working-tree changes above the commit timeline.
     * @param {object} props - workspace, changed files, cap flag, and translator.
     * @returns the changes section.
     */
    function ChangesSection({ workspaceId, changes, changesTruncated, t }) {
      const [active, setActive] = React.useState(null);
      const [anchor, setAnchor] = React.useState(null);
      const hideTimer = React.useRef(null);

      const clearHide = () => {
        if (hideTimer.current !== null) {
          window.clearTimeout(hideTimer.current);
          hideTimer.current = null;
        }
      };

      const show = (change, element) => {
        clearHide();
        setActive(change);
        setAnchor(element.getBoundingClientRect());
      };

      const hideSoon = () => {
        clearHide();
        hideTimer.current = window.setTimeout(() => {
          hideTimer.current = null;
          setActive(null);
          setAnchor(null);
        }, 220);
      };

      React.useEffect(() => () => clearHide(), []);

      React.useEffect(() => {
        if (active === null) return;
        const next = changes.find((change) => change.path === active.path);
        if (next === undefined) {
          clearHide();
          setActive(null);
          setAnchor(null);
        } else if (next !== active) {
          setActive(next);
        }
      }, [changes, active]);

      React.useEffect(() => {
        if (active === null) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          clearHide();
          setActive(null);
          setAnchor(null);
        };
        const onResize = () => {
          clearHide();
          setActive(null);
          setAnchor(null);
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', onResize);
        return () => {
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('resize', onResize);
        };
      }, [active]);

      return h(
        'section',
        { className: 'gx-changes', 'aria-label': t('changes') },
        h(
          'div',
          { className: 'gx-change-list' },
          changes.map((change) => {
            const status = changeStatus(change);
            const parts = splitChangePath(change.path);
            return h(
              'button',
              {
                key: change.path,
                type: 'button',
                className: 'gx-change',
                'aria-label': change.oldPath ? `${change.oldPath} → ${change.path}` : change.path,
                onMouseEnter: (event) => show(change, event.currentTarget),
                onMouseLeave: hideSoon,
                onWheel: hideSoon,
                onFocus: (event) => show(change, event.currentTarget),
                onBlur: hideSoon,
                onClick: (event) => show(change, event.currentTarget),
              },
              [
                h(
                  'span',
                  { key: 'status', className: 'gx-change-status', 'data-kind': status.kind, 'aria-hidden': 'true' },
                  status.marker,
                ),
                h(
                  'span',
                  { key: 'path', className: 'gx-change-path' },
                  h('span', { className: 'gx-change-name' }, parts.name),
                  parts.dir === '' ? null : h('span', { className: 'gx-change-dir' }, parts.dir),
                ),
              ],
            );
          }),
        ),
        changesTruncated ? h('p', { className: 'gx-change-more' }, t('changesMore')) : null,
        active !== null && anchor !== null
          ? h(DiffPopover, {
              workspaceId,
              change: active,
              anchor,
              t,
              onKeep: clearHide,
              onLeave: hideSoon,
            })
          : null,
      );
    }

    /**
     * Stage every working-tree change behind a confirmation form and commit it.
     * @param {object} props - workspace, changed-file count, translator, and callbacks.
     * @returns the commit form.
     */
    function CommitForm({ workspaceId, count, t, onCancel, onCommitted }) {
      const [message, setMessage] = React.useState('');
      const [submitting, setSubmitting] = React.useState(false);
      const [error, setError] = React.useState('');
      const submittingRef = React.useRef(false);

      const submit = async (event) => {
        if (event !== undefined) event.preventDefault();
        if (submittingRef.current) return;
        const text = message.trim();
        if (text === '') {
          setError(t('commitNeedsMessage'));
          return;
        }
        submittingRef.current = true;
        setSubmitting(true);
        setError('');
        try {
          const response = await fetch(COMMIT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ workspaceId, message: text }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            const detail =
              payload !== null && typeof payload === 'object' && typeof payload.detail === 'string' && payload.detail !== ''
                ? `: ${payload.detail}`
                : '';
            const failure = new Error(
              payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
                ? `${payload.message}${detail}`
                : `HTTP ${response.status}`,
            );
            failure.code =
              payload !== null && typeof payload === 'object' && typeof payload.code === 'string'
                ? payload.code
                : 'http-error';
            throw failure;
          }
          submittingRef.current = false;
          setSubmitting(false);
          onCommitted(payload);
        } catch (failure) {
          submittingRef.current = false;
          setSubmitting(false);
          setError(
            failure?.code === 'nothing-to-commit'
              ? t('commitNoChanges')
              : failure instanceof Error && failure.message !== ''
                ? failure.message
                : t('commitError'),
          );
        }
      };

      return h(
        'form',
        {
          className: 'gx-commitbox',
          onSubmit: submit,
        },
        h(
          'div',
          { className: 'gx-commitbox-head' },
          h('span', { className: 'gx-commitbox-title' }, t('commitTitle')),
          h('span', { className: 'gx-commitbox-scope' }, t('commitScope')),
        ),
        h('textarea', {
          className: 'gx-commit-input',
          'aria-label': t('commitMessage'),
          placeholder: t('commitPlaceholder'),
          rows: 3,
          maxLength: 5000,
          autoFocus: true,
          value: message,
          disabled: submitting,
          onChange: (event) => setMessage(event.currentTarget.value),
          onKeyDown: (event) => {
            if (event.key === 'Escape' && !submitting) {
              event.preventDefault();
              onCancel();
              return;
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          },
        }),
        h('p', { className: 'gx-commit-hint' }, t('commitAll', { count: String(count) })),
        error === '' ? null : h('p', { className: 'gx-commit-error', role: 'alert' }, error),
        h(
          'div',
          { className: 'gx-commit-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'gx-commit-cancel',
              disabled: submitting,
              onClick: onCancel,
            },
            t('commitCancel'),
          ),
          h(
            'button',
            {
              type: 'submit',
              className: 'gx-commit-submit',
              disabled: submitting || message.trim() === '',
            },
            submitting ? t('commitSubmitting') : t('commitSubmit'),
          ),
        ),
      );
    }

    /**
     * Render one Session's workspace Git panel inside the right column.
     * @param {object} props - Session seats, translated copy, and the injected collapse action.
     * @returns the panel element.
     */
    function GitSidebarTab({ sessionId, useWorkspaces, t, collapse }) {
      const items = useWorkspaces((snapshot) => snapshot.items);
      const workspace = Array.isArray(items)
        ? items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))
        : undefined;
      const workspaceId = typeof workspace?.workspaceId === 'string' ? workspace.workspaceId : null;
      const [selectedRef, setSelectedRef] = React.useState(null);
      const [reload, setReload] = React.useState(0);
      const [remoteOpen, setRemoteOpen] = React.useState(false);
      const [activeView, setActiveView] = React.useState(null);
      const [commitOpen, setCommitOpen] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const state = useRepository(workspaceId, selectedRef, reload);

      React.useEffect(() => {
        setSelectedRef(null);
        setRemoteOpen(false);
        setActiveView(null);
        setCommitOpen(false);
        setNotice('');
      }, [workspaceId]);

      React.useEffect(() => {
        if (state.error?.code === 'unknown-ref' && selectedRef !== null) setSelectedRef(null);
      }, [state.error, selectedRef]);

      const data = state.data;
      const branches = data !== null && Array.isArray(data.branches) ? data.branches : [];
      const changes = data !== null && Array.isArray(data.changes) ? data.changes : [];
      const local = branches.filter((branch) => branch.remote !== true);
      const remote = branches.filter((branch) => branch.remote === true);
      const effectiveRef = selectedRef ?? data?.selectedRef ?? null;
      const remoteSelected = remote.some((branch) => branch.name === effectiveRef);

      React.useEffect(() => {
        if (remoteSelected) setRemoteOpen(true);
      }, [remoteSelected]);

      React.useEffect(() => {
        if (notice === '') return undefined;
        const timer = window.setTimeout(() => setNotice(''), 4500);
        return () => window.clearTimeout(timer);
      }, [notice]);

      const selectBranch = (name) => setSelectedRef(name);
      const retry = () => setReload((value) => value + 1);
      const refresh = () => {
        setCommitOpen(false);
        retry();
      };
      const handleCommitted = (result) => {
        setCommitOpen(false);
        setActiveView('commits');
        setNotice(
          result !== null && typeof result === 'object' && typeof result.sha === 'string' && result.sha !== ''
            ? t('commitSuccess', { sha: result.sha })
            : t('commitSuccessGeneric'),
        );
        retry();
      };

      const headBranch =
        data?.isRepo === true &&
        typeof data.head === 'string' &&
        data.head !== '' &&
        !branches.some((branch) => branch.remote !== true && branch.name === data.head)
          ? { name: data.head, remote: false, current: true, date: null, subject: '' }
          : null;
      const localForDisplay = headBranch === null ? local : [headBranch, ...local];

      React.useEffect(() => {
        if (commitOpen && changes.length === 0) setCommitOpen(false);
      }, [changes.length, commitOpen]);

      const title = typeof workspace?.title === 'string' && workspace.title !== '' ? workspace.title : t('noWorkspace');
      const path = typeof workspace?.path === 'string' ? workspace.path : '';
      const ready = data?.isRepo === true && state.status === 'ready';
      const view = activeView ?? (changes.length > 0 ? 'changes' : 'commits');
      const changeCountLabel = t(
        data?.changesTruncated === true ? 'filesMore' : changes.length === 1 ? 'filesOne' : 'filesCount',
        { count: String(changes.length) },
      );
      const changeBadge = changes.length === 0 ? null : `${changes.length}${data?.changesTruncated === true ? '+' : ''}`;

      const branchBar = ready
        ? h(
            'div',
            { className: 'gx-branchbar' },
            [
              data.detached === true
                ? h(
                    'span',
                    {
                      key: 'detached',
                      className: 'gx-branch-note gx-branch-note-warn',
                      title: t('detached', { sha: data.headShort ?? '' }),
                    },
                    t('detached', { sha: data.headShort ?? '' }),
                  )
                : null,
              h(
                'div',
                { key: 'scroll', className: 'gx-branch-scroll' },
                localForDisplay.length === 0
                  ? h('span', { className: 'gx-muted' }, t('noBranches'))
                  : localForDisplay.map((branch) =>
                      h(BranchButton, {
                        key: branch.name,
                        branch,
                        t,
                        selected: effectiveRef === branch.name,
                        onSelect: selectBranch,
                      }),
                    ),
              ),
              remote.length > 0
                ? h(
                    'details',
                    {
                      key: 'remote',
                      className: 'gx-remote',
                      open: remoteOpen,
                      onToggle: (event) => setRemoteOpen(event.currentTarget.open),
                    },
                    h('summary', { className: 'gx-remote-summary' }, t('remote', { count: String(remote.length) })),
                    h(
                      'div',
                      { className: 'gx-remote-list' },
                      remote.map((branch) =>
                        h(BranchButton, {
                          key: branch.name,
                          branch,
                          t,
                          selected: effectiveRef === branch.name,
                          onSelect: selectBranch,
                        }),
                      ),
                    ),
                  )
                : null,
            ].filter(Boolean),
          )
        : null;

      return h(
        'section',
        {
          className: 'gx-panel',
          'aria-label': t('tabTitle'),
          'aria-busy': state.status === 'loading' ? 'true' : 'false',
        },
        h(
          'header',
          { className: 'gx-head' },
          h(
            'div',
            { className: 'gx-head-top' },
            h('span', { className: 'gx-mark' }, h(GitGlyph, { size: 16 })),
            h(
              'div',
              { className: 'gx-head-copy' },
              h('h2', { className: 'gx-ws-title', title }, title),
              path === '' ? null : h('p', { className: 'gx-path', title: path }, path),
            ),
            h(
              'div',
              { className: 'gx-head-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'gx-icon-button',
                  title: t('refreshHint'),
                  'aria-label': t('refreshHint'),
                  disabled: workspaceId === null,
                  onClick: refresh,
                },
                h(RefreshGlyph),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'gx-icon-button',
                  title: t('collapse'),
                  'aria-label': t('collapse'),
                  onClick: collapse,
                },
                h(CollapseGlyph),
              ),
            ),
          ),
        ),
        notice === ''
          ? null
          : h('div', { className: 'gx-notice', role: 'status', 'aria-live': 'polite' }, notice),
        ready
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'gx-tabs', role: 'tablist', 'aria-label': t('views') },
                [
                  h(
                    'button',
                    {
                      key: 'changes',
                      type: 'button',
                      role: 'tab',
                      className: 'gx-tab',
                      'data-active': view === 'changes' ? 'true' : 'false',
                      'aria-selected': view === 'changes' ? 'true' : 'false',
                      title: `${t('changes')} (${changeCountLabel})`,
                      onClick: () => setActiveView('changes'),
                    },
                    [
                      h('span', { key: 'label' }, t('changes')),
                      changeBadge === null
                        ? null
                        : h('span', { key: 'count', className: 'gx-tab-count' }, changeBadge),
                    ],
                  ),
                  h(
                    'button',
                    {
                      key: 'commits',
                      type: 'button',
                      role: 'tab',
                      className: 'gx-tab',
                      'data-active': view === 'commits' ? 'true' : 'false',
                      'aria-selected': view === 'commits' ? 'true' : 'false',
                      onClick: () => {
                        setCommitOpen(false);
                        setActiveView('commits');
                      },
                    },
                    t('history'),
                  ),
                ],
              ),
              view === 'changes'
                ? h(
                    'div',
                    { className: 'gx-scroll' },
                    changes.length > 0 && workspaceId !== null
                      ? h(
                          React.Fragment,
                          null,
                          commitOpen
                            ? h(CommitForm, {
                                workspaceId,
                                count: changes.length,
                                t,
                                onCancel: () => setCommitOpen(false),
                                onCommitted: handleCommitted,
                              })
                            : h(
                                'div',
                                { className: 'gx-commitbar' },
                                [
                                  h('span', { key: 'hint', className: 'gx-commitbar-hint' }, t('commitHint')),
                                  h(
                                    'button',
                                    {
                                      key: 'commit',
                                      type: 'button',
                                      className: 'gx-commit-open',
                                      onClick: () => setCommitOpen(true),
                                    },
                                    t('commit'),
                                  ),
                                ],
                              ),
                          h(ChangesSection, {
                            workspaceId,
                            changes,
                            changesTruncated: data?.changesTruncated === true,
                            t,
                          }),
                        )
                      : h(EmptyState, {
                          icon: h(CheckGlyph),
                          title: t('clean'),
                          hint: t('cleanHint'),
                        }),
                  )
                : h(
                    React.Fragment,
                    null,
                    branchBar,
                    h(
                      'div',
                      { className: 'gx-scroll' },
                      h(RepoBody, {
                        state,
                        t,
                        onRetry: retry,
                        hasWorkspace: workspaceId !== null,
                      }),
                    ),
                  ),
            )
          : h(
              'div',
              { className: 'gx-scroll' },
              h(RepoBody, {
                state,
                t,
                onRetry: retry,
                hasWorkspace: workspaceId !== null,
              }),
            ),
      );
    }

    /**
     * Render the right-tab chip label.
     * @param {object} props - translator supplied by the locale-aware slot.
     * @returns the title element.
     */
    function GitSidebarTitle({ t }) {
      return h('span', { className: 'gx-tab-title' }, [h(GitGlyph, { key: 'glyph', size: 13 }), h('span', { key: 'text' }, t('tabTitle'))]);
    }

    /**
     * Render the conversation-header toggle.
     * @param {object} props - translator and the injected toggle action.
     * @returns the button element.
     */
    function GitHeaderButton({ t, onOpen }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'gx-trigger',
          title: t('toggle'),
          'aria-label': t('toggle'),
          'data-git-explorer-trigger': 'true',
          onClick: onOpen,
        },
        h(GitGlyph, { size: 16 }),
      );
    }

    /**
     * The right-Sidebar page definition for the Git view.
     * @param {Function} t - namespace-bound translator.
     * @returns the tab definition to register.
     */
    function gitTabDefinition(t) {
      return {
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        title: () => t('tabTitle'),
      };
    }

    /**
     * Toggle the Git tab in the conversation's right column.
     * @param {object} ctx - Client root Context with the right-Sidebar services.
     */
    function toggleGitPanel(ctx) {
      const active = ctx.sidebarRight.active();
      if (active === undefined) return;
      if (ctx.sidebarRight.isExpanded() && active.kind === TAB_KIND) {
        ctx.sidebarRight.toggleExpanded();
        return;
      }
      ctx.sidebarRight.openTab(TAB_KIND);
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'layout'],

      /**
       * Register the dictionary, styles, tab type, header toggle, and tab seats.
       * @param {object} ctx - Client root Context.
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'git-explorer: dictionaries');
        ctx.effect(() => {
          const tagId = '@local/git-explorer/side-panel.css';
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
          if (existing !== null) existing.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/git-explorer';
          tag.dataset.pluginCss = tagId;
          tag.textContent = STYLE;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'git-explorer: styles');

        ctx.effect(() => {
          const settle = () => {
            if (ctx.layout.panelInfo.getSnapshot().activePanelId === 'git-explorer') {
              ctx.layout.selectPanel('conversation');
            }
          };
          settle();
          return ctx.layout.panelInfo.subscribe(settle);
        }, 'git-explorer: retire the old main panel');

        ctx.effect(() => ctx.sidebarRightTabs.register(gitTabDefinition(t)), 'git-explorer: tab type');

        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'git-explorer',
              order: -4,
              locale: NS,
              inject: () => ({
                onOpen: () => toggleGitPanel(ctx),
              }),
            },
            GitHeaderButton,
          ),
        );

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
              locale: NS,
              inject: () => ({
                collapse: () => ctx.sidebarRight.toggleExpanded(),
              }),
            },
            GitSidebarTab,
          ),
        );

        ctx.slots.inject('sidebar.right.pane.tab.title', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab.title',
              key: TAB_ID,
              locale: NS,
            },
            GitSidebarTitle,
          ),
        );
      },
    };
  },
});