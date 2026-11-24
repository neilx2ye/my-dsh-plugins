# @local/personal-agent

Turn one DSH profile into **several personal identities** you talk to, with
separate memories and homes, instead of a coding agent organised around project
workspaces.

Identities are an **additive layer**. The shipped Workspace/Session sidebar,
brand, search, drag, archive, and New Session button stay exactly as they are.
Each identity has one row in an identity module mounted directly above the
shipped Workspace browser, plus a manager page. Each identity has its own home, and
conversations with it open in that home. The identity persona and
memory apply only to sessions running inside an identity home, never to your
project conversations.

The bundle is deliberately **profile-scoped**. It installs into one profile,
writes only under that profile, and lives in that profile's Loader layer. Every
other profile on the device — and every device-wide setting — is untouched.

## What changes in the profile

| Surface | Before | With this bundle |
| --- | --- | --- |
| Sidebar list | Workspaces and their Sessions | Unchanged; an identity module sits directly above the Workspace browser, and the Personal agent page manages it |
| New Session | A button in the sidebar | Unchanged |
| Sidebar brand | The Harness wordmark | Unchanged |
| Persona | “You are a coding agent…” | An agent-scoped identity section only inside identity homes; project sessions keep their preset |
| Default agent preset | `standard` | Unchanged; identity conversations request `personal` explicitly |
| Memory | Per conversation | One note file per identity, shared by that identity's conversations |
| Workspace | A list of projects you choose from | Unchanged for projects; each identity adds one extra workspace group for its home |
| Tools | — | `remember`, `recall`, and `message_identity`, only visible inside identity homes |

The Harness data model still binds sessions to a directory, so each identity has
one workspace underneath. It is presentation, not deletion: the Workspace
browser is replaced, the session rows are gone, and the model is told that its
directory is its home rather than a project the user must manage.

## Install

The bundle is a normal `dsh.bundle` package. Install it into a profile:

```bash
# 1. Create a profile from the shipped web template (once).
dsh --profile myprofile --from-default-profile web --dump-config >/dev/null

# 2. Install this bundle. The CLI adds it to dsh.profile.bundles as well.
dsh plugin --profile myprofile add /path/to/personal-agent   # or a release .tgz URL

# 3. Start it.
dsh --profile myprofile
```

From the Web UI the same steps are **Plugins → Add plugin** (or **Add bundle**)
while the target profile is running. Enabling a bundle in the web profile is
enough for HMR to pick it up; restart `dsh` if the profile runs without HMR.

> Creating the profile from the `web` template matters: the default
> `dsh plugin add` initialization is the headless base template, which has no
> preset registry, Workspace rows, or browser UI for this bundle to extend.

### Keep a dedicated profile's history separate

DSH shares `$DSH_HOME/sessions`, `$DSH_HOME/storages`, and `$DSH_HOME/attachments`
across profiles by default. That is fine for several compositions of one
workspace, but a personal profile that should feel like a separate person needs
its own history. Point those three roots at the profile directory in the
profile's own `cordis.patch.yml`:

```yaml
- id: session-persistence-jsonl
  name: "@deepseek-ai/dsh-session-persistence-jsonl"
  config:
    root: !!js "dshHomePath('profiles', ctx.get('profileContext')?.name ?? 'personal', 'sessions')"
- id: storage-json
  name: "@deepseek-ai/dsh-storage-json"
  config:
    root: !!js "dshHomePath('profiles', ctx.get('profileContext')?.name ?? 'personal', 'storages')"
- id: attachment-local
  name: "@deepseek-ai/dsh-attachment-local"
  config:
    dshHome: !!js "dshHomePath('profiles', ctx.get('profileContext')?.name ?? 'personal')"
```

Credentials and model routes stay in the harness home on purpose, so the new
profile uses the same provider keys without copying secrets into a profile.
Do this when the profile is created: changing the roots later leaves the old
history behind in the shared store.

### Install into an existing profile

