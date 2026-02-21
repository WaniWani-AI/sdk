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
  .addNode("show_pricing", { resource: pricingUI }, (state) =>
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
          {p.plan}: ${p.price}/mo
        </button>
      ))}
    </div>
  );
}
```

## API Reference

### `createFlow<TState>(config)`

Creates a new `StateGraph`. Config:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | MCP tool name |
| `title` | `string` | Display title |
| `description` | `string` | Tells the AI when to use this flow |

### `StateGraph` methods

| Method | Description |
|--------|-------------|
| `.addNode(name, handler)` | Add a node |
| `.addNode(name, { resource }, handler)` | Add a node with a resource config |
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
- **Widget callback shape** — The `callTool` call must include `action: "widget_result"`, `step`, `state`, and `widgetResult`

---

# Dynamic Flows (`@waniwani/sdk/mcp`)

AI-driven form gathering for MCP tools. Instead of a rigid graph of steps, declare **what data you need** and let the AI decide **how to gather it** — combining questions, skipping answered fields, inferring from context.

## How it works

1. Define fields with types, labels, validation, and optional AI hints
2. `createDynamicFlow()` compiles into an MCP tool with an AI-driven protocol
3. The AI gathers fields through natural conversation (can batch, skip, reorder)
4. The engine validates submissions and reports what's still needed
5. When all required fields are gathered, `onComplete` runs

No nodes, no edges, no rigid ordering. The AI has agency.

## When to use dynamic vs static flows

| Use case | Approach |
|----------|----------|
| Simple data collection (name, email, role) | **Dynamic flow** — AI gathers naturally |
| Complex branching with side effects | **Static flow** — explicit graph control |
| Forms where users often provide info upfront | **Dynamic flow** — AI skips answered fields |
| Wizard with specific widget at step 3 | **Static flow** — precise step ordering |
| Conversational qualification | **Dynamic flow** — AI adapts to context |

## Import

```ts
import { createDynamicFlow, field, registerTools } from "@waniwani/sdk/mcp";
```

## Quick start

```ts
import { createDynamicFlow, field, registerTools } from "@waniwani/sdk/mcp";

type LeadState = {
  name: string;
  email: string;
  role: string;
  useCase: string;
};

const flow = createDynamicFlow<LeadState>({
  id: "qualify_lead",
  title: "Lead Qualification",
  description: "Qualify a lead for a demo. Use when a user asks about pricing or a demo.",
  fields: {
    name: field.text({ label: "Full name" }),
    email: field.text({
      label: "Work email",
      validate: (v) => v.includes("@") || "Must be a valid email",
    }),
    role: field.text({
      label: "Job role",
      hint: "Ask casually — e.g. 'What do you do at your company?'",
    }),
    useCase: field.select({
      label: "Primary use case",
      options: ["Analytics", "Lead gen", "Support", "Other"],
    }),
  },
  onComplete: async (state) => ({
    summary: `Qualified: ${state.name} (${state.email}), ${state.role} — ${state.useCase}`,
  }),
});

await registerTools(server, [flow]);
```

**What happens at runtime:**

1. AI calls the tool with `action: "start"` → gets field schema
2. AI asks the user for missing fields naturally (may combine multiple in one message)
3. AI calls `action: "submit"` with gathered data → gets validation result
4. If fields are missing or invalid, AI continues gathering
5. When complete, `onComplete` runs and result is returned

If the user says *"Hi, I'm Sarah, a PM at Acme looking for analytics"* — the AI extracts name, role, and useCase in one shot, only needing to ask for email.

## Field types

```ts
field.text({
  label: "Full name",
  description: "The user's full name",        // context for the AI
  required: true,                              // default: true
  hint: "Ask warmly",                          // AI questioning style
  validate: (v) => v.length > 0 || "Required", // sync or async
})

field.select({
  label: "Plan",
  options: ["starter", "pro", "enterprise"],   // string[] or { label, value }[]
})

field.number({
  label: "Team size",
  min: 1,
  max: 10000,
})

field.boolean({
  label: "Agrees to terms",
})

field.widget(pricingResource, {
  label: "Plan selection",
  data: { tier: "enterprise" },                // static data for the widget
})
```

## Dependencies and conditional fields

Control field ordering and visibility:

```ts
type QuoteState = {
  companySize: string;
  useCase: string;
  budget: string;
  enterpriseNeeds: string;
};

