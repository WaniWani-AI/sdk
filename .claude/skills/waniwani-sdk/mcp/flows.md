# Flows (`@waniwani/sdk/mcp`)

LangGraph-inspired multi-step conversational flows for MCP tools. Define a state graph, compile it into an MCP tool, and let the AI drive the flow.

## How it works

1. Define a graph of nodes connected by edges
2. `compile()` turns it into an MCP tool that the AI calls step by step
3. **Action nodes** run silently and auto-advance (API calls, data processing)
4. **Interrupt nodes** pause the flow and ask the user one or more questions
5. **Widget nodes** pause the flow and render a widget UI

Flow state is stored **server-side** via the WaniWani API, keyed by the session ID from `_meta`. The AI doesn't need to round-trip any token — state is recovered automatically on every call.

## Import

```ts
import { createFlow, registerTools, START, END } from "@waniwani/sdk/mcp";
```

> **Note:** `interrupt` and `showWidget` are **not** imported directly. They are provided on the handler's context object (see [Node handlers](#node-handlers)).

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
  .addNode("ask_email", ({ interrupt }) =>
    interrupt({ email: { question: "What is your work email address?" } })

  )
  .addNode("ask_role", ({ state, interrupt }) =>
    interrupt({
      role: {
        question: "What is your role?",
        context: `The user's email is ${state.email}. Reference their company domain naturally.`,
      },
    })
  )
  .addNode("ask_use_case", ({ interrupt }) =>
    interrupt({
      useCase: {
        question: "What's your main use case?",
        suggestions: ["Analytics", "Lead gen", "Support"],
      },
    })
  )
  .addNode("complete", ({ state }) => ({
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

At every step, the engine stores the current flow state (step, field, state values) server-side, keyed by session ID. The AI simply calls `action: "continue"` — no token round-tripping needed.

By default, a `WaniwaniFlowStore` is used — it stores flow state via the WaniWani API using your `WANIWANI_API_KEY` and `WANIWANI_BASE_URL` env vars. This works seamlessly in serverless environments (Vercel) with no extra infrastructure. Tenant isolation is handled by the API key.

```ts
// Default — zero config, uses WANIWANI_API_KEY env var
const flow = createFlow({ ... }).compile();

// Explicit store (rare — only if you need custom options)
import { WaniwaniFlowStore } from "@waniwani/sdk/mcp";
const store = new WaniwaniFlowStore({ apiKey: "...", baseUrl: "..." });
const flow = createFlow({ ... }).compile({ store });
```

If no API key is available, the store gracefully degrades: `set()`/`delete()` are no-ops and `get()` returns `null`.

The engine uses the session ID from `_meta` (e.g., `openai/sessionId`, `sessionId`, `anthropic/sessionId`) as the store key. State is recovered automatically from the MCP client metadata on every call — no token round-tripping needed.

You can also pass a custom store to `compile({ store })`. It must satisfy the `FlowStore` interface:

```ts
import type { FlowStore } from "@waniwani/sdk/mcp";

class MyStore implements FlowStore {
  async get(key: string) { ... }
  async set(key: string, value: FlowTokenContent) { ... }
  async delete(key: string) { ... }
}
```

## Pre-filling answers

When calling `action: "start"`, the AI can pass answers already present in the user's message via `stateUpdates`. The engine automatically skips nodes whose fields are already populated.

If a user says "I want to open a bank account in France", the AI calls:
```json
{ "action": "start", "stateUpdates": { "country": "France" } }
```

The flow skips the "which country?" question and proceeds to the next unanswered step.

**Rules:**
- Interrupt nodes are auto-skipped when their field(s) are already filled in state.
- Widget nodes are auto-skipped when their `field` is already filled in state.
- Action nodes between skipped steps still execute (their logic may be needed for conditional edges).
- Fields with `undefined`, `null`, or `""` are NOT considered pre-filled.
- The AI should only extract values the user explicitly stated — never guess.

## Node handlers

Every handler receives a **context object** with four properties:

```ts
.addNode("my_node", ({ state, meta, interrupt, showWidget }) => {
  // state      — Partial<TState>, current flow state
  // meta       — Record<string, unknown> | undefined, MCP request metadata
  // interrupt  — typed helper to pause and ask questions
  // showWidget — typed helper to pause and show a UI widget
})
```

### Handler context type

```ts
type NodeContext<TState> = {
  state: Partial<TState>;
  meta?: Record<string, unknown>;
  interrupt: TypedInterrupt<TState>;
  showWidget: TypedShowWidget<TState>;
};
```

### Return values

| Return value | Behavior |
|---|---|
| `interrupt({ ... })` | Pause → ask user one or more questions → resume with answers |
| `showWidget(tool, { data, field?, description? })` | Pause → instruct AI to call display tool → resume when user interacts. `field` enables auto-skip. |
| `{ key: value, ... }` | Action node → merge into state → auto-advance to next node |

## Interrupt API

`interrupt()` takes two arguments:

1. **`fields`** — an object where each key is a state field name, each value describes the question for that field
2. **`config`** (optional) — `{ context?: string }` for overall hidden AI instructions

One field = single question. Multiple fields = multiple questions asked together.

```ts
interrupt(fields, config?)
```

### Single question

```ts
.addNode("ask_breed", ({ interrupt }) =>
  interrupt({ breed: { question: "What breed is your pet?" } })
)
```

### Single question with suggestions and per-question context

```ts
.addNode("ask_animal", ({ interrupt }) =>
  interrupt({
    animalType: {
      question: "Is your pet a dog or a cat?",
      suggestions: ["Dog", "Cat"],
      context: "Only accept dog or cat.",
    },
  })
)
```

### Multiple questions in one message

```ts
.addNode("ask_details", ({ interrupt }) =>
  interrupt(
    {
      name: { question: "What's your name?" },
      email: { question: "What's your email?" },
    },
    { context: "Ask both questions naturally in one conversational message." },
  )
)
```

### Dynamic questions (conditional fields)

Because the API uses object spread, you can conditionally include questions:

```ts
.addNode("ask_pet_info", ({ state, interrupt }) =>
  interrupt(
    {
      ...(!state.petName ? { petName: { question: "What's your pet's name?" } } : {}),
      ...(!state.breed ? { breed: { question: "What breed?" } } : {}),
      ...(!state.age ? { age: { question: "How old?" } } : {}),
    },
    { context: "Ask conversationally, not like a form." },
  )
)
```

### Typing

Both `interrupt` and `showWidget` are **typed end-to-end** from the Zod state schema:
- `interrupt({ breed: { ... } })` — TypeScript enforces `breed` is a key of `TState`
- `validate: (value) => ...` — `value` is typed as `TState["breed"]` (e.g. `string` if `breed: z.string()`)
- `showWidget(tool, { field: "plan" })` — `"plan"` must be a key of `TState`

## Validation on interrupts

Add a `validate` function to any question. It runs **after** the user answers and **before** advancing to the next node.

```ts
.addNode("ask_breed", ({ state, interrupt }) =>
  interrupt({
    breed: {
      question: "What breed is your pet?",
      validate: async (breed) => {
        // `breed` is typed as `string` (from z.string() in state schema)
        const result = await resolveBreed(state.animalType!, breed);
        if (!result) {
          throw new Error("Couldn't find that breed. Could you check the spelling?");
        }
        // Return state updates to enrich the state
        return { breedId: result.id };
      },
    },
  })
)
```

### Validate return types

| Return | Behavior |
|--------|----------|
| `Partial<TState>` (object) | Validated. Merge into state, advance to next node. |
| `void` / `undefined` | Validated, no enrichment. Advance to next node. |
| `throw new Error(msg)` | Failed. Clear the field, re-present the interrupt with `ERROR: msg` prepended to context. |

### How it works under the hood

- Validate functions are stored in a `Map<"nodeName:fieldName", ValidateFn>` inside the compiled flow closure. They are **not** serialized into the store.
- For multi-question interrupts, validators only run **after all questions are answered**. If the user provides partial answers, validators do not fire until every question's field is filled.
- When validation fails (throws), the error message is prepended to that specific question's `context` as `ERROR: <message>`, so the AI can relay it naturally. The field is cleared and the interrupt is re-presented.

### Validate replaces the old ask-validate-reset pattern

**Before** (3 nodes + 3 edges):
```ts
.addNode("ask_breed", ({ interrupt }) =>
  interrupt({ breed: { question: "What breed?" } })
)
.addNode("validate_breed", async ({ state }) => {
  const result = await resolveBreed(state.animalType!, state.breed!);
  if (!result) return { breed: undefined }; // reset to re-ask
  return { breedId: result.id };
})
.addNode("after_breed", ({ state }) => ({ ... }))
.addEdge("ask_breed", "validate_breed")
.addConditionalEdge("validate_breed", (state) =>
  state.breed ? "after_breed" : "ask_breed"
)
.addEdge("after_breed", END)
```

**After** (1 node + 1 edge):
```ts
.addNode("ask_breed", ({ state, interrupt }) =>
  interrupt({
    breed: {
      question: "What breed?",
      validate: async (breed) => {
        const result = await resolveBreed(state.animalType!, breed);
        if (!result) throw new Error("Couldn't find that breed.");
        return { breedId: result.id };
      },
    },
  })
)
.addEdge("ask_breed", END)
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
  .addNode("ask_email", ({ interrupt }) =>
    interrupt({ email: { question: "What's your email?" } })
  )
  // Action node — runs silently, auto-advances
  .addNode("analyze_email", ({ state }) => {
    const domain = state.email!.split("@")[1];
    return { isCompanyEmail: !GENERIC_DOMAINS.has(domain) };
  })
  .addNode("ask_company", ({ interrupt }) =>
    interrupt({ companyName: { question: "What company are you with?" } })
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

Show a widget UI at a specific step. Create a display tool with `createTool()` (attached to its own resource), then reference it with `showWidget()` from the handler context.

**Important: The flow is a data-only tool.** It never returns `structuredContent` or renders widgets itself. When a `showWidget()` node is reached, the flow returns the tool name and data as text content for the LLM. The LLM then calls the display/render tool separately — that render tool is the one that returns `structuredContent` and the widget template (`resourceUri`). This follows the decoupled pattern: data tools (flow) handle logic and state, render tools (display tool) handle presentation.

```ts
import { createResource, createFlow, createTool, registerTools, START, END } from "@waniwani/sdk/mcp";
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

// 3. Use the display tool in a flow via showWidget from the handler context
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
  .addNode("ask_postal", ({ interrupt }) =>
    interrupt({ postalCode: { question: "What's your postal code?" } })
  )
  .addNode("ask_sqm", ({ interrupt }) =>
    interrupt({ sqm: { question: "How many m² is your home?" } })
  )
  .addNode("show_pricing", ({ state, showWidget }) =>
    showWidget(showPricing, {
      data: { postalCode: state.postalCode!, sqm: Number(state.sqm) },
      description: "User must pick a plan.",
      field: "selectedPlan",
    })
  )
  .addNode("confirm", ({ state }) => ({
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

## Error handling

When a flow node throws an error or the engine encounters an issue, the response includes `isError: true` at the top level of the MCP tool response (alongside `content`). This signals to the MCP client that the tool call failed, following the MCP protocol convention.

```ts
// Error response shape:
{
  content: [{ type: "text", text: '{ "status": "error", "error": "..." }' }],
  isError: true,  // set at response level for MCP protocol compliance
  _meta: { ... },
}
```

## Complete example: insurance quote with validation

```ts
import { createFlow, START, END, registerTools } from "@waniwani/sdk/mcp";
import { z } from "zod";

const flow = createFlow({
  id: "pet_insurance_quote",
  title: "Pet Insurance Quote",
  description: "Get a pet insurance quote. Use when a user wants to insure their pet.",
  state: {
    animalType: z.enum(["dog", "cat"]).describe("Type of animal"),
    breed: z.string().describe("Breed of the pet"),
    breedId: z.string().describe("Resolved breed ID"),
    age: z.number().describe("Age of the pet in years"),
    name: z.string().describe("Pet's name"),
    email: z.string().describe("Owner's email"),
  },
})
  // Simple question with suggestions
  .addNode("ask_animal", ({ interrupt }) =>
    interrupt({
      animalType: {
        question: "Is your pet a dog or a cat?",
        suggestions: ["Dog", "Cat"],
      },
    })
  )
  // Question with validation + state enrichment
  .addNode("ask_breed", ({ state, interrupt }) =>
    interrupt({
      breed: {
        question: "What breed is your pet?",
        context: `The user has a ${state.animalType}. Only suggest breeds for that animal type.`,
        validate: async (breed) => {
          const result = await lookupBreed(state.animalType!, breed);
          if (!result) {
            throw new Error(`"${breed}" doesn't match any known ${state.animalType} breed. Try again?`);
          }
          return { breedId: result.id };
        },
      },
    })
  )
  // Multiple questions in one message
  .addNode("ask_details", ({ interrupt }) =>
    interrupt(
      {
        age: { question: "How old is your pet?" },
        name: { question: "What's your pet's name?" },
      },
      { context: "Ask both questions naturally in one conversational message." },
    )
  )
  // Question with simple validation (no enrichment)
  .addNode("ask_email", ({ interrupt }) =>
    interrupt({
      email: {
        question: "What's your email for the quote?",
        validate: (email) => {
          if (!email.includes("@")) {
            throw new Error("That doesn't look like a valid email address.");
          }
          // void return = validated, no enrichment
        },
      },
    })
  )
  // Action node — runs silently
  .addNode("generate_quote", async ({ state }) => {
    const quote = await generateQuote({
      breedId: state.breedId!,
      age: state.age!,
    });
    return { quote };
  })
  .addEdge(START, "ask_animal")
  .addEdge("ask_animal", "ask_breed")
  .addEdge("ask_breed", "ask_details")
  .addEdge("ask_details", "ask_email")
  .addEdge("ask_email", "generate_quote")
  .addEdge("generate_quote", END)
  .compile();

