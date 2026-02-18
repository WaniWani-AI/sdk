# MCP Widget Creation (`@waniwani/sdk/mcp`)

Creates dual-platform widgets that work on both ChatGPT (OpenAI) and Claude (MCP Apps).

## Import

```typescript
import { createWidget, registerWidgets } from "@waniwani/sdk/mcp";
import { z } from "zod";
```

Peer dependencies: `@modelcontextprotocol/sdk`, `zod`

## `createWidget(config, handler)`

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

## `WidgetCSP`

```typescript
type WidgetCSP = {
  connect_domains?: string[];   // fetch/XHR requests
  resource_domains?: string[];  // static assets (images, fonts, scripts)
  frame_domains?: string[];     // iframe embeds
  redirect_domains?: string[];  // openExternal redirects
};
```

## `registerWidgets(server, widgets[])`

Registers multiple widgets on an `McpServer`:

```typescript
await registerWidgets(server, [widget1, widget2]);
```

## Complete Example

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

## Platform Detection

```typescript
import { detectPlatform, isOpenAI, isMCPApps } from "@waniwani/sdk/mcp";

detectPlatform(); // "openai" | "mcp-apps"
isOpenAI();       // true if window.openai exists
isMCPApps();      // true if sandboxed iframe
```

Note: These are client-side utilities for use in widget frontends, not server code.

## Common Mistakes

- **Forgetting `widgetDomain`** — Required in `createWidget` config
- **Wrong handler return shape** — Must return `{ text, data }`, not just data
