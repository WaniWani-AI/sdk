# Flows (`@waniwani/sdk/mcp`)

LangGraph-inspired multi-step conversational flows for MCP tools. Define a state graph, compile it into an MCP tool, and let the AI drive the flow.

## How it works

1. Define a graph of nodes connected by edges
2. `compile()` turns it into an MCP tool that the AI calls step by step
3. **Action nodes** run silently and auto-advance (API calls, data processing)
4. **Interrupt nodes** pause the flow and ask the user one or more questions
5. **Widget nodes** pause the flow and render a widget UI

The AI carries the state between steps — no server-side storage needed.

## Import

```ts
import { createResource, createFlow, createTool, interrupt, showWidget, registerTools, START, END } from "@waniwani/sdk/mcp";
```

## Quick start

```ts
import { createFlow, START, END, registerTools } from "@waniwani/sdk/mcp";
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
  .addNode("ask_email", () => interrupt({ question: "What is your work email address?", field: "email" }))
  .addNode("ask_role", (state) =>
    interrupt({
      question: "What is your role?",
      field: "role",
      context: `The user's email is ${state.email}. Reference their company domain naturally.`,
    })
  )
  .addNode("ask_use_case", () =>
    interrupt({ question: "What's your main use case?", field: "useCase", suggestions: ["Analytics", "Lead gen", "Support"] })
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
2. **AI protocol** — field names, types, and descriptions are embedded in the tool description so the AI can pre-fill answers via `stateUpdates`

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

At every step, the engine encodes the current flow state (step, field, state values, cached questions) into an opaque `flowToken` string included in the text response. The AI echoes this token back on the next `continue` call — it does not need to understand or modify it.

## Pre-filling answers

When calling `action: "start"`, the AI can pass answers already present in the user's message via `stateUpdates`. The engine automatically skips nodes whose fields are already populated.

If a user says "I want to open a bank account in France", the AI calls:
```json
{ "action": "start", "stateUpdates": { "country": "France" } }
```

The flow skips the "which country?" question and proceeds to the next unanswered step.

**Rules:**
- Interrupt nodes are auto-skipped when their `field` is already filled in state.
- Multi-question nodes are auto-skipped when **all** of their `questions[].field` values are already filled.
- Widget nodes are auto-skipped when their `field` is already filled in state.
- Action nodes between skipped steps still execute (their logic may be needed for conditional edges).
- Fields with `undefined`, `null`, or `""` are NOT considered pre-filled.
- The AI should only extract values the user explicitly stated — never guess.

## Node types

### Handler-based nodes

Use `interrupt()` for questions, `showWidget()` for widgets, or return a plain object for action nodes.

| Return value | Behavior |
|---|---|
| `interrupt({ question, field })` | Pause → ask user → resume with answer stored at `field` |
| `interrupt({ question, field, context })` | Same, but with hidden instructions for the assistant to enrich its response |
| `interrupt({ questions: [...], context? })` | Pause → ask ALL questions in one message → resume with all answers |
| `showWidget(tool, { data, field?, description? })` | Pause → instruct AI to call display tool → resume when user interacts. `field` enables auto-skip. |
| `{ key: value, ... }` | Action node → merge into state → auto-advance to next node |

**`interrupt()` — single or multi-question:**
```ts
// Single question
.addNode("ask_role", (state) =>
  interrupt({
    question: "What is your role?",
    field: "role",
    context: `User's email domain: ${state.email?.split("@")[1]}`,
  })
)

