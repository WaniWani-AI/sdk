# Self-hosting

Deploy `createFlow` end-to-end without any dependency on `app.waniwani.ai`. Open source, no API key, no telemetry.

## What you get

- An MCP server hosting one or more `createFlow` tools
- Flow state persisted in a key-value backend you control
- Zero outbound calls to `app.waniwani.ai`
- The same code can opt into the free tier later by setting one env var

## 1. Scaffold

Start from the [MCP Distribution Template](https://github.com/WaniWani-AI/mcp-distribution-template) or any of your own MCP servers. The only SDK dependency you need:

```bash
bun add @waniwani/sdk
```

Peer deps (`@modelcontextprotocol/sdk` and `zod`) are likely already in your project.

## 2. Pick a KV backend

See [kv-store.md](kv-store.md) for adapter recipes. Quick decision tree:

- **Vercel / Netlify** → Upstash Redis
- **Cloudflare Workers** → Cloudflare KV
- **AWS Lambda** → DynamoDB
- **Long-running Node** → ioredis against a managed Redis (Render, Railway, Fly)
- **Local box** → SQLite via `better-sqlite3`

Implement the `KvStore` interface (10 lines). Save it as `lib/flow-store.ts`.

## 3. Compile your flow

```ts flow.ts
import { createFlow, END, START } from "@waniwani/sdk/mcp";
import { z } from "zod";
import { flowStore } from "./lib/flow-store";

export const onboardingFlow = createFlow({
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
  .compile({ store: flowStore });
```

## 4. Register with your MCP server

Standard `@modelcontextprotocol/sdk` pattern:

```ts server.ts
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { onboardingFlow } from "./flow";

const server = new McpServer({ name: "my-mcp-app", version: "0.0.1" });

await onboardingFlow.register(server);

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await server.connect(transport);

const app = express();
app.use(express.json());
app.post("/mcp", (req, res) => transport.handleRequest(req, res, req.body));
app.listen(3000);
```

## 5. Deploy

Any platform that runs Node 18.17+ works. Vercel, Render, Railway, Fly.io, Cloudflare Workers (with the KV adapter), AWS Lambda, Google Cloud Run.

### Vercel

```bash
vercel deploy
```

Set the KV credentials (e.g. `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) in the project's environment variables. No `WANIWANI_API_KEY` needed.

### Cloudflare Workers

Use `cloudflareKvStore(env.FLOW_STATE_KV)` (see [kv-store.md](kv-store.md)) and bind a KV namespace in `wrangler.toml`.

## Verifying it's truly offline

A few sanity checks:

```bash
# 1. No WANIWANI_API_KEY in env
echo $WANIWANI_API_KEY
# (empty)

# 2. Run with network observability
DEBUG=* bun run start 2>&1 | grep waniwani
# (no requests to app.waniwani.ai)
```

The only SDK code that calls `app.waniwani.ai` is `WaniwaniKvStore`, `WaniwaniFlowStore`, `waniwani()`'s tracking transport, `createKbClient`, and the chat widget. None are used in a pure self-hosted setup.

## Upgrading to free tier later

If you decide you want hosted dashboards, tracking, and funnel:

```diff
- .compile({ store: flowStore });
+ .compile(); // ← uses WaniwaniKvStore when WANIWANI_API_KEY is set
```

Add `WANIWANI_API_KEY=wwk_...` to your environment and redeploy. Existing self-hosted sessions stay in your KV backend; new sessions persist on `app.waniwani.ai`.

To keep both modes — self-hosted flow state + free-tier tracking — keep the explicit `store: flowStore` and add `withWaniwani(server)`. Tracking calls fire to `app.waniwani.ai` while flow state stays in your backend.

```ts
import { withWaniwani } from "@waniwani/sdk/mcp";

withWaniwani(server);  // hosted tracking + funnel
await onboardingFlow.register(server); // self-hosted flow state
```
