/**
 * Minimal JSON-RPC client for `codex app-server`.
 *
 * The image plugin uses the app-server instead of scraping CLI text because it
 * exposes structured account data and the device-code login flow:
 *
 *   account/read            -> { account, requiresOpenaiAuth, userId }
 *   account/login/start     -> { type, loginId, userCode?, verificationUrl?, authUrl? }
 *   account/login/cancel    -> { status }
 *   account/logout          -> {}
 *   account/login/completed -> notification { loginId, success, error }
 *
 * Messages are newline-delimited JSON on stdin/stdout.
 */

import { StringDecoder } from 'node:string_decoder';

/** Default per-request timeout. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * One managed app-server process and its pending requests.
 */
export class CodexAppServer {
  /**
   * @param options.subprocess - Host subprocess service.
   * @param options.argv - app-server argv.
   * @param options.cwd - working directory.
   * @param options.env - explicit environment entries.
   * @param options.clientInfo - initialize clientInfo.
   * @param options.onNotification - notification sink `(method, params)`.
   */
  constructor(options) {
    this.subprocess = options.subprocess;
    this.argv = options.argv;
    this.cwd = options.cwd;
    this.env = options.env;
    this.clientInfo = options.clientInfo;
    this.onNotification = options.onNotification;
    this.handle = undefined;
    this.ready = false;
    this.starting = undefined;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.stderr = '';
    this.generation = 0;
  }

  /** Start the process and complete the initialize handshake once. */
  async start() {
    if (this.ready) return;
    if (this.starting !== undefined) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  /** Spawn, wire streams, and initialize. */
  async doStart() {
    const generation = (this.generation += 1);
    const handle = this.subprocess.spawn({
      argv: this.argv,
      cwd: this.cwd,
      env: this.env,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 1500,
    });
    this.handle = handle;
    this.buffer = '';
    this.stderr = '';
    handle.stdout?.on('data', (chunk) => {
      if (this.generation === generation) this.consume(chunk);
    });
    handle.stdout?.on('close', () => {
      if (this.generation === generation) this.consume(this.decoder.end());
    });
    handle.stderr?.on('data', (chunk) => {
      if (this.generation === generation) this.stderr = `${this.stderr}${chunk.toString()}`.slice(-8000);
    });
    void handle.done.then(
      (outcome) => {
        if (this.generation === generation) this.handleExit(outcome);
      },
      (error) => {
        if (this.generation === generation) this.handleExit({ exitCode: null, signal: null, failure: error });
      },
    );
    try {
      await this.request('initialize', { clientInfo: this.clientInfo });
      this.ready = true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /** Record process exit and reject everything still waiting. */
  handleExit(outcome) {
    this.ready = false;
    this.handle = undefined;
    const reason = outcome?.failure instanceof Error
      ? outcome.failure.message
      : `Codex app-server exited (${outcome?.exitCode ?? 'unknown'})`;
    this.failAll(new Error(reason));
  }

  /**
   * Feed stdout bytes into the line parser.
   * @param chunk - raw bytes.
   */
  consume(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk);
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message !== null && typeof message === 'object' && message.id !== undefined && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error !== undefined) {
          const error = new Error(typeof message.error?.message === 'string' ? message.error.message : 'Codex app-server request failed');
          if (typeof message.error?.code === 'number') error.code = message.error.code;
          entry.reject(error);
        } else {
          entry.resolve(message.result);
        }
        continue;
      }
      if (message !== null && typeof message === 'object' && typeof message.method === 'string') {
        try {
          this.onNotification?.(message.method, message.params);
        } catch {}
      }
    }
  }

  /**
   * Send one request and wait for its result.
   * @param method - protocol method.
   * @param params - protocol parameters.
   * @param timeoutMs - per-request deadline.
   * @returns the result value.
   */
  request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const handle = this.handle;
    if (handle === undefined || handle.stdin === undefined) {
      return Promise.reject(new Error('Codex app-server is not running'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        handle.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /** Reject every pending request. */
  failAll(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  /** Terminate the process and reject pending work. */
  stop() {
    this.generation += 1;
    const handle = this.handle;
    this.ready = false;
    this.handle = undefined;
    this.failAll(new Error('Codex app-server stopped'));
    if (handle !== undefined) {
      try {
        handle.terminate();
      } catch {}
    }
  }
}