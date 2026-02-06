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

| Export | Purpose | Peer Dependencies |
|--------|---------|-------------------|
| `@waniwani/sdk` | Event tracking | None |
| `@waniwani/sdk/mcp` | Widget creation (server-side) | `@modelcontextprotocol/sdk`, `zod` |
| `@waniwani/sdk/mcp/react` | Widget React hooks (client-side) | `react`, optionally `@modelcontextprotocol/ext-apps` |

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

## Widget Creation (`@waniwani/sdk/mcp`)

Creates dual-platform widgets that work on both ChatGPT (OpenAI) and Claude (MCP Apps).

### `createWidget(config, handler)`

```typescript
import { createWidget, registerWidgets } from "@waniwani/sdk/mcp";
import { z } from "zod";
```

**Config fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique tool/widget identifier |
| `title` | `string` | Yes | Display title |
| `description` | `string` | Yes | Action-oriented (tells model WHEN to use) |
| `widgetDescription` | `string` | No | UI description (WHAT it displays), falls back to `description` |
| `baseUrl` | `string` | Yes | Where to fetch widget HTML |
| `htmlPath` | `string` | Yes | Path relative to baseUrl |
| `inputSchema` | `ZodRawShape` | Yes | Input parameters using zod |
| `widgetDomain` | `string` | Yes | Domain for OpenAI security context |
| `invoking` | `string` | No | Loading message (default: `"Loading..."`) |
| `invoked` | `string` | No | Loaded message (default: `"Loaded"`) |
| `prefersBorder` | `boolean` | No | Widget border (default: `true`) |
| `widgetCSP` | `WidgetCSP` | No | Content Security Policy |
| `annotations` | `object` | No | `readOnlyHint`, `idempotentHint`, `openWorldHint`, `destructiveHint` |

**Handler signature:**

```typescript
async (input: TypedInput, context: WidgetHandlerContext) => Promise<{
  text: string;                    // Text content for LLM
  data: Record<string, unknown>;   // Structured data for widget UI
}>
```

The `context` has `extra._meta` with MCP request metadata.

### `WidgetCSP`

```typescript
type WidgetCSP = {
  connect_domains?: string[];   // fetch/XHR requests
  resource_domains?: string[];  // static assets (images, fonts, scripts)
  frame_domains?: string[];     // iframe embeds
  redirect_domains?: string[];  // openExternal redirects
};
```

### `registerWidgets(server, widgets[])`

Registers multiple widgets on an `McpServer`:

```typescript
await registerWidgets(server, [widget1, widget2]);
```

### Complete Example

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createWidget, registerWidgets } from "@waniwani/sdk/mcp";
import { z } from "zod";

const pricingWidget = createWidget({
  id: "show_pricing",
  title: "Show Pricing",
  description: "Show pricing plans when users ask about pricing",
  baseUrl: "https://my-app.com",
  htmlPath: "/widgets/pricing",
  widgetDomain: "my-app.com",
  inputSchema: {
    plan: z.enum(["starter", "pro", "enterprise"]).describe("Plan to display"),
  },
  annotations: { readOnlyHint: true },
}, async ({ plan }, context) => {
  const pricing = await getPricing(plan);
  return {
    text: `Showing ${plan} pricing: $${pricing.amount}/mo`,
    data: { plan, ...pricing },
  };
});

const server = new McpServer({ name: "my-server", version: "1.0.0" });
await registerWidgets(server, [pricingWidget]);
```

### Platform Detection

```typescript
import { detectPlatform, isOpenAI, isMCPApps } from "@waniwani/sdk/mcp";

detectPlatform(); // "openai" | "mcp-apps"
isOpenAI();       // true if window.openai exists
isMCPApps();      // true if sandboxed iframe
```

Note: These are client-side utilities for use in widget frontends, not server code.

---

## React Hooks (`@waniwani/sdk/mcp/react`)

Client-side hooks for widget frontends. All widgets must be wrapped in `WidgetProvider`.

### `WidgetProvider`

```tsx
import { WidgetProvider } from "@waniwani/sdk/mcp/react";

