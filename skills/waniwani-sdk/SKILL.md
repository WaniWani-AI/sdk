---
name: waniwani-sdk
description: "MCP distribution SDK: build sales funnels, lead generation, booking flows, insurance quote flows, pricing quote flows, and any multi-step conversational MCP app with @waniwani/sdk. Open source createFlow engine (no API key required) with pluggable state backends (in-memory, Redis, Upstash, Cloudflare KV, DynamoDB, or hosted). Optional free tier adds a revenue-first event taxonomy (track leads, prices shown/compared, options selected, and conversions — including off-platform purchases), funnel analytics, knowledge base, and a chat widget. Trigger when the user wants to add an MCP funnel, sales funnel, lead gen flow, booking flow, quote flow, knowledge base / FAQ tool, or embedded chat to an MCP server — or to instrument tracking on a @waniwani/sdk app: emit or track events, record a conversion or revenue, attribute an off-platform purchase back to a lead, or measure where users drop off in a funnel."
license: MIT
metadata:
  author: Waniwani
---

# Waniwani SDK (`@waniwani/sdk`)

The MCP distribution SDK. Build sales funnels, lead generation, booking, insurance quote, and pricing quote apps on top of your MCP server.

## Read the docs before you write code

**This file is a map, not a manual.** The full, current documentation lives at
[docs.waniwani.ai/sdk/introduction](https://docs.waniwani.ai/sdk/introduction) and it is the only
source of truth for API shapes, option names, event properties, and version behavior. The SDK is
`0.x` and moves fast, so anything you remember about it may already be wrong.

Before you answer an API question or write a line of `@waniwani/sdk` code, **fetch the relevant docs
page** from the map below. When this file and the docs disagree, the docs win.

If you can fetch only one thing, fetch [docs.waniwani.ai/llms.txt](https://docs.waniwani.ai/llms.txt):
it is the complete page index, always current, and cheap to read.

## Where things live in the docs

| You want to... | Fetch |
|---|---|
| Understand what the SDK is and pick a path | [/sdk/introduction](https://docs.waniwani.ai/sdk/introduction) |
| Get something running end to end | [/sdk/quickstart](https://docs.waniwani.ai/sdk/quickstart) |
| Install the package, pick an entry point | [/sdk/configuration/installation](https://docs.waniwani.ai/sdk/configuration/installation), [/sdk/reference/entry-points](https://docs.waniwani.ai/sdk/reference/entry-points) |
| Get a free API key | [/sdk/configuration/api-key](https://docs.waniwani.ai/sdk/configuration/api-key) |
| Learn the flow engine | [/sdk/flows/overview](https://docs.waniwani.ai/sdk/flows/overview), then [architecture](https://docs.waniwani.ai/sdk/flows/architecture), [state](https://docs.waniwani.ai/sdk/flows/state), [nodes](https://docs.waniwani.ai/sdk/flows/nodes), [edges](https://docs.waniwani.ai/sdk/flows/edges), [interrupts](https://docs.waniwani.ai/sdk/flows/interrupts), [register](https://docs.waniwani.ai/sdk/flows/register) |
| Plug in Redis / Upstash / Cloudflare KV / DynamoDB | [/sdk/flows/kv-store](https://docs.waniwani.ai/sdk/flows/kv-store), [/sdk/reference/kv-store-api](https://docs.waniwani.ai/sdk/reference/kv-store-api) |
| Build a specific funnel | [/sdk/guides/funnels](https://docs.waniwani.ai/sdk/guides/funnels), then [sales-funnel](https://docs.waniwani.ai/sdk/guides/sales-funnel), [lead-generation](https://docs.waniwani.ai/sdk/guides/lead-generation), [booking](https://docs.waniwani.ai/sdk/guides/booking), [insurance-quote](https://docs.waniwani.ai/sdk/guides/insurance-quote) |
| See a full worked example | [/sdk/guides/pet-insurance](https://docs.waniwani.ai/sdk/guides/pet-insurance) |
| Deploy, or self-host with no API key | [/sdk/deployment/overview](https://docs.waniwani.ai/sdk/deployment/overview), [/sdk/deployment/self-hosting](https://docs.waniwani.ai/sdk/deployment/self-hosting) |
| Wrap an existing MCP server, set env vars | [/sdk/configuration/wrap-server](https://docs.waniwani.ai/sdk/configuration/wrap-server), [/sdk/configuration/environment-variables](https://docs.waniwani.ai/sdk/configuration/environment-variables) |
| Track events and build a revenue funnel | [/sdk/tracking/overview](https://docs.waniwani.ai/sdk/tracking/overview), [events](https://docs.waniwani.ai/sdk/tracking/events), [identify](https://docs.waniwani.ai/sdk/tracking/identify), [sessions](https://docs.waniwani.ai/sdk/tracking/sessions) |
| Know where each event belongs in a flow | [/sdk/tracking/instrumentation](https://docs.waniwani.ai/sdk/tracking/instrumentation) |
| Check a typed event payload | [/sdk/reference/event-schema](https://docs.waniwani.ai/sdk/reference/event-schema) |
| Add knowledge-base search | [/sdk/knowledge-base/overview](https://docs.waniwani.ai/sdk/knowledge-base/overview) |
| Embed the chat widget | [/sdk/chat/embed](https://docs.waniwani.ai/sdk/chat/embed) (script tag), [/sdk/chat/react](https://docs.waniwani.ai/sdk/chat/react) |
| Read the exact tool contract a flow compiles to | [/sdk/reference/flow-tool-contract](https://docs.waniwani.ai/sdk/reference/flow-tool-contract) |
| Tunnel a dev server for remote testing | [/sdk/guides/tunnel](https://docs.waniwani.ai/sdk/guides/tunnel) |
| Use the CLI | [/sdk/cli/overview](https://docs.waniwani.ai/sdk/cli/overview) |
| Upgrade the SDK, or fix a build that broke after a bump | [/sdk/changelog](https://docs.waniwani.ai/sdk/changelog) |

Dashboard and free API key: [app.waniwani.ai](https://app.waniwani.ai).

## The one thing to get right without fetching: the tier split

- **Open source, no API key.** `createFlow`, `StateGraph`, `START`, `END`, the `KvStore` interface,
  `MemoryKvStore`. Runs against any state backend you implement.
- **Free tier, one env var (`WANIWANI_API_KEY`).** Same SDK, plus hosted flow state, event tracking,
  funnel analytics, knowledge base, chat widget, and the dashboard playground.

Default to the OSS path. Reach for the free tier when the user asks for tracking, analytics, hosted
state, KB, or chat, and say plainly that it needs a key.

Minimal shape, enough to orient yourself before you fetch the flow docs:

```typescript
import { createFlow, MemoryKvStore, START, END } from "@waniwani/sdk/mcp";
import { z } from "zod";

const onboardingFlow = createFlow({
  id: "onboarding",
  title: "User Onboarding",
  description: "Use when a new user wants to get started.",
  state: {
    email: z.string().describe("Work email"),
  },
})
  .addNode("ask_email", ({ interrupt }) =>
    interrupt({ email: { question: "What's your work email?" } })
  )
  .addEdge(START, "ask_email")
  .addEdge("ask_email", END)
  .compile({ store: new MemoryKvStore() });

await onboardingFlow.register(server);
```

Drop the `{ store }` argument once `WANIWANI_API_KEY` is set and flow state moves to app.waniwani.ai.
With neither a store nor a key, `.compile()` throws and tells you how to fix it. There is no silent
fallback.

## Removed surfaces

Removed. An import error for any of these means the code predates the removal:
`createTool`, `createResource`, `registerTools`, `toNextJsHandler`, `toExpressJsHandler`,
`createApiHandler`, `ChatCard`, every MCP-widget React hook except `useWaniwani` (`WidgetProvider`,
`useWidgetClient`, `useToolOutput`, and the rest), `InitializeNextJsInIframe`, `LoadingWidget`,
`DevModeProvider`, `detectPlatform`, `isMCPApps`, `isOpenAI`.

The `@waniwani/sdk/legacy`, `@waniwani/sdk/legacy/react`, `@waniwani/sdk/legacy/next-js`,
`@waniwani/sdk/legacy/express-js`, `@waniwani/sdk/chat/server`, `@waniwani/sdk/next-js`, and
`@waniwani/sdk/express-js` entry points no longer exist.

Use `createFlow` for multi-step tools, `server.registerTool` for single-shot ones, and
`WaniwaniChat` for chat.

`@waniwani/sdk/evals` was removed entirely. See the
[changelog](https://docs.waniwani.ai/sdk/changelog).

## Upgrading

`@waniwani/sdk` is `0.x`, so minor bumps can break the public API. Whenever you raise the version in
a project, whether by editing `package.json`, running `bun add @waniwani/sdk@latest`, or chasing a
build that started failing, do not treat it as a drop-in.

1. Read [the changelog](https://docs.waniwani.ai/sdk/changelog), starting at the **Breaking changes
   at a glance** table, then every `## <version>:` section above your old version and at or below
   your new one.
2. Apply each documented migration. They are written as mechanical codemods, so apply them rather
   than paraphrasing them.
3. Run `bun run typecheck && bun test`.

Every version hop also ships a self-contained migration skill you can invoke directly, named
`migrate-waniwani-sdk-<from>-to-<to>`. For the latest release:

```bash
npx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-0.18-to-0.19
```

## Guided playbooks

| User wants to... | Playbook |
|---|---|
| Initialize a new MCP project from the template | [scripts/initialize.md](scripts/initialize.md) |
| Create their first flow | [scripts/create-flow.md](scripts/create-flow.md) |
| Tunnel the dev server for remote testing | [scripts/tunnel.md](scripts/tunnel.md) |

When a playbook covers the user's task, follow it step by step instead of writing code directly. Each
one includes prerequisite checks, interactive design steps, and testing instructions.

Two sibling skills handle tracking work end to end:

```bash
npx skills add Waniwani-AI/sdk -s instrument-tracking   # add funnel events across existing flows
npx skills add Waniwani-AI/sdk -s audit-tracking        # read-only audit of an app's instrumentation
```

## Common mistakes

- **`createFlow().compile()` throws "no flow store configured"**: pass `{ store: new MemoryKvStore() }`
  for dev, set `WANIWANI_API_KEY` for the hosted store, or pass your own KV adapter.
- **Creating multiple clients**: create one `waniwani()` in `lib/waniwani.ts` and import it everywhere.
- **Wrong import paths**: flow primitives and KV come from `@waniwani/sdk/mcp`, `useWaniwani` from
  `@waniwani/sdk/mcp/react`, the chat widget from `@waniwani/sdk/chat`.
- **Forgetting `START` / `END` edges**: every flow needs `addEdge(START, firstNode)` and
  `addEdge(lastNode, END)`.
- **Calling `interrupt` / `showWidget` directly**: they come from the handler context,
  `({ interrupt }) => interrupt(...)`.
- **Answering from memory**: if you have not fetched the docs page for what you are writing, fetch it.