Installing into the profile you already use does not replace the project-level
UI. The Workspace/Session browser, search, grouping, drag, archive, and New
Session button remain the shipped ones. The plugin adds:

- an **identity module directly above the Workspace/Session browser**, with a
  `身份` header, one row per identity (name and role), and a manage action;
  selecting a row opens that identity's newest conversation;
- a **Personal agent** page, reachable from the module's manage action, for
  creating, editing, and removing identities and their memories. Removing an
  identity archives its conversations, deletes its workspace registration, and
  moves its home and memory to `personal-agent/removed/<id>-<timestamp>/`.
  Removing the last identity is allowed; the module then shows its empty state
  and you can create another.
- one extra workspace group per identity, because a Session still needs a
  working directory. These groups are titled after the identities and are not
  required for project work.

Set `autoOpen: false` when the profile already has project conversations, so a
page refresh does not enter an identity automatically:

```yaml
- id: personal-agent
  name: '@local/personal-agent'
  config:
    identities:
      - id: ada
        name: Ada
        role: personal assistant
        userName: ''
        persona: ''
        accent: '#5b5bd6'
        avatar: ''
        home: ''
        memoryFile: ''
    memory:
      includeInPrompt: true
      maxBytes: 6000
    autoOpen: false
```

Install through the Web UI's Plugins page, or `dsh plugin --profile <name> add
<package>`, then refresh the page. The running Host picks the bundle up through
profile HMR; the browser needs one refresh to load the footer action and page.

## First run

Open the profile and it enters the active identity's newest conversation
automatically (unless `autoOpen` is false). The sidebar lists the identities, and **Personal agent** opens
the manager page where identities are created and edited. The plugin creates:

```
<DSH_HOME>/profiles/<profile>/personal-agent/
├── home/                         legacy (first, id "default") identity's home
├── memory.md                     legacy identity's memory
├── identities/<id>/home/         every later identity's home
├── identities/<id>/memory.md     every later identity's memory
├── groups/<groupId>/home/        one group's hidden workspace
├── groups/<groupId>/transcript.json  the merged multi-agent group feed
├── groups.json                   groups and their participant Sessions
└── state.json                    identity → workspace id and last applied title
```

A home directory is also a Harness workspace, titled after the identity. The
bundle never lists it as a workspace; it exists so conversations have a private
directory to run in.

### How clicking an identity works

1. The identity module row (or the manager page's **Talk to …** button) asks the Host
   for the identity's home and newest non-archived Session.
2. If one exists, the browser opens it; otherwise it creates a blank Session in
   that home with the `personal` preset.
3. The browser auto-switches to a blank Session the agent creates with
   `new_conversation`, or the user creates with `/new`; the new Session's model
   context starts empty. A `new_conversation` Session keeps the earlier
   conversation in the identity's history; `/new` clears that history too.

### Projects and sessions

Project workspaces use the original UI unchanged: their session rows, search,
grouping, drag, archive, and New Session controls all stay. Identity homes need
a directory for their Sessions, so they exist in the workspace registry, but
their rows are filtered out of the shipped browser. They do not appear as
project groups.

### Where identities live

- **Identity module above the Workspace browser** shows the `身份` header and
  each identity's avatar, name, and role. Selecting an identity asks the Host
  for its newest conversation and returns the main area to it; the `＋` action
  opens the manager page. Agent-created fresh conversations are followed automatically, and a
  compact progress strip in the composer reports the active task and running
  Sessions.
- Identity homes are still ordinary workspaces underneath, but their workspace
  and session rows are filtered out of the shipped Workspace browser by the
  native `data-row-key`. The project workspace/session UI is otherwise exactly
  the shipped one.
- Project work keeps using the original Workspace/Session browser. There is no
  separate identity list replacing it, and no session-chrome hiding.

Identity conversations request the `personal` preset explicitly; project
conversations keep the profile default. The identity and memory prompt sections
are registered on an agent only when its working directory is inside an
identity's home, so project agents are untouched.

## Configuration

Identities are configuration, not a separate database, so they survive upgrades
and are visible in the profile patch. The manager page edits them through the
profile config editor:

```yaml
- id: personal-agent
  name: '@local/personal-agent'
  config:
    identities:
      - id: ada                 # stable slug; generated when omitted
        name: Ada               # prompt, brand, sidebar row, home title
        role: personal assistant
        userName: ''            # how this identity addresses you
        persona: ''             # free text appended to the identity
        accent: '#5b5bd6'       # avatar colour, #rrggbb
        avatar: ''              # one emoji/letter; empty = first letter of name
        home: ''                # default: legacy home/ or identities/<id>/home
        memoryFile: ''          # default: legacy memory.md or identities/<id>/memory.md
      - id: mira
        name: Mira
        role: coach
        userName: Techpod
        persona: Ask questions like a coach; keep answers short.
        accent: '#0f766e'
        avatar: ''
    memory:
      includeInPrompt: true     # include each identity's notes in every request
      maxBytes: 6000            # per-identity budget; remember refuses to overflow
    autoOpen: true              # false keeps a project conversation on refresh