await registerTools(server, [flow]);
```

## API Reference

### `createFlow(config)`

Creates a new `StateGraph`. The state type is automatically inferred from the `state` definition — no explicit generic needed.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | MCP tool name |
| `title` | `string` | yes | Display title |
| `description` | `string` | yes | Tells the AI when to use this flow |
| `state` | `Record<string, z.ZodType>` | yes | State schema — defines all fields the flow collects. Keys match interrupt field names, values are Zod schemas with `.describe()` |

### `StateGraph` methods

| Method | Description |
|--------|-------------|
| `.addNode(name, handler)` | Add a node. Handler receives `{ state, meta, interrupt, showWidget }` context. Return `interrupt(...)`, `showWidget(...)`, or a plain object. |
| `.addEdge(from, to)` | Static edge (`START` and `END` are valid) |
| `.addConditionalEdge(from, condition)` | Dynamic routing — `condition(state)` returns the next node name |
| `.compile(options?)` | Validate graph and return a `RegisteredFlow`. Options: `{ store?: FlowStore }` |

### `interrupt(fields, config?)` (from handler context)

**`fields`** — each key is a state field name, each value is a question config:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `question` | `string` | yes | The question to ask the user |
| `validate` | `(value: TState[F]) => Partial<TState> \| void` | no | Validation function. Throw to reject, return object to enrich state, return void to accept. |
| `suggestions` | `string[]` | no | Suggested answers |
| `context` | `string` | no | Hidden AI instructions for this specific question |

**`config`** (optional):

| Property | Type | Description |
|----------|------|-------------|
| `context` | `string` | Overall hidden AI instructions across all questions |

### `showWidget(tool, config)` (from handler context)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `tool` | `RegisteredTool` | yes | The display tool (from `createTool()`) |
| `data` | `Record<string, unknown>` | yes | Data to pass to the display tool |
| `field` | `keyof TState` | no | State field this widget fills — enables auto-skip |
| `description` | `string` | no | Description for the AI |
| `interactive` | `boolean` | no | Set to `false` for display-only widgets that auto-advance |

### Other exports

| Export | Description |
|--------|-------------|
| `WaniwaniFlowStore` | Default API-backed state store. Stores flow state via the WaniWani API. Options: `{ apiKey?: string, baseUrl?: string }`. Falls back to `WANIWANI_API_KEY` / `WANIWANI_BASE_URL` env vars. |
| `FlowStore` | Interface for custom store implementations. |

## Common Mistakes

- **Importing `interrupt` or `showWidget` directly** — These are NOT exported. Use them from the handler context: `({ interrupt }) => interrupt(...)`.
- **Using the old handler signature** — Handlers receive a context object, not `(state, meta?)`. Use `({ state }) => ...` instead of `(state) => ...`.
- **Using the old `interrupt({ question, field })` syntax** — Use the object-key syntax: `interrupt({ fieldName: { question: "..." } })`. Context goes in the second argument: `interrupt({...}, { context: "..." })`.
- **Forgetting `START`/`END` edges** — Every flow needs `addEdge(START, firstNode)` and `addEdge(lastNode, END)`.
- **Passing a string to `showWidget()`** — `showWidget` takes a `RegisteredTool` reference, not a string ID.
- **Missing display tool registration** — The display tool must be registered alongside the flow via `registerTools(server, [displayTool, flow])`.
- **Widget callback** — Use `sendFollowUp` to communicate the user's selection back to the AI.
- **Validate returning an error string** — `validate` must **throw** an `Error` to signal failure, not return a string. Return `void` or an object for success.
