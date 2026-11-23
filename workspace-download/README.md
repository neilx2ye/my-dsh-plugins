# Workspace downloads

Download files and folders from the DSH execution device to the computer running the browser, from the Files side panel.

- **Preview header**: save the original bytes of the file you are previewing.
- **Files page header**: save the whole workspace as one ZIP.
- **Folder right-click menu**: **Download as ZIP** for any folder in the tree.

The Host streams each response, so the browser's download manager owns progress, cancellation, and the destination. Each entry asks the Host with `HEAD` first (bounded to 1.5 s so the click's activation is not lost), and a refusal answered in time appears as a page notice; a transfer refused later shows as a failed browser download. Archives are UTF-8 ZIPs with entries stored (not compressed), skipping symlinks and `node_modules` by default, and leaving `.git` out unless the download asks for it (the Files header menu has an Include .git checkbox; the folder menu offers both variants). Archives are capped at 20,000 entries / 2 GiB (and classic-ZIP limits).

See [docs/DETAIL.md](docs/DETAIL.md) for behavior, limits, and configuration.

## Install

From the repository root:

```bash
dsh plugin --profile web add /path/to/workspace-download
```

Or open **Plugins** → **Add plugin** in DSH Web and point it at this directory (or a packed tarball).

## Layout

| File | Role |
| --- | --- |
| `index.js` | Host half: owner-only streaming file route and ZIP route |
| `client.js` | Browser half: preview and Files header controls, directory menu action |
| `cordis.patch.yml` | Bundle patch inserting the Host row and its config |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title and description |
| `docs/DETAIL.md` | The bundle's detail page |