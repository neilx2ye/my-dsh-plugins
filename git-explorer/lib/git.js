/**
 * Read-only Git inspection for one Workspace directory.
 *
 * This module is deliberately free of Harness imports. It drives only the
 * `ctx.subprocess` contract (`spawn`, stdout/stderr streams, `done`) so the
 * same parser can be exercised with a plain Node process.
 */

import { StringDecoder } from 'node:string_decoder';

/** A commit reading command may return a large branch or log listing; cap it. */
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
/** Diagnostics are only used to classify a failure. */
const MAX_STDERR_BYTES = 256 * 1024;
/** Branches retained per local/remote class before the UI is told it is capped. */
const MAX_BRANCHES_PER_KIND = 100;
/** Changed-file rows shown before the UI is told the working tree is capped. */
const MAX_CHANGES = 200;
/** Longest unified diff retained for the hover card. */
const MAX_DIFF_CHARS = 180_000;
/** Longest commit message accepted from the panel. */
const MAX_COMMIT_MESSAGE = 5000;
/** The null device `git diff --no-index` reads an untracked file against. */
const NULL_PATH = process.platform === 'win32' ? 'NUL' : '/dev/null';
/** Largest commit page the browser may request. */
export const MAX_COMMIT_LIMIT = 100;
/** Default page size when the row has no config. */
export const DEFAULT_COMMIT_LIMIT = 24;
/** Default time one inspection may take before the child is terminated. */
export const DEFAULT_TIMEOUT_MS = 12_000;
/** Default time a commit may take, including repository hooks. */
export const DEFAULT_COMMIT_TIMEOUT_MS = 30_000;

/** One field separator shared by every `--format` invocation. */
const FS = '\x1f';

/** A Git command that could not be classified as an empty repository. */
export class GitCommandError extends Error {
  /**
   * @param {string} message - human-readable summary.
   * @param {string} stderr - captured diagnostics.
   */
  constructor(message, stderr) {
    super(message);
    this.name = 'GitCommandError';
    this.stderr = stderr;
  }
}

/**
 * Normalize the row's config without an external schema dependency.
 * @param {unknown} raw - the Loader row's `config` value.
 * @returns normalized settings.
 */
export function readSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    limit: readInteger(source.limit, DEFAULT_COMMIT_LIMIT, 'limit', 1, MAX_COMMIT_LIMIT),
    timeoutMs: readInteger(source.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', 1000, 60_000),
    commitTimeoutMs: readInteger(source.commitTimeoutMs, DEFAULT_COMMIT_TIMEOUT_MS, 'commitTimeoutMs', 1000, 120_000),
  };
}

/**
 * Read one bounded integer config field.
 * @param {unknown} value - raw value; absent means the default.
 * @param {number} fallback - value used when absent.
 * @param {string} field - field name used in the error.
 * @param {number} min - smallest accepted value.
 * @param {number} max - largest accepted value.
 * @returns the accepted value.
 */
