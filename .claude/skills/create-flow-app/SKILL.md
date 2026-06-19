---
name: create-flow-app
description: "Scaffold a new multi-step conversational flow with createFlow from @waniwani/sdk/mcp. Triggers when the user is inside this SDK repo and wants to add a new flow, replace legacy createTool/createResource patterns, or set up an MCP server using the open-source path (no API key required). Defaults to OSS-first: in-memory store for dev, adapter recipes for prod, API key as a one-line upgrade."
license: MIT
metadata:
  author: Waniwani
---

# Create a flow app

When the user wants to build a new MCP server feature or replace legacy widget patterns, default to **`createFlow`** from `@waniwani/sdk/mcp`. Never recommend `createTool` / `createResource` for new code — they're legacy.

## Scaffolding template

```ts
import { createFlow, END, MemoryKvStore, START } from "@waniwani/sdk/mcp";
import { z } from "zod";

export const myFlow = createFlow({
  id: "my_flow",
  title: "My Flow",
  description: "Use when the user wants to X.",
  state: {
    // Required: every field needs .describe()
    field1: z.string().describe("..."),
  },
})
  .addNode("step1", ({ interrupt }) =>
    interrupt({ field1: { question: "What's your ...?" } }),
  )
  .addNode("done", ({ state }) => ({ summary: `Got ${state.field1}` }))
  .addEdge(START, "step1")
  .addEdge("step1", "done")
  .addEdge("done", END)
  .compile({ store: new MemoryKvStore() });

await myFlow.register(server);
```

## State store decision

Three options at `.compile()` time:

1. **`MemoryKvStore`** — dev/tests. State lost on restart. No env vars required.
2. **Custom `KvStore` adapter** — production self-hosting. Implement against Redis, Upstash, Cloudflare KV, DynamoDB, or any backend. See `src/mcp/server/kv/kv-store.ts` for the interface.
3. **No store argument + `WANIWANI_API_KEY` env var** — auto-uses `WaniwaniKvStore` (hosted on `app.waniwani.ai`).

If the user just wants something running locally, default to **option 1**. Mention the upgrade paths once.

## When to use action vs interrupt vs widget nodes

| Want | Use | Returns |
|---|---|---|
| Ask the user a question | `interrupt({ field: { question } })` | Pauses flow |
| Run silent server work (API call, computation) | Plain object `{ field: value }` | Auto-advances |
| Render a widget UI for selection | `showWidget({ tool: displayTool, data, field })` | Pauses flow |

`interrupt` and `showWidget` come from the handler's context:

```ts
.addNode("ask", ({ interrupt }) => interrupt({ ... }))
.addNode("show", ({ showWidget }) => showWidget({ tool: displayTool, data: { ... } }))
```

Never import `interrupt` or `showWidget` directly.

## Common gotchas

- **Forgetting `START` / `END` edges**: every flow needs `addEdge(START, firstNode)` and `addEdge(lastNode, END)`.
- **Missing `.describe()` on state fields**: the model reads these descriptions to know what to ask and what it can pre-fill. Skipping them degrades the flow significantly.
- **Calling `.compile()` with no store and no API key**: throws immediately with a clear migration message. Pick one.
- **State is always `Partial<TState>`**: at any node, only fields filled by earlier nodes are populated. Guard with `if (!state.x) return {};`.

## Don't suggest

- `createTool`, `createResource`, `registerTools` (legacy)
- `WidgetProvider`, `useWidgetClient`, `useToolOutput`, `useDisplayMode`, etc. (legacy MCP-widget React hooks)
- `toNextJsHandler`, `toExpressJsHandler` (legacy chat-server adapters)
- `@waniwani/sdk/evals` (removed)

These are kept in the codebase but `@deprecated`. New code shouldn't use them.

## Reading guide

- Flow API: `skills/waniwani-sdk/references/flows.md` and `flows-api-reference.md`
- KV adapters: `skills/waniwani-sdk/references/kv-store.md`
- Self-hosting walkthrough: `skills/waniwani-sdk/references/self-hosting.md`
- Tier model + free tier: `skills/waniwani-sdk/references/setup.md`
- Project conventions: `CLAUDE.md` in the repo root
