/**
 * Shopify Admin GraphQL document analysis: operation classification, a
 * human-readable operation summary, and a bounded structural view for the
 * approval panel. Parsing uses the official `graphql` package; nothing here
 * executes a request.
 */
import { GraphQLError, Kind, parse, print } from 'graphql'
import { AppError } from './errors.js'
import { byteLength } from './util.js'

/** Chinese labels for common Shopify mutation root fields. */
const MUTATION_LABELS = {
  orderUpdate: '修改订单',
  orderCancel: '取消订单',
  orderClose: '关闭订单',
  orderEditBegin: '开始编辑订单',
  orderEditAddVariant: '向订单添加商品',
  orderEditCommit: '提交订单编辑',
  tagsAdd: '添加标签',
  tagsRemove: '移除标签',
  productCreate: '创建商品',
  productUpdate: '修改商品',
  productDelete: '删除商品',
  productSet: '设置商品',
  productVariantsBulkCreate: '批量创建商品变体',
  productVariantsBulkUpdate: '批量修改商品变体',
  productVariantsBulkDelete: '批量删除商品变体',
  inventoryAdjustQuantities: '调整库存',
  inventorySetQuantities: '设置库存',
  discountCodeCreate: '创建折扣码',
  discountCodeUpdate: '修改折扣码',
  discountCodeDelete: '删除折扣码',
  customerCreate: '创建客户',
  customerUpdate: '修改客户',
  customerDelete: '删除客户',
  draftOrderCreate: '创建草稿订单',
  draftOrderUpdate: '修改草稿订单',
  draftOrderComplete: '完成草稿订单',
  draftOrderDelete: '删除草稿订单',
  fulfillmentCreate: '创建履约',
  fulfillmentCancel: '取消履约',
  refundCreate: '创建退款',
  collectionCreate: '创建集合',
  collectionUpdate: '修改集合',
  collectionDelete: '删除集合',
  metafieldsSet: '写入元字段',
  metafieldsDelete: '删除元字段',
  metaobjectCreate: '创建元对象',
  metaobjectUpdate: '修改元对象',
  metaobjectDelete: '删除元对象',
  fileCreate: '创建文件',
  fileUpdate: '修改文件',
  fileDelete: '删除文件',
  pageCreate: '创建页面',
  pageUpdate: '修改页面',
  pageDelete: '删除页面',
  blogCreate: '创建博客',
  blogUpdate: '修改博客',
  blogDelete: '删除博客',
  articleCreate: '创建文章',
  articleUpdate: '修改文章',
  articleDelete: '删除文章',
  menuCreate: '创建菜单',
  menuUpdate: '修改菜单',
  menuDelete: '删除菜单',
  themeFilesUpsert: '写入主题文件',
  publishablePublish: '发布资源',
  publishableUnpublish: '取消发布',
  marketCreate: '创建市场',
  marketUpdate: '修改市场',
  marketDelete: '删除市场',
  deliveryProfileCreate: '创建配送方案',
  deliveryProfileUpdate: '修改配送方案',
  deliveryProfileRemove: '删除配送方案',
  appUninstall: '卸载应用',
}

/** Chinese labels for common query root fields. */
const QUERY_LABELS = {
  shop: '查询店铺信息',
  order: '查询订单',
  orders: '查询订单列表',
  orderByIdentifier: '按标识查询订单',
  product: '查询商品',
  products: '查询商品列表',
  productByHandle: '按 handle 查询商品',
  customer: '查询客户',
  customers: '查询客户列表',
  draftOrder: '查询草稿订单',
  draftOrders: '查询草稿订单列表',
  inventoryItems: '查询库存项',
  inventoryLevels: '查询库存水平',
  locations: '查询地点',
  themes: '查询主题列表',
  theme: '查询主题',
  collections: '查询集合列表',
  collection: '查询集合',
  pages: '查询页面列表',
  page: '查询页面',
  blogs: '查询博客列表',
  articles: '查询文章列表',
  discounts: '查询折扣列表',
  discountNodes: '查询折扣列表',
  fulfillments: '查询履约列表',
  markets: '查询市场列表',
  metaobjects: '查询元对象',
  files: '查询文件列表',
  urlRedirects: '查询 URL 重定向',
}

/** Chinese resource-type labels used in summaries and chips. */
const RESOURCE_LABELS = {
  Order: '订单',
  Product: '商品',
  ProductVariant: '商品变体',
  Customer: '客户',
  DraftOrder: '草稿订单',
  DiscountCodeNode: '折扣码',
  DiscountCode: '折扣码',
  InventoryItem: '库存项',
  InventoryLevel: '库存水平',
  Location: '地点',
  Fulfillment: '履约',
  Collection: '集合',
  Page: '页面',
  Blog: '博客',
  Article: '文章',
  Menu: '菜单',
  Metaobject: '元对象',
  Metafield: '元字段',
  File: '文件',
  OnlineStoreTheme: '主题',
  Market: '市场',
  DeliveryProfile: '配送方案',
  Shop: '店铺',
}