function readInteger(value, fallback, field, min, max) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`git-explorer: config.${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Inspect one Workspace directory.
 * @param {object} options - inspection request.
 * @param {object} options.subprocess - Host subprocess service.
 * @param {string} options.workspaceId - registered Workspace identity echoed to the browser.
 * @param {string} options.cwd - canonical Workspace directory.
 * @param {string | undefined} options.ref - branch requested by the browser, or undefined for HEAD.
 * @param {number} options.limit - maximum commits to return.
 * @param {AbortSignal} options.signal - request lifetime and overall inspection timeout.
 * @returns {Promise<{ ok: true, value: object } | { ok: false, code: string, message: string }>}
 */
export async function inspectWorkspaceGit({ subprocess, workspaceId, cwd, ref, limit, signal }) {
  const probe = await runGit(subprocess, cwd, ['rev-parse', '--show-toplevel', '--is-inside-work-tree'], signal);
  const probeLines = probe.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (probe.code !== 0 || probeLines[probeLines.length - 1] !== 'true') {
    return {
      ok: true,
      value: {
        workspaceId,
        path: cwd,
        isRepo: false,
        reason: 'not-a-repository',
      },
    };
  }
  const root = probeLines[0] ?? cwd;

  const [localResult, remoteResult, headResult, statusResult] = await Promise.all([
    runGit(
      subprocess,
      cwd,
      [
        'for-each-ref',
        `--format=%(HEAD)${FS}%(refname:short)${FS}%(committerdate:iso-strict)${FS}%(subject)`,
        '--sort=-committerdate',
        `--count=${MAX_BRANCHES_PER_KIND + 1}`,
        'refs/heads',
      ],
      signal,
    ),
    runGit(
      subprocess,
      cwd,
      [
        'for-each-ref',
        `--format=%(refname:short)${FS}%(committerdate:iso-strict)${FS}%(subject)`,
        '--sort=-committerdate',
        `--count=${MAX_BRANCHES_PER_KIND + 1}`,
        'refs/remotes',
      ],
      signal,
    ),
    runGit(subprocess, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal),
    runGit(subprocess, cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal),
  ]);

  const head = headResult.code === 0 ? headResult.stdout.trim() || null : null;
  let local = parseBranchRows(localResult.stdout, false);
  let remote = parseBranchRows(remoteResult.stdout, true);
  const branchesTruncated = local.length > MAX_BRANCHES_PER_KIND || remote.length > MAX_BRANCHES_PER_KIND;
  if (local.length > MAX_BRANCHES_PER_KIND) local = local.slice(0, MAX_BRANCHES_PER_KIND);
  if (remote.length > MAX_BRANCHES_PER_KIND) remote = remote.slice(0, MAX_BRANCHES_PER_KIND);

  const branches = [...local, ...remote];
  for (const branch of branches) branch.current = branch.name === head;
  branches.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    if (left.remote !== right.remote) return left.remote ? 1 : -1;
    return compareDatesDescending(left.date, right.date);
  });

  const requestedRef = typeof ref === 'string' && ref.trim() !== '' ? ref.trim() : undefined;
  if (requestedRef !== undefined && requestedRef !== 'HEAD' && !branches.some((branch) => branch.name === requestedRef)) {
    return { ok: false, code: 'unknown-ref', message: `unknown branch: ${requestedRef}` };
  }
  const selectedRef = requestedRef ?? head ?? 'HEAD';

  const logResult = await runGit(
    subprocess,
    cwd,
    [
      'log',
      `--max-count=${limit + 1}`,
      '--date-order',
      `--pretty=format:%H${FS}%h${FS}%an${FS}%ae${FS}%aI${FS}%s${FS}%D`,
      selectedRef,
      '--',
    ],
    signal,
  );

  let commits = [];
  if (logResult.code === 0) {
    commits = parseCommitRows(logResult.stdout);
  } else if (!isUnbornHead(logResult.stderr)) {
    throw new GitCommandError(
      `git log ${selectedRef} failed`,
      firstLine(logResult.stderr) || firstLine(logResult.stdout) || `exit code ${logResult.code}`,
    );
  }

  const hasMore = commits.length > limit;
  if (hasMore) commits = commits.slice(0, limit);

  let headShort = null;
  if (head === null) {
    const shortResult = await runGit(subprocess, cwd, ['rev-parse', '--short', 'HEAD'], signal);
    if (shortResult.code === 0) headShort = shortResult.stdout.trim() || null;
  }

  const allChanges = statusResult.code === 0 ? parseChangeRows(statusResult.stdout) : [];
  const changesTruncated = allChanges.length > MAX_CHANGES || statusResult.stdoutTruncated === true;
  const changes = allChanges.slice(0, MAX_CHANGES);
  const dirtyFiles = changes.length;

  return {
    ok: true,
    value: {
      workspaceId,
      path: cwd,
      root,
      isRepo: true,
      head,
      headShort,
      detached: head === null && headShort !== null,
      selectedRef,
      branches,
      branchesTruncated,
      commits,
      hasMore,
      dirtyFiles,
      changes,
      changesTruncated,
    },
  };
}

/**
 * Stage all working-tree changes and create one commit.
 * @param {object} options - commit request.
 * @param {object} options.subprocess - Host subprocess service.
 * @param {string} options.cwd - canonical Workspace directory.
 * @param {string} options.message - commit message.
 * @param {AbortSignal} options.signal - request lifetime and overall timeout.
 * @returns {Promise<{ ok: true, value: object } | { ok: false, code: string, message: string }>}
 */
export async function commitWorkingTree({ subprocess, cwd, message, signal }) {
  if (typeof message !== 'string' || message.trim() === '' || message.includes('\0') || message.length > MAX_COMMIT_MESSAGE) {
    return { ok: false, code: 'invalid-message', message: `commit message must be 1–${MAX_COMMIT_MESSAGE} characters` };
  }
  const text = message.trim();

  const top = await runGit(subprocess, cwd, ['rev-parse', '--show-toplevel'], signal);
  if (top.code !== 0) {
    return { ok: false, code: 'not-a-repository', message: 'the workspace is not a Git repository' };
  }
  const root = top.stdout.trim() || cwd;

  const status = await runGit(subprocess, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal);
  if (status.code !== 0) {
    throw new GitCommandError('git status failed', firstLine(status.stderr) || `exit code ${status.code}`);
  }
  const changes = parseChangeRows(status.stdout);
  if (changes.length === 0) {
    return { ok: false, code: 'nothing-to-commit', message: 'there are no changes to commit' };
  }

  const add = await runGit(subprocess, root, ['add', '--all'], signal);
  if (add.code !== 0) {
    throw new GitCommandError('git add failed', firstLine(add.stderr) || firstLine(add.stdout) || `exit code ${add.code}`);
  }

  const commit = await runGit(subprocess, root, ['commit', '-m', text], signal);
  if (commit.code !== 0) {
    throw new GitCommandError(
      'git commit failed',
      firstLine(commit.stderr) || firstLine(commit.stdout) || `exit code ${commit.code}`,
    );
  }

  let sha = null;
  let subject = null;
  const summary = await runGit(subprocess, root, ['log', '-1', '--pretty=format:%h%x1f%s'], signal);
  if (summary.code === 0) {
    const [short, ...rest] = summary.stdout.split(FS);
    sha = short?.trim() || null;
    subject = rest.join(FS).trim() || null;
  }

  return {
    ok: true,
    value: {
      sha,
      subject,
      files: changes.length,
    },
  };
}

/**
 * Read one changed file's unified diff for the hover card.
 * @param {object} options - diff request.
 * @param {object} options.subprocess - Host subprocess service.
 * @param {string} options.cwd - canonical Workspace directory.
 * @param {string} options.path - repository-relative changed path.
 * @param {string | undefined} options.oldPath - rename source, when the browser knows it.
 * @param {AbortSignal} options.signal - request lifetime and overall timeout.
 * @returns {Promise<{ ok: true, value: object } | { ok: false, code: string, message: string }>}
 */
export async function readWorkingTreeDiff({ subprocess, cwd, path, oldPath, signal }) {
  const normalized = normalizeChangedPath(path);
  if (normalized === null) {
    return { ok: false, code: 'invalid-path', message: 'path must be repository-relative' };
  }
  const normalizedOld = typeof oldPath === 'string' && oldPath !== '' ? normalizeChangedPath(oldPath) : null;
  if (typeof oldPath === 'string' && oldPath !== '' && normalizedOld === null) {
    return { ok: false, code: 'invalid-path', message: 'oldPath must be repository-relative' };
  }

  const top = await runGit(subprocess, cwd, ['rev-parse', '--show-toplevel'], signal);
  const root = top.code === 0 ? top.stdout.trim() || cwd : cwd;
  const statusArgs = ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--'];
  if (normalizedOld !== null) statusArgs.push(pathSpec(normalizedOld));
  statusArgs.push(pathSpec(normalized));
  const status = await runGit(subprocess, root, statusArgs, signal);
  if (status.code !== 0) {
    return { ok: false, code: 'git-failed', message: firstLine(status.stderr) || 'git status failed' };
  }

  const change = parseChangeRows(status.stdout).find((row) => row.path === normalized);
  if (change === undefined) {
    return { ok: false, code: 'not-changed', message: 'the file has no uncommitted change' };
  }

  let diff = '';
  let truncated = false;

  if (change.untracked) {
    const result = await runGit(
      subprocess,
      root,
      ['diff', '--no-color', '--unified=3', '--no-index', '--', NULL_PATH, normalized],
      signal,
    );
    if (result.code !== 0 && result.code !== 1) {
      throw new GitCommandError('git diff --no-index failed', firstLine(result.stderr) || `exit code ${result.code}`);
    }
    diff = result.stdout;
    truncated = result.stdoutTruncated === true;
  } else {
    const head = await runGit(subprocess, root, ['rev-parse', '--verify', '--quiet', 'HEAD'], signal);
    if (head.code === 0) {
      const args = ['diff', '--no-color', '--unified=3', 'HEAD', '--'];
      if (change.oldPath !== null) args.push(pathSpec(change.oldPath));
      args.push(pathSpec(normalized));
      const result = await runGit(subprocess, root, args, signal);
      if (result.code !== 0 && result.code !== 1) {
        throw new GitCommandError('git diff failed', firstLine(result.stderr) || `exit code ${result.code}`);
      }
      diff = result.stdout;
      truncated = result.stdoutTruncated === true;
    } else {
      const [cached, worktree] = await Promise.all([
        runGit(subprocess, root, ['diff', '--no-color', '--unified=3', '--cached', '--', pathSpec(normalized)], signal),
        runGit(subprocess, root, ['diff', '--no-color', '--unified=3', '--', pathSpec(normalized)], signal),
      ]);
      for (const result of [cached, worktree]) {
        if (result.code !== 0 && result.code !== 1) {
          throw new GitCommandError('git diff failed', firstLine(result.stderr) || `exit code ${result.code}`);
        }
        diff += result.stdout;
        truncated = truncated || result.stdoutTruncated === true;
      }
    }
  }

  if (diff.length > MAX_DIFF_CHARS) {
    diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n…`;
    truncated = true;
  }

  return {
    ok: true,
    value: {
      path: normalized,
      oldPath: change.oldPath,
      status: change.status,
      kind: change.kind,
      untracked: change.untracked,
      diff,
      truncated,
    },
  };
}

