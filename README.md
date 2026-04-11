# @waniwani/sdk

[![npm](https://img.shields.io/npm/v/@waniwani/sdk.svg)](https://www.npmjs.com/package/@waniwani/sdk)
[![license](https://img.shields.io/npm/l/@waniwani/sdk.svg)](./LICENSE)

> The official SDK for [WaniWani](https://waniwani.ai). Build, ship, and measure conversational MCP apps.

`@waniwani/sdk` is the developer-facing library for your MCP (Model Context Protocol) server. It provides **event tracking** and **multi-step conversational flows**.

- **Zero runtime dependencies.** Sub-5KB core bundle, safe for serverless and edge runtimes.
- **Works with any MCP runtime.** [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [Skybridge](https://github.com/alpic-ai/skybridge), [`@vercel/mcp-handler`](https://www.npmjs.com/package/@vercel/mcp-handler).
- **Fully typed.** Zod state schemas, inferred node contexts, typed event properties.
- **Automatic tool tracking.** One call to `withWaniwani(server)` and every tool invocation is tracked.
- **LangGraph-inspired flows.** Compile a state graph into a single MCP tool that drives multi-turn conversations.

> **Status:** pre-alpha. APIs and behavior may change between releases. Pin versions in production.

## Install

```bash
bun add @waniwani/sdk
# or
pnpm add @waniwani/sdk
# or
npm install @waniwani/sdk
# or
yarn add @waniwani/sdk
```

Requires Node 18.17+ and an MCP server runtime.

## Quick start

### 1. Get an API key

Sign in to [app.waniwani.ai](https://app.waniwani.ai), create an MCP environment, and copy its API key. Keys are prefixed with `wwk_` and shown in full only once. Expose it to your server as `WANIWANI_API_KEY`:

```bash
# .env
WANIWANI_API_KEY=wwk_...
```

### 2. Wrap your MCP server

```ts
import express from "express";
import { withWaniwani } from "@waniwani/sdk/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import "dotenv/config";

const server = new McpServer({ name: "my-mcp-app", version: "0.0.1" });

server.registerTool(/* ... your tools ... */);

// One call. Every registered tool is now tracked automatically.
withWaniwani(server);

// Connect the Streamable HTTP transport
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await server.connect(transport);

const app = express();
app.use(express.json());
app.post("/mcp", (req, res) => transport.handleRequest(req, res, req.body));
app.listen(3000);
```

Every tool call produces a `tool.called` event with duration, status, input/output, and session correlation, all visible in your WaniWani dashboard within seconds.

### 3. Track custom events

```ts
import { waniwani } from "@waniwani/sdk";

const wani = waniwani();

await wani.track({
  event: "quote.succeeded",
  properties: { amount: 99, currency: "USD" },
  meta: extra._meta, // correlates the event with the current MCP session
});
```

### 4. Build a flow

Multi-turn conversations, compiled into a single MCP tool:

```ts
import { createFlow, END, START } from "@waniwani/sdk/mcp";
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
  .addNode("ask_email", async ({ interrupt }) =>
    interrupt({ email: { question: "What's your work email?" } }),
  )
  .addNode("ask_use_case", async ({ interrupt }) =>
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
  .compile();

await onboardingFlow.register(server);
```

The engine handles state persistence, resumption, branching, and validation. The model calls one tool and the rest is managed server-side.

## Documentation

Full product documentation lives at **[docs.waniwani.ai](https://docs.waniwani.ai)**:

- [Introduction](https://docs.waniwani.ai/introduction)
- [Quickstart](https://docs.waniwani.ai/quickstart)
- [Setup](https://docs.waniwani.ai/setup/installation)
- [Event Tracking](https://docs.waniwani.ai/tracking/overview)
- [Flows](https://docs.waniwani.ai/flows/overview)

The same docs are also available in this repository under [`docs/`](./docs).

## What's inside the package

| Entry point               | What it gives you                                                              |
| ------------------------- | ------------------------------------------------------------------------------ |
| `@waniwani/sdk`           | `waniwani()` client: event tracking, identify, flush, shutdown.                |
| `@waniwani/sdk/mcp`       | `withWaniwani`, `createFlow`, `createTool`, `createResource`, flow primitives. |
| `@waniwani/sdk/mcp/react` | React hooks for WaniWani-powered widgets.                                      |

Most users only need `@waniwani/sdk` and `@waniwani/sdk/mcp`.

## Examples

- **[Alpic x WaniWani demo](https://github.com/WaniWani-AI/alpic-x-waniwani-demo)**: a Skybridge MCP server with a full `createFlow` booking journey.

## Links

- **Website**: [waniwani.ai](https://waniwani.ai)
- **Dashboard**: [app.waniwani.ai](https://app.waniwani.ai)
- **Docs**: [docs.waniwani.ai](https://docs.waniwani.ai)
- **Issues**: [github.com/WaniWani-AI/sdk/issues](https://github.com/WaniWani-AI/sdk/issues)

## License

[AGPL-3.0-or-later](./LICENSE) © WaniWani

"WaniWani" is a trademark of WaniWani. The license covers the code, not the name.
