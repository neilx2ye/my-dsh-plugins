# Command line (`@local/command-runner`)

A floating, tabbed command window for DSH Web that runs shell commands in **the
current Workspace's registered directory** and streams their output back into
their tab. Tabs keep their own command, output, and history, but only **one
command runs at a time**: starting a command stops whatever was still running —
also a run started from another Workspace's window — and the stopped tab says
`已停止：被新命令取代`. Nothing is left running behind a command you replaced.

## Use

1. Open a session in DSH Web.
2. Click the `>_` button in the composer tool row (left side, next to the other
   composer controls).
3. Type a command and press Enter. `Up`/`Down` recall that tab's earlier
   commands, `Esc` hides the window, `Stop` terminates the tab's process. Turn
   on the `交互` chip for commands that prompt for input.
4. `+` opens another tab. Each tab has its own command, output, history, and
   Stop button, and keeps running when you switch tabs or close the window.
   Running a command in a second tab stops the first one. `×` closes a tab and
   terminates its process; closing the whole window with `✕` leaves the current
   command running.

URLs printed by a command — `http`/`https`/`ftp`, `www.` hosts, and
`localhost`/loopback ports — are rendered as links and open in a new tab.
Trailing sentence punctuation and wrapper brackets stay outside the link, so
the surrounding text keeps its shape.

### Interactive commands

Turn on the `交互` chip in a tab before running. The command then starts on a
real PTY, so programs see a terminal and TTY-aware prompts work. While it runs,
the input is a terminal keyboard: typing, arrows, Tab, Home/End, PageUp/Down,
Esc, and Ctrl combinations are written straight to the process; Enter sends CR.
The PTY echoes the input, and readline-style editing and history work. Paste
with Ctrl/Cmd+V.

Because Esc belongs to the program while a run is active, close the window with
`✕` rather than Esc. Plain output and line editing stream incrementally, while
carriage-return, backspace, and line-erase update the current line in place.
When a program rewrites earlier lines (progress blocks, multi-line prompts,
cursor addressing), the Host sends a full screen snapshot and the window
replaces its transcript, so the previous rendering does not stay behind as a
duplicate. Full-screen TUI programs are approximated by their latest text
screen; for real xterm interaction and mouse support, use the sidebar Terminal
tab.

Interactive runs end when the process exits, on `Stop`, when their tab closes,
or when the browser page reloads. There is no automatic wall-clock timeout, and
closing the floating window keeps them running like any other tab.

The new input route is Host-side: after updating this local bundle, restart
`dsh web` once. Against an older Host the window reports that a restart is
required instead of silently dropping input.

### Common commands

Type a command, then click the `☆` button next to the input to save it for the
current project (the workspace directory). Saved commands appear in a `常用`
bar under the tabs. Click a chip to run it: an idle active tab is reused, and
when the active tab is busy the command starts in a new tab and replaces the
run that was still going. The chip's `×`
removes it. Up to 24 commands are kept, and duplicates (or a command already in
the list) cannot be saved again.

The list is keyed by the project path and stored in this browser's
`localStorage`, so every Session in the same project shares it and it survives
reloads. It is not written into the repository; a project-file-backed list can
be added if the shortcuts should travel with the code.

The window floats above the conversation instead of sitting in the composer
stack, so the sticky composer and the transcript cannot clip it.

- **Move** it by dragging the title bar (the dotted grip on its left).
- **Resize** its height by dragging the grip at the bottom edge, or focus that
  grip and press `Up`/`Down`.
- **Reset** size and position by double-clicking the title bar.
- The size and position are remembered in `localStorage` and clamped to the
  viewport whenever the browser window shrinks.

### Scope

Window state is keyed by **Workspace**, not Session. Switching between Sessions
in the same Workspace keeps every tab, its output, and its running process;
each Workspace has an independent set of tabs. Sessions that belong to no
Workspace fall back to Session scope. Commands always run in the Workspace's
registered path, so switching Sessions does not move them.

The title bar shows that directory, resolved by the Host from the Workspace
registry. Commands run through `$SHELL -c` (or `cmd.exe /d /s /c` on Windows) as
the DSH user, with the same reach as the terminal panel — they are not sandboxed
or model-mediated.

## Host routes

Three owner-only Fetch routes are registered through `ctx.connection.fetch`, so
browser admission (host/origin trust plus the signed browser cookie) happens
before any handler runs:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/command-runner/workspace?workspaceId=…` | report a registered Workspace's directory and shell |
| `GET` | `/api/command-runner/workspace?sessionId=…` | fallback: report the session's effective directory and shell |
| `POST` | `/api/command-runner/run` | run `{ workspaceId, command }` or `{ sessionId, command }`, streaming `text/event-stream` events; `interactive: true` starts a PTY |
| `POST` | `/api/command-runner/input` | write one line to an interactive run as `{ runId, data }` |

Run events: `start`, `stdout`, `stderr`, `truncated`, `error`, `exit`.
An interactive `start` carries the `runId` used by the input route; interactive
runs also emit `partial` (the current line) and, after a redraw, `screen` (the
complete transcript), which the window replaces instead of appending.

## Config

```yaml
- insert:
    - id: command-runner
      name: '@local/command-runner'
      config:
        maxOutputBytes: 1048576  # delivered-output ceiling; later bytes are dropped
        shell: /bin/zsh          # optional shell override
```

Commands run until they exit, are stopped, or their connection closes; there is
no automatic wall-clock timeout. Invalid config values fail activation with the
offending field named.

## Development

`lib/exec.js` drives only the `ctx.subprocess` contract, so it is testable with a
plain Node process; interactive runs use `spawnTerminal` and sanitize PTY output
before it reaches the window. The browser half is hand-written in the dynamic Client
module format (`window.__ModuleLoader__.load`), so no build step is involved.