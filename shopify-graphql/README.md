# Shopify GraphQL

A DeepSeek Harness plugin that runs Shopify Admin GraphQL from chat under your control.

- **Read queries** execute immediately with a store's locally stored read-only token.
- **Mutations** wait for your approval in a persistent right-side panel that shows a human summary, affected resources, variables, the selected field tree, and the raw document. The write token is read on demand from Infisical.
- **Saved tools**: after any execution you can expose some variables and save the operation as a reusable tool. Saved writes still require approval on every agent call.
- **Per-user isolation**: stores, tokens, policies, history, and saved tools all live under this DSH home. A store configured by one system user is invisible to every other user. Keep `stateDir` inside the DSH home; pointing it at a shared directory breaks that isolation.

There are no preset Shopify domain tools and no MCP. The only model-facing entry point is `shopify_graphql`.

## Install and configure

The bundle is installable from its directory. Open the Shopify tab and use **Settings** to add a store and configure Infisical; the plugin writes `$DSH_HOME/shopify-graphql/stores.yaml` for you. Editing that file manually is also supported.

A store entry has two independent token slots:

```yaml
stores:
  - id: example-store
    domain: your-store.myshopify.com
    apiVersion: "2026-04"
    readToken:
      provider: local
      ref: SHOPIFY_EXAMPLE_READ_TOKEN
    writeToken:
      provider: infisical
      service: shopify
      key: ADMIN_ACCESS_TOKEN
```

- `readToken` uses the local credential store (or the process environment). It never leaves the device and costs no network round-trip.
- `writeToken` is read on demand from Infisical after the store policy passes and before the approval prompt. It is cached for 30 seconds.
- The Infisical secret path is `<secretPathPrefix>/<storeId>/<service>` and the key is normalized to uppercase.
- The Infisical machine identity (`clientIdRef`, `clientSecretRef`) is resolved from the local credential store as well.

Set the read token in the panel's **Settings** view, or export the reference before starting DSH. Infisical-managed write tokens are read-only in the panel; rotate them in Infisical.

The loader config can also carry a store list when you do not want a runtime file. Store ids must be unique across both sources.

## Approval

A mutation creates a pending request and the agent's tool call waits. The Shopify tab opens (or shows a count) with the request. Approve or reject there. Approval binds to the stored document and variables; the browser never resends them. A request expires after `approvalTimeoutMs` (default 10 minutes).

## Policy

Per-store guardrails live in `<stateDir>/policies/<storeId>.yaml`:

```yaml
readOnly: false
blockedRootFields:
  - appUninstall
limits:
  maxDocumentBytes: 65536
  maxVariablesBytes: 65536
  approvalTimeoutMs: 600000
```

The file is read on every call. Invalid YAML or unknown keys fail closed. `readOnly: true` rejects every mutation.

## Files

Everything is under `$DSH_HOME/shopify-graphql` by default:

```text
stores.yaml       per-user store registry (optional; loader config also works)
policies/         per-store guardrails
history.json      last 200 executions
audit.jsonl       append-only audit trail
tools.json        saved tool definitions
```

## Limits

- The panel is a right-side tab; it depends on the Web GUI sidebar.
- Approval requires the browser to be open. A closed browser leaves the tool call waiting until it times out or the turn is cancelled.
- Read-token scope is enforced by Shopify, not by this plugin.
- Saved tools are global to the profile; their names must start with `shopify_`.
- There is no batch approval: every mutation gets its own decision.