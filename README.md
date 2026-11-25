# DSH plugins

DeepSeek Harness (DSH) plugin bundles, released from this one repository.

| Directory | Package | Version | What it does |
| --- | --- | --- | --- |
| `artifacts/` | `@local/dsh-artifacts` | 0.2.2 | Artifacts as expandable cards in the chat plus a canvas panel: HTML, SVG, charts, Mermaid, Markdown, and code with versions and editing |
| `command-runner/` | `@local/command-runner` | 0.2.0 | Floating, tabbed shell window in DSH Web: one command at a time — a new command stops the previous one, and closing the window leaves the current one running |
| `codex-images/` | `@local/codex-images` | 0.1.5 | Project-scoped image gallery + `codex_image` tool, with an optional read-only public image server for per-image links (starts with the plugin, every clipboard action reports success or refusal) |
| `codex-login/` | `@local/codex-login` | 0.1.0 | **Sign in ChatGPT / Codex** from Settings → Models, so the `openai-codex` route spends the subscription instead of an API key; the device-code flow runs on the Host, the page never sees the token |
| `model-quota/` | `@local/model-quota` | 0.1.0 | Remaining ChatGPT / Codex subscription quota as a pill in the composer dock, with a click-through panel and automatic token renewal |
| `git-explorer/` | `@local/git-explorer` | 0.5.2 | Git browser for the current workspace |
| `mcp-settings/` | `@local/mcp-settings` | 0.1.1 | Manage MCP servers from DSH Web |
| `user-switcher/` | `@local/user-switcher` | 0.2.2 | Linux: choose the account every Bash command runs as (`setpriv`), and open each account its own DSH instance with its own home |
| `web-push-notify/` | `@local/web-push-notify` | 1.3.0 | Web Push task-completion notifications (Push API + Service Worker); notifies even while the page is in view, entry under **More** |
| `personal-agent/` | `@local/personal-agent` | 0.6.11 | Additive personal identities: an identity module above the untouched project sidebar, per-identity memory and home, create/edit/remove, selected multi-agent group chats, and `/new` for a clean start that archives the identity's earlier conversations only after the new one is open; the `personal` preset is reserved for identity chats; subagents are a per-conversation switch in the model menu (off by default), `message_identity` is not registered, and group chats keep `ask_identity`; a turn still running after two quiet minutes names the tool it is on |
| `system-usage/` | `@local/system-usage` | 1.1.0 | CPU, memory, and root-disk meter across the sidebar foot, with a hover readout and a click-to-refresh sample |
| `workspace-upload/` | `@local/workspace-upload` | 0.3.0 | Upload files or whole folders into any workspace subfolder from the Files page, with live progress, replace/cancel prompts on name conflicts, and name-safe publishing |
| `workspace-download/` | `@local/workspace-download` | 0.2.0 | Download a previewed file, any folder as ZIP (with an optional .git), or the whole workspace from the Files side panel, streamed by the Host |
| `article-studio/` | `@local/article-studio` | 0.3.0 | A writing desk in the sidebar: articles with autosave and local git history, typography controls, inline images that stay editable in place (click to select, Delete to remove with undo, **图片源码** for the Markdown), a heading outline, and a writing partner summoned at the caret |
| `cache-cleaner/` | `@local/cache-cleaner` | 0.1.1 | Settings page that reports and clears **archived** session logs, their projection checkpoints, and canvas artifacts across every DSH home on the machine; unarchived and live sessions are never deleted |
| `feishu-bridge/` | `@local/feishu-bridge` | 0.1.2 | Talk to the Harness from Feishu over a WebSocket long connection: one durable Session per chat, streamed replies, no public callback URL |

Each plugin is a plain npm package with a `dsh.bundle.patch` layer. Releases attach
`npm pack` tarballs; DSH installs them straight from the release URL, so target devices
need neither git nor registry credentials — only HTTPS.

## Install on a device

Open DSH Web → **Plugins** → **Add plugin** and paste one tarball URL per plugin
(replace `<owner>/<repo>` and `v0.23.0` with the release you want):

```
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-dsh-artifacts-0.2.2.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-command-runner-0.2.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-codex-images-0.1.5.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-codex-login-0.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-model-quota-0.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-feishu-bridge-0.1.2.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-git-explorer-0.5.2.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-mcp-settings-0.1.1.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-user-switcher-0.2.2.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-web-push-notify-1.3.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.29.0/local-personal-agent-0.6.11.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-system-usage-1.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-workspace-upload-0.3.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-workspace-download-0.2.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-article-studio-0.3.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-cache-cleaner-0.1.1.tgz
```

