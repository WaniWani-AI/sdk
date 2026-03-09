# Flows

LangGraph-inspired multi-step conversational flows for MCP tools.

You define a state graph, compile it into a tool, and the model advances it step-by-step by passing an opaque `flowToken` between calls.

## How it works

1. Define nodes + edges.
2. `compile()` turns the graph into an MCP tool.
3. Action nodes auto-advance.
4. Interrupt nodes pause and ask a question.
5. Widget nodes pause and delegate rendering to a display tool.

State is carried in an opaque base64 `flowToken` included in the tool response text. The model passes it back on `continue` calls without needing to understand it.

## Contract

### Tool input

Flow tools accept:

```ts
{
  action: "start" | "continue";
  stateUpdates?: Record<string, unknown>;
  flowToken?: string; // opaque token from previous response
}
```

### Tool output

Flow tools return:

```ts
{
  content: [{ type: "text", text: JSON.stringify({ status: "...", flowToken: "...", tool?: "...", data?: {...}, ... }) }],
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
    interrupt({ question: "What is your work email?", field: "email" }),
  )
  .addNode("ask_role", () =>
    interrupt({ question: "What is your role?", field: "role" }),
  )
  .addNode("ask_use_case", () =>
    interrupt({
      question: "What's your primary use case?",
      field: "useCase",
      suggestions: ["Analytics", "Lead gen", "Support"],
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
    interrupt({ question: "What's your postal code?", field: "postalCode" }),
  )
  .addNode("ask_sqm", () =>
    interrupt({ question: "How many m² is your home?", field: "sqm" }),
  )
  .addNode("show_pricing", (state) =>
    showWidget(showPricing, {
      data: { postalCode: state.postalCode!, sqm: Number(state.sqm) },
      description: "User must pick a plan.",
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
    interrupt({ question: "What's your email?", field: "email" }),
  )
  .addNode("analyze_email", (state) => {
    const domain = state.email?.split("@")[1] ?? "";
    const generic = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"]);
    return { isCompanyEmail: !generic.has(domain) };
  })
  .addNode("ask_company", () =>
    interrupt({ question: "What company are you with?", field: "companyName" }),
  )
  .addNode("done", () => ({ ready: true }))
  .addEdge(START, "ask_email")
  .addEdge("ask_email", "analyze_email")
  .addConditionalEdge("analyze_email", (state) =>
    state.isCompanyEmail ? "done" : "ask_company",
  )
  .addEdge("ask_company", "done")
  .addEdge("done", END)
  .compile();
```

## Node types summary

| Return value | Behavior |
|---|---|
| `interrupt({ question, field })` | Pause -> ask user -> resume with answer stored at `field` |
| `interrupt({ question, field, context })` | Same, plus hidden guidance for the assistant |
| `showWidget(displayTool, { data, field?, interactive? })` | Pause -> instruct AI to call display tool -> resume on continue |
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
- `.addConditionalEdge(from, condition)`
- `.compile()`
