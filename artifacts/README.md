# @local/dsh-artifacts

Artifacts and a canvas panel for DSH Web — the thing Claude calls *artifacts* and
Gemini calls *canvas*: the assistant writes a self-contained visual document
instead of pasting it into the transcript, and you read, edit, version, and
export it in a side panel.

## What it gives the agent

Three tools, registered only in a Web profile:

| Tool | Purpose |
| --- | --- |
| `artifact_create` | Create an artifact: `title`, `type`, `content`, optional `language` / `description`. |
| `artifact_update` | Revise one: full `content`, or exact `edits` (`old_string` / `new_string` / `replace_all`) against the current text. Each write appends a version. |
| `artifact_list` | List this chat's (or the project's) artifacts with ids, kinds, and versions. |

A short system-prompt section tells the model to reach for an artifact **on its
own initiative** when the deliverable is an interactive page, a diagram, a
chart, a formatted document, or a substantial code sample, and to keep the chat
reply to two short sentences. You do not have to name the tool: "帮我做个番茄钟
网页" or "把 Q1 12、Q2 18 做成柱状图" is enough. Borderline asks (a two-line
diagram, a short table) may still be answered inline; say "放到画布里" when you
want the canvas for certain.

## Artifact kinds

| `type` | Rendered as |
| --- | --- |
| `html` | Full HTML document in a sandboxed iframe; inline `<style>` and `<script>` run, external CDN scripts work. |
| `svg` | Inline SVG served as an image. |
| `markdown` | GitHub-flavored Markdown through the app's own renderer. |
| `mermaid` | Mermaid diagram, loaded lazily inside its own sandboxed frame (needs network for the first load). |
| `chart` | A JSON chart spec drawn locally as SVG — no chart library. |
| `code` | Line-numbered source with an optional `language` hint. |

`chart` content is JSON:

```json
{
  "kind": "bar",            // bar | line | area | pie | donut
  "title": "Quarterly revenue",
  "labels": ["Q1", "Q2", "Q3", "Q4"],
  "series": [
    { "name": "2025", "values": [12, 18, 15, 24] },
    { "name": "2026", "values": [15, 21, 19, 28] }
  ],
  "unit": "k",              // appended to axis ticks
  "stacked": false          // bar only
}
```

`pie` / `donut` read the first series; one slice per label.

## What you get in the UI

- **Transcript card.** After a turn that created or revised artifacts, one card
  per artifact appears under the closing prose — not buried in the collapsed
  tool group. The preview is flush with the card edge and sits on top, with a
  quiet title bar underneath: one frame instead of a box in a box. HTML and SVG
  use a 16:9 stage; charts and diagrams get 238px. Click the preview or title to
  expand **in the conversation**, the expand chevron to collapse, and the
  fullscreen button for a native full-size view (Esc exits). *Open canvas* still
  opens the side panel; the expanded state is remembered per artifact.
- **Canvas tab.** A card's *Open canvas* button opens the canvas: preview,
  source, and edit modes, a version panel with timestamps and one-click
  restore, back/forward through the canvases you have visited in this tab, a
  recent-canvases list, rename, copy, download, and delete. `Ctrl/⌘+S` saves an
  edit as a new version.
- **Gallery.** The sparkle button in the conversation header, or the *Artifacts*
  entry in the right sidebar's add-tab menu, opens a gallery filtered to *This
  chat* or *This project*.

## Try it

Ask for something visual and let the agent choose the tool:

> 做一个可交互的番茄钟网页，25 分钟倒计时，开始/暂停/重置，深色风格。

> 把这份季度销售数据做成柱状图：Q1 12、Q2 18、Q3 15、Q4 24。

> 画一张登录流程的 Mermaid 流程图，再给我一份带表格的接入说明。

The reply stays short; the artifact appears as a card under the answer and the
canvas opens from there.

## Storage

Artifacts are chat-side work product, not project source files, so they live
under the Harness home by default:

```
$DSH_HOME/storages/artifacts/<workspace-hash-name>/<artifact-id>/meta.json
$DSH_HOME/storages/artifacts/<workspace-hash-name>/<artifact-id>/v1.html
```

Set `artifactsDir` to keep them with the project instead (relative paths resolve
against the project root, `~` and absolute paths are accepted):

```yaml
- id: dsh-artifacts
  name: '@local/dsh-artifacts'
  config:
    artifactsDir: '.dsh-artifacts'
    maxBytes: 1048576   # per artifact, default 1 MiB
    maxVersions: 30     # files kept per artifact
```

The `meta.json` in each directory names the project, the creating Session, the
kind, the timestamps, and every version.

## Install

```bash
dsh plugin --profile web add link:/path/to/default-workspace/artifacts
```

Then add `"@local/dsh-artifacts"` to `dsh.profile.bundles` in
`~/.dsh/profiles/web/package.json` (or click **Enable now** in **Plugins**), and
restart `dsh web` — a host plugin is composed at boot.

A released tarball installs the same way:

```bash
dsh plugin --profile web add https://example.com/local-dsh-artifacts-0.1.0.tgz
```

## Security notes

- HTML artifacts are untrusted model output. They render in an iframe with
  `sandbox="allow-scripts allow-forms allow-modals allow-popups"` and no
  `allow-same-origin`, so scripts run on an opaque origin without the Harness
  cookie or API access. The raw route also sends
  `Content-Security-Policy: sandbox allow-scripts …`, which keeps that isolation
  even when someone opens the raw URL as a top-level page.
- The opaque origin also means an HTML artifact has no cookies, no
  `localStorage`, and no access to the Harness API. Keep demo state in memory; a
  page that truly needs persistence should be written into the project and
  served by the user's own app instead.
- SVG is served as an image; scripts inside it never run.
- Markdown is rendered by the app's own Markdown component, not injected as
  raw HTML by this plugin.

## Limitations

- One canvas per chat: opening another artifact navigates the same tab instead
  of stacking a second one. The tab keeps up to 12 visited artifacts in a
  back/forward history and remembers its subject across reloads in
  `localStorage`.
- The inline expanded card follows the artifact's own ratio for HTML and SVG
  (16:9) and uses `clamp(360px, 52vh, 560px)` for charts, Markdown, and code;
  it is not a resizable split. Fullscreen uses the native Fullscreen API, so no
  custom viewer chrome is drawn on top of the artifact.
- Mermaid needs network access the first time (it imports the library from a
  CDN). Without it the canvas says so and the source stays available under
  **Source**.
- Charts are intentionally small: bar, line, area, pie, donut, one value axis,
  no tooltips. Anything richer belongs in an HTML artifact.
- Artifacts are not indexed in the git repository and are not shared between
  machines; export or point `artifactsDir` at the project when that matters.

## Files

```
index.js            host: tools, HTTP routes, storage wiring, prompt section
lib/store.js        versioned filesystem store (metadata + immutable version files)
client.js           browser: transcript cards, canvas tab, gallery, header entry
cordis.patch.yml    loader row and defaults
locale/*.json       plugin-manager metadata (en, zh)
```