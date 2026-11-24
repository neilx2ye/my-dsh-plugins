# Codex images

Per-project gallery for images produced by Codex CLI. The panel lives in the composer
tool row; the `codex_image` tool exposes the same project scope to the agent. There is
no global library: every Session reads its own project directory. The plugin also has
its own isolated Codex home, so OAuth sign-in and account state never touch `~/.codex`.

## What it does

- **Scope**: images live in the Session project at `output/imagegen/` (configurable
  `projectDir`, relative to the project root). Other projects' images are never listed,
  served, or generated.
- **Preview**: the composer window shows this project's thumbnail grid; clicking one
  opens the full image with its prompt, project-relative path, timestamp, and size.
- **Use**: copy the project-relative path (`output/imagegen/hero.png`), copy a Markdown
  embed, copy an absolute path, or download the original.
- **Generate**: the window runs the local Codex CLI *inside the project* (`codex exec
  -C <project>`) and asks it to save into `output/imagegen/`. Up to four reference images
  can be attached in the generate panel; they are passed as `codex exec -i` inputs in
  selection order. The prompt and size are recorded in `output/imagegen/.codex-images.json`.
- **Account**: the panel talks to a `codex app-server` running in the isolated home and
  shows the signed-in identity (email, plan, workspace, account id, token expiry). The
  terminal's `~/.codex` configuration and login are never read or modified.
  - The signed-in card shows the plan, plan expiry, quota per window, each window's reset
    time, extra credits, and available full resets. Every window draws one usage bar that
    fills with the used share (green, amber from 80%, red once exhausted) and states the
    remaining percentage; the row under it repeats the used percentage next to the reset
    time. Account IDs and token expiry are intentionally hidden.
  - **Device code (default)**: the panel shows a one-time code and a verification URL;
    authorize on any device that can reach OpenAI and the panel updates through the
    `account/login/completed` notification.
  - **Browser**: the panel shows the authorization URL; if the authorizing browser is on
    another machine and the `127.0.0.1:1455` redirect cannot open, paste that redirect
    URL into the panel and the Host delivers it to the local login server.
  - **Import auth.json**: upload the `~/.codex/auth.json` from a device where Codex is
    already signed in. The file is validated, written with mode `0600` to the isolated
    home only, and the app-server is restarted so the account takes effect immediately.
- **Agent tool**: `codex_image` is the agent's CRUD surface over the project
  directory: `generate` (create), `list`/`show` (read), `edit` and `rename` (update),
  `delete` (delete), `export` to copy an image to another project path such as
  `public/images/hero.png`, `reference` to store a chat attachment or any local image in
  the reference library, and `account` (read-only isolated sign-in state). `generate`
  and `edit` accept an `images` array of absolute paths or project-relative ids as
  references (at most four). `reference` accepts a chat attachment's normalized copy path
  (no extension needed), copies it into `output/imagegen/.references/`, and returns the
  id to pass in `images`.
  `edit` keeps the source image's pixel size unless `size` is passed, so editing a
  2048x768 banner returns a 2048x768 banner instead of the configured square default.
  Sizes that the image model cannot render (its edges must be multiples of 16, max 3:1
  ratio, 655,360–8,294,400 pixels) are rendered at the nearest legal size and then
  scaled back to exactly the requested dimensions; the tool reports the final size.
  `generate`, `edit`, and `show` return the image inline, so the model sees it in the
  chat. A short system-prompt section asks the agent to reach for `codex_image` when a
  task needs a raster asset and not to fake one with SVG/canvas placeholder art.

## Configuration

The bundle patch is the source of defaults; override the row `config` in the profile
patch to change them.

| Key | Default | Meaning |
|---|---|---|
| `projectDir` | `output/imagegen` | Image directory, relative to each Session's project root; it must resolve inside the project |
| `codexHome` | `~/.dsh/codex-home` | Isolated Codex home used for generation, OAuth, and account reads |
| `generate` | `true` | Allow the Codex CLI generation action |
| `codexBin` | `codex` | Codex executable |
| `sandbox` | `workspace-write` | Fallback sandbox for `codex exec -s`; a live Session's own policy mode takes precedence |
| `generateTimeoutMs` | `300000` | Generation wall-clock limit |
| `proxy` | empty | Network proxy for every Codex process, e.g. `socks5h://127.0.0.1:1080`; the account panel can also save and test it. SOCKS is bridged to a loopback HTTP proxy automatically |
| `maxBytes` | `26214400` | Largest servable image |
| `size` | `1024x1024` | Default requested size for generation; `edit` defaults to the source image's own pixel size |