/** Mutation input keys that deserve a mention in the summary. */
const INPUT_FIELD_LABELS = {
  note: '备注',
  tags: '标签',
  email: '邮箱',
  title: '标题',
  descriptionHtml: '描述',
  description: '描述',
  status: '状态',
  handle: 'handle',
  price: '价格',
  inventoryQuantities: '库存数量',
  metafields: '元字段',
  publishedAt: '发布时间',
  body: '正文',
  summary: '摘要',
}

/**
 * Parse and classify one GraphQL document.
 * @param document - complete GraphQL source.
 * @param operationName - optional operation to select from a multi-operation document.
 * @param variables - supplied variable values.
 * @returns parsed operation, classification, variable metadata, and visual view.
 */
export function analyzeDocument(document, operationName, variables = {}) {
  let ast
  try {
    ast = parse(document)
  } catch (error) {
    const detail = error instanceof GraphQLError ? error.message : String(error)
    throw new AppError('graphql_parse_error', `GraphQL parse failed: ${detail}`)
  }

  const fragments = new Map()
  for (const definition of ast.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition)
  }
  const operations = ast.definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION)
  if (operations.length === 0) {
    throw new AppError('graphql_parse_error', 'The document contains no operation.')
  }

  let operation
  if (typeof operationName === 'string' && operationName.trim() !== '') {
    operation = operations.find(candidate => candidate.name?.value === operationName.trim())
    if (operation === undefined) {
      throw new AppError('operation_not_found', `No operation named "${operationName}" exists in the document.`)
    }
  } else if (operations.length === 1) {
    operation = operations[0]
  } else {
    throw new AppError('operation_ambiguous', 'The document contains multiple operations; pass operationName.')
  }

  if (operation.operation === 'subscription') {
    throw new AppError('unsupported_operation', 'Shopify Admin GraphQL does not support subscriptions here.')
  }

  const rootFieldNodes = collectRootFields(operation.selectionSet, fragments)
  const variableDefs = buildVariableDefs(operation, variables)
  const visual = buildVisual({
    document,
    operation,
    operationType: operation.operation,
    operationName: operation.name?.value ?? 'anonymous',
    rootFieldNodes,
    fragments,
    variableDefs,
    variables,
  })

  return {
    ast,
    operation,
    operationType: operation.operation,
    operationName: operation.name?.value ?? 'anonymous',
    rootFields: rootFieldNodes.map(field => field.name.value),
    rootFieldNodes,
    variableDefs,
    visual,
  }
}

/**
 * Expand a selection set into top-level field nodes, following fragments.
 * @param selectionSet - operation selection set.
 * @param fragments - fragment definitions keyed by name.
 * @returns top-level field nodes.
 */
function collectRootFields(selectionSet, fragments) {
  const fields = []
  const visitSelectionSet = (set, visited) => {
    for (const selection of set.selections) {
      if (selection.kind === Kind.FIELD) fields.push(selection)
      else if (selection.kind === Kind.INLINE_FRAGMENT) visitSelectionSet(selection.selectionSet, visited)
      else if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value
        if (visited.has(name)) continue
        const fragment = fragments.get(name)
        if (fragment !== undefined) {
          const next = new Set(visited)
          next.add(name)
          visitSelectionSet(fragment.selectionSet, next)
        }
      }
    }
  }
  visitSelectionSet(selectionSet, new Set())
  return fields
}

/**
 * Build the variable metadata list, resolving supplied values and defaults.
 * @param operation - selected operation node.
 * @param variables - supplied values.
 * @returns one entry per variable definition.
 */
function buildVariableDefs(operation, variables) {
  return (operation.variableDefinitions ?? []).map(definition => {
    const name = definition.variable.name.value
    const type = print(definition.type)
    const defaultValue = definition.defaultValue === undefined
      ? undefined
      : valueNodeToJs(definition.defaultValue, variables)
    const supplied = variables?.[name]
    return {
      name,
      type,
      required: definition.type.kind === Kind.NON_NULL_TYPE,
      defaultValue,
      value: supplied !== undefined ? supplied : defaultValue,
      valueSupplied: supplied !== undefined,
      schema: jsonSchemaForType(definition.type),
    }
  })
}

/**
 * Convert a GraphQL type node into a supported JSON Schema node.
 * @param typeNode - named, list, or non-null type node.
 * @returns JSON Schema fragment (unknown types become unconstrained JSON).
 */
