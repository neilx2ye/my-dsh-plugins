# Workspace downloads

Download files and folders from the execution device to the computer running the browser, from the Files side panel.

## Where it appears

- **Preview header** — open a file in the right Sidebar and use the download control in its header to save the original bytes of that file.
- **Files page header** — the download control there saves the whole workspace as one ZIP.
- **Folder context menu** — right-click a folder in the Files tree (or the workspace path label) and choose **Download as ZIP** to archive that folder.

All three use the browser's own download manager: the Host streams the bytes, so large files and archives are not buffered in the page.

## What happens

1. The page asks the matching route with `HEAD` first, bounded to 1.5 s so a slow archive scan does not spend the click's activation window. A refusal answered in time (missing path, folder too large, outside the workspace, expired session) is reported as a notice in the page, using the failure code the Host puts in a response header.
2. On success the browser starts the transfer and owns progress, cancellation, and the destination. A refusal that arrives after that point, or a failure while streaming, appears as a failed browser download — the page cannot observe completion, cancellation, or a blocked download.

### Archives

- The archive contains one top-level folder named after the downloaded directory, its files, and its subdirectories (including empty ones). A folder whose name already ends in `.zip` keeps that name.
- Names are stored as UTF-8, and the response carries the exact archive length so the download manager can show progress.
- Entries are **stored, not compressed**, so packing is fast and the archive is roughly the size of the folder. Files over 8 MiB are read twice (CRC, then bytes), and every file is rechecked while copying; a file that changes during packing fails the download rather than producing a corrupt archive.
- Symbolic links are skipped; `.git`, `node_modules`, and hidden `.dsh-upload-*` staging files are left out (the staging prefix is not configurable). `exclude` changes the rest of that list.
- One archive is capped at 20,000 entries (`maxEntries`, at most 65,534 because a classic ZIP stores the count in 16 bits) and 2 GiB of uncompressed content (`maxTotalBytes`). The planned archive, headers included, must stay below 4 GiB. A larger folder is refused with a notice — download a subfolder instead.
- The Files page's whole-workspace control asks for confirmation and states the excludes and limits once the Host has reported them; the folder context menu does not confirm because the target is explicit.

### Single files

The file route accepts any absolute path **on the local filesystem of the Host process**, follows a final symlink, and does not consult `sessionId`; it is owner-authenticated but wider than the preview surface, which reads through the composed filesystem and refuses a final symlink. Folder archives are fenced inside the Session's workspace root with `realpath` containment and skipped symlinks. Sessions whose files live on a non-local backend are outside this plugin's scope.

## Configuration

```yaml
- id: workspace-download
  name: '@local/workspace-download'
  config:
    maxEntries: 20000 # files and folders per archive
    maxTotalBytes: 2147483648 # uncompressed bytes per archive; classic ZIP cannot exceed 4 GiB
    exclude: # directory or file names skipped at every depth
      - .git
      - node_modules
```

## Not included

- No compression: entries are stored, which keeps packing cheap; CPU is still spent on CRC (a JS loop) and files above 8 MiB are read twice. Use an archive tool after downloading if you need a smaller file.
- No ZIP64: an archive, headers included, must stay below 4 GiB; the planning step refuses a larger one before streaming.
- No multi-select, no password protection, and no download of a folder outside the workspace.
- No resume support and no server-side progress bar; the browser's download manager shows progress. The page does not learn when a download finishes or is cancelled.
- The whole-workspace control is not a substitute for selecting files: it archives the Session's working directory with the default excludes, and a very large workspace is refused rather than streamed partially.
- No agent tool: choosing where to save is a browser action.