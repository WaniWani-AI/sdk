# Initialize MCP Distribution

Step-by-step playbook for initializing a new MCP distribution project from the WaniWani template. Gathers context about the user's business, brand, and use case, then scaffolds a production-ready conversational flow with widgets.

## Step 1: Gather Context (Interactive)

Ask the following questions **one at a time**. After each answer, move to the next question immediately.

### 1a. Website

> *"What's your website URL? I'll pull your branding (colors, logo, tone) from there so the widgets match your brand."*

**As soon as the user provides a URL**, launch a **background agent** to:
- Visit the website and take screenshots
- Extract: primary/accent colors, logo URL, fonts, brand tone (formal/casual/playful), tagline
- Look at navigation structure for product/service categories
- Check for existing pricing pages, quote forms, or booking flows
- Note any relevant API endpoints or integrations visible in the page source

Do NOT wait for this agent to finish. Move to the next question immediately.

### 1b. Use Case

> *"What do you want to build? Here are some common patterns:*
>
> - **Quote / pricing flow** -- Collect requirements, calculate a price, present options (e.g. insurance quotes, SaaS pricing)
> - **Booking / scheduling** -- Walk through availability, preferences, then confirm a booking (e.g. lessons, appointments, demos)
> - **Lead qualification** -- Ask qualifying questions, then route or capture the lead (e.g. demo requests, contact forms)
> - **Product comparison** -- Help users compare options and pick the right one (e.g. plans, products, services)
> - **Onboarding wizard** -- Guide new users through setup steps (e.g. account config, preference selection)
> - **Support triage** -- Diagnose an issue and route to the right resource or team
>
> *Or describe your own -- what's the journey you want your users to go through?"*

Based on their answer, identify:
- **What data needs to be collected** (these become flow state fields)
- **What steps the user goes through** (these become flow nodes)
- **Are there any decision points** (these become conditional edges)
- **What should the user see** (these become widgets)
- **What's the end goal** (booking confirmation, quote display, lead capture, etc.)

### 1c. Data Source

Ask this only if the use case involves pricing, product data, or external information:

> *"Do you have an API for [pricing/products/availability/etc.] we can integrate, or should I mock realistic data for now so you can swap in the real API later?"*

If they have an API:
- Ask for the base URL and any docs/examples
- Ask if authentication is needed (API key, OAuth, etc.)

If mocking:
- Confirm you'll create realistic mock data based on their website and use case
- Structure the mock so it's easy to replace with a real API call later

### 1d. Customer Profile (if relevant)

If the use case involves personalization or qualification, ask:

> *"Who are your typical customers? (e.g. individuals, small businesses, enterprises) What are the key factors that determine what they need?"*

This helps design smart branching in the flow.

## Step 2: Design the Flow (Present to User)

Before writing any code, present a summary of what you'll build:

```
Here's what I'll create:

Project: {project-name}
Brand: {colors, tone from website}

Flow: "{Flow Title}"
  Steps:
    1. Welcome -- greet user, understand their need
    2. {step} -- collect {fields}
    3. {step} -- collect/validate {fields}
    4. {widget step} -- show {widget description}
    5. {final step} -- show {confirmation/result}

Widgets:
  - {widget-name} -- {what it displays}
  - {widget-name} -- {what it displays}

Data: {API integration / mocked with realistic data}

Does this look right? Anything you'd change?
```

Wait for confirmation before proceeding.

## Step 3: Set Up the Project

### 3a. Update package.json

Replace the project name:

```bash
# In package.json, update "name" to the project name (kebab-case)
```

### 3b. Set up .env

```bash
cp .env.example .env
```

Ask the user for their `WANIWANI_API_KEY` and update `.env`.

### 3c. Install dependencies

```bash
bun install
```

## Step 4: Remove Demo Content

Delete the reference implementation (Alpine ski lessons):

```bash
rm -rf server/src/journey/
```

Clear out `server/src/app.ts` to a clean starting point (keep the imports and server setup, remove all widget/tool registrations and the ski-lessons flow).

Delete the demo widget components:

```bash
rm web/src/widgets/select-lesson-plan.tsx
rm web/src/widgets/ski-pass-confirmation.tsx
```

Clear `web/src/index.css` to a minimal reset (keep the file, remove all lesson/ski-pass styles).

## Step 5: Scaffold the Flow

Create the flow file at `server/src/journey/index.ts` (or a more descriptive name like `server/src/quote-flow/index.ts`).

**Flow structure:**

```typescript
import { createFlow, START, END } from "@waniwani/sdk/mcp";
import { z } from "zod";

export const {flowName} = createFlow({
  id: "{flow_id}",
  title: "{Flow Title}",
  description: "{When should the AI trigger this? Be specific and action-oriented.}",
  state: {
    // All data the flow collects or computes
    // Every field needs .describe() -- this is what the AI reads
  },
})
  .addNode("welcome", ({ interrupt }) =>
    // Open-ended welcome that extracts initial info from the user's message
    interrupt({
      field1: { question: "...", context: "..." },
      field2: { question: "...", context: "..." },
    })
  )
  // ... additional nodes for each step
  .addNode("show_{widget}", ({ state, showWidget }) =>
    showWidget({widgetTool}, {
      data: { /* widget props from state */ },
      field: "{fieldToUpdate}",
      description: "...",
    })
  )
  .addEdge(START, "welcome")
  // ... edges connecting all nodes
  .addEdge("{lastNode}", END)
  .compile();
```

**Design principles for a top-tier flow:**

