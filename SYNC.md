# Sync this machine's plugins into the repository

The installed DSH profile is the source of truth for what runs here; this repository
is the source of truth for what gets released. "Sync" means making the second match
the first, then publishing it.

Scope: every `@local/*` bundle installed in a profile — not the shipped
`@deepseek-ai/*` packages, which are not ours to publish.

## 1. Scan

```bash
cd /path/to/my-dsh-plugins
node scripts/scan.mjs                    # report; exit 1 when something differs
node scripts/scan.mjs --profile=web      # another profile
node scripts/scan.mjs --apply            # copy the installed files into the repo
```

The scanner compares each installed package under
`~/.dsh/profiles/<profile>/node_modules/@local/` with the repository directory that
declares the same package name, and reports four states:

| State | Meaning | Action |
| --- | --- | --- |
| `same` | bytes match | nothing |
| `changed` | files differ, or the package ships a file the repo lacks | copy, then bump + release |
| `new` | installed but not in the repo | add the directory, README rows, bump + release |
| `absent` | in the repo, not installed here | leave it, or note why |

`--apply` only copies and creates; it never deletes, so repository-only files such as
`test/` survive, and it never edits versions.

A version column like `0.2.0 -> 0.1.0` means the repo is *ahead* of the installed
package (a bump after the last install). That is expected; it is not a change to copy.

One blind spot: a `link:` install that points at a directory *inside* this repository
(for example `workspace-upload/`) is compared with itself and always reports `same`.
Review such a plugin's edits with `git status` / `git diff` instead.

## 2. Copy and review

After `--apply`, read `git diff`. Two rules that have bitten before:

- **`files` is an allowlist.** Every module the package imports must be listed in
  `files`, or `npm pack` ships a plugin that crashes on import. A `changed` state on
  `package.json` alone often means the installed package fixed such a list — take it.
- **The installed package may omit repository-only files** (tests, docs). Keep them
  and make sure they still pass against the new sources.

## 3. Verify

```bash
node --check <plugin>/index.js <plugin>/client.js   # or the files each plugin has
node --test test/                                   # when the plugin has tests
./scripts/pack.sh                                   # every package must build
tar tzf out/local-<name>-<version>.tgz              # imports present? docs present?
```

## 4. Versions and release

1. Bump every plugin whose content changed: patch for a fix, minor for a feature —
   `npm version patch --no-git-tag-version` inside the plugin directory, or edit
   `package.json`. A changed plugin with an unchanged version makes two different
   files share one asset name, so never skip this.
2. Update `README.md`: the table row(s), the install URL list and the CLI example.
   Point them at the next release tag and the new file names.
3. Commit, then tag the repository release (`v0.7.0`, …) and push `main` first, the
   tag second — a branch and its first tag in one push does not start the workflow:

   ```bash
   git push origin main
   git tag -a v0.7.0 -m "v0.7.0: ..." && git push origin v0.7.0
   ```

4. Watch CI and check the assets:

   ```bash
   curl -s https://api.github.com/repos/neilx2ye/my-dsh-plugins/actions/runs?per_page=1
   curl -s https://api.github.com/repos/neilx2ye/my-dsh-plugins/releases/latest
   curl -sIL -o /dev/null -w '%{http_code}\n' \
     https://github.com/neilx2ye/my-dsh-plugins/releases/download/v0.7.0/local-<name>-<version>.tgz
   ```

## Credentials

The repository remote is `git@github-dsh-plugins:neilx2ye/my-dsh-plugins.git`, backed
by the deploy key `~/.ssh/id_ed25519_dsh_plugins` (write access). `~/.ssh/config`
maps the `github-dsh-plugins` alias. Nothing else is needed to push.

## Concurrency

More than one DSH session can write into this checkout. Before committing, re-run
`git status`; if a plugin directory appeared or changed that this run did not touch,
validate it (`node --check`, its tests) and confirm with the user before releasing it.