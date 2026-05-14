# @waniwani/sdk

[![npm](https://img.shields.io/npm/v/@waniwani/sdk.svg)](https://www.npmjs.com/package/@waniwani/sdk)
[![license](https://img.shields.io/npm/l/@waniwani/sdk.svg)](./LICENSE)

> Open-source SDK for building **MCP funnels**: sales funnels, lead generation, booking, and quote flows that run as a single MCP tool inside ChatGPT, Claude, Cursor, and any MCP-capable client.

An **MCP funnel** is a multi-step conversation, hosted on your MCP server, that drives a user or agent from intent to outcome (a qualified lead, a booking, a quote, a purchase). One typed state graph compiles to one MCP tool. MIT licensed, bring your own store, optional hosted tier.

## Why this exists

- **ChatGPT, Claude, and Cursor are the new browsers. MCP is the store.** One edit to your messaging deploys to every MCP-capable client and your own site.
- **Conversational funnels are the new web forms.** They are where money will be made in the AI-distribution era. Recreating a real funnel inside MCP is harder than it looks.
- **LLMs are not built to replicate forms.** Left to themselves, they rush through structured collection: they skip fields, paraphrase questions, and break validation. A real funnel needs deterministic order, typed fields, validation, branching, and resumable state across tool calls.
- **Generic agent builders are not shaped for funnels.** LangChain and LangGraph are general-purpose. They expose every primitive, leaving you to re-invent funnel ergonomics (interrupts, re-ask on error, auto-skip pre-filled fields, widget cards, deterministic step order) on every project.
- **`createFlow` is the missing abstraction.** A typed state graph (Zod-typed state, named nodes, direct and conditional edges, interrupts, widget signals) compiles to a single MCP tool. Funnel-shaped by design, not by convention.
- **Production-validated.** Forked out of internal distribution MCPs we shipped for paying customers (insurance quoting, pet care, lead capture, booking). Open-sourced once we hit the same pattern enough times.

## What you can build today

- **[Sales funnel MCP](https://docs.waniwani.ai/guides/sales-funnel)**. Qualify intent, capture lead data, branch on stage, push to CRM.
- **[Lead generation MCP](https://docs.waniwani.ai/guides/lead-generation)**. Collect email, role, use case. Webhook to your CRM.
- **[Booking MCP](https://docs.waniwani.ai/guides/booking)**. Pick a service, check availability, pick a slot, confirm.
- **[Insurance or pricing quote MCP](https://docs.waniwani.ai/guides/insurance-quote)**. Collect details, validate, call your pricing API, return widget cards.

Any other multi-step MCP tool where order, validation, and resumability matter.

## 30-second example

```bash
bun add @waniwani/sdk @modelcontextprotocol/sdk zod
```

```ts
// hello.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFlow, END, MemoryKvStore, START } from "@waniwani/sdk/mcp";
import { z } from "zod";

const flow = createFlow({
  id: "hello",
  title: "Hello World",
  description: "Say hello and ask a question.",
  state: { name: z.string().describe("Your name") },
})
  .addNode({
    id: "ask",
    run: ({ interrupt }) =>
      interrupt({ name: { question: "What's your name?" } }),
  })
  .addNode({
    id: "greet",
    run: () => ({ greeted: true }),
  })
  .addEdge(START, "ask")
  .addEdge("ask", "greet")
  .addEdge("greet", END)
  .compile({ store: new MemoryKvStore() });

const server = new McpServer({ name: "hello-mcp", version: "1.0.0" });
await flow.register(server);
await server.connect(new StdioServerTransport());
```

```bash
bun run hello.ts
```

That is a complete MCP server with one flow-driven tool, runnable over stdio. Connect it to ChatGPT, Claude, or any MCP client.

For production, swap `MemoryKvStore` for a real backend (Redis, Upstash, Cloudflare KV, DynamoDB, anything with `get` / `set` / `delete`), or set `WANIWANI_API_KEY` for hosted state plus tracking, funnel analytics, knowledge base, and a chat widget. Same code.

## How WaniWani compares

**vs. LangChain / LangGraph.** General-purpose agent graphs. WaniWani is funnel-shaped: interrupts, re-ask on validation, auto-skip pre-filled fields, widget delegation, typed state via Zod. Smaller surface, sharper fit for MCP funnels.

**vs. hand-rolling on the raw MCP SDK.** You would serialize state through the model on every turn. WaniWani persists state server-side under the session id, so the model carries nothing between calls.

**vs. closed-source platform SDKs.** MIT licensed. The flow engine has zero runtime dependency on `app.waniwani.ai`. Bring any KV backend. The hosted tier is opt-in via `WANIWANI_API_KEY` and unlocks tracking, KB, chat widget, and managed flow state without changing your code.

## Two tiers

| Surface | Tier | What you get |
|---|---|---|
| `createFlow`, `StateGraph`, `KvStore`, `MemoryKvStore` | **OSS** | Multi-step conversational flows, runnable with no API key |
| `WaniwaniKvStore` | Free tier | Hosted, encrypted-at-rest flow state on `app.waniwani.ai` |
| `withWaniwani`, `useWaniwani` | Both | Tool tracking, session bridging, browser hook (no-op without a key) |
| `waniwani()`, `tracking`, `kb` | Free tier | Event tracking, funnel analytics, knowledge base |
| `ChatWidget`, `ChatEmbed`, `embed.js` | Free tier | Embeddable chat UI |

Get a free key at [app.waniwani.ai](https://app.waniwani.ai).

## Documentation

Full docs at **[docs.waniwani.ai](https://docs.waniwani.ai)**. Same source as [`./docs/`](./docs) in this repo.

**Build something:**
- [Sales funnel MCP](https://docs.waniwani.ai/guides/sales-funnel)
- [Lead generation MCP](https://docs.waniwani.ai/guides/lead-generation)
- [Booking MCP](https://docs.waniwani.ai/guides/booking)
- [Insurance or pricing quote MCP](https://docs.waniwani.ai/guides/insurance-quote)

**Learn the engine:**
- [Quickstart](https://docs.waniwani.ai/quickstart)
- [Flows overview](https://docs.waniwani.ai/flows/overview)
- [KV store adapters](https://docs.waniwani.ai/flows/kv-store)
- [Self-hosting](https://docs.waniwani.ai/deployment/self-hosting)

**Add the platform:**
- [Tracking](https://docs.waniwani.ai/tracking/overview)
- [Knowledge base](https://docs.waniwani.ai/knowledge-base/overview)
- [Chat widget](https://docs.waniwani.ai/chat/embed)

## Links

- **Website**: [waniwani.ai](https://waniwani.ai)
- **Dashboard**: [app.waniwani.ai](https://app.waniwani.ai)
- **Docs**: [docs.waniwani.ai](https://docs.waniwani.ai)
- **Issues**: [github.com/WaniWani-AI/sdk/issues](https://github.com/WaniWani-AI/sdk/issues)

## License

[MIT](./LICENSE) © WaniWani

"WaniWani" is a trademark of WaniWani Inc. The license covers the code, not the name.
