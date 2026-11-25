/**
 * Host half of the Shopify GraphQL workbench.
 *
 * One model-facing tool, `shopify_graphql`, accepts a complete Admin GraphQL
 * document. Queries execute immediately with the store's read-only token.
 * Mutations are persisted as pending requests, shown in the right-side panel,
 * and execute only after the user approves the exact stored document. Every
 * execution lands in history and the audit trail; a successful execution can be
 * turned into a reusable tool from the panel.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { createPendingManager } from './lib/pending.js'
import { createRunner } from './lib/runner.js'
import { createSecrets } from './lib/secrets.js'
import { HistoryStore } from './lib/history.js'
import { SavedToolStore } from './lib/saved-tools.js'
import { ShopifyAdminClient } from './lib/shopify.js'
import { loadPolicy } from './lib/policy.js'
import { AppError, failureResponse, messageOf } from './lib/errors.js'
import { truncate } from './lib/util.js'

/** Cordis plugin name. */
export const name = 'shopify-graphql'

/** Services this bundle needs from the Web Host composition. */
export const inject = ['tools', 'connection']

/** Default Shopify Admin API version. */
const DEFAULT_API_VERSION = '2026-04'

/** Default request timeout for one Shopify call. */
const DEFAULT_FETCH_TIMEOUT_MS = 30_000

/**
 * Resolve the Harness home directory.
 * @returns absolute path.
 */
function dshHome() {
  const fromEnvironment = process.env.DSH_HOME
  if (typeof fromEnvironment === 'string' && fromEnvironment.trim() !== '') return fromEnvironment.trim()
  return path.join(homedir(), '.dsh')
}

/**
 * Validate and normalize the loader row's config.
 * @param raw - row config.
 * @returns normalized config.
 */
export function readConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const allowed = new Set(['stores', 'stateDir', 'fetchTimeoutMs', 'infisical'])
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new Error(`shopify-graphql: unknown config key "${key}"`)
  }

  const infisical = readInfisicalConfig(source.infisical)
  const stores = normalizeStores(source.stores ?? [], infisical, 'stores')

  const stateDirInput = typeof source.stateDir === 'string' ? source.stateDir.trim() : ''
  const stateDir = stateDirInput === ''
    ? path.join(dshHome(), 'shopify-graphql')
    : path.resolve(expandHome(stateDirInput))

  const fetchTimeoutMs = source.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  if (!Number.isSafeInteger(fetchTimeoutMs) || fetchTimeoutMs <= 0) {
    throw new Error('shopify-graphql: config.fetchTimeoutMs must be a positive integer')
  }

  return { stores, stateDir, fetchTimeoutMs, infisical }
}

/**
 * Validate and normalize a store list.
 * @param storesInput - raw store entries.
 * @param infisical - normalized Infisical config, when present.
 * @param label - config path prefix for diagnostics.
 * @returns normalized stores with no duplicate ids.
 */
