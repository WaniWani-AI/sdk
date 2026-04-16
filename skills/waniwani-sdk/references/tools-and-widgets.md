# MCP Resources & Tools (`@waniwani/sdk/mcp`)

Creates dual-platform resources and tools that work on both ChatGPT (OpenAI) and Claude (MCP Apps).

## Import

```typescript
import { createResource, createTool, registerTools } from "@waniwani/sdk/mcp";
import { z } from "zod";
```

Peer dependencies: `@modelcontextprotocol/sdk`, `zod`

## `createResource(config)`

Creates a reusable UI resource (HTML template). Register it on the server, then reference it from tools.

**Config fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique resource identifier |
| `title` | `string` | Yes | Display title |
| `description` | `string` | No | UI description (what it displays) |
| `baseUrl` | `string` | Yes | Where to fetch widget HTML |
| `htmlPath` | `string` | Yes | Path relative to `baseUrl` |
| `widgetDomain` | `string` | Yes | Domain for OpenAI security context |
| `prefersBorder` | `boolean` | No | Show widget border (default: `true`) |
| `autoHeight` | `boolean` | No | Auto-adapt iframe height to content |
| `widgetCSP` | `WidgetCSP` | No | Content Security Policy for the widget |

**Returns:** `RegisteredResource` with `id`, `title`, `openaiUri`, `mcpUri`, and `register(server)`.

```typescript
const pricingUI = createResource({
  id: "show_pricing",
  title: "Show Pricing",
  description: "Displays pricing plans",
  baseUrl: "https://my-app.com",
  htmlPath: "/widgets/pricing",
  widgetDomain: "my-app.com",
});

// Register on the MCP server before referencing from tools
await pricingUI.register(server);
```

## `createTool(config, handler)`

Creates an MCP tool. When `resource` is provided, the tool returns `structuredContent` with widget metadata. Without a resource, it returns plain text.

**Config fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resource` | `RegisteredResource` | No | Resource to render. When present, tool returns widget data. |
| `id` | `string` | When no resource | Tool identifier. Defaults to `resource.id`. |
| `title` | `string` | When no resource | Display title. Defaults to `resource.title`. |
| `description` | `string` | Yes | Action-oriented description (tells model WHEN to use this tool) |
| `widgetDescription` | `string` | No | UI description (WHAT it displays), falls back to `description` |
| `inputSchema` | `ZodRawShape` | Yes | Input parameters using Zod |
| `invoking` | `string` | No | Loading message (default: `"Loading..."`) |
| `invoked` | `string` | No | Loaded message (default: `"Loaded"`) |
| `internal` | `boolean` | No | Flag as flow-only. Prepends instructions to the description telling the AI not to call this tool directly. |
| `annotations` | `object` | No | `readOnlyHint`, `idempotentHint`, `openWorldHint`, `destructiveHint` |

**Handler signature:**

```typescript
async (input: TypedInput, context: ToolHandlerContext) => Promise<{
  text: string;                     // Text content for LLM
  data?: Record<string, unknown>;   // Structured data for widget UI (only with resource)
}>
```

The `context` object contains `extra._meta` with MCP request metadata.

## `registerTools(server, tools[])`

Registers multiple tools on an `McpServer` in a single call:

```typescript
await registerTools(server, [pricingTool, searchTool]);
```

## `WidgetCSP`

Content Security Policy configuration for widget iframes:

```typescript
type WidgetCSP = {
  connect_domains?: string[];   // fetch/XHR requests
  resource_domains?: string[];  // static assets (images, fonts, scripts)
  frame_domains?: string[];     // iframe embeds
  redirect_domains?: string[];  // openExternal redirects
};
```

## Platform Detection

Client-side utilities for use in widget frontends (not server code):

```typescript
import { detectPlatform, isOpenAI, isMCPApps } from "@waniwani/sdk/mcp";

detectPlatform(); // "openai" | "mcp-apps"
isOpenAI();       // true if running inside ChatGPT
isMCPApps();      // true if running inside Claude (MCP Apps)
```

## `createTrackingRoute(options?)`

Creates a server-side API route that receives batched events from browser widgets (via `useWaniwani`) and forwards them to the WaniWani backend. Returns a web-standard `Request -> Response` handler compatible with Next.js App Router.

```typescript
import { createTrackingRoute } from "@waniwani/sdk/mcp";

// app/api/waniwani/track/route.ts
const handler = createTrackingRoute({
  apiKey: process.env.WANIWANI_API_KEY,
  apiUrl: process.env.WANIWANI_API_URL,
});

export { handler as POST };
```

**Options:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | `string` | No | API key. Defaults to `WANIWANI_API_KEY` env var. |
| `apiUrl` | `string` | No | Base URL. Defaults to `https://app.waniwani.ai`. |

This is an alternative to direct browser-to-backend posting via JWT tokens. Use it when you prefer routing widget events through your own server.

## Complete Example

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createResource, createTool, registerTools } from "@waniwani/sdk/mcp";
import { z } from "zod";

// 1. Create and register a resource (UI template)
const pricingUI = createResource({
  id: "show_pricing",
  title: "Show Pricing",
  description: "Displays pricing plans",
  baseUrl: "https://my-app.com",
  htmlPath: "/widgets/pricing",
  widgetDomain: "my-app.com",
});

const server = new McpServer({ name: "my-server", version: "1.0.0" });
await pricingUI.register(server);

// 2. Create a widget tool (with resource)
const pricingTool = createTool({
  resource: pricingUI,
  description: "Show pricing plans when users ask about pricing",
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

// 3. Create a plain tool (no resource)
const searchTool = createTool({
  id: "search",
  title: "Search",
  description: "Search the knowledge base",
  inputSchema: {
    query: z.string().describe("Search query"),
  },
  annotations: { readOnlyHint: true },
}, async ({ query }) => {
  const results = await search(query);
  return { text: JSON.stringify(results) };
});

// 4. Register all tools
await registerTools(server, [pricingTool, searchTool]);
```

## Internal (Flow-Only) Tools

Use `internal: true` to flag a tool that should only be called as part of a flow (e.g. a display tool referenced by `showWidget()`). The SDK prepends instructions to the tool description telling the AI not to call it directly.

```typescript
const showPricing = createTool({
  resource: pricingUI,
  description: "Show pricing comparison widget",
  inputSchema: { postalCode: z.string(), plans: z.array(z.string()) },
  internal: true,  // AI will only call this when a flow instructs it to
}, async ({ postalCode, plans }) => ({
  text: "Pricing loaded",
  data: { postalCode, plans },
}));
```

This is useful for widget tools that are designed to be called from a flow's `showWidget()` step and would produce confusing results if the AI called them independently.

## Common Mistakes

- **Forgetting to register the resource** -- Call `await resource.register(server)` before registering tools that reference it.
- **Missing `id`/`title` on plain tools** -- These fields are required when no `resource` is provided.
- **Wrong handler return shape** -- Must return `{ text }` for plain tools or `{ text, data }` for widget tools.
- **Using platform detection on the server** -- `detectPlatform()`, `isOpenAI()`, and `isMCPApps()` are client-side only (widget frontends).
