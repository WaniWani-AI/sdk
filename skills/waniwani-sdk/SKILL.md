---
name: waniwani-sdk
description: "MCP distribution SDK: build sales funnels, lead generation, booking flows, insurance quote flows, pricing quote flows, and any multi-step conversational MCP app with @waniwani/sdk. Open source createFlow engine (no API key required) with pluggable state backends (in-memory, Redis, Upstash, Cloudflare KV, DynamoDB, or hosted). Optional free tier adds event tracking, funnel analytics, knowledge base, and a chat widget. Trigger when the user wants to add an MCP funnel, sales funnel, lead gen flow, booking flow, quote flow, knowledge base / FAQ tool, or embedded chat to an MCP server."
license: MIT
metadata:
  author: WaniWani
---

# WaniWani SDK (`@waniwani/sdk`)

The MCP distribution SDK. Build sales funnels, lead generation, booking, insurance quote, and pricing quote apps on top of your MCP server. Open-source flow engine, with an optional free tier for hosted state, event tracking, funnel analytics, knowledge base, and a playground. The split:

- **Open source** — `createFlow`, `StateGraph`, the `KvStore` interface, `MemoryKvStore`. Runs with no API key against any state backend you implement.
- **Free tier** — set `WANIWANI_API_KEY` to unlock hosted flow state, event tracking, funnel analytics, knowledge base, and the dashboard playground.

