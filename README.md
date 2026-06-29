<div align="center">

# @waniwani/sdk

**The open-source TypeScript SDK for MCP funnels** — multi-step conversational flows (sales, lead generation, booking, quotes) that run as a single MCP tool inside ChatGPT, Claude, Cursor, and any MCP-capable client.

[![npm version](https://img.shields.io/npm/v/@waniwani/sdk?labelColor=333333&color=666666)](https://www.npmjs.com/package/@waniwani/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@waniwani/sdk?labelColor=333333&color=666666)](https://www.npmjs.com/package/@waniwani/sdk)
[![last commit](https://img.shields.io/github/last-commit/WaniWani-AI/sdk?labelColor=333333&color=666666)](https://github.com/WaniWani-AI/sdk/commits)
[![commit activity](https://img.shields.io/github/commit-activity/m/WaniWani-AI/sdk?labelColor=333333&color=666666)](https://github.com/WaniWani-AI/sdk/pulse)
[![stars](https://img.shields.io/github/stars/WaniWani-AI/sdk?labelColor=333333&color=666666)](https://github.com/WaniWani-AI/sdk/stargazers)
[![license](https://img.shields.io/npm/l/@waniwani/sdk?labelColor=333333&color=666666)](./LICENSE)
[![follow @waniwani_ai](https://img.shields.io/badge/follow-%40waniwani__ai-333333?logo=x&logoColor=white&labelColor=333333&color=666666)](https://x.com/waniwani_ai)

[**Docs**](https://docs.waniwani.ai) · [**Website**](https://waniwani.ai) · [**Dashboard**](https://app.waniwani.ai) · [**CLI**](https://www.npmjs.com/package/@waniwani/cli) · [**Issues**](https://github.com/WaniWani-AI/sdk/issues)

</div>

One typed state graph compiles to one MCP tool. MIT, bring your own store, optional hosted Platform via one env var.

Forked from production MCPs we shipped for paying customers (insurance quoting, pet care, lead capture, booking), and open-sourced once the shape stabilized.

## Install

```bash
bun add @waniwani/sdk @modelcontextprotocol/sdk zod
```

## 30-second example

```ts
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
    run: ({ state }) => ({ greeted: true }),
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

A complete MCP server with one flow-driven tool, runnable over stdio. Connect it to ChatGPT, Claude, or any MCP client.

## What is an MCP funnel

A funnel is a multi-step conversation that drives a user or agent from intent to outcome: a qualified lead, a booking, a quote, a purchase. For twenty years funnels lived in web forms. They are moving into AI clients.

ChatGPT, Claude, and Cursor are the new browsers. MCP is the store. The funnel is a tool call.

LLMs cannot run funnels on their own. They paraphrase questions, skip fields, accept malformed input, and lose state between turns. A real funnel needs deterministic order, typed fields, validation, branching, and resumable state. `createFlow` makes the funnel deterministic on the server. The model just renders the next question.

The mapping from funnel to flow is direct:

| Funnel concept | Flow primitive |
|---|---|
| Step | Node |
| Form field | Interrupt |
| Transition | Edge |
| Branching question | Conditional edge |
| Lead data | Typed state (Zod) |

See [Why MCP funnels](https://docs.waniwani.ai/sdk/why-mcp-funnels) for the full argument.

## How it compares

- **vs the raw MCP SDK.** You would serialize state through the model on every turn. `createFlow` persists state server-side under the session id; the model carries nothing between calls.
- **vs LangChain or LangGraph.** General-purpose agent graphs. Waniwani is funnel-shaped: interrupts, re-ask on validation, auto-skip pre-filled fields, widget delegation, typed state via Zod. See [vs LangGraph](https://docs.waniwani.ai/sdk/compare/vs-langgraph).
- **vs closed-source platform SDKs.** MIT. The flow engine has zero runtime dependency on `app.waniwani.ai`. The hosted Platform is opt-in via a single env var.

## Engine + optional Platform

The flow engine is MIT and runs without an API key against any `get` / `set` / `delete` store (Redis, Upstash, Cloudflare KV, DynamoDB, Postgres, in-memory).

Set `WANIWANI_API_KEY` to connect the [Waniwani Platform](https://docs.waniwani.ai/sdk/platform/overview):

- Hosted, encrypted-at-rest flow state. No infra to run.
- Event tracking and funnel analytics.
- Knowledge base (markdown ingest plus semantic search).
- Embeddable chat widget backend.

Same code, opt in by env var. `withWaniwani(server)` wraps any MCP server to add session bridging and auto-tracking; it is a no-op without a key, so it is safe to apply unconditionally. Pricing (including a free plan) lives at [app.waniwani.ai](https://app.waniwani.ai).

## What you can build

- [Sales funnel MCP](https://docs.waniwani.ai/sdk/guides/sales-funnel). Qualify intent, capture lead, branch on stage, push to CRM.
- [Lead generation MCP](https://docs.waniwani.ai/sdk/guides/lead-generation). Email, role, use case, webhook to CRM.
- [Booking MCP](https://docs.waniwani.ai/sdk/guides/booking). Pick service, check availability, pick slot, confirm.
- [Insurance or pricing quote MCP](https://docs.waniwani.ai/sdk/guides/insurance-quote). Collect details, validate, call your pricing API, return widget cards.

For a fuller starter project with chat widget, dev tunnel, and a sample funnel pre-wired:

```bash
git clone https://github.com/WaniWani-AI/mcp-distribution-template.git my-mcp-server
```

## CLI

The companion [`@waniwani/cli`](https://www.npmjs.com/package/@waniwani/cli) wires a local repo to a Waniwani agent and runs your MCP server against the hosted playground in one command. Optional — the SDK works without it.

```bash
bun add -g @waniwani/cli
waniwani login     # browser-based OAuth2 PKCE
waniwani connect   # pick an org + agent, writes waniwani.config.ts
waniwani dev       # run local MCP, open playground bridged to localhost
```

See the [CLI docs](https://docs.waniwani.ai/sdk/cli/overview) for the full command reference.

## Documentation

Full docs at **[docs.waniwani.ai](https://docs.waniwani.ai)**.

- **Start:** [Quickstart](https://docs.waniwani.ai/sdk/quickstart) · [Why MCP funnels](https://docs.waniwani.ai/sdk/why-mcp-funnels) · [Funnels overview](https://docs.waniwani.ai/sdk/guides/funnels)
- **Engine:** [Flows](https://docs.waniwani.ai/sdk/flows/overview) · [State](https://docs.waniwani.ai/sdk/flows/state) · [Interrupts](https://docs.waniwani.ai/sdk/flows/interrupts) · [KV store adapters](https://docs.waniwani.ai/sdk/flows/kv-store)
- **Deploy:** [Overview](https://docs.waniwani.ai/sdk/deployment/overview) · [Self-hosting](https://docs.waniwani.ai/sdk/deployment/self-hosting)
- **Platform:** [Overview](https://docs.waniwani.ai/sdk/platform/overview) · [Tracking](https://docs.waniwani.ai/sdk/tracking/overview) · [Knowledge base](https://docs.waniwani.ai/sdk/knowledge-base/overview) · [Chat widget](https://docs.waniwani.ai/sdk/chat/embed)

## Links

- **Website:** [waniwani.ai](https://waniwani.ai)
- **Dashboard:** [app.waniwani.ai](https://app.waniwani.ai)
- **Issues:** [github.com/WaniWani-AI/sdk/issues](https://github.com/WaniWani-AI/sdk/issues)

## Security

Found a vulnerability? Please report it privately — see [SECURITY.md](./SECURITY.md). Do not open a public issue for security reports.

## License

[MIT](./LICENSE) © Waniwani

"Waniwani" is a trademark of Waniwani Inc. The license covers the code, not the name.
