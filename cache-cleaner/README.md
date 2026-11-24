# Cache cleanup (`@local/cache-cleaner`)

A Settings page that reports and clears the data every DSH home on this machine has
produced. **Session log deletion is limited to archived sessions**; unarchived
conversations and their checkpoints stay untouched. Archived sessions that a running DSH
process still holds open are skipped. Canvas documents are still removed in full, because
they are not archived per session. Session logs and canvas documents are real data, not
rebuildable caches: deletion is permanent.

## What it covers

One DSH home is `$DSH_HOME`, normally `<account home>/.dsh`. The page discovers:

- the home of the process running this plugin;
- `/root/.dsh`;
- every `/home/<account>/.dsh`;
- any extra home listed in `config.extraHomes`.

| Category | Path (per home) | What is removed |
| --- | --- | --- |
| Session logs | `sessions/<project>/<session>/` | The append-only JSONL log of an **archived**, cold conversation, its lock file, and any temporary files in that directory. Unarchived sessions are never touched. |
| Projection checkpoints | `storages/session_projcache/sessions/<id>.json` | Cached rows for archived sessions, plus records whose session directory no longer exists. A live or unarchived session's rows are kept. |
| Canvas artifacts | `storages/artifacts/<workspace>/<artifact>/` | Documents kept by `@local/dsh-artifacts`: metadata, version files, and the workspace directory when it becomes empty. |

Archived state is read from `<home>/storages/workspace.json` (`global.archivedSessionIds`).
A home with no such file has no archived sessions, so nothing is deleted there. A file
that exists but cannot be read or parsed makes the session target fail for that home
instead of guessing.

The two buttons and the **Clear everything** action map to the `sessions` and `canvas`
targets. `sessions` removes archived session logs **and** their projection checkpoints.

## Safety

- **Only archived logs.** An unarchived session's directory and checkpoint are never
  candidates, regardless of age or activity.
- **Atomic deletion under the session lock.** The JSONL backend holds `flock(2)` on each
  session's `session.lock` for the life of its write handle. Deletion runs as
  `flock -n <lock> rm -rf <dir>`, so the kernel grants the directory to exactly one side:
  a live session's lock is held, the delete exits without touching it, and the page
  reports the skip. This protects every account's sessions, not only the Host's.
- **Two more checks.** The plugin also reads `/proc/<pid>/fd` before deleting, refreshes
  that table after the scan, and compares each session's size and latest file activity
  with the scanned values. A session that changed in between is skipped as `changed`.
- **Counts can be conservative.** When the Host cannot read every process file table it
  reports `proc-restricted` and the page says in-use counts may be low for other accounts;
  the per-session lock check during deletion remains authoritative.
- **No detection, no session deletion.** Without `/proc` *and* without a working `flock`,
  the session target is refused instead of guessed; with a restricted file table and no
  `flock`, each affected session is skipped as unverifiable. Canvas cleanup still works.
- **Ownership.** A home the Harness cannot write to is listed and reported, not forced.
- **Per-category errors.** If one category (for example `sessions/`) cannot be listed, the
  home's other categories are still scanned and cleaned; the unreadable path is reported
  as a failure for that target instead of discarding the whole home.
- **Recent files.** With `minAgeMinutes > 0`, sessions whose newest file was modified
  inside that window are skipped as well.
- **Irreversible.** Canvas artifacts are user documents: after deletion the canvas
  cannot restore them. Deleted sessions cannot be resumed.

## Where it appears

Settings (the gear) → **缓存清理 / Cache cleanup**. The page shows one card per DSH home
with session, projection, and canvas sizes, then offers:

- **清理会话记录 / Clear session history** — archived, cold session logs plus their
  projection checkpoints;
- **清理画布文档 / Clear canvas documents** — canvas artifacts;
- **全部清理 / Clear everything** — both.

Each action asks for confirmation inline, focuses the confirm button, and reports freed
bytes, removed counts, how many unarchived sessions were kept, skipped archived sessions
by reason (in use, recently modified, changed after the scan, unverifiable lock), and
per-path failures. **重新扫描** refreshes the
numbers and disables the destructive actions while it runs.

## Agent tool

`cache_cleaner` exposes the same Host operations:

| Action | Parameters | Effect |
| --- | --- | --- |
| `scan` | — | Returns per-home sizes and archived counts; changes nothing. |
| `clean` | `targets?: ('sessions' \| 'canvas')[]`, `confirm: true` | Deletes archived logs and/or canvas documents; refuses without `confirm: true`. |

The tool description states that cleaning is destructive and only for an explicit user
request. Both callers share `lib/cache.js`, so the UI and the tool cannot drift.

## Routes

Owner-admitted Fetch routes:

| Route | Method | Body | Purpose |
| --- | --- | --- | --- |
| `/api/cache-cleaner/scan` | GET | — | Scan report |
| `/api/cache-cleaner/clean` | POST | `{ "targets": ["sessions", "canvas"], "confirm": true }` | Cleanup result |

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `extraHomes` | `[]` | Additional absolute DSH home paths to scan, for installations outside `/root` and `/home/*`. |
| `minAgeMinutes` | `0` | Skip sessions whose newest file was modified within this many minutes. `0` disables the age guard. |

## Notes

- Lock detection is Linux-specific (`flock(1)`, `/proc`). The canvas target does not
  depend on either.
- A custom `artifactsDir` on `@local/dsh-artifacts` is not discovered; only the default
  `storages/artifacts` layout under each home is cleaned.
- Removing a cold archived session does not rename anything; the conversation simply
  disappears from the archive after the page refreshes its session list. A session whose
  write lock is held is never deleted, even when `minAgeMinutes` is `0`, and an
  unarchived session is never a candidate.
- Turning the bundle off removes the Settings page, both routes, and the tool; nothing
  else is changed.