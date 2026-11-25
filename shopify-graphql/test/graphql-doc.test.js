import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeDocument } from '../lib/graphql-doc.js'

test('classifies a query and summarizes its target', () => {
  const analysis = analyzeDocument(
    'query GetOrder($id: ID!) { order(id: $id) { id name tags } }',
    undefined,
    { id: 'gid://shopify/Order/1001' },
  )
  assert.equal(analysis.operationType, 'query')
  assert.equal(analysis.operationName, 'GetOrder')
  assert.equal(analysis.visual.summary, '查询订单：订单 #1001')
  assert.deepEqual(analysis.visual.risk, [])
  assert.equal(analysis.visual.variables[0].name, 'id')
  assert.equal(analysis.variableDefs[0].schema.type, 'string')
})

test('summarizes a tagsAdd mutation with its tag list', () => {
  const analysis = analyzeDocument(
    'mutation AddOrderTags($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { message } } }',
    undefined,
    { id: 'gid://shopify/Order/1001', tags: ['urgent', 'vip'] },
  )
  assert.equal(analysis.operationType, 'mutation')
  assert.equal(analysis.visual.summary, '添加标签：订单 #1001（标签：urgent、vip）')
  assert.ok(analysis.visual.risk.includes('write'))
  assert.equal(analysis.visual.resources[0].label, '订单 #1001')
})

test('names the fields changed by an orderUpdate input', () => {
  const analysis = analyzeDocument(
    'mutation Update($input: OrderInput!) { orderUpdate(input: $input) { order { id note } userErrors { message } } }',
    undefined,
    { input: { id: 'gid://shopify/Order/1001', note: 'hi' } },
  )
  assert.equal(analysis.visual.summary, '修改订单：订单 #1001（备注）')
  assert.ok(analysis.visual.risk.includes('write'))
})

test('rejects ambiguous multi-operation documents without operationName', () => {
  assert.throws(
    () => analyzeDocument('query A { shop { name } } query B { shop { id } }'),
    error => error.code === 'operation_ambiguous',
  )
})

test('selects a named operation from a multi-operation document', () => {
  const analysis = analyzeDocument(
    'query A { shop { name } } mutation B { tagsAdd(id: "gid://shopify/Order/1", tags: ["x"]) { node { id } } }',
    'B',
  )
  assert.equal(analysis.operationType, 'mutation')
  assert.equal(analysis.operationName, 'B')
})

test('rejects subscriptions and parse errors', () => {
  assert.throws(
    () => analyzeDocument('subscription S { shop { name } }'),
    error => error.code === 'unsupported_operation',
  )
  assert.throws(
    () => analyzeDocument('mutation {'),
    error => error.code === 'graphql_parse_error',
  )
})

test('flags destructive and bulk root fields', () => {
  const analysis = analyzeDocument(
    'mutation X { productDelete(input: { id: "gid://shopify/Product/1" }) { deletedProductId } }',
  )
  assert.ok(analysis.visual.risk.includes('destructive'))
  const bulk = analyzeDocument(
    'mutation Y { bulkOperationRunQuery(query: "{}") { bulkOperation { id } } }',
  )
  assert.ok(bulk.visual.risk.includes('bulk'))
})

test('maps GraphQL variable types to JSON Schema', () => {
  const analysis = analyzeDocument(
    'query Q($a: Int!, $b: [String!], $c: Boolean, $d: JSON) { shop { name } }',
  )
  const byName = new Map(analysis.variableDefs.map(item => [item.name, item]))
  assert.equal(byName.get('a').schema.type, 'integer')
  assert.equal(byName.get('a').required, true)
  assert.deepEqual(byName.get('b').schema, { type: 'array', items: { type: 'string' } })
  assert.equal(byName.get('c').schema.type, 'boolean')
  assert.deepEqual(byName.get('d').schema, {})
})