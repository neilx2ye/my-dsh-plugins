# System users (`@local/user-switcher`)

A sidebar-foot dialog that answers "which Linux account is this harness running as, and how do I
move to another one?" without ever pretending the switch already happened.

## What it does

- **Identity.** Reads `/etc/passwd`, `/etc/group` and `process.get*id()` to report the account,
  uid, host, and group list of the running Host process.
- **Accounts.** Lists local accounts with an interactive shell (`uid >= config.minUid`, or root),
  marking `root` and administrative group membership, plus whether each home directory and
  `~/.dsh` can be read from this account — absence and permission denial are reported differently.
- **Instances.** Scans `/proc/*/cmdline` for other harnesses already serving the Web UI, showing
  their pid, owner, and explicit `--port` when one was passed.
- **Switch.** The trigger opens a small popover above itself: one account per line, each with a
  state dot. Clicking a line enters that account's Harness. No dialogs and no command text.
- **Visibility.** A gear at the popover's top-right flips the same popover into a checklist where
  each account is shown or hidden. Hidden accounts disappear from the list but stay listed in the
  checklist. The choice is stored in `<DSH_HOME>/storages/user-switcher.json` (0600), so it is per
  Harness home rather than a machine-wide policy.
- **Start.** Starts a detached `tmux` session running the harness as that account, only when this
  process is root or has passwordless sudo, then reads the sign-in URL that instance printed.
  Otherwise the row reports one short reason and nothing is started.

## What it cannot do

A process cannot change its own uid. This plugin never claims the running session moved to another
account; it only prepares or launches a **separate** instance. Sessions, credentials, and the
workspace stay private to each account.

## Routes

Owner-only Fetch routes, admitted by `ctx.connection.fetch`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/user-switcher/state` | GET | identity, accounts, privilege, live instances |
| `/api/user-switcher/plan` | POST `{user}` | switch commands for one account (API only; the UI hides them) |
| `/api/user-switcher/open` | POST `{user}` | `{url}` to enter that account's instance |
| `/api/user-switcher/visibility` | POST `{user, visible}` | hide or show one account in the list |

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `port` | `3081` | port proposed for a second instance |
| `minUid` | `1000` | lowest uid listed (root is always listed) |
| `maxUsers` | `50` | cap on listed accounts |

## Notes

- The dialog is portaled to `document.body` (the sidebar column clips its own children) and
  rendered as a centred modal with a dim scrim, so it never covers the session list in place.
- Layout is master–detail: rows stay one line tall and a selected account replaces the list with
  its prepared commands, instead of inline-expanding a row in place.
- Copy uses `navigator.clipboard` with a `document.execCommand` fallback for non-secure contexts.
- The icon is an original 24×24 stroke glyph.