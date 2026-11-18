/**
 * Run one child process through the Host `ctx.subprocess` contract and collect
 * its output. Deliberately free of Harness imports so the module stays testable
 * with a plain Node process.
 */

import { StringDecoder } from 'node:string_decoder';

/** How long a killed process may take to flush and exit before the provider escalates. */
const GRACE_MS = 1500;

/**
 * Run a program with the given arguments and capture stdout/stderr as text.
 * @param options.subprocess - the Host subprocess service.
 * @param options.argv - program and arguments; argv[0] resolves on PATH.
 * @param options.cwd - working directory for the child.
 * @param options.env - extra environment variables layered over the Host environment.
 * @param options.timeoutMs - wall-clock limit before the child is terminated.
 * @param options.maxOutputBytes - ceiling for captured stdout plus stderr.
 * @param options.signal - cancellation; aborting terminates the child.
 * @returns exit facts and captured output.
 */
export async function runProcess(options) {
  const { subprocess, argv, cwd, env, timeoutMs, maxOutputBytes, signal } = options;
  const handle = subprocess.spawn({
    argv,
    cwd,
    ...(env === undefined ? {} : { env: { ...env } }),
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: GRACE_MS,
    signal,
  });

  const state = { captured: 0, truncated: false, output: '', stderr: '' };
  const capture = (channel, text) => {
    if (text === '') return;
    state.captured += Buffer.byteLength(text);
    if (state.captured > maxOutputBytes) {
      state.truncated = true;
      return;
    }
    if (channel === 'stdout') state.output += text;
    else state.stderr += text;
  };

  const pump = (stream, channel) => {
    return new Promise((resolve) => {
      if (stream === undefined) {
        resolve();
        return;
      }
      const decoder = new StringDecoder('utf8');
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        const tail = decoder.end();
        if (tail !== '') capture(channel, tail);
        resolve();
      };
      stream.on('data', (chunk) => {
        capture(channel, decoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
      });
      stream.on('end', finish);
      stream.on('error', finish);
      stream.on('close', finish);
    });
  };

  const pumps = [pump(handle.stdout, 'stdout'), pump(handle.stderr, 'stderr')];

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      handle.terminate();
    } catch {}
  }, timeoutMs);

  let outcome;
  try {
    outcome = await handle.done;
  } catch (error) {
    outcome = { exitCode: null, signal: null, failure: error };
  }
  clearTimeout(timer);
  await Promise.all(pumps);

  return {
    exitCode: typeof outcome.exitCode === 'number' ? outcome.exitCode : null,
    signal: typeof outcome.signal === 'string' ? outcome.signal : null,
    timedOut,
    truncated: state.truncated,
    output: state.output,
    stderr: state.stderr,
    failure: outcome.failure,
  };
}

/** Strip ANSI control sequences so terminal output stays readable in a panel. */
export function stripAnsi(text) {
  return String(text).replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

/**
 * Keep the last lines of one output stream within a character budget.
 * @param text - raw combined output.
 * @param maxChars - maximum characters retained.
 * @returns a trimmed tail.
 */
export function tailText(text, maxChars = 6000) {
  const clean = stripAnsi(text).trim();
  if (clean.length <= maxChars) return clean;
  return `…\n${clean.slice(clean.length - maxChars)}`;
}