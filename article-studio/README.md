# Article Studio

A writing desk and a named writing partner for one DSH profile. The panel lives in
the sidebar **above Identities** (**文章**), so writing never competes with the chat
column: the agent conversation is collapsed away, and you summon it at the caret.

## What it does

- **Articles** — create, open, rename, delete. Each article is plain JSON under the
  profile's `article-studio/articles/` directory, so a later version or a shell
  script can read it.
- **Autosave + git history** — every pause saves automatically, and the plugin
  mirrors each article into a local git repository
  (`<profile>/article-studio/repo/articles/<id>.md`) and commits it. **版本历史**
  in the toolbar lists commits, previews any version, and restores it. The
  repository is ordinary git: inspect, diff, or push it with normal tools.
- **Editor** — Markdown source in a contenteditable canvas, a live word count, and
  autosave with revision checks (an agent edit never silently overwrites your
  unsaved text; the panel asks which version to keep).
- **Styling** — font family (宋体/黑体/楷体/等宽), size, line height, paragraph
  spacing, column width, alignment, first-line indent, and a paper / sepia / dark
  canvas. The agent can apply the same controls through `article_style`.
- **Writing partner at the caret** — press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>
  while the caret is in the body, or select text and click the small **和…讨论**
  bubble. A slim bar opens at the caret. Ask for anything: keep writing, tighten
  a paragraph, restructure, restyle the page, turn the selection into a draft.
  Replies and tool names appear below the input; older turns stay behind a
  history toggle.
- **The partner is your identity** — the bar speaks as the identity selected in
  **身份** (Personal Agent): its name, persona, and memory, through the
  `personal` preset and its home directory. With no identity configured it falls
  back to the standalone `scribe` preset (写作助手 / Writing assistant).
- **No capability loss** — the `scribe` preset keeps shell, filesystem, search, and
  web tools, plus the `article_*` tools registered only on that Agent's scope.
  Publish elsewhere with `curl` through bash, an MCP tool, or the configured
  `pushTargets` HTTP API via `article_push`.

## Configuration

The bundle row accepts these fields (all optional):

| Field | Default | Meaning |
| --- | --- | --- |
| `agentPreset` | `scribe` | Fallback preset when no Personal Agent identity exists. |
| `identityPreset` | `personal` | Preset used when the conversation runs as a Personal Agent identity. |
| `hiddenPresets` | `['scribe']` | Presets this bundle keeps out of the workspace session roster. |
| `git` | `true` | Mirror articles into a local git repository and commit autosaves. |
| `gitCommitDelayMs` | `2500` | Debounce for those commits. |
| `identityName` | `''` | Optional override; empty uses the localized fallback name. |
| `cwd` | profile default | Working directory for the writing Sessions. |
| `dataDir` | `<profile>/article-studio` | Where articles and transcripts are stored. |
| `pushTargets` | `[]` | HTTP endpoints for `article_push`: `{ id, name, url, method, format, headers }`. |
| `pushTimeoutMs` | `20000` | One push request's timeout. |
| `allowAdHocPush` | `false` | Let `article_push` accept an arbitrary `url` when no target is configured. |

Example:

```yaml
- id: article-studio
  name: '@local/article-studio'
  config:
    pushTargets:
      - id: feishu
        name: 飞书文档
        url: https://example.com/api/publish
        headers:
          authorization: Bearer xxxx
        format: json
```

## Tools the writing partner gets

| Tool | Purpose |
| --- | --- |
| `article_list` | List every article with id, title, word count, last edit. |
| `article_read` | Read title, full Markdown body, style, revision. |
| `article_update` | Replace the title and/or whole body. |
| `article_replace` | Replace one exact passage. |
| `article_append` | Continue the draft at the end. |
| `article_style` | Apply a recipe (`essay`, `blog`, `wechat`, `note`, `warm`) or individual style fields. |
| `article_create` / `article_delete` | CRUD from the conversation. |
| `article_push` | POST/PUT the article to a configured `pushTargets` endpoint (an ad-hoc `url` only when `allowAdHocPush` is true). |

## Limits

- The popover renders replies and tool names, not approval prompts or
  `ask_user_question`. Use a full-access permission preset for the writing
  Session, or approve tools from the session in a normal chat.
- Writer Sessions are ordinary DSH Sessions (one per article). The panel hides
  them from the sidebar list; they remain in the profile's session storage.
- Turning the plugin off removes the panel and the tools. Stored articles stay.