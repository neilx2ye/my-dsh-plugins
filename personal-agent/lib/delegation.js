/**
 * Per-conversation subagent permission for the Personal Agent bundle.
 *
 * A private identity conversation is allowed to spawn subagents only when that
 * conversation recorded the permission itself. The choice is a Session event,
 * so it survives a restart, follows the conversation, and never leaks to
 * another identity or to a group.
 *
 * The gate is applied through `tools.restrict({ deny })` on the Agent's own
 * scope: restricting a tool is how the Host hides it from one agent without
 * touching what every other Session can use.
 */

/** Session event that records one selection; the last recorded one wins. */
export const DELEGATION_EVENT = 'personal-agent/delegation';

/**
 * Tools a private identity conversation may use only with delegation on.
 *
 * `subagent` and `subagent_fork` start children, `subagent_control` drives
 * them, and `workflow` fans out a whole tree at once.
 */
export const DELEGATION_TOOLS = Object.freeze([
  'subagent',
  'subagent_fork',
  'subagent_control',
  'workflow',
]);

/**
 * Read one conversation's delegation choice.
 *
 * Reading the log backwards means a later selection always wins, including the
 * one written by the switch the user just flipped. A conversation that never
 * recorded a selection has delegation off.
 *
 * @param log - Session event log (`session.log`).
 * @returns whether this conversation may spawn subagents.
 */
export function readDelegationChoice(log) {
  if (!Array.isArray(log)) return false;
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const event = log[index];
    if (event === null || typeof event !== 'object') continue;
    if (event.type !== DELEGATION_EVENT) continue;
    return event.data !== null && typeof event.data === 'object' && event.data.enabled === true;
  }
  return false;
}

/**
 * The restriction a conversation without delegation carries.
 * @returns a `tools.restrict` filter.
 */
export function delegationDenyFilter() {
  return { deny: [...DELEGATION_TOOLS] };
}