# System users (`@local/user-switcher`)

A sidebar-foot dialog that answers "which Linux account do this Harness's commands run as, and how
do I change it?" — without starting a second Harness and without changing any setting.

## What it does

- **Identity.** Reads `/etc/passwd`, `/etc/group` and `process.get*id()` to report the account,
  uid, host, and group list of the running Host process.
- **Accounts.** Lists local accounts with an interactive shell (`uid >= config.minUid`, or root),
  marking `root` and administrative group membership.
- **Switch.** The trigger opens a small popover above itself: one account per line, each with a
  state dot. Clicking a line selects the account every later Bash command runs under. The Host
  process keeps its uid; each execution is handed to `setpriv --reuid <uid> --regid <gid>
  --init-groups`, so the command's user, groups, `HOME` and file permissions change while sessions,
  model, plugins, credentials, and settings stay exactly where they are. A command whose working
  directory belongs to the Host's own account runs in place, because `setpriv` still calls
  `initgroups`, which a non-root Host cannot do.
- **Isolation.** Selecting an account starts or reuses that account's *own* Harness instance: a
  separate process running as the account with `DSH_HOME=<account home>/.dsh`, served at
  `/<account>/`. Its workspaces, identities, sessions and credentials are private to that account,
  so one account never lists another account's world.
- **Shared tooling.** Every account's profile is a copy of the same plugin set and model
  configuration; plugin updates and model settings are deployed by copying the profile (or its
  bundle list) into the target account.
- **Sign-in.** Each instance prints its own tokenized URL; the switcher reads it from the tmux pane
  and navigates the browser there. The token is per process.
- **Persistence.** The sidebar selection is stored in `<DSH_HOME>/storages/user-switcher.json`
  (0600). The visited Session per workspace is the ordinary GUI selection.
- **Visibility.** A gear at the popover's top-right flips the same popover into a checklist where
  each account is shown or hidden. Hidden accounts disappear from the list but stay listed in the
  checklist.

## What it cannot do

A process cannot change its own uid, and this plugin does not try. It switches the identity of
**shell executions**, not of the Host process. The model-facing file tools (`read`, `write`,
`edit`) still run in-process with the Host's authority; files they create are owned by the Host
account. Switching to a non-root account therefore changes what commands can see and do, not what
in-process tools write.

## Routes

Owner-only Fetch routes, admitted by `ctx.connection.fetch`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/user-switcher/state` | GET | identity, accounts, privilege, current selection |
| `/api/user-switcher/select` | POST `{user}` | select the account shell commands run under |
| `/api/user-switcher/visibility` | POST `{user, visible}` | hide or show one account in the list |

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `minUid` | `1000` | lowest uid listed (root is always listed) |
| `maxUsers` | `50` | cap on listed accounts |

## Notes

- Each account's instance needs an nginx location `/<account>/` forwarding to `config.port` with
  cookie-path rewriting, mirroring the shipped `/neil/` example.
- The command wrapper is installed once on `ctx.shell.execute` and removed when the plugin is
  disposed, so a reload never stacks wrappers.
- `setpriv` is required (`util-linux`); a host without it cannot switch identities.
- The dialog is portaled to `document.body` (the sidebar column clips its own children) and
  rendered as a centred modal with a dim scrim, so it never covers the session list in place.
- The icon is an original 24×24 stroke glyph.