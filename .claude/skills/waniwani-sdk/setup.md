# WaniWani SDK Setup

## Overview

Every WaniWani MCP project needs three things:

1. **`waniwani.config.ts`** — single source of truth for all config
2. **`lib/waniwani.ts`** — SDK client instance (reads from the config)
3. **MCP server + API route** — wired up with `withWaniwani` and `toNextJsHandler`

## Step 1: Install

```bash
bun add @waniwani/sdk
```

## Step 2: `waniwani.config.ts` (project root)

This is the **single source of truth**. `defineConfig()` registers the config globally so that `waniwani()` and `withWaniwani()` pick it up automatically.

```typescript
import { defineConfig } from "@waniwani/sdk";

export default defineConfig({
  // Required — your MCP environment API key
  apiKey: process.env.WANIWANI_API_KEY,

  // Optional — defaults to https://app.waniwani.ai
  apiUrl: process.env.WANIWANI_API_URL,

  // Optional — only needed if using evals
  evals: {
    mcpServerUrl: "http://localhost:3001",
    dir: "./evals", // default
  },

  // Optional — only needed if using knowledge base
  knowledgeBase: {
    dir: "./knowledge-base",
  },
});
```

### How it works

Calling `defineConfig()` does two things:
1. **Stores** the config in a module-level singleton inside the SDK
2. **Returns** the config object (so you can also pass it explicitly)

Any subsequent call to `waniwani()` or `withWaniwani()` with no arguments will read from this stored config.

## Step 3: `lib/waniwani.ts`

Import the config file (side-effect import registers the global config), then create the client.

```typescript
import "../waniwani.config";
import { waniwani } from "@waniwani/sdk";

export const wani = waniwani();
// No args needed — picks up apiKey/apiUrl from defineConfig
```

Alternative — pass the config explicitly (also works):

```typescript
import config from "../waniwani.config";
import { waniwani } from "@waniwani/sdk";

export const wani = waniwani(config);
```

## Step 4: MCP Server Route (`app/mcp/route.ts`)

Wrap your MCP server with `withWaniwani` for automatic tool tracking.

```typescript
import "../../waniwani.config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withWaniwani } from "@waniwani/sdk/mcp";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

// Auto-tracks all tool calls — no client arg needed
withWaniwani(server);
```

If you need custom options (tool types, metadata, flush behavior):

```typescript
import { wani } from "../../lib/waniwani";

withWaniwani(server, {
  client: wani,                    // optional — explicit client
  toolType: "pricing",             // default type for all tools
  flushAfterToolCall: true,        // flush after each tool call
  metadata: { source: "my-mcp" }, // extra metadata on every event
});
```

## Step 5: Chat API Route (`app/api/waniwani/[[...path]]/route.ts`)

Wire the client to the Next.js handler for the chat UI.

```typescript
import { wani } from "../../../../lib/waniwani";
import { toNextJsHandler } from "@waniwani/sdk/next-js";

export const { GET, POST } = toNextJsHandler(wani, {
  chat: {
    systemPrompt: "You are a helpful assistant.",
    mcpServerUrl: process.env.MCP_SERVER_URL!,
  },
});
```

## How They Work Together

```
waniwani.config.ts          (defineConfig — stores global config)
       |
       v
lib/waniwani.ts             (waniwani() — creates client from global config)
       |
       +---> app/mcp/route.ts               (withWaniwani — auto-tracks tools)
       |
       +---> app/api/waniwani/.../route.ts   (toNextJsHandler — chat API)
```

- `defineConfig()` is the **source of truth** for apiKey, apiUrl, and all project settings
- `waniwani()` reads from the global config when called with no arguments
- `withWaniwani(server)` creates its own client internally (also reads from global config)
- `toNextJsHandler(wani, ...)` uses the client's resolved config

## `WithWaniwaniOptions` Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `client` | `WaniWaniClient` | auto-created | Pre-built client (if omitted, creates one from global config) |
| `toolType` | `string \| (name) => string` | `"other"` | Default tool type for tracked events |
| `metadata` | `Record<string, unknown>` | — | Extra metadata merged into every event |
| `flushAfterToolCall` | `boolean` | `false` | Flush transport after each tool call |
| `onError` | `(error) => void` | — | Non-fatal tracking error callback |
| `injectWidgetToken` | `boolean` | `true` | Inject JWT into `_meta.waniwani` for browser widgets |

## `WaniWaniProjectConfig` Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | `string` | No | API key. Defaults to `WANIWANI_API_KEY` env var |
| `apiUrl` | `string` | No | API URL. Defaults to `https://app.waniwani.ai` |
| `tracking` | `TrackingConfig` | No | Transport options (flush interval, batch size, retries) |
| `evals.mcpServerUrl` | `string` | Yes (when evals used) | MCP server URL for eval simulations |
| `evals.dir` | `string` | No | Evals directory. Defaults to `./evals` |
| `knowledgeBase.dir` | `string` | No | Knowledge base directory |

## Common Mistakes

- **Forgetting the config import** — `import "../waniwani.config"` must run before `waniwani()` is called, otherwise the global config is empty
- **Passing config to both `defineConfig` and `waniwani()`** — Pick one. If you use `defineConfig`, call `waniwani()` with no args
- **Creating multiple clients** — Create one client in `lib/waniwani.ts` and import it everywhere. Don't call `waniwani()` in multiple files
- **Passing `client` to `withWaniwani` when not needed** — If you've already called `defineConfig`, just use `withWaniwani(server)` with no options
