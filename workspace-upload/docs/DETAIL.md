# Workspace uploads

Upload files from the computer running the browser into the Session's workspace — the same directory the Files page lists — without leaving the Web GUI.

## Where it appears

Open a conversation, then open the right Sidebar's **Files** page (the folder icon, `Mod+P` on desktop). An upload control sits in the page header beside the reload and search buttons.

- Click it to choose one or more files from the local computer.
- Or drop files onto the control; the header highlights while a drag is over it.

## What happens

Each file is streamed to the Host, written to a hidden temporary file inside the destination directory, and then published under its name, so the tree never lists a half-written file. The tree watches the directory and refreshes on its own when a file appears.

The progress panel lists every chosen file with its size, a progress bar while its bytes are sending, and the outcome:

- **Uploaded** — the file is in the workspace under the name shown.
- **Uploaded as …** — the name was already taken and a free alternative was used.
- **A failure line** — the reason, such as a size limit, a rejected request, or a Session without a readable directory.

Uploads run one file at a time. **Cancel** stops the current file and skips the rest of the queue. A fully successful batch closes its panel after a few seconds; a failure stays until it is dismissed. A page unload during an upload asks for confirmation first; a closed Files tab does not discard the bytes already sending.

## Destination and limits

- The destination is the Session's effective working directory, read by the Host from the Session itself. The panel shows that path above the list.
- Files land directly in that directory. Subdirectories and whole folders are not created by this version, and the tree's currently expanded folder does not change the destination.
- The default upload limit is 2 GiB per file; `maxUploadBytes` in the plugin row changes it.
- Names are published create-if-absent: a taken name becomes `name (1).ext`. Set `onConflict: overwrite` in the plugin row to replace an existing file instead of choosing a new name.
- The route is owner-only and authenticates through the Web GUI's browser session. Every write is fenced inside the Session's working directory.

## Configuration

```yaml
- id: workspace-upload
  name: '@local/workspace-upload'
  config:
    maxUploadBytes: 2147483648 # bytes accepted per file
    onConflict: rename # or overwrite
```

## Not included

- No agent tool: choosing local files is a user action, and the Host has no model-facing file picker.
- No folder upload, no upload into a subdirectory, no drag-and-drop target beyond the header control.
- The plugin writes on the Host filesystem that serves the Session; a Session whose directory lives on a remote filesystem is out of scope.