# DSH plugins

DeepSeek Harness (DSH) plugin bundles, released from this one repository.

| Directory | Package | Version | What it does |
| --- | --- | --- | --- |
| `artifacts/` | `@local/dsh-artifacts` | 0.1.1 | Artifacts + canvas: HTML, SVG, charts, Mermaid, Markdown, and code the agent writes into a side panel with versions and editing |
| `command-runner/` | `@local/command-runner` | 0.1.0 | Floating, tabbed shell window in DSH Web |
| `codex-images/` | `@local/codex-images` | 0.1.0 | Project-scoped image gallery + `codex_image` tool |
| `git-explorer/` | `@local/git-explorer` | 0.5.2 | Git browser for the current workspace |
| `mcp-settings/` | `@local/mcp-settings` | 0.1.0 | Manage MCP servers from DSH Web |
| `user-switcher/` | `@local/user-switcher` | 0.1.0 | Linux: inspect identity, list accounts, launch DSH as another user |
| `web-push-notify/` | `@local/web-push-notify` | 1.0.0 | Web Push task-completion notifications (Push API + Service Worker) |
| `personal-agent/` | `@local/personal-agent` | 0.4.0 | Additive personal identities: an identity module above the untouched project sidebar, per-identity memory and home, create/edit/remove, plus selected multi-agent group chats |

Each plugin is a plain npm package with a `dsh.bundle.patch` layer. Releases attach
`npm pack` tarballs; DSH installs them straight from the release URL, so target devices
need neither git nor registry credentials — only HTTPS.

## Install on a device

Open DSH Web → **Plugins** → **Add plugin** and paste one tarball URL per plugin
(replace `<owner>/<repo>` and `v0.5.0` with the release you want):

```
https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-dsh-artifacts-0.1.1.tgz
https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-command-runner-0.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-codex-images-0.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-git-explorer-0.5.2.tgz
https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-mcp-settings-0.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-user-switcher-0.1.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-personal-agent-0.4.0.tgz
https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-web-push-notify-1.0.0.tgz
```

After each install click **Enable now**, then restart `dsh web` when the profile has no HMR.

CLI equivalent:

```bash
dsh plugin --profile web add \
  https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-dsh-artifacts-0.1.1.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-command-runner-0.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-codex-images-0.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-git-explorer-0.5.2.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-mcp-settings-0.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-user-switcher-0.1.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-web-push-notify-1.0.0.tgz \
  https://github.com/<owner>/<repo>/releases/download/v0.5.0/local-personal-agent-0.4.0.tgz
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

## Notes

- **Personal agent profiles**: `@local/personal-agent` works in a profile created
  from the shipped `web` template and in an existing profile. For a dedicated
  personal profile, see its README for moving session/workspace storage into the
  profile so the identities do not inherit the device's history; for an existing
  profile, the project UI remains the shipped one.
- **First push quirk**: pushing a brand-new branch and its first `v*` tag in one
  `git push` does not start the workflow. Push the branch first, then the tag
  (`git push -u origin main` then `git push origin v0.5.0`), or re-push the tag alone.

## Layout

```
.github/workflows/release.yml   tag push -> npm pack -> GitHub Release assets
scripts/pack.sh                 packs every plugin that declares dsh.bundle
artifacts/                      plugin source (artifacts + canvas panel)
command-runner/                 plugin source
codex-images/                   plugin source
git-explorer/                   plugin source
mcp-settings/                   plugin source
user-switcher/                  plugin source (Linux only)
personal-agent/                 plugin source (profile-scoped personal agent)
web-push-notify/                plugin source (Web Push notifications)
```

`dist/`, `out/`, `output/`, `node_modules/` and `.dsh-timing-patch/` are ignored by git.