1. **Open-ended welcome** -- The first node should be conversational. Use `context` in interrupts to tell the AI what info to extract from the user's initial message, rather than asking robotic questions.
2. **Gather in batches** -- Group related fields in a single interrupt node (e.g. ask about the pet's name, breed, and age together).
3. **Validate early** -- If a field needs validation (API lookup, format check), do it in a processing node right after collection. Return errors via state so the flow can re-ask.
4. **Show, don't tell** -- Use widgets for any step where visual presentation matters (pricing comparison, confirmation, summaries). A widget step is always more compelling than text.
5. **Smart defaults** -- Pre-fill state from context when possible. If the user says "I need insurance for my golden retriever Max", extract all three fields from that one message.

### If mocking data

Create `server/src/journey/utils.ts` (or `server/src/{flow-name}/data.ts`) with realistic mock data:

```typescript
// Mock data -- replace with real API calls
export const MOCK_PLANS = [
  { id: "basic", name: "Basic", price: 29, features: [...] },
  { id: "premium", name: "Premium", price: 59, features: [...] },
];

// Deterministic selection for consistent demo experience
export function pick<T>(list: T[], seed: string): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return list[Math.abs(hash) % list.length];
}
```

Use data from the user's website to make mocks realistic (real product names, realistic prices, actual feature lists).

### If integrating a real API

Create `server/src/{flow-name}/api.ts`:

```typescript
const API_BASE = process.env.{SERVICE}_API_URL;
const API_KEY = process.env.{SERVICE}_API_KEY;

export async function fetchPricing(params: PricingParams): Promise<PricingResult> {
  const res = await fetch(`${API_BASE}/pricing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

Add the env vars to `.env` and `.env.example`.

## Step 6: Scaffold Widgets

For each widget, create a component in `web/src/widgets/`.

### Widget component -- `web/src/widgets/{widget-name}.tsx`

```tsx
import { useToolInfo } from "@/helpers";
import { useOpenExternal } from "@waniwani/sdk/mcp/react";

export default function {WidgetName}() {
  const data = useToolInfo<"{widget-id}">();
  const openExternal = useOpenExternal();

  if (!data) return null;

  return (
    <div className="{widget-name}">
      {/* Widget UI */}
    </div>
  );
}
```

**Key points:**
- Use `useToolInfo<"{widget-id}">()` from `@/helpers` for type-safe data access (not `useToolOutput` -- this is skybridge, not raw SDK)
- Use `useOpenExternal()` for external links
- All styling goes in `web/src/index.css`

### Widget styles -- `web/src/index.css`

Style widgets using plain CSS with custom properties for brand colors:

```css
:root {
  --brand-primary: {extracted-primary-color};
  --brand-accent: {extracted-accent-color};
  --brand-text: {extracted-text-color};
  --brand-bg: {extracted-bg-color};
}

.{widget-name} {
  /* Widget-specific styles */
  font-family: system-ui, sans-serif;
  padding: 1rem;
}
```

Apply the brand colors and tone extracted from the user's website by the background agent.

## Step 7: Register Everything in `server/src/app.ts`

Wire up the flow and widgets:

```typescript
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withWaniwani } from "@waniwani/sdk/mcp";
import { z } from "zod";
import { {flowName} } from "./journey/index.js";

const server = new McpServer(
  { name: "{project-name}", version: "0.1.0" },
  { capabilities: { logging: {} } },
);

// Register widgets
server.resource(
  "{widget-id}",
  "ui://widgets/{widget-id}",
  { mimeType: "text/html" },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/html", text: "" }],
  }),
);

// Register widget display tools
server.tool(
  "{widget-id}",
  "{Widget description for the AI}",
  { /* input schema */ },
  async (args) => ({
    structuredContent: {
      uiHint: "open",
      content: [{ type: "resource", resource: { uri: "ui://widgets/{widget-id}" } }],
      data: args,
    },
    content: [{ type: "text", text: "{text summary}" }],
  }),
);

// Register flow
server.tool({flowName}.id, {flowName}.description, {flowName}.inputSchema, {flowName}.handler);

// Apply tracking
withWaniwani(server);

export { server };
export type AppType = typeof server;
```

## Step 8: Update Helpers

Ensure `web/src/helpers.ts` exports typed helpers:

```typescript
import { generateHelpers } from "skybridge/web";
import type { AppType } from "../../server/src/index.js";

export const { useToolInfo } = generateHelpers<AppType>();
```

This provides type-safe `useToolInfo<"widget-id">()` hooks that auto-complete widget names and infer data types.

## Step 9: Build and Test

```bash
# Build
bun run build:alpic

# Start dev server
bun run dev
```

Test the flow:
1. Open the skybridge dev UI at `http://localhost:3000`
2. Trigger the flow by describing the use case naturally
3. Walk through each step, verify widgets render correctly
4. Check branding matches the user's website
5. Verify the WaniWani dashboard receives events at [app.waniwani.ai](https://app.waniwani.ai)

## Step 10: Print Summary

After completing all steps, print:
- The project name
- Brand colors and assets applied
- Flow structure (nodes and edges)
- Widgets created
- Data source (mocked or API-integrated)
- How to run: `bun run dev`
- How to deploy: Alpic (`alpic deploy`) or Vercel (`vercel`)
- Next steps: refine the flow, add more widgets, connect real APIs

## Important Notes

- **This template uses skybridge**, not Next.js. Widgets live in `web/src/widgets/`, server code in `server/src/`.
- **Use `useToolInfo<"name">()`** from `@/helpers` for widget data, not `useToolOutput` from the SDK directly.
- **No `WidgetProvider` needed** -- skybridge handles widget lifecycle automatically.
- **Styles go in `web/src/index.css`** -- plain CSS with custom properties, no Tailwind.
- **`server/src/index.ts`** must export `AppType` for typed widget helpers to work.
- **Brand extraction runs in the background** -- use the results when scaffolding widgets and CSS.
- **Mock data should be realistic** -- use actual product names, prices, and features from the user's website.
