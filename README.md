# DSH plugins

DeepSeek Harness (DSH) plugin bundles, released from this one repository.

| Directory | Package | Version | What it does |
| --- | --- | --- | --- |
| `artifacts/` | `@local/dsh-artifacts` | 0.2.1 | Artifacts as expandable cards in the chat plus a canvas panel: HTML, SVG, charts, Mermaid, Markdown, and code with versions and editing |
| `command-runner/` | `@local/command-runner` | 0.1.0 | Floating, tabbed shell window in DSH Web |
| `codex-images/` | `@local/codex-images` | 0.1.2 | Project-scoped image gallery + `codex_image` tool |
| `git-explorer/` | `@local/git-explorer` | 0.5.2 | Git browser for the current workspace |
| `mcp-settings/` | `@local/mcp-settings` | 0.1.1 | Manage MCP servers from DSH Web |
| `user-switcher/` | `@local/user-switcher` | 0.2.2 | Linux: choose the account every Bash command runs as (`setpriv`), and open each account its own DSH instance with its own home |
| `web-push-notify/` | `@local/web-push-notify` | 1.3.0 | Web Push task-completion notifications (Push API + Service Worker); notifies even while the page is in view, entry under **More** |
| `personal-agent/` | `@local/personal-agent` | 0.6.1 | Additive personal identities: an identity module above the untouched project sidebar, per-identity memory and home, create/edit/remove, selected multi-agent group chats, and private direct messages between identities; the `personal` preset is reserved for identity chats |
| `system-usage/` | `@local/system-usage` | 1.1.0 | CPU, memory, and root-disk meter across the sidebar foot, with a hover readout and a click-to-refresh sample |
| `workspace-upload/` | `@local/workspace-upload` | 0.3.0 | Upload files or whole folders into any workspace subfolder from the Files page, with live progress, replace/cancel prompts on name conflicts, and name-safe publishing |
| `workspace-download/` | `@local/workspace-download` | 0.2.0 | Download a previewed file, any folder as ZIP (with an optional .git), or the whole workspace from the Files side panel, streamed by the Host |
| `article-studio/` | `@local/article-studio` | 0.1.0 | A writing desk in the sidebar: articles with autosave and local git history, typography controls, and a writing partner summoned at the caret |
| `cache-cleaner/` | `@local/cache-cleaner` | 0.1.0 | Settings page that reports and clears session logs, projection checkpoints, and canvas artifacts across every DSH home on the machine, skipping live sessions |
| `feishu-bridge/` | `@local/feishu-bridge` | 0.1.2 | Talk to the Harness from Feishu over a WebSocket long connection: one durable Session per chat, streamed replies, no public callback URL |

Each plugin is a plain npm package with a `dsh.bundle.patch` layer. Releases attach
`npm pack` tarballs; DSH installs them straight from the release URL, so target devices
need neither git nor registry credentials — only HTTPS.

## Install on a device

Open DSH Web → **Plugins** → **Add plugin** and paste one tarball URL per plugin
(replace `<owner>/<repo>` and `v0.12.0` with the release you want):

```
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-dsh-artifacts-0.2.1.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-command-runner-0.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-codex-images-0.1.2.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-feishu-bridge-0.1.2.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-git-explorer-0.5.2.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-mcp-settings-0.1.1.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-user-switcher-0.2.2.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-web-push-notify-1.3.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-personal-agent-0.6.1.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-system-usage-1.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-workspace-upload-0.3.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-workspace-download-0.2.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-article-studio-0.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-cache-cleaner-0.1.0.tgz
```

After each install click **Enable now**, then restart `dsh web` when the profile has no HMR.

CLI equivalent:

```bash
dsh plugin --profile web add \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-dsh-artifacts-0.2.1.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-command-runner-0.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-codex-images-0.1.2.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-feishu-bridge-0.1.2.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-git-explorer-0.5.2.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-mcp-settings-0.1.1.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-user-switcher-0.2.2.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-web-push-notify-1.3.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-personal-agent-0.6.1.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-system-usage-1.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-workspace-upload-0.3.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-workspace-download-0.2.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-article-studio-0.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.12.0/local-cache-cleaner-0.1.0.tgz
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
- **Direct messages**: since 0.6.0 `message_identity` lets one identity send a private 1:1 message to another and get its reply in the same turn; the pair's thread is stored under `<profile>/personal-agent/dms/`, capped at 400 messages, and the tool is not available inside groups or project sessions.
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
- **Cache cleaner**: `@local/cache-cleaner` deletes permanently — session logs, projection checkpoints, and canvas documents are real data, not rebuildable caches. It discovers every `/home/<account>/.dsh` plus `/root/.dsh`, refuses homes it cannot read/write, and skips sessions any running DSH process still holds open.
- **Feishu bridge**: `@local/feishu-bridge` needs a Feishu custom app with the bot capability and the message events above; it dials out to Feishu, so no public IP or callback URL is required. Credentials are entered in Settings.
- **First push quirk**: pushing a brand-new branch and its first `v*` tag in one
  `git push` does not start the workflow. Push the branch first, then the tag
  (`git push -u origin main` then `git push origin v0.12.0`), or re-push the tag alone.

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
cache-cleaner/                  plugin source (Settings page: clear session/canvas caches)
web-push-notify/                plugin source (Web Push notifications)
tools/notify.py                 push a message to WeChat channels (config in notify.env)
```

`dist/`, `out/`, `output/`, `node_modules/` and `.dsh-timing-patch/` are ignored by git.