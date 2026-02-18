---
name: waniwani-sdk
description: Integrate the @waniwani/sdk package for event tracking, widget creation, and React hooks in MCP servers. Use when adding WaniWani analytics, creating dual-platform widgets (ChatGPT + Claude), or building widget UIs.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# WaniWani SDK (`@waniwani/sdk`)

SDK for MCP event tracking, dual-platform widget creation, and widget React hooks.

## Install

```bash
bun add @waniwani/sdk
```

## Export Paths

| Export | Purpose | Docs | Peer Dependencies |
|--------|---------|------|-------------------|
| `@waniwani/sdk` | Event tracking | (below) | None |
| `@waniwani/sdk/mcp` | Widget creation (server-side) | [mcp/server.md](mcp/server.md) | `@modelcontextprotocol/sdk`, `zod` |
| `@waniwani/sdk/mcp` | Multi-step flows | [mcp/flows.md](mcp/flows.md) | `@modelcontextprotocol/sdk`, `zod` |
| `@waniwani/sdk/mcp/react` | Widget React hooks (client-side) | [mcp/react.md](mcp/react.md) | `react`, optionally `@modelcontextprotocol/ext-apps` |
| `@waniwani/sdk/chat` | Chat React component | [chat/react.md](chat/react.md) | `react`, `react-dom`, `@ai-sdk/react`, `ai` |
| `@waniwani/sdk/chat` | Chat embed script | [chat/embed.md](chat/embed.md) | `react`, `react-dom`, `@ai-sdk/react`, `ai` |

---

## Event Tracking (`@waniwani/sdk`)

### Setup

```typescript
import { waniwani } from "@waniwani/sdk";

const client = waniwani({
  apiKey: "...",    // or set WANIWANI_API_KEY env var
  baseUrl: "...",   // defaults to https://app.waniwani.ai
});
```

### `client.track(event)`

Sends an event to `POST /api/mcp/events`. Returns `Promise<{ eventId: string }>`.

```typescript
await client.track({
  event: "tool.called",
  properties: { name: "pricing", type: "pricing" },
  meta: extra._meta,  // MCP request metadata
});
```

### Event Types

| Event | Properties | Fields |
|-------|-----------|--------|
| `tool.called` | `ToolCalledProperties` | `name?: string`, `type?: "pricing" \| "product_info" \| "availability" \| "support" \| "other"` |
| `quote.requested` | none | — |
| `quote.succeeded` | `QuoteSucceededProperties` | `amount?: number`, `currency?: string` |
| `quote.failed` | none | — |
| `link.clicked` | `LinkClickedProperties` | `url?: string` |
| `purchase.completed` | `PurchaseCompletedProperties` | `amount?: number`, `currency?: string` |

### `meta` Field

Pass MCP request metadata to auto-extract session/user info:

- **`@modelcontextprotocol/sdk`**: `request.params._meta`
- **`@vercel/mcp-handler`**: `extra._meta`

### Example: Tracking in a Tool Handler

```typescript
server.registerTool("get_pricing", {
  title: "Get Pricing",
  description: "Returns pricing information",
  inputSchema: { product: z.string() },
}, async ({ product }, extra) => {
  const client = waniwani();

  await client.track({
    event: "tool.called",
    properties: { name: "get_pricing", type: "pricing" },
    meta: extra._meta,
  });

  // ... tool logic
  return { content: [{ type: "text" as const, text: "..." }] };
});
```

---

## Common Patterns

### Tracking + Widget

```typescript
const widget = createWidget({
  id: "show_quote",
  // ... config
}, async (input, context) => {
  const client = waniwani();

  await client.track({
    event: "quote.requested",
    meta: context.extra?._meta,
  });

  const quote = await generateQuote(input);

  await client.track({
    event: "quote.succeeded",
    properties: { amount: quote.amount, currency: "USD" },
    meta: context.extra?._meta,
  });

  return { text: `Quote: $${quote.amount}`, data: quote };
});
```

---

## Common Mistakes

- **Wrong import path** — Hooks come from `@waniwani/sdk/mcp/react`, not `@waniwani/sdk`
- **Missing `WidgetProvider`** — All hooks require the `WidgetProvider` wrapper
- **Assuming all hooks work everywhere** — `useSafeArea`, `useMaxHeight`, `useWidgetState` return `null`/no-op on MCP Apps (Claude)
- **Forgetting `widgetDomain`** — Required in `createWidget` config
- **Wrong event field names** — Use `event` (not `eventType`), `properties` (not flat fields), `meta` (not `metadata`)
