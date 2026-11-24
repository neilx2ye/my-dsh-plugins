/**
 * Direct messages between two personal identities.
 *
 * A direct message is a private 1:1 exchange: the caller identity asks another
 * identity in the same profile a question and gets that identity's own reply.
 * It is not a group chat, so there is no transcript visible to other
 * identities and no moderator. The exchange is persisted per pair, and each
 * later message carries the recent exchange so the two can continue a thread.
 *
 * This module stays pure: key derivation, the peer roster, message validation,
 * and the reply prompt are all functions of their arguments, so the Host half
 * and the node test suite agree without a running DSH.
 */

/** Longest accepted direct-message text, in code points. */
export const DM_MESSAGE_MAX = 8000;
/** Recent direct messages carried into the reply prompt. */
export const DM_HISTORY_MESSAGES = 40;
/** Longest history text carried into the reply prompt. */
export const DM_HISTORY_CHARS = 12_000;
/** Most direct messages kept in one pair's transcript file. */
export const DM_TRANSCRIPT_LIMIT = 400;

/**
 * Stable, order-independent key for one pair of identities. Identity ids are
 * lowercase words joined by hyphens, so `a--b` cannot collide with another
 * pair's key.
 * @param left - one identity id.
 * @param right - the other identity id.
 * @returns the pair key.
 */
export function dmPairKey(left, right) {
  if (typeof left !== 'string' || left === '' || typeof right !== 'string' || right === '') {
    throw new Error('personal-agent: a direct message needs two identity ids');
  }
  if (left === right) throw new Error('personal-agent: an identity cannot send a direct message to itself');
  return [left, right].sort().join('--');
}

/**
 * Compose the identity-prompt roster that makes sibling identities known.
 * Without it a personal identity knows that the profile hosts several agents
 * but not who they are or how to reach them.
 * @param self - the calling normalized identity.
 * @param identities - every normalized identity in the profile.
 * @returns the prompt section text; empty when the identity is alone.
 */
export function composePeerSection(self, identities) {
  const peers = identities.filter((identity) => identity.id !== self.id);
  if (peers.length === 0) return '';
  const roster = peers
    .map((identity) => `- ${identity.name} (id: ${identity.id}, role: ${identity.role || 'personal agent'})`)
    .join('\n');
  return [
    `The user also has these personal agents in this profile. Each has their own home, persona, and private memory:`,
    roster,
    '',
    'You can talk to any of them directly with the message_identity tool: pass their id or exact name and what you want to say. That is a private 1:1 message, not a group chat; only the two of you take part, and they answer as themselves. The exchange is saved for later direct messages between the two of you.',
    'Use it when the user asks you to consult, ask, hand something to, or coordinate with one of them, and say plainly when you did it. Never invent their reply, never answer on their behalf, and never forward the user\u2019s private messages or memory to another identity unless the user asks you to.',
  ].join('\n');
}

/**
 * Validate one outgoing direct message.
 * @param value - tool or request value.
 * @returns trimmed message text.
 */
export function normalizeDirectMessage(value) {
  if (typeof value !== 'string') throw new Error('personal-agent: message must be a string');
  const text = value.trim();
  if (text === '') throw new Error('personal-agent: message must not be empty');
  if ([...text].length > DM_MESSAGE_MAX) {
    throw new Error(`personal-agent: message must be at most ${DM_MESSAGE_MAX} characters`);
  }
  return text;
}

/**
 * Render the recent part of one pair's transcript for a prompt: oldest first,
 * each line prefixed with the speaker, bounded by message count and characters.
 * Only real messages are stored, so a malformed entry is skipped.
 * @param messages - stored transcript messages.
 * @param limit - most messages to include.
 * @param maxChars - longest rendered history.
 * @returns the rendered history; empty when there is nothing to show.
 */
export function renderDirectMessageHistory(messages, limit = DM_HISTORY_MESSAGES, maxChars = DM_HISTORY_CHARS) {
  if (!Array.isArray(messages)) return '';
  const lines = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0 && lines.length < limit; index -= 1) {
    const message = messages[index];
    if (message === null || typeof message !== 'object') continue;
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (text === '') continue;
    const name = typeof message.name === 'string' && message.name !== '' ? message.name : '（未命名）';
    const line = `- ${name}: ${text}`;
    if (used + line.length > maxChars && lines.length > 0) break;
    used += line.length;
    lines.push(line);
  }
  return lines.reverse().join('\n');
}

/**
 * Compose the prompt that asks the target identity for its own reply. The
 * child agent runs in the target's home, so the normal identity and memory
 * sections apply; this text supplies only the direct-message situation and the
 * recent thread.
 * @param options - caller identity, target identity, new message, and history.
 * @returns the reply prompt.
 */
export function composeDirectMessagePrompt({ caller, target, message, history = [] }) {
  if (caller === undefined || target === undefined) throw new Error('personal-agent: a direct message needs both identities');
  const callerRole = typeof caller.role === 'string' && caller.role !== '' ? caller.role : 'personal agent';
  const transcript = renderDirectMessageHistory(history);
  return [
    `${caller.name} (${callerRole}) is another personal agent in this Harness profile. ${caller.name} sent you a direct message. This is a private 1:1 conversation between the two of you: it is not a group chat, and the user is not speaking to you right now.`,
    '',
    transcript === ''
      ? `This is your first direct message with ${caller.name}.`
      : `Recent direct messages with ${caller.name}:\n${transcript}`,
    '',
    `${caller.name} sent:`,
    message,
    '',
    `Reply to ${caller.name} as ${target.name}, directly and briefly, in your own voice. Answer what they asked. Do not speak for ${caller.name}, do not invent anyone else\u2019s reply, and do not start a new direct message from this reply. If only the user can answer something, say what you need from the user.`,
  ].join('\n');
}
/**
 * How long one direct-message exchange may wait for the peer's reply. The
 * deadline also covers the child's whole turn, so it is the ceiling on how long
 * a caller's conversation can sit waiting on another identity.
 */
export const DM_WAIT_DEADLINE_MS = 180_000;

/**
 * A cancelled wait reports this code, so callers can tell a stalled peer from
 * a real delivery failure.
 */
export const WAIT_CANCELLED = 'PA_WAIT_CANCELLED';

/**
 * Settle a subagent reply even when the child never finishes.
 *
 * A published activation's result promise is not tied to the cancellation
 * signal: aborting that signal only prevents a child from being created. A
 * child that stalls therefore holds the caller's turn open forever, and the
 * conversation looks frozen with nothing on screen explaining why. Racing the
 * result against the caller's signal keeps stop and the wait deadline
 * effective.
 *
 * @param result - the activation result promise.
 * @param signal - caller cancellation, already carrying any wait deadline.
 * @returns the activation result.
 */
export function waitForReply(result, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      const error = new Error('personal-agent: waiting for the reply was cancelled');
      error.code = WAIT_CANCELLED;
      reject(error);
    };
    const settle = (fn) => (value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    result.then(settle(resolve), settle(reject));
  });
}

/**
 * Describe a cancelled direct-message wait for the caller's model.
 * @param options - peer name and the abort reason.
 * @returns one sentence the caller can pass on.
 */
export function describeCancelledWait({ name, reason, deadlineSeconds }) {
  const timedOut = reason !== null && typeof reason === 'object' && reason.name === 'TimeoutError';
  if (timedOut) {
    const minutes = Math.round(deadlineSeconds / 60);
    return `${name} 没有在 ${minutes} 分钟内回复，这次等待已中止（对方可能正忙）。消息已记录，可以稍后再问一次。`;
  }
  return `${name} 的回复被中止了：等待已取消。`;
}
