# Flows (`@waniwani/sdk/mcp`)

LangGraph-inspired multi-step conversational flows for MCP tools. Define a state graph, compile it into an MCP tool, and let the AI drive the flow step by step.

## How It Works

1. Define a graph of nodes connected by edges
2. `compile()` turns it into an MCP tool that the AI calls repeatedly
3. **Action nodes** run silently and auto-advance (API calls, data processing)
4. **Interrupt nodes** pause the flow and ask the user one or more questions
5. **Widget nodes** pause the flow and render a widget UI

Flow state is stored **server-side** via the WaniWani API, keyed by the session ID from `_meta`. The AI does not need to round-trip any token -- state is recovered automatically on every call.

## Import

```ts
import { createFlow, registerTools, START, END } from "@waniwani/sdk/mcp";
```

`interrupt` and `showWidget` are **not** imported directly. They are provided on the handler's context object (see [Node Handlers](#node-handlers)).

## Quick Start

```ts
import { createFlow, START, END, registerTools } from "@waniwani/sdk/mcp";
import { z } from "zod";

const flow = createFlow({
  id: "demo_qualification",
  title: "Demo Qualification",
  description: "Qualify a lead for a demo.",
  state: {
    email: z.string().describe("Work email address"),
    role: z.string().describe("User's role"),
  },
})
  .addNode("ask_email", ({ interrupt }) =>
    interrupt({ email: { question: "What is your work email?" } })
  )
  .addNode("ask_role", ({ interrupt }) =>
    interrupt({ role: { question: "What is your role?" } })
  )
  .addNode("done", ({ state }) => ({ summary: `${state.email}, ${state.role}` }))
  .addEdge(START, "ask_email")
  .addEdge("ask_email", "ask_role")
  .addEdge("ask_role", "done")
  .addEdge("done", END)
  .compile();

await registerTools(server, [flow]);
```

## State Definition

Every flow must define its `state` -- a map of field names to Zod schemas. This serves two purposes:

1. **Type inference** -- `TState` is automatically derived, no explicit generic needed
2. **AI protocol** -- field names, types, and descriptions are embedded in the tool description so the AI can pre-fill answers via `stateUpdates`

```ts
state: {
  country: z.string().describe("Country the business is based in"),
  status: z.enum(["registered", "unregistered"]).describe("Business registration status"),
  email: z.string().describe("Work email address"),
}
```

### Nested State (z.object + dot-path)

Use `z.object()` to group related fields. The `.describe()` on the parent object provides AI context for when to collect the group. Only 1 level of nesting is supported.

```ts
state: {
  driver: z.object({
    name: z.string().describe("Driver's full name"),
    license: z.string().describe("License number"),
  }).describe("Driver details"),
  email: z.string().describe("Contact email"),
}
```

Nested fields use **dot-path notation** everywhere -- interrupts, `stateUpdates`, and `showWidget` field:

```ts
// Interrupt with dot-path keys
.addNode("ask_driver", ({ interrupt }) =>
  interrupt({
    "driver.name": { question: "What's the driver's name?" },
    "driver.license": { question: "License number?" },
  })
)

// State access uses native nested objects
.addNode("summarize", ({ state }) => ({
  summary: `${state.driver?.name} -- ${state.email}`,
}))
```

Rules for nested state:

- Flat fields (`email`) and dot-path fields (`driver.name`) work the same way in interrupts
- `isFilled` checks resolve dot-paths: auto-skip works per sub-field
- `validate` on a nested field receives the leaf value (e.g., `string` for `driver.name`)
- Validation errors clear only the specific sub-field, not the entire parent object
- Action nodes returning nested objects are deep-merged (`{ driver: { name: "John" } }` preserves `driver.license`)

## Pre-filling Answers

When calling `action: "start"`, the AI can pass known answers via `stateUpdates`. The engine auto-skips nodes whose fields are already filled.

Example: user says "I want to open a bank account in France" -- AI sends `{ "action": "start", "stateUpdates": { "country": "France" } }` and the flow skips the country question.

