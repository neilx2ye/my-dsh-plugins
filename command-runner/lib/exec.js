/**
 * One shell command, streamed back to the caller as it runs.
 *
 * The module is deliberately free of Harness imports: it drives only the
 * `ctx.subprocess` contract (`spawn`, `stdout`, `stderr`, `done`, `terminate`)
 * so it can be exercised with a plain Node process in tests.
 */

import { StringDecoder } from 'node:string_decoder';

/** How long a killed process may take to flush and exit before the provider escalates. */
const GRACE_MS = 1500;

/**
 * Resolve the shell program for this platform.
 * @param configured - explicit shell from plugin config, if any.
 * @returns an absolute or PATH-resolvable program name.
 */
export function resolveShell(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim();
  if (process.platform === 'win32') return process.env.ComSpec ?? 'cmd.exe';
  return process.env.SHELL ?? '/bin/bash';
}

/**
 * Build the argv that runs one command line through the shell.
 * @param program - shell program from {@link resolveShell}.
 * @param command - the user's command line.
 * @returns spawn argv.
 */
export function shellArgv(program, command) {
  if (process.platform === 'win32' && /(^|[\\/])cmd(?:\.exe)?$/i.test(program)) {
    return [program, '/d', '/s', '/c', command];
  }
  return [program, '-c', command];
}

/**
 * Spawn the command in `cwd` and forward stdout/stderr to `send` until it exits.
 *
 * `send` receives `{ type: 'stdout' | 'stderr' | 'truncated', ... }` events;
 * the caller owns the `start` and `exit` framing. Commands have no automatic
 * wall-clock limit: they run until they exit or the cancellation signal fires.
 *
 * @param options.subprocess - the Host subprocess service.
 * @param options.command - command line to run.
 * @param options.cwd - working directory for the child.
 * @param options.shell - optional shell override.
 * @param options.maxOutputBytes - delivered-output ceiling; later bytes are dropped.
 * @param options.send - event sink.
 * @param options.signal - cancellation; aborting terminates the child.
 * @returns exit facts once the child and both output streams settle.
 */
export async function runCommand(options) {
  const { subprocess, command, cwd, shell, maxOutputBytes, send, signal } = options;
  const handle = subprocess.spawn({
    argv: shellArgv(resolveShell(shell), command),
    cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: GRACE_MS,
    signal,
  });

  const state = { delivered: 0, truncated: false };
  const deliver = (channel, text) => {
    if (text === '') return;
    state.delivered += Buffer.byteLength(text);
    if (state.delivered > maxOutputBytes) {
      if (!state.truncated) {
        state.truncated = true;
        send({ type: 'truncated', maxOutputBytes });
      }
      return;
    }
    send({ type: channel, data: text });
  };

  const pumps = [
    pumpStream(handle.stdout, 'stdout', deliver),
    pumpStream(handle.stderr, 'stderr', deliver),
  ];

  let outcome;
  try {
    outcome = await handle.done;
  } catch (error) {
    outcome = { exitCode: null, signal: null, failure: error };
  }
  await Promise.all(pumps);

  return {
    exitCode: outcome.exitCode ?? null,
    signal: outcome.signal ?? null,
    truncated: state.truncated,
    failure: outcome.failure,
  };
}

/**
 * Decode one output stream to text chunks.
 * @param stream - provider output stream, absent when the channel was not piped.
 * @param channel - event channel name used for each chunk.
 * @param deliver - byte-budgeted sink.
 * @returns settles when the stream ends, errors, or is destroyed.
 */
function pumpStream(stream, channel, deliver) {
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
      if (tail !== '') deliver(channel, tail);
      resolve();
    };
    stream.on('data', (chunk) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      deliver(channel, decoder.write(bytes));
    });
    stream.on('end', finish);
    stream.on('error', finish);
    stream.on('close', finish);
  });
}

/** Longest terminal line retained before further characters are dropped. */
const MAX_TERMINAL_LINE = 20_000;
/** Longest scrollback retained before the oldest lines are dropped. */
const MAX_TERMINAL_LINES = 5_000;
/** Largest snapshot sent for a screen-mode redraw. */
const MAX_SNAPSHOT_CHARS = 400_000;

/**
 * A small scrollback terminal screen for PTY output.
 *
 * It applies carriage returns, backspaces, tabs, vertical cursor movement,
 * line/display erase, and other common cursor-addressing sequences. Plain
 * appends and line edits stay incremental; when a program rewrites earlier
 * lines (progress blocks, multi-line prompts, full-screen TUIs), the screen
 * switches to snapshot mode and the window replaces the transcript instead of
 * appending a duplicate copy.
 * @returns the stateful screen with `write` and `end`.
 */
