---
name: migrate-waniwani-sdk-0.19-to-0.20
description: "Migrate a project from @waniwani/sdk 0.19.x to 0.20.x and auto-apply its breaking change: the entire legacy tier is deleted. The entry points @waniwani/sdk/legacy, /legacy/react, /legacy/next-js, /legacy/express-js, /next-js, /express-js and /chat/server no longer exist, ChatCard is gone from @waniwani/sdk/chat, and @modelcontextprotocol/ext-apps is no longer a peer dependency. Covers createTool/createResource/registerTools to server.registerTool or createFlow, the chat BFF adapters (toNextJsHandler, toExpressJsHandler, createApiHandler) to WaniwaniChat, RegisteredTool moving to @waniwani/sdk/mcp, and what to do about the widget host React hooks. Trigger when the user is on @waniwani/sdk 0.19.x and wants to move to 0.20, asks to migrate to 0.20, or hits 'Cannot find module @waniwani/sdk/legacy' (or /next-js, /express-js, /chat/server) after bumping @waniwani/sdk."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.19 → 0.20

A self-contained migration for the single hop from `0.19.x` to `0.20.x`. It covers only that jump; for other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.19.x`. If it is on an older version, migrate up to 0.19 first (each jump ships its own migration skill); if it is already on 0.20+, there is nothing to do here.

## What 0.20 changes

0.12.0 moved the MCP-widget-in-host stack and the chat-server BFF adapters to `@waniwani/sdk/legacy*` while the old paths kept re-exporting every symbol, so nothing broke. 0.20.0 deletes the whole tier. There is no shim and no deprecation window left: these surface as module-resolution errors, not warnings.

Entry points that no longer exist:

| Entry point | Held |
| --- | --- |
| `@waniwani/sdk/legacy` | `createTool`, `createResource`, `registerTools`, `ToolConfig`, `ToolHandler`, `ToolHandlerContext`, `ToolToolCallback`, `ResourceConfig`, `RegisteredResource`, `WidgetCSP` |
| `@waniwani/sdk/legacy/react` | `WidgetProvider`, `useWidgetClient`, `useToolOutput`, `useToolResponseMetadata`, `useCallTool`, `useSendFollowUp`, `useFlowAction`, `useUpdateModelContext`, `useDisplayMode`, `useRequestDisplayMode`, `useTheme`, `useLocale`, `useSafeArea`, `useMaxHeight`, `useWidgetState`, `useOpenExternal`, `useIsChatGptApp`, `InitializeNextJsInIframe`, `LoadingWidget`, `DevModeProvider`, the mock helpers, `detectPlatform`, `isMCPApps`, `isOpenAI` |
| `@waniwani/sdk/legacy/next-js`, `@waniwani/sdk/next-js` | `toNextJsHandler` |
| `@waniwani/sdk/legacy/express-js`, `@waniwani/sdk/express-js` | `toExpressJsHandler` |
| `@waniwani/sdk/chat/server` | `ApiHandler`, `ApiHandlerOptions`, `BeforeRequestContext`, `BeforeRequestResult`, `ClientVisitorContext`, `VisitorMeta`, `WebSearchConfig`, `GeoLocation`, `extractGeoFromHeaders` |

Also gone: `ChatCard` and `ChatCardProps` from `@waniwani/sdk/chat`.

`@modelcontextprotocol/ext-apps` is no longer a peer dependency. Only the legacy widget clients imported it. Add it to your own dependencies if your app talks to a widget host directly.

**Untouched:** `@waniwani/sdk`, `@waniwani/sdk/mcp`, `@waniwani/sdk/mcp/react` (`useWaniwani`), `@waniwani/sdk/mcp/react/skybridge`, `@waniwani/sdk/chat` (`WaniwaniChat`, `ChatEmbed`, `McpAppFrame`, themes), `@waniwani/sdk/kb`, `@waniwani/sdk/chat/styles.css`, `@waniwani/sdk/chat/embed.js`.

This break **is** visible to `tsc` and to the bundler: every removed entry point fails to resolve, so the error output is the complete call-site list.

## Procedure

1. **Bump the dependency.**
   ```bash
   bun add @waniwani/sdk@^0.20.0
   ```
2. **Collect the call sites.**
   ```bash
   bun run typecheck
   rg "@waniwani/sdk/(legacy|next-js|express-js|chat/server)" -l
   rg "\bChatCard\b" -l
   ```
3. **Apply rewrites 1 through 5** below, matching each call site to its rewrite.
4. **Verify — this is the completion check.**
   ```bash
   bun run typecheck && bun test
   ```
5. **Report** which rewrite each call site took, and list anything that needed a port rather than a rewrite (rewrite 5).

## Rewrite 1 — `RegisteredTool` changes import path

Pure path change, no shape change. Apply it first; it is the cheapest one.

```ts
// Before
import type { RegisteredTool } from "@waniwani/sdk/legacy";

