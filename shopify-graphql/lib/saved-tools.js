/**
 * Saved tools: a GraphQL execution the user chose to turn into a reusable DSH
 * tool. Parameters are the variables the user exposed; everything else is
 * fixed to the values of the source execution. Registration is dynamic, so a
 * saved tool behaves like any other DSH tool — except mutations still require
 * approval on every agent call.
 */
import { randomUUID } from 'node:crypto'
import { AppError } from './errors.js'
import { validateAgainstSchema } from './graphql-doc.js'
import { isPlainObject, normalizeToolName, nowIso, readJson, writeJsonAtomic } from './util.js'

/**
 * Saved-tool store bound to one plugin instance.
 */
export class SavedToolStore {
  /**
   * @param options - ctx, file, runner, and logging hook.
   */
  constructor(options) {
    this.ctx = options.ctx
    this.file = options.file
    this.runner = options.runner
    /** @type {object[]} */
    this.tools = []
    /** @type {Map<string, () => void>} */
    this.disposers = new Map()
    this.queue = Promise.resolve()
  }

  /**
   * Load persisted definitions and register the enabled ones.
   * @returns when loaded.
   */
  async load() {
    const stored = await readJson(this.file, [])
    this.tools = Array.isArray(stored) ? stored.filter(tool => tool !== null && typeof tool === 'object') : []
    for (const tool of this.tools) {
      if (tool.enabled === false) continue
      try {
        this.register(tool)
      } catch (error) {
        tool.enabled = false
        tool.lastError = error?.message ?? String(error)
      }
    }
  }

  /**
   * Persist the current definitions.
   * @returns when written.
   */
  async save() {
    this.queue = this.queue.then(() => writeJsonAtomic(this.file, this.tools)).catch(() => undefined)
    await this.queue
  }

  /**
   * List tool definitions for the panel.
   * @returns public definitions including parameter metadata.
   */
  list() {
    return this.tools.map(tool => ({ ...tool }))
  }

  /**
   * Read one definition.
   * @param id - tool id.
   * @returns the definition, or undefined.
   */
  get(id) {
    return this.tools.find(tool => tool.id === id)
  }

  /**
   * Create a tool from a history entry.
   * @param input - history, name/title/description, and exposed parameter names.
   * @returns the new definition.
   */
  async createFromHistory(input) {
    const { historyEntry } = input
    if (historyEntry === undefined) throw new AppError('history_not_found', 'The source execution no longer exists.')
    if (historyEntry.status !== 'ok' && historyEntry.status !== 'error') {
      throw new AppError('history_not_savable', 'Only executed requests can be saved as tools.')
    }
    const name = normalizeToolName(input.name)
    this.assertNameAvailable(name)
    if (typeof input.title !== 'string' || input.title.trim() === '') {
      throw new AppError('invalid_title', 'A tool title is required.')
    }

    const variableDefs = Array.isArray(historyEntry.variableDefs) ? historyEntry.variableDefs : []
    const byName = new Map(variableDefs.map(variable => [variable.name, variable]))
    const exposed = Array.isArray(input.params) ? input.params : []
    const exposedNames = new Set()
    const params = []
    for (const requested of exposed) {
      const variable = byName.get(requested?.name)
      if (variable === undefined) {
        throw new AppError('invalid_param', `Unknown variable "${requested?.name}".`)
      }
      if (exposedNames.has(requested.name)) {
        throw new AppError('invalid_param', `Variable "${requested.name}" is exposed twice.`)
      }
      exposedNames.add(requested.name)
      params.push({
        name: requested.name,
        description: typeof requested.description === 'string' && requested.description.trim() !== ''
          ? requested.description.trim()
          : `${requested.name} (${variable.type})`,
      })
    }

    const fixedVariables = {}
    for (const variable of variableDefs) {
      if (exposedNames.has(variable.name)) continue
      const value = historyEntry.variables?.[variable.name] ?? variable.defaultValue
      if (value === undefined && variable.required) {
        throw new AppError(
          'invalid_param',
          `Variable "${variable.name}" is required; expose it or rerun the source execution with a value.`,
        )
      }
      if (value !== undefined) fixedVariables[variable.name] = value
    }

    const createdAt = nowIso()
    const tool = {
      id: `tool_${randomUUID().slice(0, 8)}`,
      name,
      title: input.title.trim(),
      description: typeof input.description === 'string' ? input.description.trim() : '',
      storeId: historyEntry.storeId,
      operationType: historyEntry.operationType,
      operationName: historyEntry.operationName,
      document: historyEntry.document,
      variableDefs,
      params,
      fixedVariables,
      sourceHistoryId: historyEntry.id,
      createdAt,
      updatedAt: createdAt,
      enabled: true,
    }
    this.tools.push(tool)
    await this.save()
    this.register(tool)
    return tool
  }

  /**
   * Update editable metadata.
   * @param id - tool id.
   * @param patch - title, description, or enabled.
   * @returns the updated definition.
   */
  async update(id, patch) {
    const tool = this.get(id)
    if (tool === undefined) throw new AppError('tool_not_found', `No saved tool ${id} exists.`)
    if (typeof patch.title === 'string' && patch.title.trim() !== '') tool.title = patch.title.trim()
    if (typeof patch.description === 'string') tool.description = patch.description.trim()
    if (typeof patch.enabled === 'boolean') tool.enabled = patch.enabled
    tool.updatedAt = nowIso()
    await this.save()
    this.unregister(id)
    if (tool.enabled) this.register(tool)
    return tool
  }