function normalizeStores(storesInput, infisical, label) {
  if (!Array.isArray(storesInput)) throw new Error(`shopify-graphql: ${label} must be an array`)
  const seen = new Set()
  return storesInput.map((store, index) => {
    if (store === null || typeof store !== 'object' || Array.isArray(store)) {
      throw new Error(`shopify-graphql: ${label}[${index}] must be an object`)
    }
    const id = typeof store.id === 'string' ? store.id.trim() : ''
    if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(id)) {
      throw new Error(`shopify-graphql: ${label}[${index}].id must match [a-z0-9][a-z0-9_-]*`)
    }
    if (seen.has(id)) throw new Error(`shopify-graphql: duplicate store id "${id}"`)
    seen.add(id)

    const domain = normalizeDomain(store.domain)
    if (domain === undefined) {
      throw new Error(`shopify-graphql: ${label}[${index}].domain must be a *.myshopify.com domain`)
    }
    const apiVersion = typeof store.apiVersion === 'string' && store.apiVersion.trim() !== ''
      ? store.apiVersion.trim()
      : DEFAULT_API_VERSION
    if (!/^\d{4}-\d{2}$/.test(apiVersion)) {
      throw new Error(`shopify-graphql: ${label}[${index}].apiVersion must look like 2026-04`)
    }
    const prefix = `SHOPIFY_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
    const readToken = readTokenSlot(store.readToken ?? store.readTokenRef, {
      provider: 'local',
      ref: `${prefix}_READ_TOKEN`,
      field: `${label}[${index}].readToken`,
      infisical,
    })
    const writeToken = readTokenSlot(store.writeToken ?? store.writeTokenRef, {
      provider: infisical === undefined ? 'local' : 'infisical',
      ref: `${prefix}_WRITE_TOKEN`,
      field: `${label}[${index}].writeToken`,
      infisical,
      service: 'shopify',
      key: 'ADMIN_ACCESS_TOKEN',
    })
    return {
      id,
      domain,
      apiVersion,
      readToken,
      writeToken,
      label: typeof store.label === 'string' && store.label.trim() !== '' ? store.label.trim() : id,
    }
  })
}

/**
 * Load the per-user runtime store file, when it exists.
 *
 * The file lives under the plugin's state directory in this DSH home, so a
 * store configured by one system user is invisible to every other user.
 * @param stateDir - plugin state root.
 * @returns normalized runtime stores and Infisical config, or undefined.
 */
async function readRuntimeConfig(stateDir) {
  const file = path.join(stateDir, 'stores.yaml')
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw new Error(`shopify-graphql: runtime store file could not be read: ${file}`)
  }
  let document
  try {
    document = parseYaml(raw)
  } catch (error) {
    throw new Error(`shopify-graphql: runtime store file is not valid YAML: ${file}`)
  }
  if (document === null || document === undefined) return { file, stores: [], infisical: undefined }
  if (typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`shopify-graphql: runtime store file must be an object: ${file}`)
  }
  const allowed = new Set(['stores', 'infisical'])
  for (const key of Object.keys(document)) {
    if (!allowed.has(key)) throw new Error(`shopify-graphql: unknown runtime store key "${key}" in ${file}`)
  }
  const infisical = readInfisicalConfig(document.infisical)
  const stores = normalizeStores(document.stores ?? [], infisical, 'stores')
  return { file, stores, infisical }
}

/**
 * Normalize a store domain, rejecting anything that is not a myshopify host.
 * @param value - domain or URL.
 * @returns bare host, or undefined.
 */
function normalizeDomain(value) {
  if (typeof value !== 'string') return undefined
  let candidate = value.trim().toLowerCase()
  candidate = candidate.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\/$/, '')
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(candidate)) return candidate
  if (/^[a-z0-9][a-z0-9-]*$/.test(candidate)) return `${candidate}.myshopify.com`
  return undefined
}

/**
 * Expand a leading home marker.
 * @param value - path text.
 * @returns expanded path text.
 */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2))
  return value
}

/**
 * Validate a credential reference name.
 * @param value - reference.
 * @param field - config path for diagnostics.
 * @returns the reference.
 */
function credentialRef(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())) {
    throw new Error(`shopify-graphql: ${field} must be a POSIX identifier such as SHOPIFY_STORE_READ_TOKEN`)
  }
  return value.trim()
}

/**
 * Validate the optional Infisical connection block.
 * @param raw - config.infisical.
 * @returns normalized config, or undefined.
 */
function readInfisicalConfig(raw) {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('shopify-graphql: config.infisical must be an object')
  }
  const allowed = new Set([
    'baseUrl', 'projectId', 'environment', 'secretPathPrefix',
    'clientIdRef', 'clientSecretRef', 'cacheTtlMs', 'requestTimeoutMs',
  ])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`shopify-graphql: unknown infisical key "${key}"`)
  }
  const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== ''
    ? raw.baseUrl.trim().replace(/\/+$/, '')
    : 'https://app.infisical.com'
  let parsedUrl
  try {
    parsedUrl = new URL(baseUrl)
  } catch {
    throw new Error('shopify-graphql: infisical.baseUrl must be an absolute URL')
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
    throw new Error('shopify-graphql: infisical.baseUrl must use HTTPS (HTTP is allowed only for localhost)')
  }
  if (typeof raw.projectId !== 'string' || raw.projectId.trim() === '') {
    throw new Error('shopify-graphql: infisical.projectId is required')
  }
  const environment = typeof raw.environment === 'string' && raw.environment.trim() !== '' ? raw.environment.trim() : 'prod'
  const secretPathPrefix = typeof raw.secretPathPrefix === 'string' && raw.secretPathPrefix.trim() !== ''
    ? raw.secretPathPrefix.trim()
    : '/stores'
  const clientIdRef = credentialRef(raw.clientIdRef ?? 'INFISICAL_CLIENT_ID', 'infisical.clientIdRef')
  const clientSecretRef = credentialRef(raw.clientSecretRef ?? 'INFISICAL_CLIENT_SECRET', 'infisical.clientSecretRef')
  const cacheTtlMs = raw.cacheTtlMs ?? 30_000
  if (!Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 300_000) {
    throw new Error('shopify-graphql: infisical.cacheTtlMs must be an integer from 0 to 300000')
  }
  const requestTimeoutMs = raw.requestTimeoutMs ?? 10_000
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 60_000) {
    throw new Error('shopify-graphql: infisical.requestTimeoutMs must be an integer from 1000 to 60000')
  }
  return {
    baseUrl,
    projectId: raw.projectId.trim(),
    environment,
    secretPathPrefix,
    clientIdRef,
    clientSecretRef,
    cacheTtlMs,
    requestTimeoutMs,
  }
}

/**
 * Validate one token slot: a local credential reference or an Infisical secret.
 * @param value - slot config, legacy reference string, or undefined.
 * @param defaults - provider defaults and fallback names.
 * @returns normalized token slot.
 */
function readTokenSlot(value, defaults) {
  if (value === undefined || value === null) {
    return buildTokenSlot({}, defaults)
  }
  if (typeof value === 'string') {
    return { provider: 'local', ref: credentialRef(value, defaults.field) }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`shopify-graphql: ${defaults.field} must be a string or an object`)
  }
  const allowed = new Set(['provider', 'ref', 'service', 'key'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`shopify-graphql: unknown ${defaults.field} key "${key}"`)
  }
  return buildTokenSlot(value, defaults)
}

/**
 * Build one normalized token slot from a partial config object.
 * @param value - slot object.
 * @param defaults - provider defaults and fallbacks.
 * @returns normalized slot.
 */
function buildTokenSlot(value, defaults) {
  const provider = value.provider ?? defaults.provider
  if (provider === 'local') {
    if (value.service !== undefined || value.key !== undefined) {
      throw new Error(`shopify-graphql: ${defaults.field} uses the local provider, so service/key do not apply`)
    }
    return { provider: 'local', ref: credentialRef(value.ref ?? defaults.ref, `${defaults.field}.ref`) }
  }
  if (provider === 'infisical') {
    if (defaults.infisical === undefined) {
      throw new Error(`shopify-graphql: ${defaults.field} uses Infisical but config.infisical is missing`)
    }
    if (value.ref !== undefined) {
      throw new Error(`shopify-graphql: ${defaults.field} uses Infisical, so ref does not apply`)
    }
    const service = value.service ?? defaults.service ?? 'shopify'
    if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(service)) {
      throw new Error(`shopify-graphql: ${defaults.field}.service must match [a-z0-9][a-z0-9_-]*`)
    }
    const key = value.key ?? defaults.key ?? 'ADMIN_ACCESS_TOKEN'
    if (!/^[A-Za-z0-9_]{1,120}$/.test(key)) {
      throw new Error(`shopify-graphql: ${defaults.field}.key must be an alphanumeric/underscore secret name`)
    }
    return { provider: 'infisical', service, key }
  }
  throw new Error(`shopify-graphql: ${defaults.field}.provider must be "local" or "infisical"`)
}

/**
 * Read a bounded JSON request body.
 * @param request - Fetch request.
 * @returns parsed body.
 */
async function readJsonBody(request) {
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > 1_048_576) {
    throw new AppError('body_too_large', 'Request body exceeds 1 MiB.')
  }
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    throw new AppError('invalid_json', 'Request body must be valid JSON.')
  }
}

/**
 * Compose the model-facing tool description from configured stores.
 * @param stores - normalized stores.
 * @returns description text.
 */
function describeTool(stores) {
  const storeList = stores.length === 0
    ? 'No store is configured yet; the tool will reject calls until the bundle config lists one.'
    : stores.map(store => `${store.id} (${store.domain})`).join(', ')
  return [
    'Run Shopify Admin GraphQL.',
    `Configured stores: ${storeList}. Pass storeId when more than one store is configured.`,
    'Queries run immediately with the store read-only token. Mutations are held for the user to inspect and approve in the Shopify panel before the write token is used; approval binds to the exact document and variables you send, so do not resend a modified document expecting the previous approval to apply.',
    'Use one operation per call. If the document contains more than one operation, pass operationName. Include the variables object instead of inlining large values. Keep mutations minimal and readable; the user reviews the raw document.',
  ].join(' ')
}

/**
 * Register tools, browser routes, and storage for the plugin.
 * @param ctx - Host context.
 * @param rawConfig - loader row config.
 * @returns when the plugin is ready.
 */
export async function apply(ctx, rawConfig) {
  const baseConfig = readConfig(rawConfig)
  const runtime = await readRuntimeConfig(baseConfig.stateDir)
  const merged = [...(runtime?.stores ?? []), ...baseConfig.stores]
  const seen = new Set()
  for (const store of merged) {
    if (seen.has(store.id)) {
      throw new Error(`shopify-graphql: store "${store.id}" is defined in both the runtime store file and the bundle config`)
    }
    seen.add(store.id)
  }
  const config = {
    ...baseConfig,
    stores: merged,
    infisical: runtime?.infisical ?? baseConfig.infisical,
    storeFilePath: runtime?.file ?? path.join(baseConfig.stateDir, 'stores.yaml'),
    runtimeStoreIds: new Set((runtime?.stores ?? []).map(store => store.id)),
  }
  const secrets = createSecrets({ ctx, infisical: config.infisical })
  const client = new ShopifyAdminClient({ timeoutMs: config.fetchTimeoutMs })
  const history = new HistoryStore({
    file: path.join(config.stateDir, 'history.json'),
    auditFile: path.join(config.stateDir, 'audit.jsonl'),
  })
  const pending = createPendingManager()
  const runner = createRunner({ config, secrets, pending, history, client, stateDir: config.stateDir })
  const saved = new SavedToolStore({
    ctx,
    file: path.join(config.stateDir, 'tools.json'),
    runner,
  })

  await history.load()
  try {
    await saved.load()
  } catch (error) {
    // A single broken saved tool must not prevent the plugin from loading.
    console.error(`shopify-graphql: saved tools could not be loaded: ${messageOf(error)}`)
  }

  let mainToolDispose = null
  function createMainTool() {
    return {
      name: 'shopify_graphql',
      description: describeTool(config.stores),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['document'],
        properties: {
          storeId: {
            type: 'string',
            description: 'Configured store id. Required when more than one store is configured.',
          },
          document: {
            type: 'string',
            description: 'Complete Shopify Admin GraphQL document: one query or mutation, and its operation name if present.',
          },
          variables: {
            type: 'object',
            additionalProperties: true,
            description: 'GraphQL variables object. Prefer this over inlining large values.',
          },
          operationName: {
            type: 'string',
            description: 'Operation to run when the document contains more than one operation.',
          },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          if (value?.status !== 'ok' && value?.status !== 'error') {
            return [{ type: 'text', text: value?.reason ?? value?.summary ?? JSON.stringify(value, null, 2) }]
          }
          const payload = JSON.stringify({ data: value.data ?? null, errors: value.errors ?? [] }, null, 2)
          const head = `${value.summary ?? 'Shopify GraphQL'} — ${value.status} (${value.durationMs ?? 0} ms)`
          return [{ type: 'text', text: `${head}\n\n${truncate(payload, 60_000)}` }]
        },
      },
      execute: async (args, exec) => {
        if (typeof args?.document !== 'string' || args.document.trim() === '') {
          throw new Error('shopify_graphql: document must be a non-empty GraphQL string.')
        }
        if (args.variables !== undefined && (args.variables === null || typeof args.variables !== 'object' || Array.isArray(args.variables))) {
          throw new Error('shopify_graphql: variables must be an object.')
        }
        if (args.storeId !== undefined && typeof args.storeId !== 'string') {
          throw new Error('shopify_graphql: storeId must be a string.')
        }
        const sessionId = exec.agent?.session?.id
        try {
          return await runner.run({
            storeId: args.storeId,
            document: args.document,
            variables: args.variables,
            operationName: args.operationName,
            source: 'direct',
            toolName: 'shopify_graphql',
            sessionId,
            signal: exec.signal,
          })
        } catch (error) {
          throw new Error(`shopify_graphql: ${messageOf(error)}`)
        }
      },
    }
  }

  function registerMainTool() {
    if (mainToolDispose !== null) mainToolDispose()
    mainToolDispose = ctx.tools.register(createMainTool())
  }

  registerMainTool()
  ctx.effect(() => () => {
    if (mainToolDispose !== null) mainToolDispose()
    mainToolDispose = null
  }, 'shopify-graphql: main tool')

  /**
   * Persist the runtime store registry and the optional Infisical block.
   * The loader-level store list is never rewritten.
   * @returns when the file is written.
   */
  async function writeRuntimeStores() {
    const runtimeStores = config.stores
      .filter(store => config.runtimeStoreIds.has(store.id))
      .map(store => ({
        id: store.id,
        domain: store.domain,
        apiVersion: store.apiVersion,
        label: store.label,
        readToken: store.readToken,
        writeToken: store.writeToken,
      }))
    const document = {
      stores: runtimeStores,
      ...(config.infisical === undefined ? {} : { infisical: config.infisical }),
    }
    await mkdir(path.dirname(config.storeFilePath), { recursive: true })
    await writeFile(config.storeFilePath, stringifyYaml(document), 'utf8')
  }

  /**
   * Public store summary for browser responses.
   * @param store - normalized store.
   * @returns non-secret fields.
   */
  function storeSummary(store) {
    return {
      id: store.id,
      label: store.label,
      domain: store.domain,
      apiVersion: store.apiVersion,
      source: config.runtimeStoreIds.has(store.id) ? 'runtime' : 'config',
    }
  }

  const registerRoute = (routePath, methods, handler, label) => {
    ctx.effect(
      () => ctx.connection.fetch.register({
        path: routePath,
        methods,
        // The DSH HTTP bridge omits the body on empty buffered requests.
        // An undefined mode takes the streaming branch, which is invalid for GET.
        requestBody: 'buffered',
        fetch: handler,
      }),
      label,
    )
  }

  /**
   * Build the panel's compact state.
   * @returns state payload.
   */
  async function statePayload() {
    const stores = await Promise.all(config.stores.map(async store => ({
      id: store.id,
      label: store.label,
      domain: store.domain,
      apiVersion: store.apiVersion,
      source: config.runtimeStoreIds.has(store.id) ? 'runtime' : 'config',
      read: await secrets.describe(store, 'read'),
      write: await secrets.describe(store, 'write'),
    })))
    const infisical = config.infisical === undefined ? null : {
      baseUrl: config.infisical.baseUrl,
      projectId: config.infisical.projectId,
      environment: config.infisical.environment,
      secretPathPrefix: config.infisical.secretPathPrefix,
      clientIdRef: config.infisical.clientIdRef,
      clientSecretRef: config.infisical.clientSecretRef,
      identity: {
        clientId: await secrets.local.describe(config.infisical.clientIdRef),
        clientSecret: await secrets.local.describe(config.infisical.clientSecretRef),
      },
    }
    return {
      stores,
      config: {
        stateDir: config.stateDir,
        storeFile: config.storeFilePath,
        infisical,
      },
      pending: pending.list(),
      history: history.list(),
      tools: saved.list().map(tool => ({
        id: tool.id,
        name: tool.name,
        title: tool.title,
        description: tool.description,
        storeId: tool.storeId,
        operationType: tool.operationType,
        enabled: tool.enabled,
        params: tool.params,
        createdAt: tool.createdAt,
      })),
    }
  }

  registerRoute('/api/shopify-graphql/state', ['GET'], async () => {
    try {
      return Response.json(await statePayload())
    } catch (error) {
      return failureResponse(error, 500)
    }
  }, 'shopify-graphql: state route')

  registerRoute('/api/shopify-graphql/request', ['GET'], async request => {
    try {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      const record = pending.get(id)
      if (record === undefined) return failureResponse(new AppError('request_not_found', 'No pending request exists.'), 404)
      return Response.json({ request: record })
    } catch (error) {
      return failureResponse(error)
    }
  }, 'shopify-graphql: request route')

  registerRoute('/api/shopify-graphql/decide', ['POST'], async request => {
    try {
      const body = await readJsonBody(request)
      const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : undefined
      if (decision === undefined) throw new AppError('invalid_decision', 'decision must be "approve" or "reject".')
      const record = pending.decide(String(body.id ?? ''), decision, 'user')
      return Response.json({ ok: true, request: { id: record.id, status: record.status } })
    } catch (error) {
      return failureResponse(error, error instanceof AppError && error.code === 'request_expired' ? 410 : 400)
    }
  }, 'shopify-graphql: decide route')

  registerRoute('/api/shopify-graphql/history', ['GET'], async request => {
    try {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      const entry = history.get(id)
      if (entry === undefined) return failureResponse(new AppError('history_not_found', 'No history entry exists.'), 404)
      return Response.json({ entry })
    } catch (error) {
      return failureResponse(error)
    }
  }, 'shopify-graphql: history route')

  registerRoute('/api/shopify-graphql/save-tool', ['POST'], async request => {
    try {
      const body = await readJsonBody(request)
      const entry = history.get(String(body.historyId ?? ''))
      if (entry === undefined) throw new AppError('history_not_found', 'The source execution no longer exists.')
      const tool = await saved.createFromHistory({
        historyEntry: entry,
        name: body.name,
        title: body.title,
        description: body.description,
        params: Array.isArray(body.params) ? body.params : [],
      })
      return Response.json({ tool: { id: tool.id, name: tool.name, title: tool.title, enabled: tool.enabled } })
    } catch (error) {
      return failureResponse(error)
    }
  }, 'shopify-graphql: save tool route')

  registerRoute('/api/shopify-graphql/tool', ['GET', 'POST'], async request => {
    try {
      if (request.method === 'GET') {
        const id = new URL(request.url).searchParams.get('id') ?? ''
        const tool = saved.get(id)
        if (tool === undefined) return failureResponse(new AppError('tool_not_found', 'No saved tool exists.'), 404)
        return Response.json({ tool })
      }
      const body = await readJsonBody(request)
      const id = String(body.id ?? '')
      if (body.action === 'delete') {
        await saved.remove(id)
        return Response.json({ ok: true })
      }
      if (body.action === 'update') {
        const tool = await saved.update(id, {
          title: body.title,
          description: body.description,
          enabled: body.enabled,
        })
        return Response.json({ tool: { id: tool.id, enabled: tool.enabled, title: tool.title } })
      }
      throw new AppError('invalid_action', 'action must be "update" or "delete".')
    } catch (error) {
      return failureResponse(error)
    }
  }, 'shopify-graphql: tool route')

  registerRoute('/api/shopify-graphql/invoke', ['POST'], async request => {
    try {
      const body = await readJsonBody(request)
      const tool = saved.get(String(body.id ?? ''))
      if (tool === undefined) throw new AppError('tool_not_found', 'No saved tool exists.')
      const result = await saved.invoke(tool.id, body.variables)
      return Response.json({ result })
    } catch (error) {
      return failureResponse(error, 400)
    }
  }, 'shopify-graphql: invoke route')

  registerRoute('/api/shopify-graphql/store', ['POST'], async request => {
    try {
      const body = await readJsonBody(request)
      if (body.action === 'add') {
        const writeProvider = body.writeProvider === 'local'
          ? 'local'
          : body.writeProvider === 'infisical'
            ? 'infisical'
            : config.infisical === undefined ? 'local' : 'infisical'
        const [candidate] = normalizeStores([{
          id: body.id,
          domain: body.domain,
          apiVersion: body.apiVersion,
          label: body.label,
          readToken: { provider: 'local' },
          writeToken: { provider: writeProvider },
        }], config.infisical, 'stores')
        if (config.stores.some(store => store.id === candidate.id)) {
          throw new AppError('store_exists', `Store "${candidate.id}" is already configured.`)
        }
        config.stores.push(candidate)
        config.runtimeStoreIds.add(candidate.id)
        await writeRuntimeStores()
        registerMainTool()
        return Response.json({ ok: true, store: storeSummary(candidate) })
      }
      if (body.action === 'remove') {
        const id = String(body.id ?? '')
        if (!config.runtimeStoreIds.has(id)) {
          throw new AppError('store_config_managed', 'This store comes from the bundle config; remove it there instead.')
        }
        const index = config.stores.findIndex(store => store.id === id)
        if (index < 0) throw new AppError('store_not_found', `Store "${id}" is not configured.`)
        config.stores.splice(index, 1)
        config.runtimeStoreIds.delete(id)
        await writeRuntimeStores()
        registerMainTool()
        return Response.json({ ok: true })
      }
      throw new AppError('invalid_action', 'action must be "add" or "remove".')
    } catch (error) {
      return failureResponse(error)
    }
  }, 'shopify-graphql: store route')

  registerRoute('/api/shopify-graphql/infisical', ['POST'], async request => {
    try {
      const body = await readJsonBody(request)
      if (body.action !== undefined && body.action !== 'save' && body.action !== 'clear') {
        throw new AppError('invalid_action', 'action must be "save" or "clear".')
      }
      if (body.action === 'clear') {
        config.infisical = undefined
        secrets.setInfisical(undefined)
        await writeRuntimeStores()
        return Response.json({ ok: true, infisical: null })
      }
      const { action: _action, ...fields } = body
      const next = readInfisicalConfig(fields)
      config.infisical = next
      secrets.setInfisical(next)
      await writeRuntimeStores()
      return Response.json({ ok: true, infisical: { ...next } })
    } catch (error) {
      return failureResponse(error)
    }
  }, 'shopify-graphql: infisical route')

  registerRoute('/api/shopify-graphql/credential', ['POST'], async request => {
    try {
      const body = await readJsonBody(request)
      const kind = body.kind
      if (kind === 'infisical-id' || kind === 'infisical-secret') {
        if (config.infisical === undefined) {
          throw new AppError('infisical_not_configured', 'Save the Infisical connection before setting its machine identity.')
        }
        const service = ctx.get('credentials')
        if (service === undefined) {
          throw new AppError('credentials_unavailable', 'This profile has no credential store; set the reference through the process environment instead.')
        }
        const ref = kind === 'infisical-id' ? config.infisical.clientIdRef : config.infisical.clientSecretRef
        if (typeof body.value === 'string' && body.value.trim() !== '') {
          await service.set(ref, body.value.trim())
        } else {
          await service.unset(ref)
        }
        return Response.json({ ok: true, kind, credential: await secrets.local.describe(ref) })
      }

      const store = runner.resolveStore(body.storeId)
      if (kind !== 'read' && kind !== 'write') {
        throw new AppError('invalid_credential_kind', 'kind must be "read", "write", "infisical-id", or "infisical-secret".')
      }
      const slot = kind === 'read' ? store.readToken : store.writeToken
      if (slot.provider !== 'local') {
        throw new AppError('credential_external', 'This token is managed by Infisical; update it there instead.')
      }
      const service = ctx.get('credentials')
      if (service === undefined) {
        throw new AppError('credentials_unavailable', 'This profile has no credential store; set the reference through the process environment instead.')
      }
      if (typeof body.value === 'string' && body.value.trim() !== '') {
        await service.set(slot.ref, body.value.trim())
      } else {
        await service.unset(slot.ref)
      }
      return Response.json({ ok: true, storeId: store.id, kind, credential: await secrets.describe(store, kind) })
    } catch (error) {
      return failureResponse(error)
    }
  }, 'shopify-graphql: credential route')

  registerRoute('/api/shopify-graphql/policy', ['GET'], async request => {
    try {
      const storeId = new URL(request.url).searchParams.get('storeId') ?? undefined
      const store = runner.resolveStore(storeId)
      const loaded = await loadPolicy({ stateDir: config.stateDir, storeId: store.id })
      return Response.json({
        storeId: store.id,
        policy: loaded.policy,
        path: loaded.path,
        hash: loaded.hash,
        exists: loaded.exists,
      })
    } catch (error) {
      return failureResponse(error)
    }
  }, 'shopify-graphql: policy route')

  ctx.effect(
    () => () => {
      saved.dispose()
      pending.dispose()
    },
    'shopify-graphql: teardown',
  )
}