// After
import type { RegisteredTool } from "@waniwani/sdk/mcp";
```

The type is still `{ id, title, description, register(server) }` and still structural, so whatever you already hand to `showWidget({ tool })` keeps satisfying it. This is the only legacy symbol that survived, because the OSS flow API depends on it.

## Rewrite 2 — `createTool` becomes `server.registerTool`

`createTool(config, handler)` returned `{ id, title, description, register }` and `registerTools(server, tools)` called each `register`. Register on the server directly.

```ts
// Before
import { createTool, registerTools } from "@waniwani/sdk/mcp";

export const searchTool = createTool(
  {
    id: "search",
    title: "Search",
    description: "Search the knowledge base",
    inputSchema: { query: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ query }, { waniwani, extra }) => {
    await waniwani?.track.priceShown({ amount: 49, currency: "EUR" });
    return { text: `Results for "${query}"`, data: { query } };
  },
);

await registerTools(server, [searchTool]);
```

```ts
// After
import { extractScopedClient } from "@waniwani/sdk/mcp";

server.registerTool(
  "search",
  {
    title: "Search",
    description: "Search the knowledge base",
    inputSchema: { query: z.string() },
    annotations: { title: "Search", readOnlyHint: true },
  },
  async ({ query }, extra) => {
    const waniwani = extractScopedClient(extra);
    await waniwani?.track.priceShown({ amount: 49, currency: "EUR" });
    return {
      content: [{ type: "text" as const, text: `Results for "${query}"` }],
      structuredContent: { query },
    };
  },
);
```

Apply without judgment:

- `config.id` (or `config.resource.id` when the tool was resource-backed) becomes `registerTool`'s first argument.
- The rest of `config` becomes the second argument, minus `id`, `resource`, `invoking`, `invoked` and `autoInjectResultText`. Those four have no equivalent; `invoking`/`invoked` reappear in rewrite 3's `_meta`.
- Copy the top-level `title` into `annotations.title` as well. `createTool` accepted it at the top level, and Claude's Connectors Directory requires it inside `annotations` or it flags the server at submission.
- Handler return `{ text }` becomes `{ content: [{ type: "text" as const, text }] }`.
- Handler return `{ text, data }` becomes that plus `structuredContent: data`.
- The handler's second parameter changes from `{ extra, waniwani }` to MCP's `extra`. Replace `waniwani` with `extractScopedClient(extra)` and `extra._meta` (the old `context.extra._meta`) with `extra._meta` directly. `extractScopedClient` is still exported from `@waniwani/sdk/mcp`.
- Drop the `await` on the old `registerTools` call; `registerTool` is synchronous.

**When the tool pauses, branches, or carries state across turns, port it to `createFlow` instead.** That is the surface `createTool` was deprecated in favour of back in 0.12, and a straight `registerTool` translation of a multi-turn tool keeps the problem `createFlow` exists to solve.

## Rewrite 3 — resource-backed tools carry their own `_meta`

`createTool` derived widget metadata from `config.resource` via `createResource`. Both are gone, so write the metadata out. This is exactly what `createTool` used to build:

```ts
_meta: {
  "openai/outputTemplate": openaiUri,
  "openai/toolInvocation/invoking": invoking,   // default "Loading..."
  "openai/toolInvocation/invoked": invoked,     // default "Loaded"
  "openai/widgetAccessible": true,
  "openai/resultCanProduceWidget": true,
  ui: { resourceUri: mcpUri },                  // add `autoHeight: true` if the resource set it
  "ui/resourceUri": mcpUri,                     // flat key, for older MCP Apps hosts
}
```

`createResource` built `mcpUri` as `ui://widgets/ext-apps/{id}.html` and `openaiUri` from the resource's own URI. Keep serving whatever URIs you already serve; only the construction moves into your code.