/**
 * Reject an absolute, traversal, or malformed diff path.
 * @param {string} path - browser-supplied path.
 * @returns the accepted path, or null.
 */
function normalizeChangedPath(path) {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) return null;
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return null;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return path;
}

/**
 * Build a literal Git pathspec so a filename's glob characters stay literal.
 * @param {string} path - repository-relative path.
 * @returns the `:(literal)` pathspec.
 */
function pathSpec(path) {
  return `:(literal)${path}`;
}

/**
 * Parse `git status --porcelain=v1 -z` records.
 * Rename and copy records carry their old path in the following NUL token.
 * @param {string} text - command stdout.
 * @returns {Array<{ path: string, oldPath: string | null, status: string, kind: string, untracked: boolean, staged: boolean, unstaged: boolean }>}
 */
function parseChangeRows(text) {
  const tokens = text.split('\0');
  const changes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.length < 3) continue;
    const status = token.slice(0, 2);
    const path = token.slice(3);
    if (path === '') continue;
    let oldPath = null;
    if (status.includes('R') || status.includes('C')) {
      oldPath = tokens[index + 1] ?? null;
      index += 1;
    }
    changes.push({
      path,
      oldPath: oldPath === '' ? null : oldPath,
      status,
      kind: changeKind(status),
      untracked: status === '??',
      staged: status[0] !== ' ' && status[0] !== '?',
      unstaged: status[1] !== ' ' && status[1] !== '?',
    });
  }
  return changes;
}