function createTerminalScreen() {
  let lines = [''];
  let row = 0;
  let col = 0;
  let parser = 'plain';
  let csi = '';
  let screenMode = false;
  let committed = '';
  let redraw = false;

  const snapshot = () => {
    const text = lines.join('\n');
    return text.length > MAX_SNAPSHOT_CHARS ? text.slice(text.length - MAX_SNAPSHOT_CHARS) : text;
  };

  const ensureRow = (index) => {
    while (lines.length <= index) lines.push('');
  };

  const finish = () => {
    if (row < 0) row = 0;
    if (col < 0) col = 0;
    ensureRow(row);
    if (lines.length > MAX_TERMINAL_LINES) {
      const drop = lines.length - MAX_TERMINAL_LINES;
      lines = lines.slice(drop);
      row = Math.max(0, row - drop);
      redraw = true;
    }
    if (row !== lines.length - 1) redraw = true;
    if (redraw) screenMode = true;
  };

  const put = (char) => {
    ensureRow(row);
    if (row < lines.length - 1) redraw = true;
    if (col >= MAX_TERMINAL_LINE) return;
    const line = lines[row];
    if (col < line.length) lines[row] = line.slice(0, col) + char + line.slice(col + 1);
    else lines[row] = line + ' '.repeat(col - line.length) + char;
    col += 1;
  };

  const newline = () => {
    if (row < lines.length - 1) {
      redraw = true;
      row += 1;
      col = 0;
      return;
    }
    committed += `${lines[row]}\n`;
    lines.push('');
    row = lines.length - 1;
    col = 0;
  };

  const eraseLine = (param) => {
    if (row < lines.length - 1) redraw = true;
    const line = lines[row];
    if (param === 1) {
      lines[row] = ' '.repeat(Math.min(col, line.length)) + line.slice(col);
      col = 0;
    } else if (param === 2) {
      lines[row] = '';
      col = 0;
    } else {
      lines[row] = line.slice(0, col);
    }
  };

  const applyCsi = (raw, final) => {
    const privateMode = raw.startsWith('?') || raw.startsWith('>') || raw.startsWith('<') || raw.startsWith('=');
    const params = privateMode ? [] : raw.split(';').map((part) => (part === '' ? 0 : Number(part)));
    const value = (index, fallback) => (Number.isFinite(params[index]) ? params[index] : fallback);
    const count = (index) => Math.max(1, value(index, 1));
    switch (final) {
      case 'K':
        eraseLine(value(0, 0));
        break;
      case 'C':
        col += count(0);
        break;
      case 'D':
        col = Math.max(0, col - count(0));
        break;
      case 'G':
        col = Math.max(0, count(0) - 1);
        break;
      case 'A':
        row = Math.max(0, row - count(0));
        redraw = true;
        break;
      case 'B':
        row += count(0);
        ensureRow(row);
        if (row !== lines.length - 1) redraw = true;
        break;
      case 'H':
      case 'f':
        row = Math.max(0, count(0) - 1);
        ensureRow(row);
        col = Math.max(0, (params.length > 1 ? value(1, 1) : 1) - 1);
        redraw = true;
        break;
      case 'J': {
        const param = value(0, 0);
        if (param === 2 || param === 3) {
          lines = [''];
          row = 0;
          col = 0;
        } else if (param === 0) {
          ensureRow(row);
          lines[row] = lines[row].slice(0, col);
          lines = lines.slice(0, row + 1);
        } else if (param === 1) {
          ensureRow(row);
          for (let index = 0; index < row; index += 1) lines[index] = '';
          lines[row] = ' '.repeat(Math.min(col, lines[row].length)) + lines[row].slice(col);
        }
        redraw = true;
        break;
      }
      default:
        break;
    }
  };

  const consume = (char) => {
    if (parser === 'csi') {
      if (char >= '@' && char <= '~') {
        applyCsi(csi, char);
        csi = '';
        parser = 'plain';
      } else if (csi.length < 32) {
        csi += char;
      }
      return;
    }
    if (parser === 'plain') {
      if (char === '\x1b') {
        parser = 'escape';
      } else if (char === '\n') {
        newline();
      } else if (char === '\r') {
        col = 0;
      } else if (char === '\b') {
        col = Math.max(0, col - 1);
      } else if (char === '\t') {
        while (col % 8 !== 0) put(' ');
      } else if (char === '\x07' || char === '\x7f') {
        // Bell and delete are not text.
      } else if (char.charCodeAt(0) >= 0x20) {
        put(char);
      }
      return;
    }
    if (parser === 'escape') {
      if (char === '[') {
        csi = '';
        parser = 'csi';
      } else if (char === ']' || char === 'P' || char === '^' || char === '_') {
        parser = 'string';
      } else {
        parser = 'plain';
      }
      return;
    }
    if (parser === 'string') {
      if (char === '\x07') parser = 'plain';
      else if (char === '\x1b') parser = 'stringEscape';
      return;
    }
    if (parser === 'stringEscape') {
      parser = char === '\\' ? 'plain' : 'string';
    }
  };

  return {
    /**
     * Transform one decoded PTY chunk.
     * @param chunk - decoded terminal text.
     * @returns either an incremental stream delta or a full screen snapshot.
     */
    write(chunk) {
      committed = '';
      for (const char of chunk) consume(char);
      finish();
      if (screenMode) return { mode: 'screen', text: snapshot() };
      return { mode: 'stream', committed, partial: lines[row] };
    },
    /**
     * Finish the screen, committing any unterminated current line.
     * @returns either a trailing stream delta or a final screen snapshot.
     */
    end() {
      finish();
      if (screenMode) return { mode: 'screen', text: snapshot() };
      const trailing = lines[row] ?? '';
      return { mode: 'stream', committed: trailing, partial: '' };
    },
  };
}

