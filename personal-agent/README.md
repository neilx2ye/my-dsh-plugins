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
| Tools | — | `remember` and `recall`, only visible inside identity homes |

The Harness data model still binds sessions to a directory, so each identity has
one workspace underneath. It is presentation, not deletion: the Workspace
browser is replaced, the session rows are gone, and the model is told that its
directory is its home rather than a project the user must manage.

## Install

The bundle is a normal `dsh.bundle` package. Install it into a profile:

```bash
# 1. Create a profile from the shipped web template (once).
dsh --profile personal --from-default-profile web --dump-config >/dev/null

# 2. Install this bundle. The CLI adds it to dsh.profile.bundles as well.
dsh plugin --profile personal add /path/to/personal-agent   # or a release .tgz URL

# 3. Start it.
dsh --profile personal
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
3. The original workspace/session browser may expand the identity's workspace to
   show that conversation; that is the shipped UI, not a replacement.

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
  opens the manager page.
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

The preset becomes the profile default when the profile patch does not pin
another preset. A profile that already pins a default keeps it, because the
user's profile patch applies after bundle layers. In that case, opening an
identity from the sidebar or manager still names the personal preset
explicitly; the identity and memory sections apply to every conversation in the
profile whichever preset it runs.

## Tools

| Tool | Purpose |
| --- | --- |
| `remember` | Append one durable fact to the calling identity's memory |
| `recall` | Search or read the calling identity's memory |

Both are registered at the profile's Host scope and resolve the identity from
the calling agent's working directory (nearest identity home wins), falling back
to the first identity when a session runs outside every home.

## HTTP routes

All four are owner-admitted by `connection.fetch` before the handler runs:

| Route | Purpose |
| --- | --- |
| `GET /api/personal-agent/state` | Identities, homes, memories, editable flag |
| `POST /api/personal-agent/identity` | Create or update one identity through the config editor |
| `PUT /api/personal-agent/memory` | Replace one identity's memory |
| `POST /api/personal-agent/open` | Return an identity's or project's newest Session (`identityId` or `workspaceId`) |

## Security and privacy

- No device-wide files, environment variables, or settings are written.
- Homes and memories live under `<DSH_HOME>/profiles/<profile>/personal-agent/`
  (or configured absolute paths), never under a shared location by default.
- Memory is plain text at rest. Encrypt the disk if the notes are sensitive.

## Development

```
personal-agent/
├── index.js              Host: per-agent prompts, tools, homes, routes
├── client.js             Browser: sidebar identity list, manager page, brand
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
- **Identity history is not surfaced.** Each identity row opens its newest
  non-archived conversation; older identity conversations remain in session
  storage but are not listed. Project history covers existing project work.
- **Preset default can be pinned.** See “Agent preset” above.
- **External memory edits wait for a restart.** The page and the `remember` tool
  share the in-process cache; a hand-edited `memory.md` is read at the next
  start.
- **Not a security boundary.** A preset is a composition, not a sandbox; the
  plugin trusts the profile owner and the tools the profile mounts.