/**
 * The governance chain for one GraphQL request:
 * store resolution → parse/classify → policy → token routing → approval (writes)
 * → execution → history/audit. Reads never ask for approval; mutations never
 * execute without one (except an explicit user-initiated panel run).
 */
import { analyzeDocument } from './graphql-doc.js'
import { AppError } from './errors.js'
import { checkPolicy, loadPolicy } from './policy.js'
import { byteLength, hashJson, nowIso, sha256 } from './util.js'

/** Decision labels recorded in history. */
const DECISION_LABELS = {
  approve: 'approved',
  reject: 'rejected',
  timeout: 'timeout',
  cancelled: 'cancelled',
}

/**
 * Create the runner bound to one plugin instance.
 * @param options - config, credential resolver, pending registry, history, and client.
 * @returns the run function.
 */
export function createRunner(options) {
  const { config, secrets, pending, history, client, stateDir } = options

  /**
   * Resolve the target store from config.
   * @param storeId - requested store id, optional for a single-store setup.
   * @returns store config.
   */
  function resolveStore(storeId) {
    const stores = Array.isArray(config.stores) ? config.stores : []
    if (stores.length === 0) {
      throw new AppError('store_not_configured', 'No Shopify store is configured for this plugin.')
    }
    if (typeof storeId === 'string' && storeId.trim() !== '') {
      const found = stores.find(store => store.id === storeId.trim())
      if (found === undefined) {
        throw new AppError('store_not_configured', `Unknown Shopify store "${storeId}".`)
      }
      return found
    }
    if (stores.length === 1) return stores[0]
    throw new AppError('store_required', 'Multiple stores are configured; pass storeId.')
  }

  /**
   * Run one GraphQL request through the full governance chain.
   * @param request - document, variables, store, source, and cancellation.
   * @returns a tool-facing result with status, data, and a history id.
   */
  async function run(request) {
    const {
      storeId,
      document,
      variables,
      operationName,
      source = 'direct',
      toolName = 'shopify_graphql',
      savedTool,
      manual = false,
      sessionId,
      signal,
    } = request

    if (typeof document !== 'string' || document.trim() === '') {
      throw new AppError('graphql_invalid', 'document must be a non-empty GraphQL string.')
    }
    const store = resolveStore(storeId)
    const analysis = analyzeDocument(document, operationName, variables)
    const policyFile = await loadPolicy({ stateDir, storeId: store.id })
    const documentBytes = byteLength(document)
    const variablesBytes = byteLength(variables ?? {})
    checkPolicy(policyFile.policy, {
      operationType: analysis.operationType,
      rootFields: analysis.rootFields,
      documentBytes,
      variablesBytes,
    })

    const tokenKind = analysis.operationType === 'query' ? 'read' : 'write'
    const token = await secrets.resolve(store, tokenKind)
    if (token === undefined) {
      throw new AppError('secret_missing', tokenErrorMessage(store, tokenKind))
    }

    const documentHash = sha256(document)
    const variablesHash = hashJson(variables ?? {})
    const risk = analysis.visual.risk

    /** @type {object | undefined} */
    let pendingRecord
    let decision = manual ? 'manual' : 'auto'

    if (analysis.operationType === 'mutation' && !manual) {
      pendingRecord = pending.create({
        storeId: store.id,
        operationType: analysis.operationType,
        operationName: analysis.operationName,
        document,
        variables: variables ?? {},
        visual: analysis.visual,
        documentHash,
        variablesHash,
        timeoutMs: policyFile.policy.limits.approvalTimeoutMs,
        source,
        toolName,
        savedToolName: savedTool?.name,
        sessionId,
      })
      const outcome = await pending.wait(pendingRecord.id, signal)
      if (outcome.decision !== 'approve') {
        pending.remove(pendingRecord.id)
        const status = outcome.decision === 'timeout'
          ? 'timeout'
          : outcome.decision === 'cancelled' ? 'cancelled' : 'rejected'
        const entry = await history.append({
          requestId: pendingRecord.id,
          storeId: store.id,
          operationType: analysis.operationType,
          operationName: analysis.operationName,
          summary: analysis.visual.summary,
          risk,
          document,
          variables: variables ?? {},
          variableDefs: analysis.variableDefs,
          documentHash,
          variablesHash,
          decision: DECISION_LABELS[outcome.decision] ?? outcome.decision,
          decidedAt: outcome.record?.decidedAt,
          decidedBy: outcome.record?.decidedBy,
          status,
          durationMs: 0,
          source,
          toolName,
          savedToolId: savedTool?.id,
          savedToolName: savedTool?.name,
        })
        return {
          requestId: entry.id,
          storeId: store.id,
          operationType: analysis.operationType,
          operationName: analysis.operationName,
          status,
          summary: analysis.visual.summary,
          reason: status === 'timeout'
            ? 'The approval request expired before a decision.'
            : status === 'cancelled' ? 'The approval request was cancelled.' : 'The user rejected this mutation.',
        }
      }
      decision = 'approved'
    }

    if (pendingRecord !== undefined) pending.remove(pendingRecord.id)

    const startedAt = Date.now()
    let execution
    try {
      execution = await client.execute({
        domain: store.domain,
        apiVersion: store.apiVersion,
        token,
        document,
        variables,
        operationName: operationName?.trim() || undefined,
        signal,
      })
    } catch (error) {
      const entry = await history.append({
        requestId: pendingRecord?.id,
        storeId: store.id,
        operationType: analysis.operationType,
        operationName: analysis.operationName,
        summary: analysis.visual.summary,
        risk,
        document,
        variables: variables ?? {},
        variableDefs: analysis.variableDefs,
        documentHash,
        variablesHash,
        decision,
        decidedAt: pendingRecord?.decidedAt,
        decidedBy: pendingRecord?.decidedBy,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: error?.message ?? String(error),
        source,
        toolName,
        savedToolId: savedTool?.id,
        savedToolName: savedTool?.name,
      })
      throw new AppError(
        error instanceof AppError ? error.code : 'shopify_execution_failed',
        error?.message ?? String(error),
        { historyId: entry.id },
      )
    }

    const status = execution.errors.length > 0 ? 'error' : 'ok'
    const entry = await history.append({
      requestId: pendingRecord?.id,
      storeId: store.id,
      operationType: analysis.operationType,
      operationName: analysis.operationName,
      summary: analysis.visual.summary,
      risk,
      document,
      variables: variables ?? {},
      variableDefs: analysis.variableDefs,
      documentHash,
      variablesHash,
      decision,
      decidedAt: pendingRecord?.decidedAt,
      decidedBy: pendingRecord?.decidedBy,
      status,
      durationMs: Date.now() - startedAt,
      result: execution.data,
      errors: execution.errors,
      cost: execution.cost,
      source,
      toolName,
      savedToolId: savedTool?.id,
      savedToolName: savedTool?.name,
    })

    return {
      requestId: entry.id,
      storeId: store.id,
      operationType: analysis.operationType,
      operationName: analysis.operationName,
      status,
      summary: analysis.visual.summary,
      decision,
      data: execution.data,
      errors: execution.errors,
      cost: execution.cost,
      durationMs: entry.durationMs,
    }
  }

  /**
   * Execute a saved tool from the panel with user-supplied parameters.
   * @param savedTool - stored definition.
   * @param variables - user-supplied variables.
   * @param signal - optional cancellation.
   * @returns the runner result.
   */
  async function invokeSaved(savedTool, variables, signal) {
    return run({
      storeId: savedTool.storeId,
      document: savedTool.document,
      variables,
      operationName: savedTool.operationName,
      source: 'manual',
      toolName: savedTool.name,
      savedTool,
      manual: true,
      signal,
    })
  }

  return { run, invokeSaved, resolveStore }
}

/**
 * Build a provider-aware token error message.
 * @param store - normalized store.
 * @param kind - "read" or "write".
 * @returns message naming the provider, never the value.
 */
function tokenErrorMessage(store, kind) {
  const slot = kind === 'read' ? store.readToken : store.writeToken
  return slot.provider === 'infisical'
    ? `Store "${store.id}" could not resolve its ${kind} token from Infisical (${slot.service}/${slot.key}).`
    : `Store "${store.id}" has no ${kind} token configured (local reference ${slot.ref}).`
}