A resource-backed handler that returned `{ text, data }` becomes:

```ts
return {
  content: [{ type: "text" as const, text }],
  structuredContent: data,
  _meta: { /* the block above */ },
};
```

Registering the HTML resource itself is now a plain `server.registerResource` call with the same URI and MIME type you were passing to `createResource` (`text/html+skybridge` for the OpenAI path, `text/html;profile=mcp-app` for MCP Apps).

## Rewrite 4 — delete the chat BFF

`toNextJsHandler`, `toExpressJsHandler` and `createApiHandler` existed so the chat widget could proxy through your backend. `WaniwaniChat` talks to `app.waniwani.ai` directly, so the route disappears rather than moving.

```tsx
// Before — app/api/waniwani/[[...path]]/route.ts
import { toNextJsHandler } from "@waniwani/sdk/next-js";
export const { GET, POST } = toNextJsHandler(client);
```
```tsx
// Before — the page
import { ChatCard } from "@waniwani/sdk/chat";
<ChatCard api="/api/waniwani" />
```

```tsx
// After — delete the route file entirely
import { WaniwaniChat } from "@waniwani/sdk/chat";

<WaniwaniChat token="wwp_..." channelId="51c3658a-..." />
```

The `token` is a public `wwp_...` token from the Waniwani dashboard and `channelId` routes to the right agent. Both are safe in client code.

Keep a backend of your own **only** if you were using `beforeRequest` to inject per-visitor context, or pointing at a self-hosted model. In that case stay on `ChatEmbed` and set `api` to a route you write yourself. The SDK no longer ships the router, so that route is now your code:

```tsx
import { ChatEmbed } from "@waniwani/sdk/chat";
<ChatEmbed api="/api/chat" headers={{ Authorization: `Bearer ${token}` }} />
```

`extractGeoFromHeaders` and `GeoLocation` went with `@waniwani/sdk/chat/server`. If you were calling it, read `x-vercel-ip-country` / `x-vercel-ip-city` (or your platform's equivalents) in your own route.

## Rewrite 5 — widget host React hooks need a port, not a rewrite

`WidgetProvider` and the host bridge hooks have no drop-in replacement in the SDK. Split them by what they were doing:

- **Tracking from inside a widget** stays in the SDK: `useWaniwani` from `@waniwani/sdk/mcp/react`, or from `@waniwani/sdk/mcp/react/skybridge` when skybridge hosts the widget. Both survive 0.20 untouched. `useWaniwani` never read `WidgetProvider` context (that went away in 0.17), so removing the provider does not affect it.
- **Everything else** (host handshake, display mode, `tools/call` from the widget, follow-up messages, theme, safe area, widget state) belongs to the app framework now. Move the widget to the kit's runtime rather than reimplementing the postMessage bridge.

If a widget only ever called `useToolOutput`, the data it read is the tool result your host already passes in; take it as a prop instead of from context.

## Not covered by a shim

The tier is deleted outright rather than left behind a `@deprecated` re-export that throws. It was deprecated in 0.12.0 with a stated removal in 0.14.0, so the deprecation window has been open for eight minor versions; another one buys nothing. A module-resolution error names the exact specifier and file, which makes the migration list easier to collect than a runtime throw would.

## Common mistakes

- **Reaching for `@waniwani/sdk/legacy` as the fix.** It is the thing that was removed. Every rewrite above moves off it, never onto it.
- **Translating a multi-turn `createTool` into a single `registerTool`.** If the tool interrupts, branches or holds state, it wants `createFlow`. Rewrite 2 is for single-shot tools.
- **Forgetting `annotations.title`.** `createTool` took a top-level `title`; the Connectors Directory checks the one inside `annotations`. Copy it into both.
- **Leaving the BFF route in place.** `WaniwaniChat` does not call it. A route that still imports `@waniwani/sdk/next-js` fails to build even when nothing renders it.
- **Assuming `useWaniwani` broke.** It is not part of the legacy tier and needs no changes.
- **Adding `@modelcontextprotocol/ext-apps` back as a peer to silence a warning.** If your own code imports it, add it as a normal dependency; the SDK no longer references it.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done.