export function jsonSchemaForType(typeNode) {
  if (typeNode.kind === Kind.NON_NULL_TYPE) return jsonSchemaForType(typeNode.type)
  if (typeNode.kind === Kind.LIST_TYPE) return { type: 'array', items: jsonSchemaForType(typeNode.type) }
  const name = typeNode.name.value
  if (name === 'ID' || name === 'String') return { type: 'string' }
  if (name === 'Int') return { type: 'integer' }
  if (name === 'Float') return { type: 'number' }
  if (name === 'Boolean') return { type: 'boolean' }
  // Enums, input objects, and custom scalars need the live schema to be precise.
  return {}
}

/**
 * Convert a GraphQL value node into a JS value, resolving variables when present.
 * @param node - value node.
 * @param variables - supplied values.
 * @returns JS value, or undefined for an unresolved variable.
 */
function valueNodeToJs(node, variables) {
  switch (node.kind) {
    case Kind.VARIABLE:
      return variables?.[node.name.value]
    case Kind.INT:
      return Number(node.value)
    case Kind.FLOAT:
      return Number(node.value)
    case Kind.STRING:
      return node.value
    case Kind.BOOLEAN:
      return node.value
    case Kind.NULL:
      return null
    case Kind.ENUM:
      return node.value
    case Kind.LIST:
      return node.values.map(item => valueNodeToJs(item, variables))
    case Kind.OBJECT:
      return Object.fromEntries(node.fields.map(field => [field.name.value, valueNodeToJs(field.value, variables)]))
    default:
      return undefined
  }
}

/**
 * Read a field's arguments with both printed raw text and resolved values.
 * @param fieldNode - field node.
 * @param variables - supplied values.
 * @returns argument entries.
 */
function argumentEntries(fieldNode, variables) {
  return (fieldNode.arguments ?? []).map(argument => ({
    name: argument.name.value,
    raw: print(argument.value),
    value: valueNodeToJs(argument.value, variables),
  }))
}

/**
 * Walk a JS value and collect distinct Shopify resource GIDs.
 * @param value - argument value.
 * @param out - accumulator.
 * @returns the accumulator.
 */
function collectResources(value, out = new Map()) {
  if (typeof value === 'string') {
    const match = /^gid:\/\/shopify\/([A-Za-z]+)\/([0-9]+)$/.exec(value)
    if (match !== null) {
      const key = value
      if (!out.has(key)) {
        out.set(key, {
          gid: value,
          type: match[1],
          numericId: match[2],
          label: `${RESOURCE_LABELS[match[1]] ?? match[1]} #${match[2]}`,
        })
      }
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectResources(item, out)
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectResources(item, out)
  }
  return out
}

/**
 * Build the bounded field tree shown in the panel.
 * @param fieldNode - field node.
 * @param fragments - fragment definitions.
 * @param depth - current depth.
 * @param budget - remaining node budget.
 * @returns tree node.
 */
function fieldTreeNode(fieldNode, fragments, depth, budget) {
  const name = fieldNode.alias === undefined
    ? fieldNode.name.value
    : `${fieldNode.alias.value}: ${fieldNode.name.value}`
  const node = { name }
  if (depth >= 6 || budget.remaining <= 0) return node
  const children = []
  const expand = (selectionSet, visited) => {
    for (const selection of selectionSet.selections) {
      if (budget.remaining <= 0) return
      if (selection.kind === Kind.FIELD) {
        budget.remaining -= 1
        children.push(fieldTreeNode(selection, fragments, depth + 1, budget))
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        expand(selection.selectionSet, visited)
      } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const fragmentName = selection.name.value
        if (visited.has(fragmentName)) continue
        const fragment = fragments.get(fragmentName)
        if (fragment !== undefined) {
          const next = new Set(visited)
          next.add(fragmentName)
          expand(fragment.selectionSet, next)
        }
      }
    }
  }
  expand(fieldNode.selectionSet ?? { selections: [] }, new Set())
  if (children.length > 0) node.children = children
  return node
}

/**
 * Build the human summary and the structural view.
 * @param input - parsed operation and context.
 * @returns visual object stored with a pending request or history entry.
 */
