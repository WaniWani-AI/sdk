# Flows API Reference

Pure API reference for `@waniwani/sdk/mcp` flows. For narrative guide and examples, see [flows.md](flows.md).

## createFlow(config)

Creates a new `StateGraph`. The state type is automatically inferred from the `state` definition -- no explicit generic needed.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | MCP tool name |
| `title` | `string` | yes | Display title |
| `description` | `string` | yes | Tells the AI when to use this flow |
| `state` | `Record<string, z.ZodType>` | yes | State schema. Values are Zod schemas with `.describe()`. Use `z.object()` for grouped nested fields (1 level max). |

```ts
import { createFlow } from "@waniwani/sdk/mcp";
import { z } from "zod";

const flow = createFlow({
  id: "signup",
  title: "Signup",
  description: "Sign up for a new account",
  state: {
    country: z.string().describe("Country the business is based in"),
    status: z.enum(["registered", "unregistered"]).describe("Registration status"),
  },
});
```

## StateGraph Methods

All methods return `this` for chaining (except `compile` and `graph`).

| Method | Signature | Description |
|--------|-----------|-------------|
| `addNode` | `(name: string, handler: NodeHandler<TState>)` | Add a node. Handler receives `{ state, meta, interrupt, showWidget }`. Return `interrupt(...)`, `showWidget(...)`, or a plain object. |
| `addEdge` | `(from: string, to: string)` | Static edge. `START` and `END` are valid values. |
| `addConditionalEdge` | `(from: string, condition: (state) => string)` | Dynamic routing. `condition(state)` returns the next node name. TypeScript enforces the return type matches registered node names. |
| `compile` | `(options?: { store?: FlowStore })` | Validate graph, return a `RegisteredFlow`. |
| `graph` | `()` | Returns a Mermaid `flowchart TD` string. Also available on the compiled `RegisteredFlow`. Conditional edges render as dashed arrows. |

## interrupt(fields, config?)

Available on the handler context, not as a direct import. Pauses the flow and asks the user one or more questions.

```ts
interrupt(fields, config?)
```

- **`fields`** -- object where each key is a state field path (flat like `"email"` or dot-path like `"driver.name"`), each value is a question config
- **`config`** -- optional second argument

### Field Properties

Each value in the `fields` object:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `question` | `string` | yes | The question to ask the user |
| `validate` | `(value: TState[F]) => Partial<TState> \| void` | no | Validation function. **Throw** to reject (clears field, re-asks with error in context). Return object to enrich state. Return void to accept as-is. Can be async. |
| `suggestions` | `string[]` | no | Suggested answers shown to the user |
| `context` | `string` | no | Hidden AI instructions for this specific question |

### Config Properties

The optional second argument to `interrupt()`:

| Property | Type | Description |
|----------|------|-------------|
| `context` | `string` | Overall hidden AI instructions across all questions in this interrupt |

### Examples

```ts
// Single question
interrupt({ email: { question: "What's your email?" } })

// With validation
interrupt({
  breed: {
    question: "What breed?",
    validate: async (breed) => {
      const result = await lookup(breed);
      if (!result) throw new Error("Unknown breed.");
      return { breedId: result.id };
    },
  },
})

// Multiple questions with context
interrupt(
  {
    name: { question: "Your name?" },
    email: { question: "Your email?" },
  },
  { context: "Ask both naturally in one message." },
)

// Nested state with dot-path
interrupt({
  "driver.name": { question: "Driver's name?" },
  "driver.license": { question: "License number?" },
})
```

## showWidget(tool, config)

Available on the handler context, not as a direct import. Pauses the flow and instructs the AI to call a display tool.

```ts
showWidget(tool, config)
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `tool` | `RegisteredTool \| string` | yes | The display tool (from `createTool()`) or its id as a string |
| `data` | `Record<string, unknown>` | yes | Data to pass to the display tool |
| `field` | `FieldPaths<TState>` | no | State field this widget fills. Enables auto-skip when already in state. Supports dot-paths for nested state. |
| `description` | `string` | no | Description for the AI (what the widget does, what user should do) |
| `interactive` | `boolean` | no | Set to `false` for display-only widgets that auto-advance. Defaults to `true`. |

```ts
.addNode("show_pricing", ({ state, showWidget }) =>
  showWidget(showPricing, {
    data: { postalCode: state.postalCode!, sqm: Number(state.sqm) },
    description: "User must pick a plan.",
    field: "selectedPlan",
  })
)
```

## FlowStore Interface

Interface for server-side flow state persistence. Implement this to use a custom store instead of the default WaniWani API store.

```ts
import type { FlowStore } from "@waniwani/sdk/mcp";

interface FlowStore {
  get(key: string): Promise<FlowTokenContent | null>;
  set(key: string, value: FlowTokenContent): Promise<void>;
  delete(key: string): Promise<void>;
}
```

`FlowTokenContent` shape:

```ts
type FlowTokenContent = {
  step?: string;
  state: Record<string, unknown>;
  field?: string;
  widgetId?: string;
};
```

### WaniwaniFlowStore

Default API-backed store. Reads `WANIWANI_API_KEY` and `WANIWANI_API_URL` from env vars. No constructor arguments. Throws if `WANIWANI_API_KEY` is not set.

```ts
import { WaniwaniFlowStore } from "@waniwani/sdk/mcp";

// Used automatically by compile() -- zero config
const flow = createFlow({ ... }).compile();

// Or pass explicitly
const flow = createFlow({ ... }).compile({ store: new WaniwaniFlowStore() });
```

### Custom Store

```ts
import type { FlowStore, FlowTokenContent } from "@waniwani/sdk/mcp";

class RedisFlowStore implements FlowStore {
  async get(key: string): Promise<FlowTokenContent | null> { /* ... */ }
  async set(key: string, value: FlowTokenContent): Promise<void> { /* ... */ }
  async delete(key: string): Promise<void> { /* ... */ }
}

const flow = createFlow({ ... }).compile({ store: new RedisFlowStore() });
```

## Other Exports

| Export | Type | Description |
|--------|------|-------------|
| `START` | `"__start__"` | Sentinel for the first edge: `addEdge(START, "first_node")` |
| `END` | `"__end__"` | Sentinel for the last edge: `addEdge("last_node", END)` |
| `registerTools` | `function` | Register tools and flows on an MCP server: `registerTools(server, [tool, flow])` |
| `WaniwaniFlowStore` | `class` | Default API-backed state store (see above) |
| `FlowStore` | `interface` | Interface for custom store implementations |
| `RegisteredFlow` | `type` | Compiled flow returned by `compile()`. Has `name`, `config`, `handler`, `register`, and `graph`. |
| `NodeContext<TState>` | `type` | Context object passed to node handlers: `{ state, meta, interrupt, showWidget }` |
| `InferFlowState<T>` | `type` | Utility type to extract the runtime state type from a flow's state schema |
| `StateGraph` | `class` | The builder class returned by `createFlow()`. Exposes `addNode`, `addEdge`, `addConditionalEdge`, `compile`, `graph`. |
| `createFlowTestHarness` | `function` | Test utility for running flows in tests without an MCP server |
