/**
 * Conversation reset policy for the Personal Agent bundle.
 *
 * `/new` starts a blank conversation in an identity's home and archives the
 * identity's earlier private conversations so the history list no longer
 * offers them. Group, participant, and already archived Sessions are owned by
 * other surfaces and are never cleared here.
 */

/**
 * Pick the identity conversations one `/new` reset should archive.
 * @param sessionIds - the identity workspace's Session ids.
 * @param options.keep - the freshly created Session, never archived.
 * @param options.archived - Session ids already in the archive set.
 * @param options.excluded - Session ids owned by groups or participants.
 * @returns unique ids to archive, in workspace order.
 */
export function conversationsToClear(sessionIds, options = {}) {
  const skip = new Set();
  if (typeof options.keep === 'string' && options.keep !== '') skip.add(options.keep);
  for (const id of options.archived ?? []) {
    if (typeof id === 'string' && id !== '') skip.add(id);
  }
  for (const id of options.excluded ?? []) {
    if (typeof id === 'string' && id !== '') skip.add(id);
  }
  const seen = new Set();
  const result = [];
  for (const id of sessionIds ?? []) {
    if (typeof id !== 'string' || id === '' || skip.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}