/**
 * Classify one porcelain status pair for the file row badge.
 * @param {string} status - two-character porcelain status.
 * @returns the display kind.
 */
function changeKind(status) {
  if (status === '??') return 'untracked';
  if (status.includes('U') || status === 'AA' || status === 'DD') return 'conflict';
  if (status.includes('R')) return 'renamed';
  if (status.includes('C')) return 'copied';
  if (status.includes('D')) return 'deleted';
  if (status.includes('A')) return 'added';
  return 'modified';
}

/**
 * Run one bounded Git command from a directory.
 * @param {object} subprocess - Host subprocess service.
 * @param {string} cwd - working directory.
 * @param {readonly string[]} args - arguments after `git`.
 * @param {AbortSignal} signal - cancellation for the child.
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, stdoutTruncated: boolean, stderrTruncated: boolean, failure?: unknown }>}
 */
async function runGit(subprocess, cwd, args, signal) {
  const handle = subprocess.spawn({
    argv: ['git', '--no-pager', ...args],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
    graceMs: 1500,
    signal,
  });

  const outcomePromise = handle.done.then(
    (outcome) => ({ exitCode: outcome.exitCode, signal: outcome.signal, failure: undefined }),
    (error) => ({ exitCode: null, signal: null, failure: error }),
  );
  const [outcome, stdout, stderr] = await Promise.all([
    outcomePromise,
    collectStream(handle.stdout, MAX_STDOUT_BYTES),
    collectStream(handle.stderr, MAX_STDERR_BYTES),
  ]);

  return {
    code: outcome.exitCode,
    signal: outcome.signal,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    failure: outcome.failure,
  };
}