// Multiple questions (asked in one message)
.addNode("ask_details", () =>
  interrupt({
    questions: [
      { question: "How many employees?", field: "headcount" },
      { question: "Average age?", field: "averageAge" },
    ],
    context: "Ask conversationally, one friendly message.",
  })
)
```

**`showWidget()` — delegates rendering to a display tool:**

`showWidget` takes a `RegisteredTool` (created via `createTool()` with a `resource`). The flow engine returns the tool name and data in the text response, and the AI calls the display tool separately.

```ts
.addNode("choose_plan", (state) =>
  showWidget(showPricingTool, {
    data: { offers: computeOffers(state.idcc) },
    description: "Showing pricing options.",
    field: "selectedPlan",  // enables auto-skip when already set
  })
)
```

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
  .addNode("ask_email", () => interrupt({ question: "What's your email?", field: "email" }))
  // Action node — runs silently, auto-advances
  .addNode("analyze_email", (state) => {
    const domain = state.email!.split("@")[1];
    return { isCompanyEmail: !GENERIC_DOMAINS.has(domain) };
  })
  .addNode("ask_company", () => interrupt({ question: "What company are you with?", field: "companyName" }))
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

Show a widget UI at a specific step. Create a display tool with `createTool()` (attached to its own resource), then reference it in `showWidget()`. The flow returns the tool name + data in text content — the AI calls the display tool separately.

This follows ChatGPT's recommended "decoupled pattern": data tools (flow) and render tools (display tool) are separate. The flow is a data-only tool; each widget has its own render tool and widget page.

```ts
import { createResource, createFlow, createTool, interrupt, showWidget, registerTools, START, END } from "@waniwani/sdk/mcp";
import { z } from "zod";

// 1. Create and register a resource for the widget
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
  description: "Walk users through getting a quote.",
  state: {
    postalCode: z.string().describe("User's postal code"),
    sqm: z.string().describe("Home size in square meters"),
    selectedPlan: z.string().describe("The plan the user selected"),
  },
})
  .addNode("ask_postal", () => interrupt({ question: "What's your postal code?", field: "postalCode" }))
  .addNode("ask_sqm", () => interrupt({ question: "How many m² is your home?", field: "sqm" }))
  .addNode("show_pricing", (state) =>
    showWidget(showPricing, {
      data: { postalCode: state.postalCode!, sqm: Number(state.sqm) },
      description: "User must pick a plan.",
      field: "selectedPlan",
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

// 4. Register display tool + flow
await registerTools(server, [showPricing, flow]);
```

### Widget page (client-side)

Each display tool has its own widget page. Use `useToolOutput` to read the data:

```tsx
import { WidgetProvider, useToolOutput, useSendFollowUp } from "@waniwani/sdk/mcp/react";

function PricingTable() {
  const data = useToolOutput<{ prices: Array<{ plan: string; price: number }> }>();
  const sendFollowUp = useSendFollowUp();

  if (!data) return null;

  return (
    <div>
      {data.prices.map((p) => (
        <button key={p.plan} onClick={() => sendFollowUp(`I selected the ${p.plan} plan`)}>
          {p.plan}: ${p.price}/mo
        </button>
      ))}
    </div>
  );
}

export default function PricingPage() {
  return (
    <WidgetProvider>
      <PricingTable />
    </WidgetProvider>
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
| `.addNode(name, handler)` | Handler node — return `interrupt()`, `showWidget()`, or a plain object |
| `.addNode(name, { field? }, handler)` | Handler node with config. `field` enables auto-skip. |
| `.addEdge(from, to)` | Static edge (`START` and `END` are valid) |
| `.addConditionalEdge(from, condition)` | Dynamic routing based on state |
| `.compile()` | Validate graph and return a `RegisteredFlow` |

### Helper functions (for handler-based nodes)

| Function | Description |
|----------|-------------|
| `interrupt({ question, field, suggestions?, context? })` | Pause and ask the user a single question. `context` provides hidden AI instructions. |
| `interrupt({ questions: [...], context? })` | Pause and ask several questions at once in one message. |
| `showWidget(tool, { data, field?, description? })` | Pause and delegate to a display tool. `tool` is a `RegisteredTool` (from `createTool()`). `field` enables auto-skip when already set. |

## Common Mistakes

- **Forgetting `START`/`END` edges** — Every flow needs `addEdge(START, firstNode)` and `addEdge(lastNode, END)`
- **Action nodes returning interrupt/widget** — If a node returns `interrupt()` or `showWidget()`, it becomes an interrupt/widget node, not an action node
- **Passing a string to `showWidget()`** — `showWidget` takes a `RegisteredTool` reference, not a string ID
- **Missing display tool registration** — The display tool must be registered alongside the flow via `registerTools(server, [displayTool, flow])`
- **Widget callback** — Use `sendFollowUp` to communicate the user's selection back to the AI