/**
 * Run one interactive command on a real PTY and stream its sanitized output.
 *
 * The PTY gives prompts and TTY-aware programs a terminal; input arrives from
 * a separate Host route through {@link options.onTerminal}. The screen model
 * applies line redraws and cursor addressing, approximating full-screen TUIs
 * as their latest text screen.
 *
 * @param options.subprocess - the Host subprocess service.
 * @param options.command - command line to run.
 * @param options.cwd - working directory for the child.
 * @param options.shell - optional shell override.
 * @param options.maxOutputBytes - delivered-output ceiling; later bytes are dropped.
 * @param options.send - event sink for sanitized output.
 * @param options.signal - cancellation; aborting terminates the terminal session.
 * @param options.onTerminal - receives the live PTY handle for input routing.
 * Plain output arrives as `stdout` for committed lines plus `partial` for the
 * line being edited; when a program rewrites earlier lines, a `screen` event
 * carries the full transcript and the window replaces its output with it.
 * @returns exit facts once the PTY and its remaining output settle.
 */
export async function runInteractiveCommand(options) {
  const { subprocess, command, cwd, shell, maxOutputBytes, send, signal, onTerminal } = options;
  const handle = await subprocess.spawnTerminal({
    argv: shellArgv(resolveShell(shell), command),
    cwd,
    env: { TERM: 'xterm-256color', NO_COLOR: '1', CLICOLOR: '0', FORCE_COLOR: '0' },
    rows: 40,
    cols: 120,
    terminalType: 'xterm-256color',
    graceMs: GRACE_MS,
    signal,
  });
  onTerminal?.(handle);

  const screen = createTerminalScreen();
  const decoder = new StringDecoder('utf8');
  const state = { delivered: 0, truncated: false };

  const deliver = (text) => {
    if (text === '') return;
    state.delivered += Buffer.byteLength(text);
    if (state.delivered > maxOutputBytes) {
      if (!state.truncated) {
        state.truncated = true;
        send({ type: 'truncated', maxOutputBytes });
      }
      return;
    }
    send({ type: 'stdout', data: text });
  };

  let partial = '';
  let screenText = null;

  const publishPartial = (next) => {
    if (screenText !== null || next === partial) return;
    partial = next;
    send({ type: 'partial', data: next });
  };

  const publish = (result) => {
    if (result.mode === 'screen') {
      if (result.text === screenText) return;
      screenText = result.text;
      partial = '';
      send({ type: 'screen', data: result.text });
      return;
    }
    if (screenText !== null) return;
    if (result.committed !== '') deliver(result.committed);
    publishPartial(result.partial);
  };

  const pump = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      publish(screen.end());
      resolve();
    };
    handle.output.on('data', (chunk) => publish(screen.write(typeof chunk === 'string' ? chunk : decoder.write(chunk))));
    handle.output.on('end', finish);
    handle.output.on('error', finish);
    handle.output.on('close', finish);
  });

  const terminate = () => {
    void handle.terminate().catch(() => {});
  };
  if (signal !== undefined && signal.aborted) terminate();
  else signal?.addEventListener('abort', terminate, { once: true });

  let outcome;
  try {
    outcome = await handle.done;
  } catch (error) {
    outcome = { exitCode: null, signal: null, failure: error };
  }
  signal?.removeEventListener('abort', terminate);
  await pump;

  return {
    exitCode: outcome.exitCode ?? null,
    signal: outcome.signal ?? null,
    truncated: state.truncated,
    failure: outcome.failure,
  };
}
