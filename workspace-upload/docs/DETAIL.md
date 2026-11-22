# Workspace uploads

Upload files from the computer running the browser into the Session's workspace — the same directory the Files page lists — without leaving the Web GUI.

## Where it appears

Open a conversation, then open the right Sidebar's **Files** page (the folder icon; `Ctrl/⌘+Alt+P` in Web, `Mod+P` in Desktop). An upload control sits in the page header beside the reload and search buttons.

- Click it to open the upload panel, then choose **files** or a **folder** from the local computer.
- Or drop files or a whole folder anywhere on the Files page — the page highlights as a drop target — to upload them. A drop there is claimed for the workspace, so the same files are not also attached to the open conversation.
- While a batch is running, click the control (its badge shows `n/total`) to show or hide the progress panel.

A chosen or dropped folder keeps its shape: the folder itself becomes a directory in the workspace and every file keeps its relative path, so `proj/src/main.ts` lands at `<workspace>/proj/src/main.ts`.

## What happens

Each file is streamed to the Host, written to a hidden temporary file inside the destination directory, and then published under its name, so the tree never lists a half-written file. The tree watches the directory and refreshes on its own when a file appears.

The progress panel lists every chosen file with its size, a progress bar while its bytes are sending, `Saving to the workspace…` while the Host finalizes the file, and the outcome:

- **Uploaded** — the file is in the workspace under the name shown.
- **Uploaded as …** — the name was already taken and a free alternative was used.
- **Replaced the existing file** — `onConflict: overwrite` is set and an earlier file of that name was replaced.
- **A failure line** — the reason, such as the size limit, a rejected request, or a Session without a readable directory. Hovering the line shows the Host's technical message when there is one.

Uploads run one file at a time. **Cancel uploads** stops the current file and skips the rest of the queue. The panel's close button and **Hide** only hide it: uploads keep running, and the badge keeps counting. A clean batch (every file published under its chosen name) hides its panel after a few seconds; a renamed, replaced, cancelled, or failed file keeps the panel until it is dismissed. Closing the Files tab does not stop a running upload, but its progress panel goes away; the page asks for confirmation before unloading while a transfer is in flight.

## Destination and limits

- The destination is the Session's effective working directory, read by the Host from the Session itself. The panel shows that path above the list.
- Files land directly in that directory, and an uploaded folder becomes a subdirectory below it. Expanding a folder in the tree does not change the destination.
- Folders merge with what is already in the workspace: missing directories are created, existing files follow the name rule below, and empty folders found in a **dropped** folder are created too (the browser's folder picker does not report empty subdirectories).
- The default limit is 500 MiB per file. The panel states it once the Host has answered the limits request, and a larger file is then refused before anything is sent; if that request never answers, the Host still refuses an oversized file after the bytes arrive. The default leaves room under a 512 MiB reverse-proxy request cap — a proxy that caps bodies lower answers its own 413, which the panel reports as the size limit. `maxUploadBytes` in the plugin row changes the Host limit and what the panel shows.
- Names are published create-if-absent: a taken name becomes `name (1).ext`. Set `onConflict: overwrite` in the plugin row to replace an existing file instead.
- A hidden file such as `.env` uploads normally but stays hidden in the tree until the tree shows hidden entries; the row says so when the file kept its name (a renamed or replaced file reports that instead).
- The routes are owner-only and authenticate through the Web GUI's browser session. Every write is fenced inside the Session's working directory.

## Configuration

```yaml
- id: workspace-upload
  name: '@local/workspace-upload'
  config:
    maxUploadBytes: 524288000 # bytes accepted per file; keep it below the proxy cap
    onConflict: rename # or overwrite
```

## Not included

- No agent tool: choosing local files is a user action, and the Host has no model-facing file picker.
- No upload into an arbitrary subdirectory of the workspace: the Files page exposes the workspace root to this control, not the folder currently expanded in the tree, so a folder you upload becomes a top-level directory.
- Empty folders are preserved only for a drop, not for the folder picker, because the picker does not report them.
- Uploads target the Host filesystem that serves the Session; a Session whose directory lives on a remote filesystem is out of scope.