  /**
   * Delete a saved tool and unregister it.
   * @param id - tool id.
   * @returns when removed.
   */
  async remove(id) {
    const index = this.tools.findIndex(tool => tool.id === id)
    if (index < 0) throw new AppError('tool_not_found', `No saved tool ${id} exists.`)
    this.unregister(id)
    this.tools.splice(index, 1)
    await this.save()
  }

  /**
   * Invoke a saved tool from the panel.
   * @param id - tool id.
   * @param variables - user-supplied variable values.
   * @param signal - optional cancellation.
   * @returns the runner result.
   */
  async invoke(id, variables, signal) {
    const tool = this.get(id)
    if (tool === undefined) throw new AppError('tool_not_found', `No saved tool ${id} exists.`)
    return this.runner.invokeSaved(tool, this.mergeVariables(tool, variables, true), signal)
  }

  /**
   * Build the model-facing parameter schema for one definition.
   * @param tool - saved definition.
   * @returns JSON Schema object.
   */
  buildParameters(tool) {
    const byName = new Map((tool.variableDefs ?? []).map(variable => [variable.name, variable]))
    const properties = {}
    const required = []
    for (const param of tool.params) {
      const variable = byName.get(param.name)
      const schema = variable?.schema ?? {}
      properties[param.name] = {
        ...schema,
        description: param.description,
        ...(variable?.defaultValue !== undefined ? { default: variable.defaultValue } : {}),
      }
      if (variable?.required === true && variable?.defaultValue === undefined) required.push(param.name)
    }
    return {
      type: 'object',
      additionalProperties: false,
      ...(required.length > 0 ? { required } : {}),
      properties,
    }
  }

  /**
   * Validate and merge fixed + supplied variables.
   * @param tool - saved definition.
   * @param supplied - caller values.
   * @param userInitiated - whether the panel is invoking.
   * @returns merged variables.
   */
  mergeVariables(tool, supplied, userInitiated = false) {
    if (supplied !== undefined && !isPlainObject(supplied)) {
      throw new AppError('invalid_variables', 'variables must be an object.')
    }
    const merged = { ...(tool.fixedVariables ?? {}), ...(supplied ?? {}) }
    const byName = new Map((tool.variableDefs ?? []).map(variable => [variable.name, variable]))
    for (const param of tool.params) {
      const variable = byName.get(param.name)
      if (merged[param.name] === undefined && variable?.required === true) {
        throw new AppError('missing_variable', `Variable "${param.name}" is required.`)
      }
      if (merged[param.name] !== undefined) {
        const issue = validateAgainstSchema(variable?.schema, merged[param.name])
        if (issue !== undefined) {
          throw new AppError('invalid_variable', `Variable "${param.name}" ${issue}.`)
        }
      }
    }
    return merged
  }

  /**
   * Register one saved tool on the Harness tool registry.
   * @param tool - saved definition.
   * @returns when registered.
   */
  register(tool) {
    this.unregister(tool.id)
    if (this.ctx.tools.get(tool.name) !== undefined) {
      throw new AppError('tool_name_conflict', `A tool named "${tool.name}" is already registered.`)
    }
    const parameters = this.buildParameters(tool)
    const description = [
      tool.description || tool.title,
      `Saved from a Shopify GraphQL ${tool.operationType} on store "${tool.storeId}".`,
      tool.operationType === 'mutation'
        ? 'This is a write operation: every agent call still waits for user approval before execution.'
        : 'This is a read operation and executes directly with the store read token.',
    ].join(' ')
    const disposer = this.ctx.tools.register({
      name: tool.name,
      description,
      parameters,
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{
          type: 'text',
          text: typeof value?.summary === 'string'
            ? `${value.summary}\n\n${JSON.stringify(value.data ?? value, null, 2)}`
            : JSON.stringify(value, null, 2),
        }],
      },
      execute: async (args, exec) => {
        const merged = this.mergeVariables(tool, args)
        return this.runner.run({
          storeId: tool.storeId,
          document: tool.document,
          variables: merged,
          operationName: tool.operationName,
          source: 'saved',
          toolName: tool.name,
          savedTool: tool,
          signal: exec.signal,
        })
      },
    })
    this.disposers.set(tool.id, disposer)
  }

  /**
   * Unregister one saved tool, if registered.
   * @param id - tool id.
   */
  unregister(id) {
    const disposer = this.disposers.get(id)
    if (disposer !== undefined) {
      this.disposers.delete(id)
      disposer()
    }
  }

  /**
   * Unregister everything (plugin unload).
   */
  dispose() {
    for (const disposer of this.disposers.values()) disposer()
    this.disposers.clear()
  }

  /**
   * Reject a name that collides with a live tool.
   * @param name - normalized tool name.
   */
  assertNameAvailable(name) {
    if (this.ctx.tools.get(name) !== undefined) {
      throw new AppError('tool_name_conflict', `A tool named "${name}" is already registered.`)
    }
    if (this.tools.some(tool => tool.name === name)) {
      throw new AppError('tool_name_conflict', `A saved tool named "${name}" already exists.`)
    }
  }
}