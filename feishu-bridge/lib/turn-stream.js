/**
 * One streaming Feishu card fed by an agent turn.
 *
 * `createLarkChannel().stream()` eagerly sends a card, then runs a producer
 * that appends markdown until it returns. This class bridges that push-style
 * producer to the pull of assistant token deltas: `push()` buffers text, the
 * producer drains it, and `close()` writes the authoritative final text before
 * letting the card complete.
 */

export class TurnStream {
  /**
   * @param start - starts a Feishu card stream with one producer callback.
   * @param finalTimeoutMs - bound on writing the authoritative final text.
   */
  constructor(start, finalTimeoutMs = 20_000) {
    /** Buffered text not yet appended to the card. */
    this.buffer = [];
    /** Waiters paused inside the producer loop. */
    this.waiters = [];
    /** Set once `close()` or `fail()` begins. */
    this.closed = false;
    /** Authoritative final text written just before the card completes. */
    this.finalText = undefined;
    /** Error from the card stream, when it failed. */
    this.failed = undefined;
    /** Bound used when writing the final text. */
    this.finalTimeoutMs = finalTimeoutMs;
    /** Resolves with the stream result, or rejects. */
    this.promise = Promise.resolve()
      .then(() =>
        start(async (controller) => {
          for await (const chunk of this) {
            await controller.append(chunk);
          }
          if (typeof this.finalText === 'string' && this.finalText !== '') {
            await asyncTimeout(controller.setContent(this.finalText), this.finalTimeoutMs);
          }
        }),
      )
      .catch((error) => {
        this.failed = error;
        throw error;
      });
    // Avoid an unhandled rejection when the caller only awaits close() later.
    this.promise.catch(() => undefined);
  }

  /**
   * Wake every waiter so the producer re-checks its buffer.
   */
  wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  /**
   * Queue one text delta for the card.
   * @param text - assistant text.
   */
  push(text) {
    if (this.closed || this.failed !== undefined) return;
    if (typeof text !== 'string' || text === '') return;
    this.buffer.push(text);
    this.wake();
  }

  /**
   * Async producer source consumed by the Feishu card controller.
   * @returns chunks until `close()`.
   */
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift();
        continue;
      }
      if (this.closed) return;
      await new Promise((resolve) => this.waiters.push(resolve));
    }
  }

  /**
   * Finish the card with the authoritative turn text.
   * @param finalText - exact text of the turn; empty keeps the streamed text.
   * @returns the Feishu stream result.
   */
  async close(finalText) {
    if (this.closed) return this.promise;
    if (typeof finalText === 'string' && finalText !== '') this.finalText = finalText;
    this.closed = true;
    this.wake();
    return this.promise;
  }

  /**
   * Abort the card with a final line.
   * @param reason - user-facing failure text.
   */
  fail(reason) {
    if (this.closed) return;
    if (typeof reason === 'string' && reason !== '') this.finalText = reason;
    this.closed = true;
    this.wake();
  }
}

/**
 * Await a promise with a deadline.
 * @param promise - promise to await.
 * @param ms - deadline in milliseconds.
 * @returns the promise's value.
 */
function asyncTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}