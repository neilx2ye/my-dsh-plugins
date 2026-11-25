# Shopify GraphQL

## What it is

This bundle replaces a preset Shopify tool surface with one governed entry point:

```text
shopify_graphql({ storeId?, document, variables?, operationName? })
```

The Host parses the document, classifies it as a query or mutation, and routes it:

| Operation | Token | Approval |
|---|---|---|
| `query` | store `readToken` (local credential store) | none |
| `mutation` | store `writeToken` (Infisical, read on demand) | one approval in the Shopify panel |

The write token is resolved after the store policy preflight and before the approval prompt; it is used only after the approval. The approval is bound to the exact document, variables, and operation name stored on the pending request; a browser decision only names the request id.

## Store configuration

Stores are configured per DSH home. Add them from the panel's **Settings** view, or edit `$DSH_HOME/shopify-graphql/stores.yaml` directly:

```yaml
stores:
  - id: example-store
    domain: your-store.myshopify.com
    apiVersion: "2026-04"
    label: Example store
    readToken:
      provider: local
      ref: SHOPIFY_EXAMPLE_READ_TOKEN
    writeToken:
      provider: infisical
      service: shopify
      key: ADMIN_ACCESS_TOKEN

infisical:
  baseUrl: https://app.infisical.com
  projectId: your-project-id
  environment: prod
  secretPathPrefix: /stores
  clientIdRef: INFISICAL_CLIENT_ID
  clientSecretRef: INFISICAL_CLIENT_SECRET
```

A copy is shipped as `docs/stores.example.yaml`.

The loader row can also carry the same `stores` and `infisical` blocks. Duplicate ids across the runtime file and the loader config are rejected.

**Isolation.** The store file, policies, history, saved tools, and the local credential store all sit under this DSH home. A store configured by one system user is invisible to another; each user configures their own file and credentials. Keep `stateDir` inside the DSH home so this boundary holds.

## The panel

The plugin adds a persistent **Shopify** tab to the right sidebar. It polls the Host every two seconds and has four views:

- **Pending** — the summary, risk chips, resources, variables, selected field tree, and raw GraphQL. Approve or reject here. The agent's tool call waits for this decision.
- **History** — the last 200 executions with decision, status, duration, document, variables, and result. Any executed request can be saved as a tool.
- **Tools** — saved tools; enable, disable, delete, or invoke one manually with parameters.
- **Settings** — add or remove stores, configure Infisical, edit the two token slots, and inspect the effective policy.

When a new mutation arrives, the panel opens and switches to Pending.

## Tokens

Each store has two independent slots:

- `readToken` — provider `local`. The value lives in the Harness credential store (or the process environment) on this device. It is never sent to a secret manager.
- `writeToken` — provider `infisical`. The value is read on demand from `<baseUrl>/api/v4/secrets/<KEY>` with `secretPath=<prefix>/<storeId>/<service>`. Login uses Universal Auth with `clientIdRef` and `clientSecretRef`, both resolved from the local credential store. Reads are cached for `cacheTtlMs` (default 30 seconds) and misses are not cached.

The panel's Settings view edits only local slots. An Infisical slot shows its path and key and must be rotated in Infisical.

Values are never returned to the model, the panel, the history, or the audit trail.

Recommended Shopify scopes: `read_orders`, `write_orders` for the write token, plus `read_products` and any other read scopes the queries need.

## Saving a tool

After an execution, open **History**, select the entry, and use **Save as tool**:

- The tool name is normalized to the `shopify_` namespace.
- Each variable can be exposed as a parameter or fixed to the value of the source execution.
- Exposed parameters become the model-facing schema and the manual-invocation form.
- Saved query tools run directly; saved mutation tools still wait for approval on every agent call.

## Policy

`<stateDir>/policies/<storeId>.yaml`:

```yaml
readOnly: false
blockedRootFields:
  - appUninstall
  - shopifyPaymentsPayout
limits:
  maxDocumentBytes: 65536
  maxVariablesBytes: 65536
  approvalTimeoutMs: 600000
```

Unknown keys, duplicate entries, or non-positive limits are rejected instead of being ignored. The file is read fresh on every call; a missing file uses the defaults.

## State

`<stateDir>` defaults to `$DSH_HOME/shopify-graphql`:

```text
stores.yaml           per-user store registry (optional)
history.json          last 200 executions (documents, variables, bounded results)
audit.jsonl           append-only audit lines
tools.json            saved tool definitions
policies/<store>.yaml
```

## Limitations

- The approval UI requires the Web GUI right sidebar and an open browser tab.
- The tool call stays pending until the user decides, the request times out, or the turn is cancelled.
- The plugin cannot verify Shopify token scopes; Shopify returns authorization errors.
- GraphQL results are stored in history with a 256 KiB bound per entry.
- There is no batch approval: every mutation gets its own decision.
- Infisical write tokens are resolved before the approval prompt, so a missing secret fails early; the panel cannot show whether a remote secret exists without a network call.