## Host routes

All routes sit behind `ctx.connection.fetch` browser admission.

- `GET /api/codex-images/list?sessionId=…` — scan this project's directory
- `GET /api/codex-images/file?sessionId=…&id=…&download=1` — one project image
- `POST /api/codex-images/generate` — `{ sessionId, prompt, size, sourceId? }`
- `POST /api/codex-images/export` — `{ sessionId, id, target? }`
- `POST /api/codex-images/rename` — `{ sessionId, id, target }`
- `POST /api/codex-images/delete` — `{ sessionId, id }`
- `GET /api/codex-images/account` — isolated account, provider, and pending login
- `POST /api/codex-images/account/login` — `{ method: "device" | "browser" }`
- `POST /api/codex-images/account/cancel` — stop the pending login
- `POST /api/codex-images/account/login/callback` — deliver a pasted loopback callback
- `POST /api/codex-images/account/import` — `{ content }` (auth.json text)
- `POST /api/codex-images/account/logout` — sign out of the isolated home

## Notes

- Generation requires a Codex CLI that can actually produce images (a built-in
  `image_gen` tool or the imagegen CLI fallback with a working API key). When it cannot,
  the panel shows Codex's own output instead of a fake image.
- The isolated home starts with a stock OpenAI config, so image generation uses the
  OAuth account, not the terminal's custom provider. OAuth requires network access to
  `auth.openai.com`; a blocked region reports Codex's own error in the panel.
- Tokens are never returned to the browser: the account route exposes only email, name,
  plan, workspace, account id, expiry, and an API-key suffix when applicable.
- Account state and login run through one managed `codex app-server` child using the
  isolated `CODEX_HOME`; it is stopped when the plugin unloads.
- **Reverse SSH networking**: when the Harness runs on a remote host reached over SSH,
  the remote host can borrow the client's network. Reconnect with
  `ssh -R 1080 ...` (dynamic remote forward) and enter
  `socks5h://127.0.0.1:1080` in the account panel's proxy field, or forward the client's
  HTTP proxy with `ssh -R 7890:127.0.0.1:7890` and enter `http://127.0.0.1:7890`.
  The panel's test button reports whether that exit can reach
  `chatgpt.com/backend-api/codex/models`.
- **SOCKS bridge**: Codex's HTTP client does not complete HTTPS requests through a
  SOCKS proxy even though its WebSocket client does. When `proxy` is `socks5://` or
  `socks5h://`, the plugin starts a loopback HTTP CONNECT proxy that forwards through the
  SOCKS endpoint and hands that URL to Codex. The configured proxy stays as entered; the
  bridge is automatic and stops when the plugin unloads.
- **Public access (simple CDN)**: an optional read-only HTTP server bound to `0.0.0.0`
  on a configurable port. Each project gets an unguessable token and images are served at
  `http://<base>/cdn/<token>/<project-relative path>` with CORS and `nosniff` headers.
  Only image files inside the project's image directory are served; `.references` is
  excluded and no write or listing endpoint exists. The panel shows the detected public
  or LAN IPv4, lets you override the public base URL, and copies per-image links. Open the
  port in your firewall and use a public IP, port mapping, or reverse proxy. **复制公网链接**
  only produces a link while public access is on: with the server off the detail view says
  so inline (and the button is dimmed) instead of silently copying nothing.
  A refused clipboard write (an `http://` page or a browser without the async clipboard) is
  reported as **复制失败**, never as silence.
- The directory is the single source of truth: adding, replacing, or deleting an image
  file is reflected on the next scan. Only `.codex-images.json` is plugin metadata.
- A file request, rename, or export target is rejected unless it resolves inside the
  expected project path, including through symlinks.
- `edit` attaches the source image to `codex exec -i` and saves a new file; the source
  is never modified. `delete` removes the file and its metadata entry.