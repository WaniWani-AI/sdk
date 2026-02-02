# @waniwani

SDK for [app.waniwani.ai](https://app.waniwani.ai) - MCP event tracking and tools.

## Warning

This is **pre-alpha** software. Here's what that means:

- Everything will break
- APIs will change without notice
- We will not apologize

If you're not comfortable with that, wait for v1.0.

## What is WaniWani?

[WaniWani](https://app.waniwani.ai) is the Shopify of MCP servers — enabling quote-based businesses that sell complex services to deploy AI agents that capture leads, qualify customers, and generate quotes.

This SDK is how you track events and interactions in your MCP server.

## Installation

```bash
npm install @waniwani
```

## Quick Start

```typescript
import { waniwani } from "@waniwani";

const client = waniwani({
  apiKey: "your-api-key", // or use WANIWANI_API_KEY env var
});

// Track a tool call
await client.track({
  eventType: "tool.called",
  sessionId: "session-123",
  toolName: "pricing",
  toolType: "pricing",
});

// Get or create session from MCP metadata
const sessionId = await client.getOrCreateSession(extra?._meta);
```

## API

### `waniwani(config?)`

Creates a WaniWani client.

```typescript
const client = waniwani({
  apiKey: "...", // defaults to WANIWANI_API_KEY env var
  baseUrl: "...", // defaults to https://app.waniwani.ai
});
```

### `client.track(event)`

Track an event. Returns `{ eventId: string }`.

```typescript
await client.track({
  eventType: "tool.called",
  sessionId: "session-123",
  toolName: "pricing",
  toolType: "pricing",
  metadata: { custom: "data" },
});
```

**Event Types:**

| Event Type           | Description                | Additional Fields                        |
| -------------------- | -------------------------- | ---------------------------------------- |
| `session.started`    | New session began          | -                                        |
| `tool.called`        | MCP tool was invoked       | `toolName?`, `toolType?`                 |
| `quote.requested`    | Quote was requested        | -                                        |
| `quote.succeeded`    | Quote completed            | `quoteAmount?`, `quoteCurrency?`         |
| `quote.failed`       | Quote failed               | -                                        |
| `link.clicked`       | User clicked a link        | `linkUrl?`                               |
| `purchase.completed` | Purchase was completed     | `purchaseAmount?`, `purchaseCurrency?`   |

**Tool Types:** `pricing`, `product_info`, `availability`, `support`, `other`

**Base Event Fields:**

- `sessionId` (required): Session identifier
- `externalUserId?`: Your user identifier
- `metadata?`: Custom key-value data

### `client.getOrCreateSession(meta?)`

Extract session ID from MCP request metadata, or generate a new one. If a new session is generated, automatically tracks a `session.started` event.

```typescript
// In your MCP tool handler
const sessionId = await client.getOrCreateSession(extra?._meta);
```

Looks for session ID in: `meta["openai/sessionId"]`, `meta.sessionId`, or `meta.conversationId`.

## Configuration

| Option    | Environment Variable | Default                    |
| --------- | -------------------- | -------------------------- |
| `apiKey`  | `WANIWANI_API_KEY`   | -                          |
| `baseUrl` | -                    | `https://app.waniwani.ai`  |

## License

MIT