export default function App() {
  return (
    <WidgetProvider loading={<div>Loading...</div>}>
      <MyWidget />
    </WidgetProvider>
  );
}
```

### Hooks Reference

| Hook | Returns | Platform |
|------|---------|----------|
| `useToolOutput<T>()` | `T \| null` | Both |
| `useCallTool()` | `(name, args) => Promise<ToolCallResult>` | Both |
| `useTheme()` | `"light" \| "dark"` | Both |
| `useLocale()` | `string` (e.g. `"en-US"`) | Both |
| `useDisplayMode()` | `"pip" \| "inline" \| "fullscreen"` | Both (MCP Apps: always `"inline"`) |
| `useRequestDisplayMode()` | `(mode) => Promise<DisplayMode>` | OpenAI only (no-op on MCP Apps) |
| `useOpenExternal()` | `(url) => void` | Both |
| `useSendFollowUp()` | `(prompt) => void` | Both |
| `useSafeArea()` | `SafeArea \| null` | OpenAI only (`null` on MCP Apps) |
| `useMaxHeight()` | `number \| null` | OpenAI only (`null` on MCP Apps) |
| `useWidgetState<T>(default?)` | `[T \| null, setState]` | OpenAI only (`[null, no-op]` on MCP Apps) |
| `useToolResponseMetadata()` | `object \| null` | OpenAI only |
| `useIsChatGptApp()` | `boolean` | OpenAI only |
| `useWidgetClient()` | `UnifiedWidgetClient` | Both |

### Example Widget

```tsx
"use client";
import {
  WidgetProvider,
  useToolOutput,
  useTheme,
} from "@waniwani/sdk/mcp/react";

function PricingContent() {
  const data = useToolOutput<{ plan: string; amount: number }>();
  const theme = useTheme();

  if (!data) return null;

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <h1>{data.plan} Plan</h1>
      <p>${data.amount}/mo</p>
    </div>
  );
}

export default function PricingWidget() {
  return (
    <WidgetProvider loading={<div>Loading pricing...</div>}>
      <PricingContent />
    </WidgetProvider>
  );
}
```

### Components

- **`InitializeNextJsInChatGpt`** — Required in Next.js layout for ChatGPT iframe compatibility. Takes `baseUrl` prop.
- **`LoadingWidget`** — Pre-built loading spinner for widget loading states.

### Dev Tools

For local development without a ChatGPT/Claude host:

```tsx
import { DevModeProvider } from "@waniwani/sdk/mcp/react";

// Wraps app, mocks window.openai for local testing
<DevModeProvider defaultProps={{ plan: "pro", amount: 49 }}>
  <MyWidget />
</DevModeProvider>
```

Programmatic mock updates: `initializeMockOpenAI()`, `updateMockToolOutput()`, `updateMockTheme()`, `updateMockDisplayMode()`, `updateMockGlobal()`.

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

### Theme-Aware Widget

```tsx
function MyWidget() {
  const theme = useTheme();
  return (
    <div style={{
      background: theme === "dark" ? "#1a1a1a" : "#ffffff",
      color: theme === "dark" ? "#ffffff" : "#000000",
    }}>
      {/* content */}
    </div>
  );
}
```

---

## Common Mistakes

- **Wrong import path** — Hooks come from `@waniwani/sdk/mcp/react`, not `@waniwani/sdk`
- **Missing `WidgetProvider`** — All hooks require the `WidgetProvider` wrapper
- **Assuming all hooks work everywhere** — `useSafeArea`, `useMaxHeight`, `useWidgetState` return `null`/no-op on MCP Apps (Claude)
- **Forgetting `widgetDomain`** — Required in `createWidget` config
- **Wrong event field names** — Use `event` (not `eventType`), `properties` (not flat fields), `meta` (not `metadata`)
