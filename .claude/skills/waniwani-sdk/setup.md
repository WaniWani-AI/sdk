# WaniWani SDK Setup

## Overview

Every WaniWani MCP project needs two things:

1. **Environment variables** — `WANIWANI_API_KEY` (required), `WANIWANI_API_URL` (optional)
2. **`lib/waniwani.ts`** — SDK client instance

## Step 1: Install

```bash
bun add @waniwani/sdk
```

## Step 2: Environment Variables

Set these in your `.env` (or Vercel/deployment config):

```env
WANIWANI_API_KEY=your_api_key_here

# Optional — defaults to https://app.waniwani.ai
WANIWANI_API_URL=https://app.waniwani.ai
```

All SDK components (tracking, flow state, KV store) read directly from these env vars. No config file needed.

## Step 3: `lib/waniwani.ts`

Create a single SDK client instance:

```typescript
import { waniwani } from "@waniwani/sdk";

export const wani = waniwani();
// Reads WANIWANI_API_KEY from env
```

Or pass config explicitly:

```typescript
import { waniwani } from "@waniwani/sdk";

export const wani = waniwani({
  apiKey: process.env.WANIWANI_API_KEY,
  apiUrl: process.env.WANIWANI_API_URL,
});
```

## Step 4: MCP Server Route (`app/mcp/route.ts`)

Wrap your MCP server with `withWaniwani` for automatic tool tracking:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withWaniwani } from "@waniwani/sdk/mcp";
import { wani } from "../../lib/waniwani";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

withWaniwani(server, { client: wani });
```

If you need custom options (tool types, metadata, flush behavior):

```typescript
withWaniwani(server, {
  client: wani,                    // explicit client
  toolType: "pricing",             // default type for all tools
  flushAfterToolCall: true,        // flush after each tool call
  metadata: { source: "my-mcp" }, // extra metadata on every event
});
```

## Step 5: Chat API Route (`app/api/waniwani/[[...path]]/route.ts`)

Wire the client to the Next.js handler for the chat UI:

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
.env                          (WANIWANI_API_KEY, WANIWANI_API_URL)
       |
       v
lib/waniwani.ts             (waniwani() — creates client from env vars)
       |
       +---> app/mcp/route.ts               (withWaniwani — auto-tracks tools)
       |
       +---> app/api/waniwani/.../route.ts   (toNextJsHandler — chat API)
```

- `WANIWANI_API_KEY` env var is the **source of truth** for authentication
- `waniwani()` reads from env vars when called with no config
- Flow state (KV store) reads `WANIWANI_API_KEY` and `WANIWANI_API_URL` directly from env — no config threading needed

## `WithWaniwaniOptions` Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `client` | `WaniWaniClient` | auto-created | Pre-built client (if omitted, creates one from env vars) |
| `toolType` | `string \| (name) => string` | `"other"` | Default tool type for tracked events |
| `metadata` | `Record<string, unknown>` | — | Extra metadata merged into every event |
| `flushAfterToolCall` | `boolean` | `false` | Flush transport after each tool call |
| `onError` | `(error) => void` | — | Non-fatal tracking error callback |
| `injectWidgetToken` | `boolean` | `true` | Inject JWT into `_meta.waniwani` for browser widgets |

## Common Mistakes

- **Missing `WANIWANI_API_KEY` env var** — Flow state will throw an error. Make sure the env var is set in all environments (dev, staging, prod).
- **Creating multiple clients** — Create one client in `lib/waniwani.ts` and import it everywhere. Don't call `waniwani()` in multiple files.