const flow = createDynamicFlow<QuoteState>({
  id: "get_quote",
  title: "Get a Quote",
  description: "Help users get a pricing quote.",
  fields: {
    companySize: field.select({
      label: "Company size",
      options: ["1-10", "11-50", "51-200", "200+"],
    }),
    useCase: field.text({
      label: "Primary use case",
      hint: "Understand their pain points",
    }),
    budget: field.text({
      label: "Monthly budget",
      required: false,
      dependsOn: ["companySize"],  // only shown after companySize is gathered
    }),
    enterpriseNeeds: field.text({
      label: "Enterprise requirements",
      when: (state) => state.companySize === "200+",  // only for large companies
      hint: "Ask about compliance, SSO, SLAs",
    }),
  },
  onComplete: async (state) => ({
    quote: calculateQuote(state),
  }),
});
```

- **`dependsOn`** — Field becomes active only after all dependency fields are gathered
- **`when`** — Field becomes active only when the condition returns true (re-evaluated on each submission)

## Widget fields

For data that needs a rich UI (date pickers, plan selectors, file uploads):

```ts
const pricingUI = createResource({
  id: "pricing_table",
  title: "Pricing Table",
  baseUrl: "https://my-app.com",
  htmlPath: "/widgets/pricing",
  widgetDomain: "my-app.com",
});

await pricingUI.register(server);

const flow = createDynamicFlow<{ name: string; email: string; selectedPlan: string }>({
  id: "signup",
  title: "Signup",
  description: "Sign up for a plan.",
  fields: {
    name: field.text({ label: "Full name" }),
    email: field.text({ label: "Email" }),
    selectedPlan: field.widget(pricingUI, {
      label: "Plan selection",
      data: { showAnnual: true },
    }),
  },
  onComplete: async (state) => ({
    message: `Signed up ${state.name} for ${state.selectedPlan}!`,
  }),
});
```

Widget fields are resolved automatically after all non-widget required fields are gathered. The widget callback works identically to static flows.

## Completion with a widget

`onComplete` can return a `showWidget()` signal to display a final widget:

```ts
import { showWidget } from "@waniwani/sdk/mcp";

const flow = createDynamicFlow<MyState>({
  // ... fields
  onComplete: async (state) =>
    showWidget(confirmationUI, {
      data: { summary: state },
      description: "Showing order confirmation.",
    }),
});
```

## API Reference

### `createDynamicFlow<TState>(config)`

Creates an AI-driven flow. Returns a `RegisteredFlow`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | MCP tool name |
| `title` | `string` | Display title |
| `description` | `string` | Tells the AI when to use this flow |
| `fields` | `Record<keyof TState, FieldDefinition>` | Field schema |
| `onComplete` | `(state, meta?) => Result \| WidgetSignal` | Handler when all fields are gathered |

### `field` helpers

| Helper | Config |
|--------|--------|
| `field.text(config)` | `label`, `description?`, `required?`, `hint?`, `validate?`, `dependsOn?`, `when?` |
| `field.select(config)` | Same + `options: string[] \| { label, value }[]` |
| `field.number(config)` | Same + `min?`, `max?` |
| `field.boolean(config)` | Same as base config |
| `field.widget(resource, config)` | Same + `data?` for the widget |

### Field config options

| Option | Type | Description |
|--------|------|-------------|
| `label` | `string` | Human-readable field name |
| `description` | `string?` | Additional context for the AI |
| `required` | `boolean?` | Whether field must be gathered (default: `true`) |
| `hint` | `string?` | AI instructions for gathering style |
| `dependsOn` | `string[]?` | Fields that must be gathered first |
| `when` | `(state) => boolean` | Conditional visibility |
| `validate` | `(value) => true \| string` | Validation (return error message or `true`) |

## Common Mistakes

- **Using dynamic flows for complex branching** — If you need side effects between steps or precise widget ordering, use `createFlow` instead
- **Forgetting `onComplete`** — Dynamic flows always need a completion handler
- **Async validation without error handling** — If `validate` makes API calls, handle errors gracefully
- **Widget fields with `dependsOn` pointing to another widget** — Widget dependencies should point to text/select/number fields