/**
 * Decode one output stream, draining it even after the retained byte budget is spent.
 * @param {NodeJS.ReadableStream | undefined} stream - provider output stream.
 * @param {number} limit - retained UTF-8 byte ceiling.
 * @returns {Promise<{ text: string, truncated: boolean }>}
 */
function collectStream(stream, limit) {
  return new Promise((resolve) => {
    if (stream === undefined || stream === null) {
      resolve({ text: '', truncated: false });
      return;
    }
    const decoder = new StringDecoder('utf8');
    let text = '';
    let retained = 0;
    let truncated = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const tail = decoder.end();
      if (!truncated && tail !== '') text += tail;
      resolve({ text, truncated });
    };
    stream.on('data', (chunk) => {
      if (truncated) return;
      const decoded = decoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      const bytes = Buffer.byteLength(decoded);
      if (retained + bytes > limit) {
        truncated = true;
        return;
      }
      retained += bytes;
      text += decoded;
    });
    stream.on('end', finish);
    stream.on('error', finish);
    stream.on('close', finish);
  });
}

/**
 * Parse `for-each-ref` rows separated by newlines.
 * @param {string} text - command stdout.
 * @param {boolean} remote - whether the rows came from `refs/remotes`.
 * @returns {Array<{ name: string, remote: boolean, current: boolean, date: string | null, subject: string }>}
 */
function parseBranchRows(text, remote) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const fields = line.split(FS);
    const name = (remote ? fields[0] : fields[1] ?? '').trim();
    if (name === '') continue;
    if (remote && (name.endsWith('/HEAD') || name.includes(' -> '))) continue;
    rows.push({
      name,
      remote,
      current: !remote && (fields[0] ?? '').trim() === '*',
      date: (remote ? fields[1] : fields[2])?.trim() || null,
      subject: remote ? (fields[2] ?? '') : (fields[3] ?? ''),
    });
  }
  return rows;
}

/**
 * Parse `git log` rows separated by newlines.
 * @param {string} text - command stdout.
 * @returns {Array<{ hash: string, shortHash: string, author: string, email: string, date: string, subject: string, refs: string[] }>}
 */
function parseCommitRows(text) {
  const commits = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const fields = line.split(FS);
    const hash = (fields[0] ?? '').trim();
    if (hash === '') continue;
    commits.push({
      hash,
      shortHash: (fields[1] ?? hash.slice(0, 7)).trim(),
      author: fields[2] ?? '',
      email: fields[3] ?? '',
      date: fields[4] ?? '',
      subject: fields[5] ?? '',
      refs: (fields[6] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== ''),
    });
  }
  return commits;
}

/**
 * Whether Git failed because the selected branch has no commit yet.
 * @param {string} stderr - captured diagnostics.
 * @returns true for the known unborn/empty repository errors.
 */
function isUnbornHead(stderr) {
  return /does not have any commits yet|bad revision|unknown revision|ambiguous argument|bad object|needed a single revision/i.test(stderr);
}

/**
 * Sort ISO instants newest first, with missing dates last.
 * @param {string | null} left - left instant.
 * @param {string | null} right - right instant.
 * @returns comparison number.
 */
function compareDatesDescending(left, right) {
  const leftTime = left === null ? 0 : Date.parse(left);
  const rightTime = right === null ? 0 : Date.parse(right);
  return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
}

/**
 * First non-empty line of diagnostics.
 * @param {string} text - captured stdout or stderr.
 * @returns a single line, or an empty string.
 */
function firstLine(text) {
  return text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
}