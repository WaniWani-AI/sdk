---
name: waniwani-sdk
description: "Integrate the @waniwani/sdk package into MCP servers for event tracking, multi-step conversational flows, widget creation, knowledge base search, and chat components. Use when building or integrating WaniWani analytics, creating MCP tools with UI widgets, building multi-turn flows, or adding chat to a website."
license: AGPL-3.0-or-later
metadata:
  author: WaniWani
---

# WaniWani SDK (`@waniwani/sdk`)

SDK for MCP event tracking, multi-step conversational flows, dual-platform widget creation, knowledge base search, and embeddable chat components. Works with `@modelcontextprotocol/sdk`, `@vercel/mcp-handler`, and Skybridge.

Docs: [docs.waniwani.ai](https://docs.waniwani.ai)
Dashboard: [app.waniwani.ai](https://app.waniwani.ai)

## Install

```bash
bun add @waniwani/sdk     # or: pnpm add / npm install
```

Peer dependencies vary by export path (see table below). The core tracking module has zero runtime dependencies.

## Quick Start

1. Get an API key from [app.waniwani.ai](https://app.waniwani.ai) (create an MCP project, copy `wwk_...` key)
2. Set the env var:

```bash
# .env
WANIWANI_API_KEY=wwk_...
```

3. Create a client singleton:

```typescript
// lib/waniwani.ts
import { waniwani } from "@waniwani/sdk";

export const wani = waniwani();
// Reads WANIWANI_API_KEY from env — one instance, import everywhere
```

4. Wrap your MCP server for automatic tracking:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withWaniwani } from "@waniwani/sdk/mcp";
import { wani } from "../lib/waniwani";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

// Every tool call now emits a tool.called event with timing and status
withWaniwani(server, { client: wani });

server.registerTool("get_pricing", /* ... */);
```

5. Verify: trigger any tool call, then check your [WaniWani dashboard](https://app.waniwani.ai).

## Export Paths

| Export | Purpose | Reference | Peer Dependencies |
|--------|---------|-----------|-------------------|
| `@waniwani/sdk` | Event tracking client | (this file) | None |
| `@waniwani/sdk/mcp` | Server-side tools, widgets, flows, tracking | [tools-and-widgets](references/tools-and-widgets.md), [flows](references/flows.md) | `@modelcontextprotocol/sdk`, `zod` |
| `@waniwani/sdk/mcp/react` | Client-side widget React hooks | [widget-react-hooks](references/widget-react-hooks.md) | `react` |
| `@waniwani/sdk/chat` | Chat React component + embed script | [chat-widget](references/chat-widget.md) | `react`, `react-dom`, `@ai-sdk/react`, `ai` |
| `@waniwani/sdk/chat/styles.css` | Chat widget stylesheet | [chat-widget](references/chat-widget.md) | -- |
| `@waniwani/sdk/next-js` | Next.js route handler adapter | [chat-server](references/chat-server.md) | -- |
| `@waniwani/sdk/kb` | Knowledge base client | [knowledge-base](references/knowledge-base.md) | None |

## Core: Event Tracking (`@waniwani/sdk`)

### `waniwani(config?)`

Creates a client instance. Reads `WANIWANI_API_KEY` and `WANIWANI_API_URL` from env vars when called with no arguments.

```typescript
import { waniwani } from "@waniwani/sdk";

const client = waniwani();

// Or with explicit config:
const client = waniwani({
  apiKey: process.env.WANIWANI_API_KEY,
  apiUrl: "https://app.waniwani.ai",  // default
});
```

Create one client in `lib/waniwani.ts` and import it everywhere. Do not call `waniwani()` in multiple files.

### `client.track(event)`

Enqueues an event for batched delivery. Returns immediately after enqueue.

```typescript
await client.track({
  event: "tool.called",
  properties: { name: "get_pricing", type: "pricing" },
  meta: extra._meta,  // MCP request metadata
});
```

### `client.identify(userId, properties?)`

Sends a one-shot `user.identified` event.

```typescript
await client.identify("user@example.com", { plan: "pro", company: "Acme" });
```

### Event Types

| Event | Key Properties |
|-------|---------------|
| `session.started` | -- |
| `tool.called` | `name`, `type` (`"pricing"`, `"product_info"`, `"availability"`, `"support"`, `"other"`) |
| `quote.requested` | -- |
| `quote.succeeded` | `amount`, `currency` |
| `quote.failed` | -- |
| `link.clicked` | `url` |
| `purchase.completed` | `amount`, `currency` |

### `meta` Field

Pass MCP request metadata to auto-extract session and user info:

- **`@modelcontextprotocol/sdk`**: `request.params._meta`
- **`@vercel/mcp-handler`**: `extra._meta`

### `client.flush()` / `client.shutdown(options?)`

```typescript
// Flush buffered events
await client.flush();

// Flush and stop transport (for serverless/tests)
const result = await client.shutdown({ timeoutMs: 2000 });
// => { timedOut: boolean, pendingEvents: number }
```

In Node environments, the SDK auto-flushes on `beforeExit`, `SIGINT`, and `SIGTERM`. For serverless or edge runtimes, call `shutdown()` explicitly.

## Auto-Tracking: `withWaniwani` (`@waniwani/sdk/mcp`)

Wraps an MCP server so all tool handlers automatically emit `tool.called` events **after** execution with `durationMs`, `status` (`"ok"` or `"error"`), and `errorMessage` (on failure).

```typescript
import { withWaniwani } from "@waniwani/sdk/mcp";
import { wani } from "../lib/waniwani";

withWaniwani(server, { client: wani });
```

**Options (all optional):**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `client` | `WaniWaniClient` | auto from env | Pre-built client |
| `toolType` | `string \| (name) => string` | `"other"` | Default tool type for events |
| `metadata` | `Record<string, unknown>` | -- | Extra metadata on every event |
| `flushAfterToolCall` | `boolean` | `false` | Flush after each tool call |
| `onError` | `(error) => void` | -- | Non-fatal tracking error callback |
| `injectWidgetToken` | `boolean` | `true` | Inject JWT into `_meta.waniwani` for browser widget tracking |

### Combined example: auto-tracking + manual events

```typescript
const client = waniwani();

withWaniwani(server, { client, flushAfterToolCall: true });

server.registerTool("get_quote", config, async (input, extra) => {
  // tool.called is tracked automatically
  const quote = await generateQuote(input.product);

  // Additional event tracked manually
  await client.track({
    event: "quote.succeeded",
    properties: { amount: quote.amount, currency: "USD" },
    meta: extra._meta,
  });

  return { content: [{ type: "text", text: `Quote: $${quote.amount}` }] };
});
```

## Building Flows

Multi-step conversational flows with server-side state. Define a state graph, compile it into an MCP tool, and let the AI drive the flow step by step.

```typescript
import { createFlow, START, END, registerTools } from "@waniwani/sdk/mcp";
import { z } from "zod";

const flow = createFlow({
  id: "demo_qualification",
  title: "Demo Qualification",
  description: "Qualify a lead for a demo.",
  state: {
    email: z.string().describe("Work email"),
    role: z.string().describe("Role at company"),
  },
})
  .addNode("ask_email", ({ interrupt }) =>
    interrupt({ email: { question: "What is your work email?" } })
  )
  .addNode("ask_role", ({ interrupt }) =>
    interrupt({ role: { question: "What is your role?" } })
  )
  .addNode("done", ({ state }) => ({ summary: `${state.email}, ${state.role}` }))
  .addEdge(START, "ask_email")
  .addEdge("ask_email", "ask_role")
  .addEdge("ask_role", "done")
  .addEdge("done", END)
  .compile();

await registerTools(server, [flow]);
```

Flows support interrupt validation, conditional edges, widget steps, nested state, and pre-filling. See [references/flows.md](references/flows.md) for the full guide.

## Reading Guide

| You want to... | Read |
|----------------|------|
| Add analytics to an existing MCP server | [setup](references/setup.md) + auto-tracking section above |
| Create tools with widget UIs | [tools-and-widgets](references/tools-and-widgets.md) + [widget-react-hooks](references/widget-react-hooks.md) |
| Build multi-step conversational flows | [flows](references/flows.md) + [flows API reference](references/flows-api-reference.md) |
| Add a knowledge base with search | [knowledge-base](references/knowledge-base.md) |
| Embed a chat widget on a website | [chat-widget](references/chat-widget.md) + [chat-server](references/chat-server.md) |

## Common Mistakes

- **Missing `WANIWANI_API_KEY` env var** -- Flow state and tracking will throw. Set it in all environments (dev, Vercel, production).
- **Creating multiple clients** -- Create one in `lib/waniwani.ts` and import everywhere.
- **Wrong import paths** -- Hooks: `@waniwani/sdk/mcp/react`. Chat: `@waniwani/sdk/chat`. Tools: `@waniwani/sdk/mcp`.
- **Missing `WidgetProvider`** -- All React widget hooks require the `WidgetProvider` wrapper.
- **Forgetting `START`/`END` edges in flows** -- Every flow needs `addEdge(START, firstNode)` and `addEdge(lastNode, END)`.
- **Importing `interrupt`/`showWidget` directly** -- These come from the handler context: `({ interrupt }) => interrupt(...)`.
