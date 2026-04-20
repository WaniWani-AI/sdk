# Setup

## Environment Variables

Set these in `.env` (or your deployment config):

```env
WANIWANI_API_KEY=wwk_...

# Optional -- defaults to https://app.waniwani.ai
WANIWANI_API_URL=https://app.waniwani.ai

# Optional -- encrypts flow state at rest (AES-256-GCM)
# Generate with: openssl rand -base64 32
WANIWANI_ENCRYPTION_KEY=<base64-encoded 32-byte key>
```

All SDK modules (tracking, flows, chat) read from these env vars automatically.

When `WANIWANI_ENCRYPTION_KEY` is set, all KV store values (flow state) are encrypted before being sent to the WaniWani API and decrypted on read. The server never sees plaintext flow state.

## Client Singleton (`lib/waniwani.ts`)

Create one client instance and import it everywhere:

```typescript
import { waniwani } from "@waniwani/sdk";

export const wani = waniwani();
// Reads WANIWANI_API_KEY and WANIWANI_API_URL from env
```

Or pass config explicitly:

```typescript
export const wani = waniwani({
  apiKey: process.env.WANIWANI_API_KEY,
  apiUrl: process.env.WANIWANI_API_URL,
});
```

## MCP Server Route

Wrap your MCP server with `withWaniwani` for automatic tool tracking:

```typescript
// app/mcp/route.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withWaniwani } from "@waniwani/sdk/mcp";
import { wani } from "../../lib/waniwani";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

withWaniwani(server, { client: wani });
```

With custom options:

```typescript
withWaniwani(server, {
  client: wani,
  toolType: "pricing",          // default type for all tools
  flushAfterToolCall: true,     // flush after each tool call
  metadata: { source: "my-mcp" },
});
```

## Chat API Route

Wire the client to a Next.js catch-all route for the chat widget backend. See [chat-server.md](chat-server.md) for full configuration.

```typescript
// app/api/waniwani/[[...path]]/route.ts
import { wani } from "../../../../lib/waniwani";
import { toNextJsHandler } from "@waniwani/sdk/next-js";

export const { GET, POST, PATCH, OPTIONS } = toNextJsHandler(wani, {
  source: "pricing-page",
  chat: {
    systemPrompt: "You are a helpful assistant.",
    mcpServerUrl: process.env.MCP_SERVER_URL!,
  },
});
```

## How They Connect

```
.env                          (WANIWANI_API_KEY, WANIWANI_API_URL)
       |
       v
lib/waniwani.ts             (waniwani() -- creates client from env vars)
       |
       +---> app/mcp/route.ts               (withWaniwani -- auto-tracks tools)
       |
       +---> app/api/waniwani/.../route.ts   (toNextJsHandler -- chat API + resources)
       |
```

- `WANIWANI_API_KEY` is the single source of truth for authentication
- `waniwani()` reads from env vars when called with no arguments
- Flow state reads `WANIWANI_API_KEY` and `WANIWANI_API_URL` directly from env

## WithWaniwaniOptions Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `client` | `WaniWaniClient` | auto from env | Pre-built client instance |
| `toolType` | `string \| (name) => string` | `"other"` | Default tool type for tracked events |
| `metadata` | `Record<string, unknown>` | -- | Extra metadata merged into every event |
| `flushAfterToolCall` | `boolean` | `false` | Flush transport after each tool call |
| `onError` | `(error) => void` | -- | Non-fatal tracking error callback |
| `injectWidgetToken` | `boolean` | `true` | Inject JWT into `_meta.waniwani` for browser widgets |

## Common Mistakes

- **Missing `WANIWANI_API_KEY` env var** -- Tracking and flow state will throw. Set it in all environments (dev, staging, prod).
- **Creating multiple clients** -- Create one client in `lib/waniwani.ts` and import it everywhere. Do not call `waniwani()` in multiple files.
- **Wrong import paths** -- Tracking: `@waniwani/sdk`. MCP tools: `@waniwani/sdk/mcp`. Chat server: `@waniwani/sdk/next-js`. Chat widget: `@waniwani/sdk/chat`.
- **Forgetting `source` on `toNextJsHandler`** -- The `source` field is required and identifies this chat instance in analytics.