- Interrupt and widget nodes are auto-skipped when their field(s) are filled
- Action nodes between skipped steps still execute (needed for conditional edges)
- `undefined`, `null`, and `""` are NOT considered pre-filled

## Node Handlers

Every handler receives a context object: `({ state, meta, interrupt, showWidget, waniwani }) => ...`

The `waniwani` property is a session-scoped `ScopedWaniWaniClient` for tracking events within flow handlers (e.g. `waniwani.track(...)`, `waniwani.identify(...)`). It is automatically scoped to the current session.

| Return value | Behavior |
|---|---|
| `interrupt({ ... })` | Pause, ask user one or more questions, resume with answers |
| `showWidget(tool, { data, field?, description? })` | Pause, instruct AI to call display tool, resume when user interacts |
| `{ key: value, ... }` | Action node: merge into state, auto-advance to next node |

## Interrupt API

`interrupt()` takes two arguments:

1. **`fields`** -- an object where each key is a state field name, each value describes the question
2. **`config`** (optional) -- `{ context?: string }` for overall hidden AI instructions

One field = single question. Multiple fields = multiple questions asked together.

### Single Question

```ts
.addNode("ask_breed", ({ interrupt }) =>
  interrupt({ breed: { question: "What breed is your pet?" } })
)
```

### With Suggestions and Context

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

### Multiple Questions

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

### Dynamic Questions

Conditionally include questions with object spread:

```ts
.addNode("ask_pet_info", ({ state, interrupt }) =>
  interrupt({
    ...(!state.petName ? { petName: { question: "What's your pet's name?" } } : {}),
    ...(!state.breed ? { breed: { question: "What breed?" } } : {}),
  })
)
```

## Validation

Add a `validate` function to any question. It runs after the user answers and before advancing.

```ts
.addNode("ask_breed", ({ state, interrupt }) =>
  interrupt({
    breed: {
      question: "What breed is your pet?",
      validate: async (breed) => {
        const result = await resolveBreed(state.animalType!, breed);
        if (!result) {
          throw new Error("Couldn't find that breed. Could you check the spelling?");
        }
        return { breedId: result.id };
      },
    },
  })
)
```

Validate return types:

| Return | Behavior |
|--------|----------|
| `Partial<TState>` (object) | Validated. Merge into state, advance to next node. |
| `void` / `undefined` | Validated, no enrichment. Advance to next node. |
| `throw new Error(msg)` | Failed. Clear the field, re-present the interrupt with `ERROR: msg` prepended to context. |

Notes:

- For multi-question interrupts, validators only run after **all** questions are answered
- When validation fails (throws), the error message is prepended to that question's `context` as `ERROR: <message>` and the field is cleared
- `validate` replaces the old ask-validate-reset pattern (3 nodes + conditional edge) with a single node

## Conditional Edges

Route to different nodes based on state. `addConditionalEdge(from, condition)` takes a function that receives state and returns the name of the next node. TypeScript enforces the return type matches registered node names.

```ts
// Action node sets a flag
.addNode("analyze_email", ({ state }) => {
  const domain = state.email!.split("@")[1];
  return { isCompanyEmail: !GENERIC_DOMAINS.has(domain) };
})

// Conditional edge branches on that flag
.addEdge("ask_email", "analyze_email")
.addConditionalEdge("analyze_email", (state) =>
  state.isCompanyEmail ? "done" : "ask_company"
)
.addEdge("ask_company", "done")
.addEdge("done", END)
```

## Widget Steps

Show a widget UI at a specific step. Create a display tool with `createTool()`, then reference it with `showWidget()` from the handler context.

The flow is a **data-only tool**. It never returns `structuredContent` or renders widgets itself. When a `showWidget()` node is reached, the flow returns the tool name and data as text content. The AI then calls the display tool separately -- that tool returns `structuredContent` and the widget template.

