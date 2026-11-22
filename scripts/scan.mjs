#!/usr/bin/env node
/**
 * Compare the `@local/*` plugins installed in a DSH profile with the plugin
 * source directories in this repository.
 *
 * The profile is the source of truth for what actually runs: every bundle in
 * `dsh.profile.bundles` is installed under `<profile>/node_modules/@local/`
 * (a packed tarball, `file:` tarball, or a `link:` to a working copy). This
 * script walks those packages, finds the repository directory that declares the
 * same package name, and reports files that differ, files the package ships but
 * the repository lacks, and plugins the repository does not carry yet.
 *
 * Usage:
 *   node scripts/scan.mjs                 report only
 *   node scripts/scan.mjs --apply         copy the package's version into the repo
 *   node scripts/scan.mjs --json          machine-readable report
 *   node scripts/scan.mjs --profile=web   profile name (default: $DSH_PROFILE or web)
 *   node scripts/scan.mjs --home=/x/.dsh  harness home (default: $DSH_HOME or ~/.dsh)
 *   node scripts/scan.mjs --repo=/path    repository root (default: this checkout)
 *
 * `--apply` copies files and creates missing plugin directories. It never
 * deletes: repository-only files such as `test/` stay. Version bumps, README
 * updates, tests, commits and tags stay manual — see SYNC.md.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directories that never take part in a plugin comparison. */
const SKIP_DIRS = new Set(['node_modules', '.git']);

/** A plugin whose package and repository copy carry the same bytes. */
const SAME = 'same';
/** A plugin that differs only by a version bump already made in the repository. */
const AHEAD = 'ahead';
/** A plugin whose package differs from its repository copy. */
const CHANGED = 'changed';
/** An installed plugin this repository does not carry yet. */
const NEW = 'new';
/** A repository plugin this profile does not have installed. */
const ABSENT = 'absent';

/**
 * Read one command-line flag with `--name=value` syntax.
 * @param argv - process arguments.
 * @param name - flag name without dashes.
 * @returns the value, or undefined.
 */
function flag(argv, name) {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
}

/**
 * Read one package.json, or undefined when it is missing or unreadable.
 * @param path - absolute path.
 * @returns parsed manifest, or undefined.
 */
async function manifest(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Whether a directory entry is a regular file.
 * @param path - absolute path.
 * @returns whether the path is a file.
 */
async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * List every regular file under a directory, relative to it.
 * @param root - absolute directory.
 * @param prefix - relative prefix for recursion.
 * @returns sorted relative paths using forward slashes.
 */
async function listFiles(root, prefix = '') {
  const found = [];
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...(await listFiles(root, rel)));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      found.push(rel);
    }
  }
  return found.sort();
}

/**
 * Hash one file so equal bytes compare cheaply.
 * @param path - absolute path.
 * @returns hex sha1, or undefined when unreadable.
 */
async function hash(path) {
  try {
    return createHash('sha1').update(await readFile(path)).digest('hex');
  } catch {
    return undefined;
  }
}

/**
 * Whether two manifests are equal apart from their version.
 * @param installed - installed manifest.
 * @param repo - repository manifest.
 * @returns whether only the version field differs.
 */
function onlyVersionDiffers(installed, repo) {
  if (installed === undefined || repo === undefined) return false;
  const strip = (value) => {
    const { version: _version, ...rest } = value;
    return rest;
  };
  return JSON.stringify(strip(installed)) === JSON.stringify(strip(repo));
}

/**
 * Compare two plugin directories file by file.
 * @param installedDir - directory of the installed package.
 * @param repoDir - directory of the repository copy.
 * @returns changed, installed-only, and repository-only relative paths.
 */
async function compare(installedDir, repoDir) {
  const installed = await listFiles(installedDir);
  const repo = new Set(await listFiles(repoDir));
  const changed = [];
  const onlyInstalled = [];
  for (const rel of installed) {
    repo.delete(rel);
    if (!(await isFile(join(repoDir, rel)))) {
      onlyInstalled.push(rel);
      continue;
    }
    const [left, right] = await Promise.all([hash(join(installedDir, rel)), hash(join(repoDir, rel))]);
    if (left !== right) changed.push(rel);
  }
  return { changed, onlyInstalled, onlyRepo: [...repo].sort() };
}

/**
 * Collect every installed `@local/*` plugin of one profile.
 * @param profileDir - absolute profile directory.
 * @returns name, version, and resolved package directory.
 */
