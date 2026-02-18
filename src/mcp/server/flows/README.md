# Flows

LangGraph-inspired multi-step conversational flows for MCP tools. Define a state graph, compile it into an MCP tool, and let the AI drive the flow.

## How it works

1. You define a graph of nodes connected by edges
2. `compile()` turns it into an MCP tool that the AI calls step by step
3. **Action nodes** run silently and auto-advance (API calls, data processing)
4. **Interrupt nodes** pause the flow and ask the user a question
5. **Widget nodes** pause the flow and render a widget UI

The AI carries the state between steps — no server-side storage needed.

## Quick start

```ts
import { createFlow, interrupt, START, END, registerWidgets } from "@waniwani/sdk/mcp";

type LeadState = {
  email: string;
  role: string;
  useCase: string;
};

const flow = createFlow<LeadState>({
  id: "demo_qualification",
  title: "Demo Qualification",
  description: "Qualify a lead for a demo. Use when a user asks for a demo or wants to get started.",
})
  .addNode("ask_email", () =>
    interrupt({ question: "What is your work email address?", field: "email" })
  )
  .addNode("ask_role", () =>
    interrupt({ question: "What is your role?", field: "role" })
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

// Register alongside widgets
await registerWidgets(server, [flow]);
```

## Conditional edges

Route to different nodes based on state:

```ts
const GENERIC_DOMAINS = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"]);

const flow = createFlow<{ email: string; isCompanyEmail: boolean; companyName: string }>({
  id: "smart_onboarding",
  title: "Smart Onboarding",
  description: "Onboards users with email-aware branching.",
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

Show a widget UI at a specific step in the flow. The widget calls back into the flow with its result.

```ts
import { createFlow, interrupt, showWidget, createWidget, START, END } from "@waniwani/sdk/mcp";
import { z } from "zod";

// 1. Define the widget independently
const pricingWidget = createWidget({
  id: "pricing_table",
  title: "Pricing Table",
  description: "Interactive pricing comparison",
  baseUrl: "https://my-app.com",
  htmlPath: "/widgets/pricing",
  widgetDomain: "my-app.com",
  inputSchema: { postalCode: z.string(), sqm: z.number() },
}, async ({ postalCode, sqm }) => ({
  text: "Pricing loaded",
  data: { postalCode, sqm, prices: [/* ... */] },
}));

// 2. Reference it in the flow
const flow = createFlow<{ postalCode: string; sqm: string; selectedPlan: string }>({
  id: "guided_quote",
  title: "Guided Quote",
  description: "Walk users through getting a quote.",
})
  .addNode("ask_postal", () =>
    interrupt({ question: "What's your postal code?", field: "postalCode" })
  )
  .addNode("ask_sqm", () =>
    interrupt({ question: "How many m² is your home?", field: "sqm" })
  )
  .addNode("show_pricing", (state) =>
    showWidget({
      widgetId: "pricing_table",
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

// 3. Register both
await registerWidgets(server, [pricingWidget, flow]);
```

Inside the widget, call back into the flow:

```tsx
import { useCallTool, useToolOutput } from "@waniwani/sdk/mcp/react";

function PricingTable() {
  const data = useToolOutput<{
    prices: Array<{ plan: string; price: number }>;
    __flow?: { flowId: string; step: string; state: Record<string, unknown> };
  }>();
  const callTool = useCallTool();

  const handleSelect = (plan: string) => {
    if (data?.__flow) {
      callTool(data.__flow.flowId, {
        action: "widget_result",
        step: data.__flow.step,
        state: data.__flow.state,
        widgetResult: { selectedPlan: plan },
      });
    }
  };

  return (
    <div>
      {data?.prices.map((p) => (
        <button key={p.plan} onClick={() => handleSelect(p.plan)}>
          {p.plan}: €{p.price}/mo
        </button>
      ))}
    </div>
  );
}
```

## Node types summary

| Return value | Behavior |
|---|---|
| `interrupt({ question, field })` | Pause → ask user → resume with answer stored at `field` |
| `showWidget({ widgetId, data })` | Pause → render widget → resume when widget calls back |
| `{ key: value, ... }` | Action node → merge into state → auto-advance to next node |

## API

### `createFlow<TState>(config)`

Creates a new `StateGraph`. Config:
- `id` — MCP tool name
- `title` — display title
- `description` — tells the AI when to use this flow

### `StateGraph` methods

- `.addNode(name, handler)` — add a node
- `.addEdge(from, to)` — static edge (`START` and `END` are valid)
- `.addConditionalEdge(from, condition)` — dynamic routing based on state
- `.compile(options?)` — validate graph and return a `RegisteredFlow`

### `compile(options?)`

Options:
- `widgetRefs` — map of widget IDs to `RegisteredWidget` objects for metadata resolution
