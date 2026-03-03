# Flows (`@waniwani/sdk/mcp`)

LangGraph-inspired multi-step conversational flows for MCP tools. Define a state graph, compile it into an MCP tool, and let the AI drive the flow.

## How it works

1. Define a graph of nodes connected by edges
2. `compile()` turns it into an MCP tool that the AI calls step by step
3. **Action nodes** run silently and auto-advance (API calls, data processing)
4. **Interrupt nodes** pause the flow and ask the user a question
5. **Widget nodes** pause the flow and render a widget UI

The AI carries the state between steps — no server-side storage needed.

## Import

```ts
import { createResource, createFlow, createTool, interrupt, showWidget, registerTools, START, END } from "@waniwani/sdk/mcp";
```

## Quick start

```ts
import { createFlow, interrupt, START, END, registerTools } from "@waniwani/sdk/mcp";
import { z } from "zod";

const flow = createFlow({
  id: "demo_qualification",
  title: "Demo Qualification",
  description: "Qualify a lead for a demo. Use when a user asks for a demo or wants to get started.",
  state: {
    email: z.string().describe("Work email address"),
    role: z.string().describe("The user's role at their company"),
    useCase: z.string().describe("Primary use case for the product"),
  },
})
  .addNode("ask_email", () =>
    interrupt({ question: "What is your work email address?", field: "email" })
  )
  .addNode("ask_role", (state) =>
    interrupt({
      question: "What is your role?",
      field: "role",
      context: `The user's email is ${state.email}. Reference their company domain naturally.`,
    })
  )
  .addNode("ask_use_case", () =>
    interrupt({
      question: "What's your main use case?",
      field: "useCase",
      suggestions: ["Analytics", "Lead gen", "Support"],
    })
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

// Register alongside tools
await registerTools(server, [flow]);
```

## State definition (required)

Every flow must define its `state` — a map of field names to Zod schemas. This serves two purposes:

1. **Type inference** — `TState` is automatically derived from the schemas, no explicit generic needed
2. **AI protocol** — field names, types, and descriptions are embedded in the tool description so the AI can pre-fill answers via `initialState`

```ts
const flow = createFlow({
  id: "signup",
  title: "Signup",
  description: "Sign up for a new account",
  state: {
    country: z.string().describe("Country the business is based in"),
    status: z.enum(["registered", "unregistered"]).describe("Business registration status"),
    email: z.string().describe("Work email address"),
  },
})
```

At every step, the engine stores the current `field` in `_meta.flow.field` — routing metadata the AI echoes back, not something displayed to the user.

## Pre-filling answers

When calling `action: "start"`, the AI can pass answers already present in the user's message via `stateUpdates`. The engine automatically skips nodes whose fields are already populated.

If a user says "I want to open a bank account in France", the AI calls:
```json
{ "action": "start", "stateUpdates": { "country": "France" } }
```

The flow skips the "which country?" question and proceeds to the next unanswered step.

**Rules:**
- Interrupt nodes are auto-skipped when their `field` is already filled in state.
- Widget nodes are auto-skipped when their `addNode` config declares a `field` and that field is already filled in state.
- Action nodes between skipped steps still execute (their logic may be needed for conditional edges).
- Fields with `undefined`, `null`, or `""` are NOT considered pre-filled.
- The AI should only extract values the user explicitly stated — never guess.

## Node types

| Return value | Behavior |
|---|---|
| `interrupt({ question, field })` | Pause → ask user → resume with answer stored at `field` |
| `interrupt({ question, field, context })` | Same, but with hidden instructions for the assistant to enrich its response |
| `showWidget(resource, { data })` | Pause → render widget → resume when widget calls back |
| `{ key: value, ... }` | Action node → merge into state → auto-advance to next node |

## Conditional edges

Route to different nodes based on state:

```ts
const GENERIC_DOMAINS = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"]);

const flow = createFlow({
  id: "smart_onboarding",
  title: "Smart Onboarding",
  description: "Onboards users with email-aware branching.",
  state: {
    email: z.string().describe("User's email address"),
    isCompanyEmail: z.boolean().describe("Whether the email is a company domain"),
    companyName: z.string().describe("Company name"),
  },
})
  .addNode("ask_email", () =>
    interrupt({ question: "What's your email?", field: "email" })
  )
  // Action node — runs silently, auto-advances
  .addNode("analyze_email", (state) => {
    const domain = state.email!.split("@")[1];
    return { isCompanyEmail: !GENERIC_DOMAINS.has(domain) };
  })
  .addNode("ask_company", () =>
    interrupt({ question: "What company are you with?", field: "companyName" })
  )
  .addNode("done", () => ({ ready: true }))
  .addEdge(START, "ask_email")
  .addEdge("ask_email", "analyze_email")
  // Branch based on email type
  .addConditionalEdge("analyze_email", (state) =>
    state.isCompanyEmail ? "done" : "ask_company"
  )
  .addEdge("ask_company", "done")
  .addEdge("done", END)
  .compile();
```

## Widget steps

Show a widget UI at a specific step. The widget calls back into the flow with its result.

```ts
import { createResource, createFlow, createTool, interrupt, showWidget, registerTools, START, END } from "@waniwani/sdk/mcp";
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

// 2. Optionally create a standalone tool for the same resource
const pricingTool = createTool({
  resource: pricingUI,
  description: "Show pricing comparison",
  inputSchema: { postalCode: z.string(), sqm: z.number() },
}, async ({ postalCode, sqm }) => ({
  text: "Pricing loaded",
  data: { postalCode, sqm, prices: [/* ... */] },
}));

// 3. Reference the resource in a flow
const flow = createFlow({
  id: "guided_quote",
  title: "Guided Quote",
  description: "Walk users through getting a quote.",
  state: {
    postalCode: z.string().describe("User's postal code"),
    sqm: z.string().describe("Home size in square meters"),
    selectedPlan: z.string().describe("The plan the user selected"),
  },
})
  .addNode("ask_postal", () =>
    interrupt({ question: "What's your postal code?", field: "postalCode" })
  )
  .addNode("ask_sqm", () =>
    interrupt({ question: "How many m² is your home?", field: "sqm" })
  )
  .addNode("show_pricing", { resource: pricingUI, field: "selectedPlan" }, (state) =>
    showWidget(pricingUI, {
      data: { postalCode: state.postalCode, sqm: Number(state.sqm) },
      description: "Showing pricing comparison. User will select a plan.",
    })
  )
  .addNode("confirm", (state) => ({
    summary: `Selected ${state.selectedPlan} for ${state.postalCode}`,
  }))
  .addEdge(START, "ask_postal")
  .addEdge("ask_postal", "ask_sqm")
  .addEdge("ask_sqm", "show_pricing")
  .addEdge("show_pricing", "confirm")
  .addEdge("confirm", END)
  .compile();

// 4. Register
await registerTools(server, [pricingTool, flow]);
```

### Widget callback (client-side)

Inside the widget, call back into the flow using `action: "continue"` and `stateUpdates`:

```tsx
import { useCallTool, useToolOutput, useToolResponseMetadata } from "@waniwani/sdk/mcp/react";

function PricingTable() {
  const data = useToolOutput<{
    prices: Array<{ plan: string; price: number }>;
  }>();
  const meta = useToolResponseMetadata() as {
    flow?: { flowId: string; step: string; state: Record<string, unknown>; field?: string };
  } | null;
  const callTool = useCallTool();

  const handleSelect = (plan: string) => {
    if (meta?.flow) {
      callTool(meta.flow.flowId, {
        action: "continue",
        _meta: {
          flow: {
            step: meta.flow.step,
            state: meta.flow.state,
          },
        },
        stateUpdates: { [meta.flow.field ?? "selectedPlan"]: plan },
      });
    }
  };

  return (
    <div>
      {data?.prices.map((p) => (
        <button key={p.plan} onClick={() => handleSelect(p.plan)}>
          {p.plan}: ${p.price}/mo
        </button>
      ))}
    </div>
  );
}
```

## API Reference

### `createFlow(config)`

Creates a new `StateGraph`. The state type is automatically inferred from the `state` definition — no explicit generic needed.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | MCP tool name |
| `title` | `string` | yes | Display title |
| `description` | `string` | yes | Tells the AI when to use this flow |
| `state` | `Record<string, z.ZodType>` | yes | State schema — defines all fields the flow collects. Keys match `interrupt({ field })` names, values are Zod schemas with `.describe()` |

### `StateGraph` methods

| Method | Description |
|--------|-------------|
| `.addNode(name, handler)` | Add a node |
| `.addNode(name, { resource?, field? }, handler)` | Add a node with config. `field` is typed as `keyof TState` and enables auto-skip. |
| `.addEdge(from, to)` | Static edge (`START` and `END` are valid) |
| `.addConditionalEdge(from, condition)` | Dynamic routing based on state |
| `.compile()` | Validate graph and return a `RegisteredFlow` |

### Helper functions

| Function | Description |
|----------|-------------|
| `interrupt({ question, field, suggestions?, context? })` | Return from a node to pause and ask the user a question. `context` provides hidden instructions to the assistant to enrich its response using data from previous nodes. |
| `showWidget(resource, { data, description? })` | Return from a node to pause and render a widget |

## Common Mistakes

- **Forgetting `START`/`END` edges** — Every flow needs `addEdge(START, firstNode)` and `addEdge(lastNode, END)`
- **Action nodes returning interrupt/widget** — If a node returns `interrupt()` or `showWidget()`, it becomes an interrupt/widget node, not an action node
- **Forgetting to register the resource** — Call `await resource.register(server)` before registering the flow
- **Widget callback shape** — The `callTool` call must use `action: "continue"`, include `_meta.flow.step`, `_meta.flow.state`, and pass the result via `stateUpdates: { [field]: value }`
