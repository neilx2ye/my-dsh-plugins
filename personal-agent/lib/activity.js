/**
 * Per-Session activity clock for the Personal Agent bundle.
 *
 * A running turn is not "stuck" because it has been running for a while. The
 * only honest signal is whether the Session is still doing something: durable
 * events cover tool calls, results, steps, and settled replies, while streamed
 * model tokens arrive as transient frames and never reach the log. This log
 * folds both into one timestamp per Session, which the working bubble reads
 * through the state snapshot.
 *
 * The log is bounded: the least recently active Session is dropped first, so a
 * long-lived profile cannot grow it without limit.
 */

/**
 * Build one bounded activity log.
 * @param options.now - clock, injectable for tests.
 * @param options.limit - maximum remembered Sessions.
 * @returns the log: touch, lastActivity, and snapshot.
 */
export function createActivityLog(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 512;
  /** Session id -> last observed activity (ms), least recently active first. */
  const entries = new Map();
  return {
    /**
     * Record that one Session just did something observable.
     * @param sessionId - Session that produced an event or a stream frame.
     */
    touch(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return;
      entries.delete(sessionId);
      entries.set(sessionId, now());
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    /**
     * Read one Session's last activity without touching it.
     * @param sessionId - Session id.
     * @returns last observed activity in ms, or 0 when nothing was observed.
     */
    lastActivity(sessionId) {
      return entries.get(sessionId) ?? 0;
    },
    /**
     * Copy the whole clock for the state payload.
     * @returns Session id -> last activity ms.
     */
    snapshot() {
      return Object.fromEntries(entries);
    },
  };
}