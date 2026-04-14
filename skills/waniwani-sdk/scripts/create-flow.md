# Create a Flow

Step-by-step playbook for building a multi-step conversational flow from scratch. Follow each step in order.

## Step 1: Check Prerequisites

Run all checks before proceeding:

```bash
# 1. Check SDK is installed
cat package.json | grep '@waniwani/sdk'

# 2. Check env var is set
grep WANIWANI_API_KEY .env 2>/dev/null || grep WANIWANI_API_KEY .env.local 2>/dev/null

# 3. Check client singleton exists
ls lib/waniwani.ts 2>/dev/null || ls src/lib/waniwani.ts 2>/dev/null
```

### If any check fails:

- **SDK not installed**: Run `bun add @waniwani/sdk` (or npm/pnpm equivalent)
- **No env var**: Ask the user for their API key. Create `.env` with `WANIWANI_API_KEY=wwk_...`
- **No client singleton**: Create `lib/waniwani.ts`:
  ```typescript
  import { waniwani } from "@waniwani/sdk";
  export const wani = waniwani();
  ```

## Step 2: Understand What the User Wants to Build

Ask the user to describe their flow in one sentence. Common patterns:

| Pattern | Example | Key characteristics |
|---------|---------|-------------------|
| **Lead qualification** | "Qualify leads before booking a demo" | Collect email, role, company size, then route |
| **Onboarding** | "Walk new users through account setup" | Sequential questions, some conditional |
| **Quote/pricing** | "Generate a custom insurance quote" | Collect details, validate, compute result |
| **Support triage** | "Route support requests to the right team" | Collect issue type, branch to different paths |
| **Survey/feedback** | "Collect product feedback after a call" | Multiple questions, optional branching |

Based on their description, identify:

1. **What data needs to be collected** (these become state fields)
2. **What order to collect it** (these become nodes + edges)
3. **Are there any branches** (these become conditional edges)
4. **Is validation needed** (e.g., email format, lookup against an API)
5. **Is there a widget step** (e.g., showing a pricing table, a calendar picker)

Present your understanding back to the user as a summary before proceeding:

```
Here's what I'll build:

Flow: "Demo Qualification"
State fields: email (string), role (string), companySize (enum), useCase (string)
Steps:
  1. Ask email (with validation)
  2. Ask role
  3. Ask company size (with suggestions)
  4. Ask use case
  5. Complete -- summarize lead
No branching needed.

Does this look right?
```

## Step 3: Design the State Schema

Create the Zod state schema from the identified fields. Rules:

- Every piece of data the flow collects or computes is a state field
- Use `.describe()` on every field -- this is what the AI sees
- Use `z.enum()` for fields with a fixed set of options
- Use `z.object()` to group related fields (e.g., `driver: { name, license }`)
- Include computed/derived fields too (e.g., `breedId` from a validation lookup)

```typescript
state: {
  email: z.string().describe("Work email address"),
  role: z.string().describe("Role at the company"),
  companySize: z.enum(["1-10", "11-50", "51-200", "200+"]).describe("Company size"),
  useCase: z.string().describe("Primary use case for the product"),
}
```

## Step 4: Design the Node Graph

Map each step to a node. There are three node types:

### Interrupt nodes (ask questions)
```typescript
.addNode("ask_email", ({ interrupt }) =>
  interrupt({ email: { question: "What is your work email?" } })
)
```

### Action nodes (silent, auto-advance)
```typescript
.addNode("analyze_email", ({ state }) => {
  const domain = state.email!.split("@")[1];
  return { isCompanyEmail: !GENERIC_DOMAINS.has(domain) };
})
```

### Widget nodes (show UI)
```typescript
.addNode("show_pricing", ({ state, showWidget }) =>
  showWidget(pricingTool, {
    data: { plan: state.plan },
    field: "selectedPlan",
  })
)
```

Design guidelines:

- **One concern per node.** Don't ask 5 questions in one node unless they're tightly related.
- **Group related questions.** 2-3 related questions in one interrupt is fine (e.g., name + email).
- **Validate at the source.** If a field needs validation, add `validate` on the interrupt -- don't create separate validate/re-ask nodes.
- **Action nodes for computation.** API calls, lookups, formatting -- these are action nodes that auto-advance.

## Step 5: Design the Edges

Connect nodes with edges. Every flow needs:

1. `addEdge(START, firstNode)` -- entry point
2. Edges between consecutive nodes
3. `addEdge(lastNode, END)` -- exit point

For branching:
```typescript
.addConditionalEdge("analyze_email", (state) =>
  state.isCompanyEmail ? "done" : "ask_company"
)
```

Draw the graph mentally or describe it:
```
START -> ask_email -> analyze_email -> [company email? -> done] [personal? -> ask_company -> done] -> END
```

## Step 6: Generate the Flow File

Create the flow file. Naming convention: `lib/<project>/flows/<flow-name>.ts` or `flows/<flow-name>.ts`.

Use this template:

```typescript
import { createFlow, START, END } from "@waniwani/sdk/mcp";
import { z } from "zod";

export const <flowName> = createFlow({
  id: "<flow_id>",
  title: "<Flow Title>",
  description: "<When should the AI trigger this flow? Be specific.>",
  state: {
    // ... state fields from Step 3
  },
})
  // ... nodes from Step 4
  // ... edges from Step 5
  .compile();
```

Important details:

- **`id`**: snake_case, becomes the MCP tool name
- **`description`**: This is what the AI reads to decide when to call the flow. Be specific: "Qualify a lead for a demo. Use when a user asks for a demo, wants to get started, or asks about pricing."
- **`compile()`**: Always call at the end -- it validates the graph and returns a `RegisteredFlow`
- **Export the compiled flow**, not the builder

## Step 7: Register the Flow

Find the MCP server route (usually `app/mcp/route.ts` or similar) and register the flow:

```typescript
import { registerTools } from "@waniwani/sdk/mcp";
import { myFlow } from "../../lib/my-project/flows/my-flow";

// Register alongside existing tools
await registerTools(server, [myFlow, ...existingTools]);
```

If the flow has widget steps, register the display tools too:

```typescript
await registerTools(server, [displayTool, myFlow, ...existingTools]);
```

## Step 8: Test

1. **Start the dev server**: `bun dev` (or equivalent)
2. **Trigger the flow**: In ChatGPT or Claude, say something that matches the flow's description
3. **Walk through all steps**: Answer each question, verify the flow advances correctly
4. **Test edge cases**:
   - Pre-filling: "I want a demo, my email is test@company.com" -- should skip the email question
   - Validation: Enter an invalid value and verify the error message + re-ask
   - Branching: If conditional edges exist, test both paths
5. **Check the dashboard**: Verify events appear at [app.waniwani.ai](https://app.waniwani.ai)

## Common Pitfalls

- **Forgetting START/END edges** -- The graph won't compile without them
- **Importing interrupt/showWidget** -- They come from the handler context, not from imports
- **Description too vague** -- "Handle user requests" is bad. "Qualify leads who want a demo" is good.
- **Not exporting compiled flow** -- Export the result of `.compile()`, not the builder chain
- **State fields missing .describe()** -- The AI needs descriptions to know what each field is for
