# Flows

LangGraph-inspired multi-step conversational flows for MCP tools.

You define a state graph, compile it into a tool, and the engine advances it step-by-step. Flow state is stored server-side in a key-value store, keyed by session ID.

## How it works

1. Define nodes + edges.
2. `compile()` turns the graph into an MCP tool.
3. Action nodes auto-advance.
4. Interrupt nodes pause and ask a question.
5. Widget nodes pause and delegate rendering to a display tool.

State is stored server-side via the Waniwani API, keyed by the session ID from `_meta`. The model doesn't need to round-trip any token — state is recovered automatically on every call.

## Contract

### Tool input

Flow tools accept:

```ts
type FlowToolInput =
  | {
      action: "start";
      intent: string;
      stateUpdates?: Record<string, unknown>;
    }
  | {
      action: "continue";
      stateUpdates?: Record<string, unknown>;
    };
```

`intent` is required on `start` and should summarize the user's goal for the flow, including relevant prior context that led to triggering it, if available.

### Tool output

Flow tools return:

```ts
{
  content: [{ type: "text", text: JSON.stringify({ status: "...", tool?: "...", data?: {...}, ... }) }],
}
```

For widget steps, the response includes `tool` (display tool name) and `data` (data to pass to it). The model calls the display tool separately.

## Quick start

```ts
import { createFlow, interrupt, START, END } from "@waniwani/sdk/mcp";
import { z } from "zod";

const flow = createFlow({
  id: "demo_qualification",
  title: "Demo Qualification",
  description: "Qualify a lead for a demo request.",
  state: {
    email: z.string().describe("Work email"),
    role: z.string().describe("Role in the company"),
    useCase: z.string().describe("Primary use case"),
  },
})
  .addNode("ask_email", () =>
    interrupt({ email: { question: "What is your work email?" } }),
  )
  .addNode("ask_role", () =>
    interrupt({ role: { question: "What is your role?" } }),
  )
  .addNode("ask_use_case", () =>
    interrupt({
      useCase: {
        question: "What's your primary use case?",
        suggestions: ["Analytics", "Lead gen", "Support"],
      },
    }),
  )
  .addNode("complete", (state) => ({
    summary: `Lead: ${state.email}, ${state.role}, ${state.useCase}`,
  }))
  .addEdge(START, "ask_email")
  .addEdge("ask_email", "ask_role")
  .addEdge("ask_role", "ask_use_case")
  .addEdge("ask_use_case", "complete")
  .addEdge("complete", END)
  .compile();

await flow.register(server);
```

## Widget step example

```ts
import {
  createFlow,
  createResource,
  createTool,
  interrupt,
  showWidget,
  registerTools,
  START,
  END,
} from "@waniwani/sdk/mcp";
import { z } from "zod";

// 1. Create and register a resource
const pricingUI = createResource({
  id: "pricing_table",
  title: "Pricing Table",
  description: "Interactive pricing comparison",
  baseUrl: "https://my-app.com",
  htmlPath: "/widgets/pricing",
  widgetDomain: "my-app.com",
});

await pricingUI.register(server);

// 2. Create a display tool with typed schema
const showPricing = createTool({
  resource: pricingUI,
  description: "Show pricing comparison",
  inputSchema: { postalCode: z.string(), sqm: z.number() },
}, async ({ postalCode, sqm }) => ({
  text: "Pricing loaded",
  data: { postalCode, sqm, prices: [/* ... */] },
}));

// 3. Use the display tool in a flow via showWidget
const flow = createFlow({
  id: "guided_quote",
  title: "Guided Quote",
  description: "Collect quote data and plan choice.",
  state: {
    postalCode: z.string().describe("User postal code"),
    sqm: z.string().describe("Home size in square meters"),
    selectedPlan: z.string().describe("Selected plan"),
  },
})
  .addNode("ask_postal", () =>
    interrupt({ postalCode: { question: "What's your postal code?" } }),
  )
  .addNode("ask_sqm", () =>
    interrupt({ sqm: { question: "How many m² is your home?" } }),
  )
  .addNode("show_pricing", (state) =>
    showWidget({
      tool: showPricing,
      data: { postalCode: state.postalCode!, sqm: Number(state.sqm) },
      field: "selectedPlan",
    }),
  )
  .addNode("done", (state) => ({ summary: `Selected ${state.selectedPlan}` }))
  .addEdge(START, "ask_postal")
  .addEdge("ask_postal", "ask_sqm")
  .addEdge("ask_sqm", "show_pricing")
  .addEdge("show_pricing", "done")
  .addEdge("done", END)
  .compile();

// 4. Register display tool + flow
await registerTools(server, [showPricing, flow]);
```

## Conditional edges

```ts
const flow = createFlow({
  id: "smart_onboarding",
  title: "Smart Onboarding",
  description: "Branches based on email type.",
  state: {
    email: z.string().describe("User email"),
    isCompanyEmail: z.boolean().describe("Whether email uses a company domain"),
    companyName: z.string().describe("Company name"),
  },
})
  .addNode("ask_email", () =>
    interrupt({ email: { question: "What's your email?" } }),
  )
  .addNode("analyze_email", (state) => {
    const domain = state.email?.split("@")[1] ?? "";
    const generic = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"]);
    return { isCompanyEmail: !generic.has(domain) };
  })
  .addNode("ask_company", () =>
    interrupt({ companyName: { question: "What company are you with?" } }),
  )
  .addNode("done", () => ({ ready: true }))
  .addEdge(START, "ask_email")
  .addEdge("ask_email", "analyze_email")
  .addConditionalEdge(
    "analyze_email",
    ["done", "ask_company"],
    (state) => (state.isCompanyEmail ? "done" : "ask_company"),
  )
  .addEdge("ask_company", "done")
  .addEdge("done", END)
  .compile();
```

Declare every node the branch can reach in the `to` array. The condition's
return type is constrained to that list, so it can never route somewhere
undeclared, and graph introspection (funnel analytics, Mermaid diagrams) reads
`to` directly — correct by construction, with no source parsing.

## Node types summary

| Return value | Behavior |
|---|---|
| `interrupt({ field: { question } })` | Pause -> ask user -> resume with answer stored at `field` |
| `interrupt({ field: { question, context } })` | Same, plus hidden guidance for the assistant |
| `showWidget({ tool: displayTool, data?, field?, interactive? })` | Pause -> instruct AI to call display tool -> resume on continue |
| `{ key: value, ... }` | Action node -> merge into state -> auto-advance |

## API

### `createFlow(config)`

Creates a `StateGraph` with inferred state type from `config.state`.

Config fields:

- `id`: MCP tool name
- `title`: display title
- `description`: model-facing usage guidance
- `state`: `Record<string, z.ZodType>` (required)
- `annotations`: optional MCP tool annotations

### `StateGraph` methods

- `.addNode(name, handler)`
- `.addNode(name, { field? }, handler)`
- `.addEdge(from, to)`
- `.addConditionalEdge(from, to, condition)`
- `.compile()`
