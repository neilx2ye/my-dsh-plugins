/**
 * In-memory pending-write registry. One entry per mutation waiting for a user
 * decision; the waiting tool call and the browser panel share the same record.
 * Decisions bind to the stored immutable document, never to a client payload.
 */
import { randomUUID } from 'node:crypto'
import { AppError } from './errors.js'
import { nowIso } from './util.js'

/**
 * Create a pending manager.
 * @param options - optional cleanup hook invoked when the plugin unloads.
 * @returns pending registry.
 */
export function createPendingManager(options = {}) {
  /** @type {Map<string, object>} */
  const records = new Map()
  /** @type {Map<string, { resolve: (value: object) => void }>} */
  const waiters = new Map()
  const onCleanup = options.onCleanup

  /**
   * Add a new pending request.
   * @param input - store, document, variables, visual, and timeout.
   * @returns the stored record.
   */
  function create(input) {
    const id = `req_${randomUUID().slice(0, 8)}`
    const createdAt = nowIso()
    const timeoutMs = input.timeoutMs ?? 600_000
    const record = {
      id,
      createdAt,
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      timeoutMs,
      status: 'pending',
      storeId: input.storeId,
      operationType: input.operationType,
      operationName: input.operationName,
      document: input.document,
      variables: input.variables ?? {},
      visual: input.visual,
      documentHash: input.documentHash,
      variablesHash: input.variablesHash,
      source: input.source ?? 'agent',
      toolName: input.toolName,
      savedToolName: input.savedToolName,
      sessionId: input.sessionId,
    }
    records.set(id, record)
    return record
  }

  /**
   * List pending summaries for the panel.
   * @returns pending records without full documents.
   */
  function list() {
    return [...records.values()]
      .filter(record => record.status === 'pending')
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
      .map(record => ({
        id: record.id,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        storeId: record.storeId,
        operationType: record.operationType,
        operationName: record.operationName,
        summary: record.visual?.summary,
        risk: record.visual?.risk ?? [],
        source: record.source,
        toolName: record.toolName,
        savedToolName: record.savedToolName,
      }))
  }

  /**
   * Read one pending record (full document and variables).
   * @param id - request id.
   * @returns the record, or undefined.
   */
  function get(id) {
    return records.get(id)
  }

  /**
   * Apply the user's decision to a pending request.
   * @param id - request id.
   * @param decision - "approve" or "reject".
   * @param decidedBy - display identity of the decider.
   * @returns the updated record.
   */
  function decide(id, decision, decidedBy = 'user') {
    const record = records.get(id)
    if (record === undefined) throw new AppError('request_not_found', `No pending request ${id} exists.`)
    if (record.status !== 'pending') {
      throw new AppError('request_not_pending', `Request ${id} is already ${record.status}.`)
    }
    if (record.expiresAt <= nowIso()) {
      record.status = 'expired'
      record.decidedAt = nowIso()
      record.decidedBy = 'system'
      throw new AppError('request_expired', `Request ${id} has expired.`)
    }
    record.status = decision === 'approve' ? 'approved' : 'rejected'
    record.decidedAt = nowIso()
    record.decidedBy = decidedBy
    const waiter = waiters.get(id)
    waiters.delete(id)
    waiter?.resolve({ decision, record })
    return record
  }

  /**
   * Wait for a decision, a timeout, or cancellation.
   * @param id - request id.
   * @param signal - the tool call's cancellation signal.
   * @returns decision outcome: "approve", "reject", "timeout", "cancelled", or "missing".
   */
  function wait(id, signal) {
    return new Promise(resolve => {
      const record = records.get(id)
      if (record === undefined) {
        resolve({ decision: 'missing', record: undefined })
        return
      }
      if (record.status !== 'pending') {
        resolve({ decision: record.status === 'approved' ? 'approve' : 'reject', record })
        return
      }

      let settled = false
      const settle = outcome => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        waiters.delete(id)
        resolve({ ...outcome, record: records.get(id) })
      }
      const timer = setTimeout(() => {
        const current = records.get(id)
        if (current !== undefined && current.status === 'pending') {
          current.status = 'expired'
          current.decidedAt = nowIso()
          current.decidedBy = 'system'
        }
        settle({ decision: 'timeout' })
      }, Math.max(1, record.timeoutMs))
      const onAbort = () => {
        const current = records.get(id)
        if (current !== undefined && current.status === 'pending') {
          current.status = 'cancelled'
          current.decidedAt = nowIso()
          current.decidedBy = 'system'
        }
        settle({ decision: 'cancelled' })
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      waiters.set(id, { resolve: outcome => settle(outcome) })
      if (signal?.aborted === true) {
        onAbort()
        return
      }

      // Close the race between the status check above and installing the waiter.
      const settledRecord = records.get(id)
      if (settledRecord !== undefined && settledRecord.status !== 'pending') {
        settle({
          decision: settledRecord.status === 'approved'
            ? 'approve'
            : settledRecord.status === 'rejected' ? 'reject' : 'cancelled',
        })
      }
    })
  }

  /**
   * Remove a completed record after the runner consumed it.
   * @param id - request id.
   */
  function remove(id) {
    records.delete(id)
    waiters.delete(id)
  }

  /**
   * Abandon every pending request (plugin unload).
   */
  function dispose() {
    for (const record of records.values()) {
      if (record.status !== 'pending') continue
      record.status = 'cancelled'
      record.decidedAt = nowIso()
      record.decidedBy = 'system'
      waiters.get(record.id)?.resolve({ decision: 'cancelled', record })
    }
    waiters.clear()
    onCleanup?.()
  }

  return { create, list, get, decide, wait, remove, dispose }
}