async function installedPlugins(profileDir) {
  const root = join(profileDir, 'node_modules', '@local');
  const plugins = [];
  let entries;
  try {
    entries = await readdir(root);
  } catch {
    return plugins;
  }
  for (const entry of entries.sort()) {
    const path = join(root, entry);
    const pkg = await manifest(join(path, 'package.json'));
    if (pkg?.name === undefined) continue;
    let real = path;
    try {
      real = await realpath(path);
    } catch {
      // A broken link still reports the declared package name.
    }
    plugins.push({ name: pkg.name, version: pkg.version ?? '0.0.0', dir: real });
  }
  return plugins;
}

/**
 * Map package name to repository directory.
 * @param repo - absolute repository root.
 * @returns name -> { dir, version } for every top-level plugin.
 */
async function repoPlugins(repo) {
  const map = new Map();
  for (const entry of await readdir(repo, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const dir = join(repo, entry.name);
    const pkg = await manifest(join(dir, 'package.json'));
    if (pkg?.name === undefined || pkg.dsh?.bundle === undefined) continue;
    map.set(pkg.name, { dir, version: pkg.version ?? '0.0.0', directory: entry.name });
  }
  return map;
}

/**
 * Copy one plugin's package content into its repository directory.
 * @param source - installed package directory.
 * @param target - repository directory.
 * @param files - relative paths to copy; undefined copies the whole package.
 */
async function apply(source, target, files) {
  await mkdir(target, { recursive: true });
  for (const rel of files ?? (await listFiles(source))) {
    const destination = join(target, rel);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(source, rel), destination, { preserveTimestamps: true });
  }
}

/** Entry point. */
async function main() {
  const argv = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(flag(argv, 'repo') ?? join(here, '..'));
  const home = resolve(flag(argv, 'home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const profile = flag(argv, 'profile') ?? process.env.DSH_PROFILE ?? 'web';
  const profileDir = resolve(flag(argv, 'profile-dir') ?? join(home, 'profiles', profile));
  const applyChanges = argv.includes('--apply');
  const json = argv.includes('--json');

  const installed = await installedPlugins(profileDir);
  const repository = await repoPlugins(repo);
  const report = [];

  for (const plugin of installed) {
    const target = repository.get(plugin.name);
    if (target === undefined) {
      const directory = plugin.name.replace(/^@[^/]+\//, '');
      report.push({ ...plugin, status: NEW, directory, files: [] });
      if (applyChanges) {
        await apply(plugin.dir, join(repo, directory));
        repository.set(plugin.name, { dir: join(repo, directory), version: plugin.version, directory });
      }
      continue;
    }
    repository.delete(plugin.name);
    const diff = await compare(plugin.dir, target.dir);
    const files = [...diff.changed, ...diff.onlyInstalled];
    const repoPkg = await manifest(join(target.dir, 'package.json'));
    const installedPkg = await manifest(join(plugin.dir, 'package.json'));
    const ahead = files.length === 1 && files[0] === 'package.json' && onlyVersionDiffers(installedPkg, repoPkg);
    const status = files.length === 0 ? SAME : ahead ? AHEAD : CHANGED;
    report.push({
      ...plugin,
      status,
      directory: target.directory,
      versionRepo: target.version,
      files,
      onlyRepo: diff.onlyRepo,
    });
    if (applyChanges && status === CHANGED) await apply(plugin.dir, target.dir, files);
  }

  for (const [name, target] of repository) {
    report.push({ name, version: undefined, status: ABSENT, directory: target.directory, versionRepo: target.version, files: [] });
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const order = [NEW, CHANGED, AHEAD, ABSENT, SAME];
    for (const status of order) {
      for (const row of report.filter((item) => item.status === status)) {
        const versions =
          row.versionRepo === undefined || row.versionRepo === row.version
            ? row.version ?? ''
            : `${row.versionRepo} -> ${row.version}`;
        console.log(`${status.padEnd(7)} ${row.name.padEnd(28)} ${versions.padEnd(14)} ${row.directory}/`);
        for (const rel of row.files) console.log(`          ${rel}`);
      }
    }
    const count = (status) => report.filter((item) => item.status === status).length;
    console.log(
      `\n${installed.length} installed in ${profileDir}, ${report.length} compared: ` +
        `${count(NEW)} new, ${count(CHANGED)} changed, ${count(AHEAD)} ahead of this profile, ` +
        `${count(ABSENT)} absent from this profile, ${count(SAME)} in sync.`,
    );
    if (applyChanges) console.log('Applied: package files copied into the repository (no deletions, no version bumps).');
  }

  const pending = report.some((item) => item.status === NEW || item.status === CHANGED);
  process.exitCode = applyChanges ? 0 : pending ? 1 : 0;
}

await main();