function buildVisual(input) {
  const { document, operation, operationType, operationName, rootFieldNodes, fragments, variableDefs, variables } = input
  const isMutation = operationType === 'mutation'
  const labels = isMutation ? MUTATION_LABELS : QUERY_LABELS
  const documentBytes = byteLength(document)
  const variablesBytes = byteLength(variables ?? {})
  const resources = new Map()
  const rootFields = []
  const summaries = []

  for (const fieldNode of rootFieldNodes) {
    const name = fieldNode.name.value
    const args = argumentEntries(fieldNode, variables)
    for (const argument of args) collectResources(argument.value, resources)
    const budget = { remaining: 120 }
    rootFields.push({
      name,
      label: labels[name] ?? name,
      args,
      children: (fieldNode.selectionSet?.selections ?? [])
        .filter(selection => selection.kind === Kind.FIELD)
        .slice(0, 20)
        .map(selection => fieldTreeNode(selection, fragments, 1, budget)),
    })
    summaries.push(summarizeField({ name, args, isMutation, resources }))
  }

  const risk = []
  if (isMutation) risk.push('write')
  if (rootFieldNodes.some(field => /(delete|remove|cancel|refund|close|archive|destroy|revoke)/i.test(field.name.value))) {
    risk.push('destructive')
  }
  if (rootFieldNodes.some(field => /(publish|activate|complete|approve)/i.test(field.name.value))) {
    risk.push('publish')
  }
  if (operation.selectionSet.selections.some(selection => /bulk/i.test(selection.name?.value ?? ''))) {
    risk.push('bulk')
  }
  if (/__schema|__type/.test(document)) risk.push('introspection')
  if (documentBytes > 16384 || variablesBytes > 16384) risk.push('large')
  if (variableDefs.some(variable => variable.value === undefined && !variable.valueSupplied && variable.defaultValue === undefined)) {
    risk.push('unresolved-variable')
  }

  return {
    operationType,
    operationName,
    summary: summaries.join('；') || (isMutation ? '执行 Shopify 写操作' : '执行 Shopify 查询'),
    risk,
    resources: [...resources.values()],
    rootFields,
    variables: variableDefs.map(variable => ({
      name: variable.name,
      type: variable.type,
      required: variable.required,
      value: variable.value,
      valueSupplied: variable.valueSupplied,
      hasDefault: variable.defaultValue !== undefined,
    })),
    stats: {
      documentBytes,
      variablesBytes,
      rootFields: rootFieldNodes.length,
      fields: countFields(operation.selectionSet),
    },
  }
}

/**
 * Count selected fields (bounded) for the panel's size hint.
 * @param selectionSet - root selection set.
 * @returns field count.
 */
function countFields(selectionSet) {
  let count = 0
  const walk = set => {
    for (const selection of set.selections) {
      if (count >= 500) return
      if (selection.kind === Kind.FIELD) {
        count += 1
        if (selection.selectionSet !== undefined) walk(selection.selectionSet)
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        walk(selection.selectionSet)
      }
    }
  }
  walk(selectionSet)
  return count
}

/**
 * Produce one root field's Chinese summary.
 * @param input - field name, arguments, and collected resources.
 * @returns summary text.
 */
function summarizeField({ name, args, isMutation, resources }) {
  const target = [...resources.values()][0]?.label
  const details = []
  if (name === 'tagsAdd' || name === 'tagsRemove') {
    const tags = args.find(argument => argument.name === 'tags')?.value
    if (Array.isArray(tags) && tags.length > 0) details.push(`标签：${tags.join('、')}`)
  }
  const input = args.find(argument => argument.name === 'input')?.value
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(input)) {
      if (INPUT_FIELD_LABELS[key] !== undefined && !details.includes(INPUT_FIELD_LABELS[key])) {
        details.push(INPUT_FIELD_LABELS[key])
      }
    }
  }
  const label = isMutation ? (MUTATION_LABELS[name] ?? name) : (QUERY_LABELS[name] ?? name)
  if (!isMutation && name === 'shop') return '查询店铺信息'
  if (!isMutation && name === 'orders') {
    const query = args.find(argument => argument.name === 'query')?.value
    return typeof query === 'string' && query.trim() !== '' ? `查询订单列表（${query}）` : '查询订单列表'
  }
  if (!isMutation && name === 'products') {
    const query = args.find(argument => argument.name === 'query')?.value
    return typeof query === 'string' && query.trim() !== '' ? `查询商品列表（${query}）` : '查询商品列表'
  }
  const head = target === undefined ? label : `${label}：${target}`
  return details.length > 0 ? `${head}（${details.join('、')}）` : head
}

/**
 * Validate a variable value against the GraphQL type's JSON Schema fragment.
 * @param schema - JSON Schema fragment.
 * @param value - supplied value.
 * @returns error message or undefined.
 */
export function validateAgainstSchema(schema, value) {
  if (schema === undefined || schema.type === undefined) return undefined
  if (schema.type === 'string' && typeof value !== 'string') return 'must be a string'
  if (schema.type === 'integer' && !Number.isInteger(value)) return 'must be an integer'
  if (schema.type === 'number' && typeof value !== 'number') return 'must be a number'
  if (schema.type === 'boolean' && typeof value !== 'boolean') return 'must be a boolean'
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return 'must be an array'
    for (const item of value) {
      const issue = validateAgainstSchema(schema.items, item)
      if (issue !== undefined) return issue
    }
  }
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object'
  }
  return undefined
}