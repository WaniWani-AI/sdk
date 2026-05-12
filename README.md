# @waniwani/sdk

[![npm](https://img.shields.io/npm/v/@waniwani/sdk.svg)](https://www.npmjs.com/package/@waniwani/sdk)
[![license](https://img.shields.io/npm/l/@waniwani/sdk.svg)](./LICENSE)

> Open-source flow engine for MCP servers. Free hosted tier for analytics, knowledge base, and chat — when you want them.

`@waniwani/sdk` is split into two tiers:

- **Open source** — `createFlow` and the `KvStore` interface. LangGraph-inspired multi-step conversations, compiled into a single MCP tool. No API key needed. Plug in any state backend (in-memory, Redis, Upstash, Cloudflare KV) — or run pure self-hosted.
- **Free tier** — add `WANIWANI_API_KEY` for hosted flow state, event tracking, funnel analytics, knowledge base, and a local playground. One env var. Same code.

A separate [legacy section](#legacy) holds APIs we still ship for back-compat (`createTool`, `createResource`, chat-server adapters, MCP-widget React hooks) but no longer document for new code.

> **Status:** pre-alpha. APIs may change between releases. Pin versions in production.

## Quick start — open source (no API key)

```bash
bun add @waniwani/sdk
```

```ts
// flow.ts
import { createFlow, END, MemoryKvStore, START } from "@waniwani/sdk/mcp";
import { z } from "zod";

export const onboardingFlow = createFlow({
  id: "onboarding",
  title: "User Onboarding",
  description: "Use when a new user wants to get started.",
  state: {
    email: z.string().describe("Work email"),
    useCase: z.string().describe("What they want to build"),
  },
})
  .addNode("ask_email", () =>
    interrupt({ email: { question: "What's your work email?" } }),
  )
  .addNode("ask_use_case", () =>
    interrupt({
      useCase: {
        question: "What do you want to build?",
        suggestions: ["Analytics", "Support", "Lead capture"],
      },
    }),
  )
  .addEdge(START, "ask_email")
  .addEdge("ask_email", "ask_use_case")
  .addEdge("ask_use_case", END)
  .compile({ store: new MemoryKvStore() });

await onboardingFlow.register(server);
```

`MemoryKvStore` is fine for local dev and tests. For self-hosted production, implement the [`KvStore`](src/mcp/server/kv/kv-store.ts) interface against Redis, Upstash, Cloudflare KV, DynamoDB — anything with `get` / `set` / `delete`.

## Quick start — free tier (with API key)

```bash
bun add @waniwani/sdk
export WANIWANI_API_KEY=wwk_...
```

The same flow works with zero code changes — drop the `store` argument and state lives on `app.waniwani.ai`, plus you get tracking, funnel, and the dashboard.

```ts
const onboardingFlow = createFlow({ /* ...same config... */ })
  // ...same nodes and edges...
  .compile(); // no store → uses hosted flow state
```

Want event tracking too?

```ts
import { waniwani } from "@waniwani/sdk";
import { withWaniwani } from "@waniwani/sdk/mcp";

// Auto-track every tool call:
withWaniwani(server);

// Or track custom events:
const wani = waniwani();
await wani.track({
  event: "quote.succeeded",
  properties: { amount: 99, currency: "USD" },
  meta: extra._meta,
});
```

Get an API key at [app.waniwani.ai](https://app.waniwani.ai).

## What's in each tier

| Surface | Tier | What you get |
|---|---|---|
| `createFlow`, `StateGraph`, `KvStore`, `MemoryKvStore` | **OSS** | Multi-step conversational flows, runnable with no API key |
| `WaniwaniKvStore` | Free tier | Hosted flow state on `app.waniwani.ai` |
| `withWaniwani` | Both | Tool tracking + session bridging (no-op without an API key) |
| `waniwani()`, `tracking`, `kb`, `createTrackingRoute` | Free tier | Event tracking, knowledge base, funnel routing |
| `ChatWidget`, `ChatEmbed`, themes, `embed.js` | Free tier | Embeddable chat UI |
| `useWaniwani` | Both | React hook for browser-side tracking (no-op until configured) |

## Package entry points

| Entry point | Use it for |
|---|---|
| `@waniwani/sdk` | `waniwani()` client, `defineConfig`, `WaniWaniError` |
| `@waniwani/sdk/mcp` | `createFlow`, `KvStore`, `MemoryKvStore`, `withWaniwani`, tracking helpers |
| `@waniwani/sdk/mcp/react` | `useWaniwani` (the only non-legacy hook here) |
| `@waniwani/sdk/chat` | `ChatWidget`, `ChatBar`, `ChatCard`, `ChatEmbed`, themes |
| `@waniwani/sdk/chat/embed.js` | Self-contained `<script>` install for any website |
| `@waniwani/sdk/chat/styles.css` | Prebuilt Tailwind styles for `chat/` components |
| `@waniwani/sdk/kb` | `createKbClient` for knowledge base ingest/search |

## Documentation

Full docs at **[docs.waniwani.ai](https://docs.waniwani.ai)** — same source as [`./docs/`](./docs) in this repo.

- [Introduction](https://docs.waniwani.ai/introduction) — tiers and pitch
- [Quickstart](https://docs.waniwani.ai/quickstart)
- [Flows](https://docs.waniwani.ai/flows/overview)
- [KV store adapters](https://docs.waniwani.ai/flows/kv-store)
- [Self-hosting](https://docs.waniwani.ai/flows/self-hosting)
- [Tracking](https://docs.waniwani.ai/tracking/overview)
- [Knowledge base](https://docs.waniwani.ai/knowledge-base/overview)

## Legacy

The following exports are preserved for back-compat with existing customer MCPs but are no longer documented. New code should use `createFlow` instead. They will move to dedicated `@waniwani/sdk/legacy*` entry points in a future minor release.

- `createTool`, `createResource`, `registerTools` from `@waniwani/sdk/mcp`
- `toNextJsHandler` from `@waniwani/sdk/next-js`
- `toExpressJsHandler` from `@waniwani/sdk/express-js`
- `createApiHandler` from `@waniwani/sdk/chat/server`
- `WidgetProvider`, `useWidgetClient`, `useDisplayMode`, `useToolOutput`, etc. from `@waniwani/sdk/mcp/react`
- `InitializeNextJsInIframe`, `LoadingWidget`, `DevModeProvider`

See the [Legacy docs section](https://docs.waniwani.ai/legacy/tools-resources) for migration notes.

## Links

- **Website**: [waniwani.ai](https://waniwani.ai)
- **Dashboard**: [app.waniwani.ai](https://app.waniwani.ai)
- **Docs**: [docs.waniwani.ai](https://docs.waniwani.ai)
- **Issues**: [github.com/WaniWani-AI/sdk/issues](https://github.com/WaniWani-AI/sdk/issues)

## License

[MIT](./LICENSE) © WaniWani

"WaniWani" is a trademark of WaniWani. The license covers the code, not the name.
