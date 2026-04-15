# Chat Server (`@waniwani/sdk/next-js`)

Next.js App Router adapter that creates route handlers for the chat widget backend.

## Quick Start: `createChatAgent` (recommended for embed)

One-liner that creates client + route handlers. Best for MCP apps serving the embeddable chat widget.

```typescript
// app/api/chat/[[...path]]/route.ts
import { createChatAgent } from "@waniwani/sdk/next-js";

export const maxDuration = 60;

export const { GET, POST, OPTIONS } = createChatAgent({
  systemPrompt: "You are a helpful assistant.",
  mcpServerUrl: process.env.MCP_SERVER_URL,
  embedAuth: {
    publicKey: process.env.WANIWANI_EMBED_PUBLIC_KEY!,
  },
});
```

Reads `WANIWANI_API_KEY` and `WANIWANI_API_URL` from env automatically.

### `ChatAgentOptions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `systemPrompt` | `string` | -- | System prompt for the assistant |
| `mcpServerUrl` | `string` | auto-detect | MCP server URL |
| `embedAuth` | `{ publicKey: string }` | -- | Embed token verification (see [Embed Auth](#embed-auth)) |
| `source` | `string` | `"embed"` | Analytics source name |
| `maxSteps` | `number` | `5` | Max tool call steps per request |
| `beforeRequest` | `(context) => result` | -- | Request interceptor hook |
| `webSearch` | `boolean \| WebSearchConfig` | -- | Enable web search tool |
| `debug` | `boolean` | `WANIWANI_DEBUG` env | Verbose logging |
| `apiKey` | `string` | `WANIWANI_API_KEY` env | WaniWani API key override |
| `apiUrl` | `string` | `https://app.waniwani.ai` | WaniWani API URL override |

## Advanced: `toNextJsHandler`

For more control, create the client separately:

```typescript
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

This creates these routes:

- `POST /api/waniwani` -- chat message proxy (streams responses)
- `GET /api/waniwani/resource?uri=...` -- MCP resource content (e.g. widget HTML)

## NextJsHandlerOptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | `string` | Yes | Identifies this chat instance in analytics (e.g. `"pricing-page"`) |
| `debug` | `boolean` | No | Enable verbose logging. Also enabled when `WANIWANI_DEBUG=1` |
| `chat` | `ChatOptions` | No | Chat handler configuration (see below) |

## ChatOptions

Nested under the `chat` key:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `systemPrompt` | `string` | -- | System prompt for the assistant |
| `maxSteps` | `number` | `5` | Maximum tool call steps per request |
| `mcpServerUrl` | `string` | -- | Override MCP server URL (useful for local dev) |
| `webSearch` | `boolean \| WebSearchConfig` | -- | Enable web search alongside MCP tools. `true` for defaults, or `{ includeDomains?, excludeDomains? }` |
| `embedAuth` | `{ publicKey: string }` | -- | Embed token verification. When set, POST requests require a valid `Authorization: Bearer` token signed with the corresponding private key. |
| `beforeRequest` | `(context) => BeforeRequestResult \| undefined` | -- | Hook to intercept/modify requests before forwarding |

### `beforeRequest` Hook

Called before each request is forwarded to the WaniWani API. Use it to override messages, inject a custom system prompt, or reject requests.

```typescript
chat: {
  beforeRequest: async ({ messages, sessionId, visitor, request }) => {
    // Return overrides (all fields optional)
    return {
      systemPrompt: "Custom prompt based on visitor context",
      sessionId: "custom-session-id",
      messages: filteredMessages,
    };

    // Or throw to reject the request
    // throw new Error("Unauthorized");
  },
}
```

**`BeforeRequestContext`** fields: `messages` (UIMessage[]), `sessionId`, `modelContext`, `request` (HTTP Request), `visitor` (geo + client context).

**`BeforeRequestResult`** fields (all optional): `messages`, `systemPrompt`, `sessionId`, `modelContext`.

## Complete Example

```typescript
// app/api/waniwani/[[...path]]/route.ts
import { wani } from "../../../../lib/waniwani";
import { toNextJsHandler } from "@waniwani/sdk/next-js";

export const maxDuration = 60;

export const { GET, POST, PATCH, OPTIONS } = toNextJsHandler(wani, {
  source: "support-chat",
  debug: process.env.WANIWANI_DEBUG === "1",
  chat: {
    systemPrompt: "You are a support assistant for Acme Corp.",
    mcpServerUrl: process.env.MCP_SERVER_URL!,
    maxSteps: 8,
    webSearch: { includeDomains: ["docs.acme.com"] },
    beforeRequest: async ({ visitor }) => {
      const timezone = visitor.client?.timezone ?? "UTC";
      return {
        systemPrompt: `You are a support assistant. The user's timezone is ${timezone}.`,
      };
    },
  },
});
```

## Embed Auth

Asymmetric JWT authentication for the embeddable chat widget. WaniWani signs tokens (RS256 private key), customer MCP apps verify them (public key).

### How it works

1. Generate token in WaniWani dashboard (`POST /api/mcp/environments/[id]/embed-token`)
2. Customer puts token in `<script data-token="eyJ...">`
3. Embed widget sends `Authorization: Bearer <token>` on every request
4. MCP app verifies with `WANIWANI_EMBED_PUBLIC_KEY` env var

### Token claims

```json
{
  "sub": "environment-uuid",
  "iss": "waniwani",
  "jti": "unique-token-id",
  "scope": ["mcp:chat", "mcp:resources", "mcp:tools", "mcp:events"],
  "origins": ["https://customer.com"],
  "iat": 1750000000
}
```

### Token revocation

Revoke tokens by adding their `jti` to the MCP app's environment:

```env
WANIWANI_EMBED_REVOKED_JTIS=token-id-1,token-id-2
```

Or pass directly:

```typescript
createChatAgent({
  embedAuth: {
    publicKey: process.env.WANIWANI_EMBED_PUBLIC_KEY!,
    revokedJtis: process.env.WANIWANI_EMBED_REVOKED_JTIS,
  },
});
```

### Standalone verification

For custom auth flows outside `createChatAgent`:

```typescript
import { verifyEmbedToken } from "@waniwani/sdk/chat/server";

const claims = await verifyEmbedToken(token, publicKeyPem);
// claims.sub, claims.scope, claims.origins, claims.jti
```

## Common Mistakes

- **Wrong route path** -- Must be a catch-all: `app/api/waniwani/[[...path]]/route.ts`. A non-catch-all route will not handle sub-paths like `/resource`.
- **Missing `source`** -- The `source` field is required. It identifies this chat instance in the WaniWani dashboard.
- **Forgetting `maxDuration`** -- Chat responses stream and can take time. Set `export const maxDuration = 60` to avoid Vercel timeouts on longer conversations.
- **Client created inline** -- Import the shared client from `lib/waniwani.ts` instead of calling `waniwani()` in the route file.