Docs: [docs.waniwani.ai](https://docs.waniwani.ai)
Dashboard: [app.waniwani.ai](https://app.waniwani.ai)

## Install

```bash
bun add @waniwani/sdk
```

Core flow engine has no required runtime dependencies. Peer dependencies (`@modelcontextprotocol/sdk`, `zod`, etc.) vary by entry point — see the export table below.

## Quick start — open source path

For developers who want pure OSS with no telemetry:

```typescript
import { createFlow, MemoryKvStore, START, END } from "@waniwani/sdk/mcp";
import { z } from "zod";

const onboardingFlow = createFlow({
  id: "onboarding",
  title: "User Onboarding",
  description: "Use when a new user wants to get started.",
  state: {
    email: z.string().describe("Work email"),
    useCase: z.string().describe("What they want to build"),
  },
})
  .addNode("ask_email", ({ interrupt }) =>
    interrupt({ email: { question: "What's your work email?" } })
  )
  .addNode("ask_use_case", ({ interrupt }) =>
    interrupt({ useCase: { question: "What do you want to build?" } })
  )
  .addEdge(START, "ask_email")
  .addEdge("ask_email", "ask_use_case")
  .addEdge("ask_use_case", END)
  .compile({ store: new MemoryKvStore() });

await onboardingFlow.register(server);
```

`MemoryKvStore` is fine for dev/tests. For production self-hosting, see [kv-store.md](references/kv-store.md) for Redis, Upstash, Cloudflare KV, and DynamoDB adapters.

## Quick start — free tier path

Same code, hosted features added:

```bash
# .env
WANIWANI_API_KEY=wwk_...
```

```typescript
// Drop the `store` argument — flow state now lives on app.waniwani.ai
const flow = createFlow({ /* …same… */ }).compile();

// Optional: auto-track every tool call
import { withWaniwani } from "@waniwani/sdk/mcp";
withWaniwani(server);
```

Get a free key at [app.waniwani.ai](https://app.waniwani.ai). See [setup.md](references/setup.md) for full configuration.

## Export paths

| Export | Purpose | Tier | Reference |
|---|---|---|---|
| `@waniwani/sdk` | `waniwani()` client, `defineConfig`, `WaniWaniError` | Free tier | [setup.md](references/setup.md) |
| `@waniwani/sdk/mcp` | `createFlow`, `KvStore`, `MemoryKvStore`, `withWaniwani`, tracking helpers | OSS + Free tier | [flows.md](references/flows.md), [kv-store.md](references/kv-store.md) |
| `@waniwani/sdk/mcp/react` | `useWaniwani` standalone tracking hook | OSS + Free tier | (rest of this entry point is legacy) |
| `@waniwani/sdk/chat` | `ChatEmbed`, themes | Free tier | [chat-widget.md](references/chat-widget.md) |
| `@waniwani/sdk/chat/embed.js` | Self-contained `<script>` install for any website | Free tier | [chat-widget.md](references/chat-widget.md) |
| `@waniwani/sdk/chat/styles.css` | Prebuilt Tailwind styles for chat components | Free tier | [chat-widget.md](references/chat-widget.md) |
| `@waniwani/sdk/kb` | Knowledge base client | Free tier | [knowledge-base.md](references/knowledge-base.md) |

## Tier reference

### Open source (no API key required)

`createFlow` plus its supporting types. Drives multi-step conversations: pause on interrupts, branch on conditions, persist state across calls. Compiles into a single MCP tool the model invokes.

State persistence is pluggable through the `KvStore` interface. Built-in:
- `MemoryKvStore` — in-process `Map`, dev only
- `WaniwaniKvStore` — hosted (free tier; selected automatically when API key is set)

Or write a 10-line adapter for any backend. See [kv-store.md](references/kv-store.md).

If no `{ store }` is passed and `WANIWANI_API_KEY` is not set, `.compile()` throws with a clear error pointing at the fix. No silent fallback.

### Free tier (one env var: `WANIWANI_API_KEY`)

Adds hosted features on top of the OSS flow engine.

- **Hosted flow state** — `WaniwaniKvStore` used by default when no `{ store }` is passed.
- **Event tracking** — `waniwani().track()` for custom events, `withWaniwani(server)` for auto-tracking every tool call.
- **Knowledge base** — `createKbClient()` for ingest/search.
- **Funnel analytics** — flow graphs auto-sync to the dashboard.
- **Chat widget** — `ChatEmbed` talks directly to `app.waniwani.ai`.

`withWaniwani(server)` is safe to call with or without an API key — tracking silently no-ops when no key is set, but session-ID bridging and widget metadata forwarding still happen.

### Legacy

The following are still exported for back-compat with existing customer MCPs but are no longer documented for new code: `createTool`, `createResource`, `registerTools`, `toNextJsHandler`, `toExpressJsHandler`, `createApiHandler`, all MCP-widget React hooks (`WidgetProvider`, `useWidgetClient`, `useToolOutput`, etc.) except `useWaniwani`, `InitializeNextJsInIframe`, `LoadingWidget`, `DevModeProvider`, `detectPlatform`, `isMCPApps`, `isOpenAI`.

**Never recommend these for new code.** They will move to dedicated `@waniwani/sdk/legacy*` entry points in a future minor release. Existing apps using them keep working.

`@waniwani/sdk/evals` has been removed entirely — see [legacy/evals](https://docs.waniwani.ai/legacy/evals).

## Reading guide

| You want to... | Read |
|---|---|
| Build a flow that runs without an API key | [flows.md](references/flows.md) |
| Plug in a Redis / Upstash / Cloudflare KV / DynamoDB backend | [kv-store.md](references/kv-store.md) |
| Deploy a pure OSS production MCP server | [self-hosting.md](references/self-hosting.md) |
| Add a free-tier API key and unlock tracking + dashboard | [setup.md](references/setup.md) |
| Use the flow API in detail (nodes, edges, interrupts, widgets) | [flows-api-reference.md](references/flows-api-reference.md) |
| Add knowledge-base search | [knowledge-base.md](references/knowledge-base.md) |
| Embed the chat widget on a website | [chat-widget.md](references/chat-widget.md) |

## Guided playbooks

| User wants to... | Playbook |
|---|---|
| Initialize a new MCP project from the template | [scripts/initialize.md](scripts/initialize.md) |
| Create their first flow | [scripts/create-flow.md](scripts/create-flow.md) |
| Tunnel the dev server for remote testing | [scripts/tunnel.md](scripts/tunnel.md) |

When a playbook exists for the user's task, **follow the playbook step by step** instead of writing code directly. The playbooks include prerequisite checks, interactive design steps, and testing instructions.

## Common mistakes

- **`createFlow().compile()` throws "no flow store configured"** — Pass `{ store: new MemoryKvStore() }` to `.compile()` for dev, or set `WANIWANI_API_KEY` for the hosted store, or pass a custom KV adapter.
- **Creating multiple clients** — Create one `waniwani()` in `lib/waniwani.ts` and import everywhere.
- **Wrong import paths** — Flow primitives + KV: `@waniwani/sdk/mcp`. `useWaniwani`: `@waniwani/sdk/mcp/react`. Chat widget: `@waniwani/sdk/chat`.
- **Forgetting `START`/`END` edges** — Every flow needs `addEdge(START, firstNode)` and `addEdge(lastNode, END)`.
- **Calling `interrupt`/`showWidget` directly** — These come from the handler context: `({ interrupt }) => interrupt(...)`.
- **Suggesting `createTool` / `createResource` for new code** — These are legacy. Use `createFlow` instead. They remain exported only for back-compat.
