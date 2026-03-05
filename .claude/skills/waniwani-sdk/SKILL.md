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
| `@waniwani/sdk/kb` | Knowledge base client | [mcp/kb.md](mcp/kb.md) | None |

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

Enqueues an event for batched delivery to `POST /api/mcp/events/v2/batch`.
Returns `Promise<{ eventId: string }>` immediately after enqueue.

```typescript
await client.track({
  event: "tool.called",
  properties: { name: "pricing", type: "pricing" },
  meta: extra._meta,  // MCP request metadata
});
```

Legacy-compatible shape is also accepted:

```typescript
await client.track({
  eventType: "tool.called",
  toolName: "pricing",
  toolType: "pricing",
  metadata: { source: "legacy" },
});
```

### `client.flush()`

Flushes buffered tracking events.

### `client.shutdown(options?)`

Flushes and stops tracking transport.

```typescript
const result = await client.shutdown({ timeoutMs: 2000 });
// { timedOut: boolean, pendingEvents: number }
```

### Event Types

| Event | Properties | Fields |
|-------|-----------|--------|
| `session.started` | none | — |
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

### Example: Tracking in a Tool Handler (Manual)

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

## Server-Side Tracking Helpers (`@waniwani/sdk/mcp`)

### `withWaniwani(server, options?)` — Automatic Tracking

Wraps an MCP server so all tool handlers automatically emit `tool.called` events
**after** execution with `durationMs`, `status` (`"ok"` or `"error"`), and `errorMessage` (on failure).

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withWaniwani } from "@waniwani/sdk/mcp";

const server = new McpServer({ name: "my-server", version: "1.0.0" });
withWaniwani(server, {
  config: { apiKey: "..." },          // or uses WANIWANI_API_KEY env var
  toolType: "pricing",                 // default type for all tools
  flushAfterToolCall: true,            // flush after each tool invocation
});

// All tools registered after wrapping are auto-tracked
server.registerTool("get_pricing", config, async (input, extra) => {
  // tool.called event is emitted automatically after execution
  // with durationMs, status, and meta from extra._meta
  return { content: [{ type: "text" as const, text: "..." }] };
});
```

Options:

| Field | Type | Description |
|-------|------|-------------|
| `client` | `WaniWaniClient` | Pre-built client (skips internal creation) |
| `config` | `WaniWaniConfig` | Config for internal client creation |
| `toolType` | `string \| (name) => string` | Default tool type for tracked events |
| `metadata` | `Record<string, unknown>` | Extra metadata merged into every event |
| `flushAfterToolCall` | `boolean` | Flush transport after each tool call |
| `onError` | `(error) => void` | Non-fatal tracking error callback |
| `injectWidgetToken` | `boolean` (default: `true`) | Mint JWT and inject into `_meta.waniwani` for direct browser-to-backend tracking |

---

## Client-Side Widget Tracking (`@waniwani/sdk/mcp/react`)

### `useWaniwani(options?)` — Automatic Widget Event Tracking

Auto-captures user interactions from widget UIs. Also provides manual tracking methods.
Events are sent **directly to the WaniWani backend** using a JWT widget token that is
auto-resolved from `WidgetProvider` context (injected by `withWaniwani` on the server).

```typescript
import { useWaniwani } from "@waniwani/sdk/mcp/react";

function MyWidget() {
  const wani = useWaniwani();
  // Auto-captures clicks, link clicks, errors, scrolls, form interactions
  // Optionally call wani.track("custom_event") for manual events
  return <a href="https://example.com">Visit site</a>;
}
```

Options:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `token` | `string` | — | JWT widget token (auto-resolved from context if omitted) |
| `endpoint` | `string` | — | V2 batch endpoint URL (auto-resolved from context if omitted) |
| `sessionId` | `string` | — | Session ID for event correlation (auto-resolved from context, then falls back to random UUID) |
| `metadata` | `Record<string, unknown>` | — | Extra metadata merged into every event |

Returns `WaniwaniWidget`:

| Method | Description |
|--------|-------------|
| `identify(userId, traits?)` | Tie subsequent events to a user |
| `step(name, meta?)` | Record a funnel step (auto-incrementing sequence) |
| `track(event, properties?)` | Record a custom event |
| `conversion(name, data?)` | Record a conversion event |

Auto-captured events: `widget_render`, `widget_click`, `widget_link_click`, `widget_error`, `widget_scroll`, `widget_form_field`, `widget_form_submit`.

---

## Common Patterns

### withWaniwani + Manual Tracking in Widget Tools

Use `withWaniwani` for automatic `tool.called` tracking, and `client.track()` for
additional events inside tool handlers:

```typescript
import { withWaniwani } from "@waniwani/sdk/mcp";
import { waniwani } from "@waniwani/sdk";

const client = waniwani();

// Auto-track all tool calls
withWaniwani(server, { client, flushAfterToolCall: true });

const widget = createTool({
  resource: quoteResource,
  description: "Show a quote",
  inputSchema: { product: z.string() },
}, async ({ product }, context) => {
  const quote = await generateQuote(product);

  // Additional event tracked manually
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
- **No `WidgetProvider` in `page.tsx`** — Every widget page must wrap its content with `WidgetProvider`, otherwise all hooks will fail
- **Business logic in `page.tsx`** — Keep `page.tsx` as a thin wrapper only. All widget logic belongs in `lib/{{MCP_NAME}}/widgets/`
- **Assuming all hooks work everywhere** — `useSafeArea`, `useMaxHeight`, `useWidgetState` return `null`/no-op on MCP Apps (Claude)
- **Forgetting `widgetDomain`** — Required in `createWidget` config
- **Ignoring lifecycle methods** — Call `flush()` / `shutdown()` for graceful delivery during shutdown
