# MCP Resources & Tools (`@waniwani/sdk/mcp`)

Creates dual-platform resources and tools that work on both ChatGPT (OpenAI) and Claude (MCP Apps).

## Import

```typescript
import { createResource, createTool, registerTools } from "@waniwani/sdk/mcp";
import { z } from "zod";
```

Peer dependencies: `@modelcontextprotocol/sdk`, `zod`

## `createResource(config)`

Creates a reusable UI resource (HTML template). Register it on the server, then reference it from tools or flows.

**Config fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique resource identifier |
| `title` | `string` | Yes | Display title |
| `description` | `string` | No | UI description (WHAT it displays) |
| `baseUrl` | `string` | Yes | Where to fetch widget HTML |
| `htmlPath` | `string` | Yes | Path relative to baseUrl |
| `widgetDomain` | `string` | Yes | Domain for OpenAI security context |
| `prefersBorder` | `boolean` | No | Widget border (default: `true`) |
| `autoHeight` | `boolean` | No | Auto-adapt iframe height to content |
| `widgetCSP` | `WidgetCSP` | No | Content Security Policy |

**Returns:** `RegisteredResource` with `id`, `title`, `openaiUri`, `mcpUri`, and `register(server)`.

## `createTool(config, handler)`

Creates an MCP tool. When `resource` is provided, the tool returns `structuredContent` + widget metadata. Without a resource, it's a plain text tool.

**Config fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resource` | `RegisteredResource` | No | Resource to render. When present, tool returns widget data. |
| `id` | `string` | When no resource | Tool identifier. Defaults to `resource.id`. |
| `title` | `string` | When no resource | Display title. Defaults to `resource.title`. |
| `description` | `string` | Yes | Action-oriented (tells model WHEN to use) |
| `widgetDescription` | `string` | No | UI description (WHAT it displays), falls back to `description` |
| `inputSchema` | `ZodRawShape` | Yes | Input parameters using zod |
| `invoking` | `string` | No | Loading message (default: `"Loading..."`) |
| `invoked` | `string` | No | Loaded message (default: `"Loaded"`) |
| `annotations` | `object` | No | `readOnlyHint`, `idempotentHint`, `openWorldHint`, `destructiveHint` |

**Handler signature:**

```typescript
async (input: TypedInput, context: ToolHandlerContext) => Promise<{
  text: string;                     // Text content for LLM
  data?: Record<string, unknown>;   // Structured data for widget UI (only when resource is present)
}>
```

The `context` has `extra._meta` with MCP request metadata.

## `WidgetCSP`

```typescript
type WidgetCSP = {
  connect_domains?: string[];   // fetch/XHR requests
  resource_domains?: string[];  // static assets (images, fonts, scripts)
  frame_domains?: string[];     // iframe embeds
  redirect_domains?: string[];  // openExternal redirects
};
```

## `registerTools(server, tools[])`

Registers multiple tools on an `McpServer`:

```typescript
await registerTools(server, [tool1, tool2]);
```

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

await registerTools(server, [pricingTool, searchTool]);
```

## Platform Detection

```typescript
import { detectPlatform, isOpenAI, isMCPApps } from "@waniwani/sdk/mcp";

detectPlatform(); // "openai" | "mcp-apps"
isOpenAI();       // true if window.openai exists
isMCPApps();      // true if sandboxed iframe
```

Note: These are client-side utilities for use in widget frontends, not server code.

## Server-Side Tracking Helpers

### `withWaniwani(server, options?)`

Wraps an MCP server so all tool handlers automatically emit `tool.called` events
**after** execution with timing and status:

```typescript
import "../../waniwani.config";
import { withWaniwani } from "@waniwani/sdk/mcp";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

// No args needed — reads from defineConfig
withWaniwani(server);
```

Each `tool.called` event includes `durationMs` (execution time), `status` (`"ok"` or `"error"`),
and `errorMessage` (on failure). Errors are re-thrown after tracking.

**Widget tracking config injection (default: enabled):** When `injectWidgetToken` is `true`
(default), `withWaniwani` injects `_meta.waniwani` into tool responses.

- Always injects `endpoint` (derived from `apiUrl`).
- Injects `token` when JWT minting via `POST /api/mcp/widget-tokens` succeeds.

This allows browser widgets using `useWaniwani()` to send events directly to the WaniWani
backend without a server-side proxy route. Tokens are cached and reused until near expiry.

For additional manual tracking inside tool handlers, use `client.track()` directly and pass `extra._meta` as `meta`.

### `createTrackingRoute(options?)`

Creates a server-side API route handler that receives batched events from browser widgets
(via `useWaniwani`) and forwards them to the WaniWani backend. Returns a web-standard
`Request → Response` handler compatible with Next.js App Router and similar frameworks.

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
| `apiKey` | `string` | No | API key for the WaniWani backend. Defaults to `WANIWANI_API_KEY` env var. |
| `apiUrl` | `string` | No | Base URL for the WaniWani backend. Defaults to `https://app.waniwani.ai`. |

This is an alternative to direct browser-to-backend posting via JWT tokens. Use it when
you prefer routing widget events through your own server rather than having widgets POST
directly to the WaniWani API.

## Common Mistakes

- **Forgetting to register the resource** — Call `await resource.register(server)` before registering tools that reference it
- **Missing `id`/`title` on plain tools** — Required when no resource is provided
- **Wrong handler return shape** — Must return `{ text }` (plain) or `{ text, data }` (widget)
