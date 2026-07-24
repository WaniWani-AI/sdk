---
name: audit-tracking
description: "Audit Waniwani event tracking across an MCP project. Does an in-depth overview check of the whole app (server, flows, tools, widgets, chat embed), verifies that only events defined in the Waniwani taxonomy are sent, and identifies missing events worth adding at each funnel stage (identify, lead_qualified, price_shown, prices_compared, option_selected, converted). Trigger when the user wants to audit tracking, check event coverage, find missing funnel events, verify events are valid, or review the instrumentation of an MCP built with @waniwani/sdk."
metadata:
  author: Waniwani
---

# Audit tracking on a Waniwani MCP app

Read the whole project, inventory every tracking call on every surface, verify each event against the defined taxonomy, map the funnel, and report the gaps. The output is a report, not code changes: what is wrong, what is missing, and exactly where each missing event belongs. To apply fixes afterwards, use the `instrument-tracking` skill.

## Source of truth: fetch the live docs first

Event definitions evolve. Before auditing, fetch these pages and treat them as the latest definitions; where they disagree with this file, the docs win:

- [docs.waniwani.ai/sdk/tracking/events](https://docs.waniwani.ai/sdk/tracking/events): the full event catalog and the definition of a qualified lead
- [docs.waniwani.ai/sdk/tracking/instrumentation](https://docs.waniwani.ai/sdk/tracking/instrumentation): placement rules per funnel stage
- [docs.waniwani.ai/sdk/tracking/identify](https://docs.waniwani.ai/sdk/tracking/identify): identify semantics
- [docs.waniwani.ai/sdk/reference/event-schema](https://docs.waniwani.ai/sdk/reference/event-schema): typed property shapes

Also read the taxonomy the *installed* SDK version actually accepts, since that is what typechecks in the project:

```bash
bun -e "import { EVENT_TYPES } from '@waniwani/sdk'; console.log(EVENT_TYPES)"
```

If the installed list differs from the docs (older SDK), audit against the docs and flag the version gap as a finding: the project should upgrade (see the changelog at [docs.waniwani.ai/sdk/changelog](https://docs.waniwani.ai/sdk/changelog)).

## The taxonomy (closed set)

Snapshot for orientation; the docs pages above are authoritative.

| Event | Sent by | When |
|---|---|---|
| `page.viewed` | chat widget, automatic | Visitor lands on a page with the widget |
| `session.started` | Waniwani backend, automatic | First time a session id is seen |
| `tool.called` | `withWaniwani(server)`, automatic | Every tool invocation |
| `widget_render` | `useWaniwani()`, automatic | A widget initialized |
| `user.identified` | `identify(userId, properties?)` | A stable identity became known |
| `lead_qualified` | `track.leadQualified({ externalId?, email?, name? })` | The handoff happened (definition below) |
| `price_shown` | `track.priceShown({ amount, currency })` | One price shown |
| `prices_compared` | `track.pricesCompared({ options })` | 2+ options shown side by side |
| `option_selected` | `track.optionSelected({ id, amount, currency })` | The user picked one option |
| `converted` | `track.converted({ amount, currency, occurredAt? })` | The user became paying |
| `link.clicked` | generic `track({ event: "link.clicked" })` | An outbound link was followed |

Anything else is invalid. There is no custom event name.

## The two definitions that decide most findings

**A lead is qualified when the conversation produces a concrete handoff toward the business.** That means the user:

- is redirected to the business's pricing page or own website,
- books a call or a meeting,
- is sent an email (quote recap, follow-up, booking confirmation),
- or meets an explicit qualification bar the business defined.

`lead_qualified` belongs at that handoff: the flow node that pushes the lead to a CRM or sends the email, or the widget callback right before `openExternal(...)` to the business's domain. Once per flow run.

**Identified is not qualified.** When the app learns an email, a phone number, or a first and last name, that is `identify(userId, properties?)`: it attaches identity to the session and is the join key for later attribution. It does not make the lead qualified. Most funnels emit both, at different moments.

## Procedure

### Step 1: Inventory the app

Build a picture of the whole MCP before judging anything:

```bash
# Surfaces and entry points
grep -rn "withWaniwani(" --include="*.ts" --include="*.tsx" src/ server/ api/ lib/ app/ web/ 2>/dev/null
grep -rn "createFlow(\|registerTool\|createTool(" --include="*.ts" src/ server/ lib/ app/ 2>/dev/null
grep -rn "useWaniwani\|WaniWani.chat\|createFrontendClient" --include="*.ts" --include="*.tsx" src/ web/ app/ 2>/dev/null
grep -rn "@waniwani/sdk" package.json */package.json 2>/dev/null
```

Record: SDK version, whether `withWaniwani(server)` wraps the server (with which options), every flow and its node graph, every tool, every widget, and which `useWaniwani` entry each widget imports. On skybridge hosts the import must be `@waniwani/sdk/mcp/react/skybridge`; the plain `@waniwani/sdk/mcp/react` entry called bare is a silent no-op, so a wrong import means every widget event silently drops.

### Step 2: Collect every tracking call

```bash
grep -rn "track\.\(leadQualified\|priceShown\|pricesCompared\|optionSelected\|converted\)\|track(\s*{\|identify(" \
  --include="*.ts" --include="*.tsx" src/ server/ web/ api/ lib/ app/ 2>/dev/null

# Custom markers that look like tracking but are not read by the SDK
grep -rn "data-ww-\|dataset\.ww" --include="*.tsx" --include="*.ts" src/ web/ 2>/dev/null
```

For each call record: file:line, surface (flow node / tool handler / widget / chat host page / backend), event name, payload, and guard style.

### Step 3: Verify only defined events are used

Every event name must be in the fetched catalog. Flag as a **violation**:

- **Undefined event names** in generic `track({ event: ... })`. Includes events removed from the taxonomy in older code (for example `quote.requested`, `quote.succeeded`, `quote.failed`, `purchase.completed`; the changelog documents their replacements).
- **Auto-emitted events sent manually**: `page.viewed`, `session.started`, `tool.called`, `widget_render`, `chat.*`. These come from the widget, the wrapper, or the backend; sending them from code double-counts.
- **Bespoke tracking vocabularies outside the SDK**: `data-ww-*` DOM attributes, hand-rolled event constants, or posts to the events endpoint with invented names. The SDK does not read DOM attributes; these are dead markers or a shadow taxonomy, and every one must map to a real event or be removed.
- **Typos in payload keys** (compare against the property interfaces in the event schema page).

Flag as a **risk**:

- Unguarded scoped calls (`waniwani.track...` without `?.`) in code that must also run keyless.
- Manual `sessionId` passed inside a flow, tool handler, or widget (the surface already carries it).
- `useWaniwani` imported from the wrong entry for the host.
- More than one `leadQualified` reachable in a single flow run, or one placed at flow entry.
- Top-level client calls with no identity (`externalUserId` / `sessionId` / `visitorId`).

### Step 4: Map the funnel and find missing events

For each flow, build the node graph: node id, what it does for the business, which state fields exist when it runs, and which events it emits. Do the same for widgets (props in, callbacks out). Then walk the stages and note every gap:

| Look for | Missing event |
|---|---|
| Redirect to the business's site or pricing page (`openExternal`, redirect widget, CTA link to their domain) with no `lead_qualified` right before it | `lead_qualified` |
| A call/meeting booked, or an email sent to the user, with no `lead_qualified` | `lead_qualified` |
| Email, phone, or first+last name collected (interrupt fields, forms, widget inputs) with no `identify` once it is in state | `identify` |
| A single price computed or displayed with no `price_shown` | `price_shown` |
| A comparison table or multi-option widget with no `prices_compared` | `prices_compared` |
| The user picks one option (selection lands in state or a select callback fires) with no `option_selected` | `option_selected` |
| An on-platform purchase, booking, or signup completing with no `converted` | `converted` |
| Conversion happens later on the business's own site, and no `identify` ran during the funnel (no join key for an off-platform `converted`) | `identify` + backend `converted` snippet |
| Outbound links worth measuring with no `link.clicked` | `link.clicked` (optional) |

Also check `withWaniwani` options: serverless runtimes should pass `flushAfterToolCall: true`, and long-lived processes should not.

Not every flow has every stage. A lead-gen flow can legitimately end at `lead_qualified`; a support flow may only ever `identify`. Only report a gap where the business moment actually happens in the code.

### Step 5: Report

Produce a single report with these sections, most severe first:

1. **Violations** (undefined events, manual auto-events, shadow taxonomies, typos): file:line, what, why, fix.
2. **Risks** (guards, wrong entry, manual sessionId, duplicate leadQualified): file:line, what, why, fix.
3. **Funnel coverage map**: one table per flow, `node/widget -> event emitted -> payload`, with auto-captured events included, so the current funnel is visible at a glance.
4. **Missing events**: table of `where (file:line or node) -> event to add -> suggested payload from available state`, each justified by the definitions above.
5. **Verdict**: is the funnel measurable end to end (landing -> identity -> qualification -> steps -> conversion), and the top 3 changes by impact.

Do not edit code. If the user wants the gaps filled, run the `instrument-tracking` skill next; this report is its input.

## Common findings from real audits

- **A comparison widget renders N tariffs/plans but nothing emits `prices_compared`, and the pick emits nothing** while a dead `data-ww-conversion="tariff-selected ..."` attribute sits on the button. The attribute maps to `option_selected`; the render maps to `prices_compared`.
- **Contact details collected in-flow with no `identify`**, so a later off-platform conversion has no join key.
- **`lead_qualified` fired on redirect to the business's domain is correct** and is the most common right placement: a helper around `openExternal` that checks the target host is a clean pattern.
- **`leadQualified()` called with an empty payload** when `externalId`, `email`, or `name` are sitting in state: valid, but weak dedup. Fill what exists.
- **Pre-0.18 event names (`quote.*`, `purchase.completed`) still in code** after an SDK upgrade: replace per the changelog codemod (`quote.succeeded` becomes `track.priceShown`, `purchase.completed` becomes `track.converted`).

## Running as a subagent

Spawn a read-only subagent with this prompt, adjusted for the project root:

```
Follow the audit-tracking skill (skills/audit-tracking/SKILL.md, or the installed
audit-tracking skill) to audit Waniwani event tracking across this MCP project.
Fetch the live event definitions from docs.waniwani.ai/sdk/tracking/events and
docs.waniwani.ai/sdk/tracking/instrumentation first. Inventory every surface,
collect every tracking call, verify only defined taxonomy events are used, map
each flow's funnel, and report violations, risks, the coverage map, and missing
events with suggested payloads. Do not modify any file.
```
