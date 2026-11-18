# Git side panel

A DSH Web plugin that places the Git view **beside the conversation**, in the
session's right column, rather than in the main panel.

- A Git button in the conversation header opens the tab and expands the right
  column. Pressing it again while the Git tab is active collapses the column.
- A collapse button in the panel header provides the same action from inside
  the tab; the right column's own chrome also supports resizing and collapsing.
- The tab shows the repository of the workspace that owns the current
  conversation in two adjacent views:
  - **Changes**: uncommitted files with a status marker (modified, added,
    deleted, renamed, untracked, conflict). Hover, focus, or tap a filename to
    open a floating unified diff with added/removed lines tinted; the diff is
    fetched on demand and capped. A dirty tree opens this view first. The
    **Commit** control opens a message form, stages every listed change, and
    creates one commit; success switches to History and shows the new hash.
  - **History**: local branches plus a collapsible remote list, and a vertical
    commit timeline. Each commit is one node: the subject is the description,
    followed by the short hash, author, date, and the refs pointing at it.
    Branch pills switch the ref.
- Refresh re-reads the branch, changes, and commits.

The panel keeps the working-tree view and commit history as peer tabs, so a
long change list never pushes the history out of reach. The Git read is
read-only, and the only write is the explicit manual commit the user submits
from the Changes tab; both happen on the Host. The browser calls
`/api/git-explorer/workspace?workspaceId=…&ref=…` for the panel and
`/api/git-explorer/diff?workspaceId=…&path=…` for a hovered file. A submitted
commit posts `{ workspaceId, message }` to `/api/git-explorer/commit`. Every
route resolves the directory through `ctx.workspaceRegistry`, never from a
path the client supplies for the repository. Diff paths must stay repository-relative
and must match a file currently reported as changed. The child process is
bounded by the row's `timeoutMs`; the panel returns at most `limit` commits
and 200 changed files, and the diff card caps both its fetch and its rendered
line count.

## Configuration

```yaml
- id: git-explorer
  name: '@local/git-explorer'
  config:
    limit: 24             # 1–100 commit nodes
    timeoutMs: 12000      # 1000–60000 ms per inspection
    commitTimeoutMs: 30000 # 1000–120000 ms per manual commit, including hooks
```

## Notes

- A workspace that is not a Git repository stays readable and shows a quiet
  empty state.
- The repository's current branch is always read as `HEAD`; selecting a branch
  re-reads that ref.
- The commit action stages all working-tree changes (`git add --all`) and
  commits them with the message entered in the form; it never pushes, checks
  out, fetches, or rewrites history.
- Hover cards are portaled to the document body so the right column's
  `overflow: clip` does not cut them off; they close on pointer leave, Escape,
  resize, or when the file stops being changed.