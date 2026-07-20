# Instrument tracking on a createFlow app

Read the project's flows, map each node to the Waniwani event taxonomy, insert the tracking calls with metadata sourced from flow state, and verify. The output is a flow where every funnel stage emits exactly the right event, without the user writing a single `track` call.

Hosted reference: [docs.waniwani.ai/sdk/tracking/instrumentation](https://docs.waniwani.ai/sdk/tracking/instrumentation)

## The taxonomy (closed set)

Events are typed and first-class. Never invent a custom event name; model every funnel step with one of these.

| Event | Helper | When it fires | Required data |
|---|---|---|---|
| `tool.called` | automatic via `withWaniwani(server)` | Every tool invocation | none |
| `lead_qualified` | `waniwani?.track.leadQualified({ externalId?, email?, name? })` | The person met your qualification bar | identity only |
| `price_shown` | `waniwani?.track.priceShown({ amount, currency, itemId?, label? })` | You showed one price | `amount`, `currency` |
| `prices_compared` | `waniwani?.track.pricesCompared({ options: [{ id, amount, currency }] })` | You showed 2+ options side by side | `options[]` |
| `option_selected` | `waniwani?.track.optionSelected({ id, amount, currency })` | The user picked one option | `id`, `amount`, `currency` |
| `converted` | `waniwani?.track.converted({ amount, currency, occurredAt? })` | The user became paying | `amount`, `currency` |
| identity | `waniwani?.identify(userId, properties?)` | A stable external id becomes known | `userId` |

`page.viewed`, `chat.*`, and `widget_*` are emitted automatically by the chat widget and widget runtime. Never send them from server code.

## Placement rules

Work these out per flow, in order:

1. **`lead_qualified` fires when the qualification bar is met, not at flow entry.** Place it in the node where qualification completes: after the qualifying questions are answered, after a demo is requested, or after the lead is pushed to a CRM. Emit it exactly once per flow run. A user merely starting the flow is not a qualified lead; `tool.called` already covers activity.
2. **`lead_qualified` metadata comes from flow state.** Fill every property you can:
   - `externalId`: the strongest field. Use the record id your CRM or lead API returns (place the event *after* that push so the id exists).
   - `email` and `name`: map from the state fields that hold them, whatever they are called (`email`, `workEmail`, `contactName`, ...).

   Do **not** add a `source` — `leadQualified` has no acquisition-source property. The origin channel is set automatically on the event envelope.
3. **`identify` as soon as a stable id exists.** The first node where an email or user id is present in state gets `waniwani?.identify(state.email)`. This is the join key for off-platform conversions. Sharing an email is `identify`, not `lead_qualified`.
4. **Price events go where the numbers are.** The node that computes or returns a single price gets `priceShown`. A node that presents multiple plans (usually right before or inside the node feeding a comparison widget) gets `pricesCompared`. The node that runs after the user picked (the selected id is now in state) gets `optionSelected`.
5. **`converted` only on real conversion.** A booking confirmed, a purchase completed, a signup finished inside the flow. If conversion happens later on the customer's own site, do not emit it from the flow; instead make sure `identify` ran, and add a snippet for their backend that calls `client.track.converted({ amount, currency, externalUserId })`.
6. **Emit from node handlers, never from `validate` callbacks.** Action nodes are the natural home. For data collected by an interrupt, emit in the next node that runs after the answer landed in state.
7. **Always guard with `waniwani?.`.** The scoped client is `undefined` when `withWaniwani(server)` was not applied, and tracking throws without `WANIWANI_API_KEY`. Optional chaining keeps keyless and OSS runs working.
8. **Never pass `sessionId` manually inside a flow.** The scoped client (`context.waniwani`) carries session identity automatically.

## Procedure

### Step 1: Inventory

```bash
# Find every flow
grep -rln "createFlow(" src/ server/ lib/ app/ 2>/dev/null

# Is the server wrapped? (required for context.waniwani + tool.called auto-capture)
grep -rn "withWaniwani(" src/ server/ lib/ app/ 2>/dev/null

# Is the key configured? (tracking is free tier)
grep -l "WANIWANI_API_KEY" .env .env.local .env.example 2>/dev/null
```

If `withWaniwani` is missing, add it where the server is created: `withWaniwani(server);` (import from `@waniwani/sdk/mcp`). It is safe without an API key. If no key is configured anywhere, tell the user tracking needs `WANIWANI_API_KEY` (free at [app.waniwani.ai](https://app.waniwani.ai)) and continue; the guarded calls you add will no-op safely once shipped with a key.

### Step 2: Map each flow

For every flow, read the full node graph and build a table: node id, node kind (interrupt / action / widget), which state fields are populated when it runs, and what the node does for the business (asks, computes, presents, confirms). Then assign events using the placement rules above. A typical mapping:

```
START -> welcome (interrupt: email)        -> [identify after answer]
      -> qualify (interrupt: role, size)
      -> push_to_crm (action, returns id)  -> lead_qualified { externalId, email, name }
      -> compute_quote (action)            -> price_shown { amount, currency }
      -> show_plans (widget: 3 options)    -> prices_compared { options }
      -> confirm_plan (action)             -> option_selected { id, amount, currency }
      -> book (action)                     -> converted { amount, currency }
      -> END
```

Not every flow has every stage. A lead-gen flow may end at `lead_qualified`; a support flow may only get `identify`. Never force events onto nodes that do not represent that stage.

### Step 3: Apply

Insert the calls. `waniwani` comes from the node handler context, next to `state` and `interrupt`:

```ts
.addNode({
  id: "push_to_crm",
  label: "Push to CRM",
  run: async ({ state, waniwani }) => {
    const lead = await crm.createLead({ email: state.email, name: state.name });
    waniwani?.track.leadQualified({
      externalId: lead.id,
      email: state.email,
      name: state.name,
    });
    return { leadId: lead.id };
  },
})
```

Do not `await` tracking calls inside hot paths unless the runtime is serverless; the transport batches in the background. In serverless runtimes, pass `flushAfterToolCall: true` to `withWaniwani()` instead of flushing by hand.

### Step 4: Verify

- `bun run typecheck` (or the project's equivalent) passes.
- Exactly one `leadQualified` call per flow, placed at the qualification bar.
- Every call is guarded (`waniwani?.`), and no call passes `sessionId` manually.
- No invented event names; only taxonomy events.
- `withWaniwani(server)` wraps the server.
- Report the final mapping (node -> event -> metadata) back to the user as a table.

## Running as a subagent

Scaffolding playbooks (for example the Waniwani `initialize` playbook) invoke this playbook as a follow-up step once a flow exists. Spawn a subagent with this prompt, adjusted for the project root:

```
Follow the waniwani-sdk skill's instrument-tracking reference
(references/instrument-tracking.md) to instrument Waniwani funnel events across
every createFlow app in this project. Inventory the flows, map nodes to the event
taxonomy, insert guarded track calls with metadata from flow state (lead_qualified
with externalId/email/name/source where the qualification bar is met), ensure
withWaniwani(server) wraps the server, run typecheck, and report the node -> event
mapping you applied.
```

The subagent needs write access to the project and nothing else; tracking keys are not required to apply the instrumentation.

## Common mistakes

- **`lead_qualified` at flow entry.** Entering a funnel is not qualifying. Use the node where your bar is met.
- **Emitting from `validate` callbacks.** Validation can run multiple times per answer; you get duplicate events.
- **Unguarded calls.** `waniwani.track...` without `?.` crashes keyless runs; inside a node handler that throw fails the whole tool call.
- **Passing `sessionId` inside a flow.** The scoped client already carries it; a manual value can mis-attribute the event.
- **Custom event names.** The taxonomy is closed. `track({ event: "my_step" })` is rejected by the types.
- **`converted` for "reached the last node".** Finishing a conversation is not revenue. Only emit on actual purchase/booking, or from the customer's backend with `externalUserId`.
- **Adding `source` to `lead_qualified`.** There is no acquisition-source property (`source: "mcp_chat"` is wrong). `leadQualified` takes only `externalId`, `email`, and `name`; the origin channel is stamped on the envelope automatically.
