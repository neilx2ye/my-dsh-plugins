# MCP servers

A Settings page for Model Context Protocol servers in the DSH Web UI. It lists
the servers saved in the current profile, shows their live connection state and
registered tools, and adds or edits one inline.

## What it does

- Stores one server list in this bundle's own Loader row (`config.servers`); the
  page saves through the profile config editor, so values survive restarts and
  appear in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`.
- Connects each enabled server with the MCP SDK and registers its tools as
  `mcp__<server>__<tool>` for every conversation in the profile.
- Probes a draft without saving it, so a broken command or URL is caught before
  it joins the tool list.
- Reuses the official `@deepseek-ai/dsh-mcp-client` tool adapter and the
  Harness-process environment scrubbing for stdio transports. Both modules are
  resolved from the Harness installation, because profile-installed bundles do
  not see installation modules through ordinary Node resolution.

## Server fields

| Field | Meaning |
|---|---|
| `serverName` | Tool namespace, `[A-Za-z0-9_-]{1,32}`; must be unique |
| `transport` | `stdio` for a local program, `streamable-http` for a remote endpoint |
| `command`, `args`, `env`, `cwd` | stdio: executable, arguments, extra environment, working directory |
| `url`, `headers` | streamable-http: endpoint and request headers |
| `enabled` | Disabled rows stay saved but publish no tools |
| `toolCallTimeoutMs` | Per-call timeout, default 60000 |

A `$NAME` value in `env` or `headers` reads the Harness process environment at
connect time instead of storing the secret in the profile patch.

## Install

The bundle lives in the workspace and is installed into the active profile with
the `plugin_manager` tool (`action: install_bundle`, `target` = this directory).
After installation, open **Settings → MCP servers**. Changing the list
restarts this plugin, which rebuilds the connections.

## Notes

- The page and Host routes are available only to the authenticated owner of the
  Web connection, like the rest of the Settings pages.
- A server that fails to connect keeps its row and reports the failure; fix the
  configuration and save again, or use **Reconnect**.
- There is no automatic reconnect loop: a dropped connection shows as failed
  and can be rebuilt with **Reconnect**.