After each install click **Enable now**, then restart `dsh web` when the profile has no HMR.

CLI equivalent:

```bash
dsh plugin --profile web add \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-dsh-artifacts-0.2.2.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-command-runner-0.2.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-codex-images-0.1.5.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-codex-login-0.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-model-quota-0.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-feishu-bridge-0.1.2.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-git-explorer-0.5.2.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-mcp-settings-0.1.1.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-user-switcher-0.2.2.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-web-push-notify-1.3.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.29.0/local-personal-agent-0.6.11.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-system-usage-1.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-workspace-upload-0.3.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-workspace-download-0.2.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-article-studio-0.3.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.23.0/local-cache-cleaner-0.1.1.tgz
```

Installing only records the dependency. To load a bundle, click **Enable now**, or append its
package name to `~/.dsh/profiles/web/package.json` → `dsh.profile.bundles`.

`@local/personal-agent` installs into an existing profile without replacing the project
sidebar: an identity module appears directly above the Workspace browser, and project
workspaces/sessions keep their original display and interaction. See its README
for the recommended `autoOpen: false` setting.

## Upgrade

1. Bump the version inside the plugin directory:
   `npm version patch --no-git-tag-version` (or edit `package.json`).
2. Commit, then `git tag v0.1.1 && git push --tags`. CI packs and publishes every plugin.
3. On each device, repeat **Add plugin** with the new URL, or uninstall/reinstall the bundle.
   Tarball-sourced bundles have no automatic update check.

> Always use versioned asset file names, never a fixed `latest/download/plugin.tgz`.
> pnpm pins the URL's resolution in the lockfile: replacing the bytes at the same URL
> leaves the old content installed.

## Release locally (no CI)

```bash
./scripts/pack.sh                       # writes out/*.tgz for every plugin
```

Then on GitHub: **Releases → Draft a new release**, choose/create the tag, attach the
`out/*.tgz` files, publish. Asset URLs follow the pattern above.

## Sync with this machine

See [SYNC.md](SYNC.md). `node scripts/scan.mjs` reports every installed `@local/*`
bundle that differs from its directory here; `--apply` copies the package files in.

## Notes

- **Personal agent profiles**: `@local/personal-agent` works in a profile created
  from the shipped `web` template and in an existing profile. For a dedicated
  personal profile, see its README for moving session/workspace storage into the
  profile so the identities do not inherit the device's history; for an existing
  profile, the project UI remains the shipped one.
- **Subagents are per conversation**: since 0.6.8 a private identity chat starts without the delegation tools and gains them only when the user flips `允许开子代理` in the model menu. The choice is one Session event, applied with `tools.restrict({ deny })` on that Agent's scope — it survives restarts, never leaks to another identity or a group, and the default stays off. `message_identity` is not registered, so one identity cannot wait on another inside its own turn; group chats keep `ask_identity` and behave as before.
- **`/new` handoff**: since 0.6.2 `/new` in an identity chat creates the blank Session first and archives the identity's earlier conversations only after the browser has the new one open. A switch that never opens leaves the old history intact, and `/new` is not registered in project, group, or subagent conversations.
- **A stuck turn says what it is on**: since 0.6.7 the working bubble stays quiet for an ordinary wait and adds one flat line after two minutes without finishing — `两分钟没有结果了 —— 停在 bash` — naming the tool the turn is stuck on. No live timer and no click-through; the line belongs to the bubble and leaves with the turn.
- **Bubble width on a phone**: the identity chat caps a bubble at 60% of the column, which left a 185px ribbon on a 412px phone column. Since 0.6.5 the cap is `min(100%, max(60%, 480px))` (user bubbles: `min(88%, max(60%, 440px))`), so a narrow column uses its full width while a wide one keeps the 60% layout.
- **Money vs. math**: since 0.6.4 the browser half puts quoted prose back when the shipped markdown read a `$…$` pair as inline math. A reply that writes `$811.82 拿 18.5 单 … CPC $1.76` used to render the sentence between the two dollar signs as one unbreakable math span — wider than the message column, clipped instead of wrapped. TeX that carries a command, or holds no Han text, is left alone.
- **Personal preset scope**: since 0.5.0 `@local/personal-agent` reserves the `personal`
  preset for identity and group homes. It is hidden from the preset roster and refused for
  workspace Sessions, which keep the profile's ordinary preset (`standard` by default).
