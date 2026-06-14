---
name: local-mcp-claude
description: Add the current MCP server to the Claude Desktop configuration for local development, so you can test its tools and widgets in Claude before submitting.
user-invocable: true
license: MIT
metadata:
  author: WaniWani
---

# Add Local MCP to Claude Desktop

Registers the current MCP project as a server in the user's Claude Desktop config
so they can test it locally (tools + widgets) before deploying or submitting.

## Steps

### 1. Determine the MCP name

Pick a short, stable key for the server entry. In order of preference:

1. The `name` passed to `new McpServer({ name, version }, …)` in the server entry
   (search `server/src/app.ts`, `app/mcp/route.ts`, or wherever the server is created).
2. The `name` field in `package.json`.
3. Ask the user.

If the project still has a placeholder name (e.g. `{{MCP_NAME}}`), tell the user to
run the project's `initialize`/scaffold step first and stop.

Store the chosen name as `{MCP_NAME}`.

### 2. Determine the MCP URL

The local dev server URL is typically `http://localhost:3000/mcp`.

Ask the user: *"I'll register `{MCP_NAME}` pointing to `http://localhost:3000/mcp`.
Is that the right URL, or are you using a different port?"*

Store as `{MCP_URL}`.

### 3. Read the current Claude Desktop config

The config file is at:

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Read the file. If it doesn't exist, start with:

```json
{
  "mcpServers": {}
}
```

### 4. Add the MCP server entry

Add (or update) an entry under `mcpServers` with key `{MCP_NAME}`, using
`npx mcp-remote` to bridge the HTTP connection:

```json
{
  "mcpServers": {
    "{MCP_NAME}": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "{MCP_URL}"
      ]
    }
  }
}
```

Preserve all existing entries and preferences in the config file. Only add/update
the `{MCP_NAME}` key.

### 5. Write the updated config

Write the updated JSON back to the config file with proper formatting (2-space indent).

### 6. Print summary

Tell the user:
- The MCP server `{MCP_NAME}` has been added to Claude Desktop
- They need to **restart Claude Desktop** (or reload MCP servers) for it to take effect
- They should make sure the dev server (e.g. `bun dev`) is running on the correct
  port before using it in Claude Desktop
