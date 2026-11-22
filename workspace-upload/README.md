# Workspace uploads

Upload files from the browser into a Session's workspace from the **Files** page header.

- One upload control in the right Sidebar's Files page header: pick files or a whole folder, or drop either anywhere on the Files page; a folder keeps its directory structure.
- Each file streams to the Host as a hidden temporary file and is then published, so the tree never shows a partial upload.
- Per-file progress, a saving phase, outcomes, and failures in a small panel; **Cancel uploads** stops the current file and the rest of the queue, while **Hide** keeps uploads running. When the batch ends the panel clears itself and a toast reports the outcome — no history or log file is kept.
- Name-safe publishing (`name (1).ext`), a size cap shown in the panel (default 500 MiB, below a typical 512 MiB proxy cap), and a destination fenced inside the Session's working directory.

See [docs/DETAIL.md](docs/DETAIL.md) for behavior, limits, and configuration.

## Install

From the repository root:

```bash
dsh plugin --profile web add /path/to/workspace-upload
```

Or open **Plugins** → **Add plugin** in DSH Web and point it at this directory (or a packed tarball).

## Layout

| File | Role |
| --- | --- |
| `index.js` | Host half: owner-only streaming upload route and read-only limits route, writing into the Session's directory |
| `client.js` | Browser half: Files page header control, drag-and-drop, progress panel |
| `cordis.patch.yml` | Bundle patch inserting the Host row and its config |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title and description |
| `docs/DETAIL.md` | The bundle's detail page |