```

Identity ids are lowercase letters, digits, and hyphens. Two identities cannot
share a home directory or a memory file; activation fails with both names.
`identities` must contain at least one entry.

### Migrating from 0.1

Version 0.1 stored a single `identity:` plus `home:` and `memory.file:`. This
version reads that shape as one identity with the reserved id `default`, keeping
its original `home/` and `memory.md` locations. The first save from the manager
page rewrites the row as `identities:`, so the upgrade is in place and loses
nothing.

## Memory

Each identity has its own Markdown note file, one note per line:

```
- 2026-11-19 · [preferences] — Likes oolong tea.
- 2026-11-19 · [work] — Builds DSH plugins.
```

- The agent calls **`remember`** to append a durable fact to the identity it is
  talking as; identical notes are deduplicated and an overflow is refused rather
  than silently dropping old notes.
- The agent calls **`recall`** to search that identity's notes before asking you
  something earlier conversations already answered.
- The manager page edits or prunes the selected identity's notes.
- The identity's memory section is registered on its own agent scope, so two
  identities talking at once never see each other's notes. Notes are not written
  into a session log.

The notes are user data, not secrets: credentials and tokens should never be
stored there. File and directory modes are user-only, and every browser route is
owner-admitted by the Harness connection service.

## Agent preset

The bundle declares a `personal` preset: the standard toolset minus
project-shaped pieces (no `AGENTS.md` loader, no code-review plan mode), with a
static persona that describes a personal agent rather than a coding agent. The
per-identity prompt section supplies the name, role, and boundaries.

`personal` is reserved for identity and group conversations. It is not a
selectable workspace mode:

- the bundle's Host half removes it from the `agentPresets/list` roster, so it
  never appears in the new-session chip or the settings list;
- selecting it (or creating a Session with it) for any working directory that
  is not an identity home or a group home is refused with
  `Personal 模式只用于个人身份会话，工作区会话不能使用。`;
- the bundle's deployment default is `standard`, and a workspace Session created
  without a named preset falls back to `standard` whenever the profile default
  would resolve to `personal`.

Opening an identity from the sidebar or manager still names the personal preset
explicitly; the identity and memory sections apply to every conversation in the
profile whichever preset it runs. A profile patch may pin another default for
workspace conversations; it cannot re-enable Personal there.

## Tools

| Tool | Purpose |
| --- | --- |
| `remember` | Append one durable fact to the calling identity's memory |
| `recall` | Search or read the calling identity's memory |
| `new_conversation` | Start a blank context after this turn; the earlier conversation stays in history |
| `message_identity` | Send a private 1:1 direct message to another identity and return its reply |
| `ask_identity` | Legacy groups only: let the host ask one guest identity for a reply |

They are registered at the profile's Host scope and resolve the identity from
the calling agent's working directory (nearest identity home wins). They are
visible only in identity conversations, not in project sessions.

### Starting a fresh conversation

`/new` is the human command for a clean start. Type it in a private identity
conversation and the Host creates a blank Session in that identity's home. The
browser opens the new Session first, then the Host archives the earlier private
conversations captured by the reset. If you leave before the switch, reopening
that identity opens the prepared conversation and finishes the reset. If the new
Session cannot open, the old history is kept. The command does not appear in
project, group, or subagent conversations. The new model context contains only
the identity prompt and long-term memory. Group and already archived Sessions
are left alone.

An identity agent can also call `new_conversation` when the user asks for a
fresh start or changes to an unrelated topic. The tool registers a request for
the end of the current turn; the Host then creates a blank Session in the
identity workspace. Unlike `/new`, this keeps the earlier conversation in the
identity's history. The new model context is empty except for the identity
prompt and long-term memory, and no previous transcript is shown in the new
conversation.

Anything that must survive the switch has to be in long-term memory. The
identity prompt tells the agent to call `remember` for durable preferences,
projects, and decisions (and never for secrets), and `new_conversation`'s note
reminds it before switching.

### Group chat

The identity module's **group** action (the two-person icon beside `＋`) opens a
picker: choose at least two identities and optionally name the group. There is
no host or moderator. Each selected identity gets its own independent Agent and
Session in the group's hidden workspace (`personal-agent/groups/<groupId>/`),
with its own persona, memory, and tools.

The group opens as a plugin-rendered feed instead of a single DSH Session. When
you send a message, the Host fans it out to every participant in parallel; each
one sees the user message plus the group history and replies as itself. A
message containing `@<name>` goes only to the named identities. Typing `@` in
the group composer opens a member picker above the input: it lists the group's
participants, narrows as you type, and inserts `@<name> ` when you press
`Enter`/`Tab`, click a row, or use `↑`/`↓` to choose. Replies are
written to the group transcript (`transcript.json`) as each participant's turn
ends and appear under that identity's avatar and name. The page polls the
transcript and marks participants that are still replying.

A message can also carry images. Use the picture button, paste an image into
the composer, or drop files onto it; up to six PNG/JPEG/WebP/GIF files are
accepted per message. The composer downscales a large image to fit the Host's
per-image budget before sending. The Host validates the bytes, stores them under
the group's own directory (`personal-agent/groups/<groupId>/images/`), shows
thumbnails in the feed, and passes the images to every addressed participant as
image parts of its prompt. Only the current message's images are attached to a
prompt; older images appear in later history as `[N 张图片]` so a long-running
group does not resend every past image.

Group rows appear under `群聊` in the identity module. Hover a row for the
rename (`✎`) and close (`×`) actions. Renaming updates the group name and its
hidden workspace title. Closing archives every participant Session and removes
the group workspace registration; the identities' own conversations are
untouched. Groups are archived, not deleted, so the Sessions remain in storage
for recovery.

Legacy host-and-guests groups created before this version keep their original
Session and `ask_identity` tool; they open as a normal Session. New groups use
the multi-agent feed. A legacy group Session is detached from the identity
workspace on the next Host start, so a group transcript can never be selected
as that identity's private conversation.

In a blank identity or group conversation the hero's shipped brand, workspace
picker, and preset picker are hidden. An identity shows its avatar and name; a
group shows its group name and a rename action. The active conversation header
uses the same rule: the session title and preset controls are hidden, and the
identity's avatar/name or the group name is shown instead. Project heroes and
headers are unchanged.

### Direct messages between identities

Every private identity conversation knows the other identities in the profile:
its prompt lists their names, ids, and roles, and explains how to reach them.
The `message_identity` tool starts one **private 1:1 message** — pass the other
identity's id or exact name and what you need:

- The target answers as itself. The Host runs a one-shot child in that
  identity's home, so its persona, memory, and tools apply, and returns the
  reply to the caller in the same turn. The caller can then tell the user what
  the other identity said. No group is created and no third identity sees the
  exchange.
- The pair's thread is saved under
  `<profile>/personal-agent/dms/<a>--<b>/transcript.json`, and the recent
  exchange is carried into the next direct message, so two identities can keep
  a conversation across calls. The file is bounded to the last 400 messages.
- The tool is not available in project sessions, inside a group (which already
  has its own channel), or inside the one-shot child that is answering a
  direct message. A direct message therefore cannot start an endless chain of
  agents messaging each other.
- One message is capped at 8,000 characters and one exchange at 180 seconds.
  There is no separate direct-message page yet: the human sees the relay in the
  caller's conversation, and the target's own conversation is untouched.

### Unread badges

Each identity and group row shows a red circle with the number of unread
assistant messages. The Host counts visible assistant replies for identity
Sessions and legacy group Sessions; a multi-agent group counts replies as they
are appended to its transcript. Opening and viewing an identity or group marks
it read, and the client refreshes the count while it stays visible. The counts
are in-process state, not persisted across a Host restart.

### Chat style and working bubble

Identity conversations use the same bubble layout as a group chat: your messages
sit in a right-aligned tinted bubble, and each agent reply is a left-aligned
bubble with the identity's avatar and name next to it. Project conversations
keep the shipped transcript, and group pages already render a bubble feed.

The reply stream fills the conversation pane the way the group chat page does:
the transcript column and the composer span the available width, so the feed
starts at the pane edge instead of sitting in a centred column, and your
right-aligned bubbles end at the opposite edge. Bubble width is relative rather
than a fixed cap: both the agent reply and your own message grow with the pane
but stop at 60% of the conversation width, so short messages stay compact and
long ones stay readable. Wide Markdown tables scroll inside the bubble rather
than spilling past its edge.

Tool calls, reasoning rows, retry notices, turn-process summaries, and turn
metadata are hidden by default. The `◎`/`◉` button in the identity module header
toggles that preference per browser; showing it brings the original work rows
back for inspection.

While an identity Session is running, a working bubble joins the end of the
transcript with the identity's avatar and a rotating line such as
`正在忙活…`, plus the active todo when one exists. It is part of the message
flow, not a panel floating over it: it scrolls away with the conversation, so
scrolling back never has it cover earlier messages, and it is only pulled into
view while the reader already follows the tail. It replaces the shipped running
indicator while work details are hidden. The full todo list remains the shipped
TodoPanel above the composer. Auto-switch only runs while an identity
conversation is on screen, never while a project conversation is focused.

## HTTP routes

All of these are owner-admitted by `connection.fetch` before the handler runs:

| Route | Purpose |
| --- | --- |
| `GET /api/personal-agent/state` | Identities, homes, memories, editable flag |
| `POST /api/personal-agent/identity` | Create or update one identity through the config editor |
| `PUT /api/personal-agent/memory` | Replace one identity's memory |
| `POST /api/personal-agent/open` | Return an identity's or project's newest Session (`identityId` or `workspaceId`) |
| `POST /api/personal-agent/identity/remove` | Remove an identity, archive its conversations, and move its data to `removed/` |
| `POST /api/personal-agent/group` | Start a multi-agent group (or a legacy host-and-guests group) |
| `POST /api/personal-agent/group/state` | Read a group transcript and participant status |
| `POST /api/personal-agent/group/send` | Fan one user message out to the addressed participants |
| `POST /api/personal-agent/group/remove` | Close a group, archive its Sessions, and remove its workspace |
| `POST /api/personal-agent/group/rename` | Rename a group and its workspace |

## Security and privacy

- No device-wide files, environment variables, or settings are written.
- Homes and memories live under `<DSH_HOME>/profiles/<profile>/personal-agent/`
  (or configured absolute paths), never under a shared location by default.
- Memory is plain text at rest. Encrypt the disk if the notes are sensitive.

## Development

```
personal-agent/
├── index.js              Host: per-agent prompts, tools, homes, routes
├── client.js             Browser: identity module, history, manager, progress, auto-switch
├── lib/identity.js       Config schema, validation, prompt composition
├── lib/paths.js          Per-identity home/memory locations and migration
├── lib/memory.js         Note format, search, atomic writes
├── cordis.patch.yml      Bundle layer: Host row, default preset, personal preset
├── locale/{en,zh}.json   Plugin Manager metadata
└── test/                 Node tests for identity, paths, and memory logic
```

Run the logic tests:

```bash
node --test personal-agent/test/
```

Verify a composed profile without starting it:

```bash
DSH_HOME=/tmp/pa-check dsh --profile check --from-default-profile web --dump-config >/dev/null
DSH_HOME=/tmp/pa-check dsh plugin --profile check add "$PWD/personal-agent"
DSH_HOME=/tmp/pa-check dsh --profile check --dump-config | grep -A4 'personal-agent'
```

## Known limits

- **Sessions still exist underneath.** The bundle hides the session list; older
  conversations are not surfaced in the UI. A future version may add an
  identity-scoped history for recovery.
- **Removal retains data.** Removing an identity archives its conversations and
  moves its home and memory under `personal-agent/removed/`; nothing is erased.
  Archived conversations remain visible through the project browser's Archived
  filter. The last identity may be removed; the module shows an empty state.
- **Project rows read the Client catalog.** Their history is populated from the
  browser's live session list, so a session the Host has not listed yet does not
  appear until the next catalog refresh.
- **The home is re-created.** Removing an identity's workspace from a UI only
  removes the registration; the next start registers the same directory again,
  because that is what makes it the identity's home.
- **Title changes are conservative.** A home follows the identity name only
  while its title is still one this plugin applied or the directory's own name;
  a title you renamed by hand is preserved.
- **The session-chrome hide is a compatibility shim.** See “What the client
  hides”. The shell's `session.new` keyboard command is still registered by the
  sidebar even though its button is hidden; pressing it creates a conversation
  in the current identity's home. The identity list then opens the newest
  conversation when clicked.
- **No global conversation search.** Project history is a per-project
  disclosure; the old full-text session search UI is not mounted.
- **New conversations are blank.** `new_conversation` creates an empty-context
  Session and keeps the old one in the identity history (`↺`); `/new` also
  archives that history. No previous transcript is shown in the new
  conversation or sent to the model. Durable information must be written with
  `remember`.
- **Quoted money is not a formula.** The shipped markdown reads a `$…$` pair
  as inline math, so a reply quoting prices (`$811.82 拿 18.5 单 … CPC $1.76`)
  rendered the sentence between the two dollar signs as one math span. Math
  does not wrap, so the sentence was clipped at the message column's edge when
  the column was narrow. Since 0.6.4 the browser half restores the author's
  text whenever the parsed TeX carries no command and holds Han characters;
  real formulas (`\\frac`, `\\text{…}`, or any TeX at all) are untouched.
- **Group replies are parallel, not streamed.** Every participant is prompted at
  the same time; each sees the user message and the history up to it, not the
  other participants' same-round replies. A reply appears in the feed when that
  participant's turn ends. A group supports two to four identities.
- **Groups are archived on close.** Closing removes the group from the list,
  archives every participant Session, and deletes the group workspace
  registration; it does not erase the Session logs or the group transcript.
- **Auto-switch is a client poll.** The browser checks the Host state roughly
  once a second while an identity conversation is focused. It only follows the
  pending fresh-conversation marker and waits until the current Session is idle.
  Project and group conversations are never auto-switched. Opening history
  suppresses the switch.
- **A profile patch cannot re-enable Personal for workspaces.** The default can
  be pinned, but the personal preset stays hidden and refused outside identity
  and group homes. Sessions already started under it keep it, because a
  composition cannot be swapped after the first turn.
- **The roster hide is host-side.** A client that read the roster before the
  plugin loaded keeps its copy until the next refresh.
- **External memory edits wait for a restart.** The page and the `remember` tool
  share the in-process cache; a hand-edited `memory.md` is read at the next
  start.
- **Not a security boundary.** A preset is a composition, not a sandbox; the
  plugin trusts the profile owner and the tools the profile mounts.