```ts
// 1. Create a display tool (see tools-and-widgets reference for createResource/createTool)
const showPricing = createTool({ resource: pricingUI, /* ... */ });

// 2. Reference the display tool in a flow node via showWidget
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
  .addNode("show_pricing", ({ state, showWidget }) =>
    showWidget(showPricing, {
      data: { postalCode: state.postalCode!, sqm: Number(state.sqm) },
      description: "User must pick a plan.",
      field: "selectedPlan",  // enables auto-skip when already filled
    })
  )
  .addNode("confirm", ({ state }) => ({
    summary: `Selected ${state.selectedPlan} for ${state.postalCode}`,
  }))
  .addEdge(START, "ask_postal")
  .addEdge("ask_postal", "show_pricing")
  .addEdge("show_pricing", "confirm")
  .addEdge("confirm", END)
  .compile();

// 3. Register display tool + flow together
await registerTools(server, [showPricing, flow]);
```

On the client side, use `useToolOutput` to read data and `useSendFollowUp` to communicate selections back. See the widget React hooks reference for details.

## Error Handling

When a node throws or the engine encounters an issue, the response includes `isError: true` at the top level (MCP protocol convention), with `{ "status": "error", "error": "..." }` in the text content.

## Complete Example

Pet insurance quote combining suggestions, validation, multi-question steps, and action nodes:

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
    age: z.number().describe("Age in years"),
    name: z.string().describe("Pet's name"),
    email: z.string().describe("Owner's email"),
  },
})
  .addNode("ask_animal", ({ interrupt }) =>                    // suggestions
    interrupt({ animalType: { question: "Dog or cat?", suggestions: ["Dog", "Cat"] } })
  )
  .addNode("ask_breed", ({ state, interrupt }) =>              // validation + enrichment
    interrupt({ breed: {
      question: "What breed?",
      context: `The user has a ${state.animalType}.`,
      validate: async (breed) => {
        const result = await lookupBreed(state.animalType!, breed);
        if (!result) throw new Error(`Unknown ${state.animalType} breed.`);
        return { breedId: result.id };
      },
    }})
  )
  .addNode("ask_details", ({ interrupt }) =>                   // multiple questions
    interrupt(
      { age: { question: "How old?" }, name: { question: "Pet's name?" } },
      { context: "Ask both naturally." },
    )
  )
  .addNode("ask_email", ({ interrupt }) =>                     // simple validation
    interrupt({ email: {
      question: "Email for the quote?",
      validate: (email) => { if (!email.includes("@")) throw new Error("Invalid email."); },
    }})
  )
  .addNode("generate_quote", async ({ state }) => {            // action node (silent)
    return { quote: await generateQuote({ breedId: state.breedId!, age: state.age! }) };
  })
  .addEdge(START, "ask_animal").addEdge("ask_animal", "ask_breed")
  .addEdge("ask_breed", "ask_details").addEdge("ask_details", "ask_email")
  .addEdge("ask_email", "generate_quote").addEdge("generate_quote", END)
  .compile();

await registerTools(server, [flow]);
```

## Annotations

Pass MCP tool annotation hints to the flow's compiled tool via the `annotations` field in `createFlow`:

```ts
const flow = createFlow({
  id: "lookup",
  title: "Lookup",
  description: "Look up information",
  state: { query: z.string().describe("Search query") },
  annotations: { readOnlyHint: true, idempotentHint: true },
})
```

Supported annotations: `readOnlyHint`, `idempotentHint`, `openWorldHint`, `destructiveHint`.

## Common Mistakes

- **Importing `interrupt` or `showWidget` directly** -- These are NOT exported. Use them from the handler context: `({ interrupt }) => interrupt(...)`.
- **Using the old handler signature** -- Handlers receive a context object, not `(state, meta?)`. Use `({ state }) => ...` not `(state) => ...`.
- **Using the old `interrupt({ question, field })` syntax** -- Use object-key syntax: `interrupt({ fieldName: { question: "..." } })`. Context goes in the second argument.
- **Forgetting `START`/`END` edges** -- Every flow needs `addEdge(START, firstNode)` and `addEdge(lastNode, END)`.
- **Missing display tool registration** -- The display tool must be registered alongside the flow via `registerTools(server, [displayTool, flow])`.
- **Widget callback** -- Use `sendFollowUp` to communicate the user's selection back to the AI.
- **Validate returning an error string** -- `validate` must **throw** an `Error` to signal failure. Return `void` or an object for success.