- **User switcher requirements**: `@local/user-switcher` needs Linux, `setpriv`
  (`util-linux`), and a `/<account>/` nginx location per account for that account's own
  instance. It switches the identity of shell commands, not of the Host process.
- **System usage**: `@local/system-usage` reads `/proc/meminfo` and `os.cpus()` on the Host;
  it has no configuration beyond `minSampleMs` and stores nothing.
- **Workspace upload**: `@local/workspace-upload` streams browser picks into the Session's own
  working directory (500 MiB per file by default, configurable, `onConflict: rename`); no agent tool is added.
- **Article Studio**: `@local/article-studio` keeps articles and their git history under the profile's `article-studio/` directory; its writing partner speaks as the identity selected in Personal Agent, and falls back to a hidden `scribe` preset. The panel sits above Identities in the sidebar.
- **Cache cleaner**: `@local/cache-cleaner` deletes permanently — session logs, projection checkpoints, and canvas documents are real data, not rebuildable caches. Since 0.1.1 session logs and their checkpoints are deleted **only for sessions listed in that home's `storages/workspace.json` → `global.archivedSessionIds`**; unarchived conversations are never candidates, and a home whose registry is missing or unreadable has its session target refused instead of guessed. Canvas documents are still removed in full, because they are not archived per session. It discovers every `/home/<account>/.dsh` plus `/root/.dsh`, refuses homes it cannot read/write, and skips sessions any running DSH process still holds open.
- **Codex login**: `@local/codex-login` adds **登录 ChatGPT** to Settings → Models for the `llm-pi-ai` card whose provider is `openai-codex`. The device-code attempt runs on the Host through `ctx.authorization.begin()` and the page only polls account/expiry; the token itself never reaches the browser. Signing out deletes the `llm-pi-ai/openai-codex` credential record.
- **Model quota**: `@local/model-quota` reads `GET https://chatgpt.com/backend-api/codex/usage` with that Codex grant and shows the 5-hour and weekly windows as one composer-dock pill. It renews an expired access token (or one refused with 401/403) from the refresh token under the credential lock, so it only asks for a new sign-in when renewal itself is refused; percentages and reset times are the only things that leave the Host.
- **Feishu bridge**: `@local/feishu-bridge` needs a Feishu custom app with the bot capability and the message events above; it dials out to Feishu, so no public IP or callback URL is required. Credentials are entered in Settings.
- **First push quirk**: pushing a brand-new branch and its first `v*` tag in one
  `git push` does not start the workflow. Push the branch first, then the tag
  (`git push -u origin main` then `git push origin v0.23.0`), or re-push the tag alone.

## Layout

```
.github/workflows/release.yml   tag push -> npm pack -> GitHub Release assets
scripts/pack.sh                 packs every plugin that declares dsh.bundle
scripts/scan.mjs                compares this repo with the installed profile
SYNC.md                         the sync runbook (scan -> copy -> bump -> release)
artifacts/                      plugin source (artifacts + canvas panel)
command-runner/                 plugin source
codex-images/                   plugin source
git-explorer/                   plugin source
mcp-settings/                   plugin source
user-switcher/                  plugin source (Linux only)
personal-agent/                 plugin source (profile-scoped personal agent)
system-usage/                   plugin source (CPU/memory meter)
workspace-upload/               plugin source (upload files/folders into the Session workspace)
workspace-download/             plugin source (download files/folders/workspace from Files)
feishu-bridge/                  plugin source (Feishu long-connection bridge)
article-studio/                 plugin source (writing desk + writing partner)
codex-login/                    plugin source (ChatGPT / Codex sign-in for Settings → Models)
model-quota/                    plugin source (ChatGPT / Codex subscription quota pill)
cache-cleaner/                  plugin source (Settings page: clear session/canvas caches)
web-push-notify/                plugin source (Web Push notifications)
tools/notify.py                 push a message to WeChat channels (config in notify.env)
```

`dist/`, `out/`, `output/`, `node_modules/` and `.dsh-timing-patch/` are ignored by git.