/**
 * Execution history and the append-only audit trail. History keeps bounded
 * summaries and result previews; the audit file is one JSON object per line.
 */
import { randomUUID } from 'node:crypto'
import { appendJsonLine, boundJson, nowIso, readJson, writeJsonAtomic } from './util.js'

/**
 * History store with serialized writes.
 */
export class HistoryStore {
  /**
   * @param options - history file, audit file, and retention count.
   */
  constructor(options) {
    this.file = options.file
    this.auditFile = options.auditFile
    this.max = options.max ?? 200
    /** @type {object[]} */
    this.entries = []
    this.queue = Promise.resolve()
  }

  /**
   * Load persisted entries.
   * @returns when loaded.
   */
  async load() {
    const stored = await readJson(this.file, [])
    this.entries = Array.isArray(stored) ? stored.slice(0, this.max) : []
  }

  /**
   * Persist one execution.
   * @param entry - execution record.
   * @returns the stored entry.
   */
  async append(entry) {
    const record = {
      id: entry.id ?? `run_${randomUUID().slice(0, 8)}`,
      at: entry.at ?? nowIso(),
      ...entry,
      result: boundJson(entry.result, 256_000),
    }
    this.entries.unshift(record)
    this.entries = this.entries.slice(0, this.max)
    this.queue = this.queue
      .then(() => writeJsonAtomic(this.file, this.entries))
      .then(() => appendJsonLine(this.auditFile, record))
      .catch(() => undefined)
    await this.queue
    return record
  }

  /**
   * List compact entries for the panel.
   * @returns summaries without documents or results.
   */
  list() {
    return this.entries.map(entry => ({
      id: entry.id,
      requestId: entry.requestId,
      at: entry.at,
      storeId: entry.storeId,
      operationType: entry.operationType,
      operationName: entry.operationName,
      summary: entry.summary,
      status: entry.status,
      decision: entry.decision,
      durationMs: entry.durationMs,
      source: entry.source,
      toolName: entry.toolName,
    }))
  }

  /**
   * Read one full entry.
   * @param id - execution id.
   * @returns the entry, or undefined.
   */
  get(id) {
    return this.entries.find(entry => entry.id === id)
  }
}