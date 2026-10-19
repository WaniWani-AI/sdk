---
name: migrate-waniwani-sdk-0.24-to-0.25
description: "Migrate a project from @waniwani/sdk 0.24.x, or straight from 0.23.x, to 0.25.x. 0.25 removes the asked-only gate: the first question or widget lists every state field in `fields`, and any call writes a declared field whose value fits its Zod schema, so the flow skips the questions it fills. Computed values (price, eligibility result, policy number, lookup id, vehicle version) must move out of `state` into a store keyed by `ctx.sessionId`. Consents, attestations, health answers and must-see widget picks need `neverPrefilled()`. Covers guarded computed values (`state.x ?? lookup()`), dropping 0.24 silent-question workarounds, the createFlowTestHarness change and `nextStep` snapshots. Trigger when the user is on 0.24.x or 0.23.x and wants 0.25, or after bumping sees a consent question or must-see widget skipped, a lookup skipped, a computed field holding a value the model sent, or tests that expect an early value to be ignored fail."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.24 → 0.25

A self-contained migration for the hop to `0.25.x`. It covers projects on `0.24.x`, and projects on `0.23.x` that skip 0.24. For other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.24.x` or `@waniwani/sdk@0.23.x`. On 0.23.x, do not run the `migrate-waniwani-sdk-0.23-to-0.24` skill first. Read "Starting from 0.23" below, then run this procedure. On an older version, migrate up to 0.23 first. If the project is already on 0.25 and its flows were written for 0.24, run the procedure anyway: almost all of this hop is invisible to `tsc`, and a flow can compile on 0.25 while the model fills its consent questions.

Projects with no `createFlow` call have nothing to migrate. Bump the dependency, run the completion check, and stop.

To see which write rule the installed SDK runs:

```bash
grep -rhoE 'takes fields the flow (listed in `fields` or )?has asked' node_modules/@waniwani/sdk/dist | sort -u
```

`takes fields the flow has asked` is 0.24 (asked-only gate). ``takes fields the flow listed in `fields` or has asked`` is 0.25. No output is 0.23 or older.

## What 0.25 changes

In 0.24 a call wrote only the fields the run had asked through an interrupt question or a widget's `field`. The model never saw a field name before its question, so it could not send what the user had already said, and a field no question asks could never be set from the conversation. That gate also kept the conversation away from fields the flow computes for itself.

In 0.25 the session's first `interrupt` or `widget` response carries `fields`: every state field with its type, enum values and description, keyed the way `stateUpdates` takes them (members of a `z.object` group as dot-paths such as `driver.name`). It goes out once per conversation, through the flow's internal state, the same way `intro` does. `tools/list` still names no field.

The write rule for every call (`start`, `continue`, `reset`):

- The answer to a field the run has asked is written as sent.
- Any other declared field, or group member, is written when its value passes the field's Zod schema. The flow then skips the question or widget that would ask it. Validators on that question run when the flow reaches the node.
- A value that fails its schema, or a key the state does not declare, is dropped.
- A field marked `neverPrefilled()` is left out of `fields` and takes a value only once the run has asked it.

The result: **everything in `state` is visible to the model and writable from the conversation.** A value the model must never set has to leave `state`. Nodes get `ctx.sessionId`, the id the flow's own record is stored under, so they can key their own `KvStore` by it. Always add a prefix (`quote:${sessionId}`): the flow stores its own record under the bare id, and a store that shares its key space overwrites the flow state.

Breaking, and visible to `tsc`: nothing. `neverPrefilled` and `ctx.sessionId` are new and optional.

Breaking, and not visible to `tsc`:

| Call | 0.24 | 0.25 |
| --- | --- | --- |
| `start` with `stateUpdates` | Ignored | Each declared field that fits its schema is written, and the flow skips its question |
| `continue` with a field not asked yet | Dropped | Written if it fits its schema |
| Any call with a field no question or widget asks | Dropped | Written if it fits its schema |
| Any call with a field a node computes | Dropped | Written if it fits its schema. A node that keeps an existing value (`state.x ?? compute()`) keeps the model's value |
| Any call with a consent or a widget pick | Dropped until asked | Written if it fits its schema, so the question or widget is skipped. Use `neverPrefilled()` |
| `reset` with no accepted field | Error: `Nothing to correct: "reset" takes fields the flow has asked for.` | Same error, new text: ``Nothing to correct: "reset" takes fields the flow listed in `fields` or has asked for.`` |

Other behavior changes:

- **`nextStep` text.** The first question or widget gets a paragraph on `fields`, and every interrupt tells the model to also send listed fields the user stated. Snapshot tests of it change.
- **Output schema.** `flowOutputSchema` has a new optional `fields` property. Snapshot tests of the tool definition change.
- **`createFlowTestHarness`.** `start(intent, known)` sends `known` as `stateUpdates` on `start`, then answers each question whose field `known` still holds (a `neverPrefilled()` field, or a value that failed its schema) with a `continue`. A value in `known` for a field no question asks is written now, where 0.24 ignored it.
- **Hand-set `_meta._flowGraph`.** Still deprecated, and still read: 0.25.0 did not remove it. `withWaniwani` moves it off the wire. Delete it anyway (see "Hand-set `_meta._flowGraph`").
- **Held answers.** The hold for answers given before their question (WAN-1464) was merged after 0.24.2 and removed before 0.25.0. No release shipped it. No action.
- **Sessions in flight.** A 0.24 record keeps its `asked` list and follows the new rule on its next call. It never gets `fields`, because its internal state was seeded before 0.25, so the model in that conversation only learns field names from each question. A 0.23 record has no `asked`, so its next call merges everything once. No action.

- **`tools/list`.** The input schema still names no field. Only the `stateUpdates` description text changes, from "Answers to the flow's questions, keyed by the `field` each response names" to "Values for the flow's fields, keyed by the field names its responses give". Snapshot tests of the listing change.

**Untouched:** node handlers and their return values (a value a node returns always writes state), the `interrupt` and `showWidget` signatures, validators, `redacted()`, `intro` and widget `data`.

## Starting from 0.23

The 0.24 skill rewrites model-inferred fields into questions or nodes, because 0.24 dropped any field no question asks. 0.25 writes those fields again, so that work is wasted. Skip the 0.24 skill. Apply only these parts of the 0.24 hop, then run the procedure below:

- **`_meta._flowGraph` reads.** 0.24 retyped `flow.config._meta` as `Record<string, unknown>`, so `flow.config._meta._flowGraph.nodes` fails to compile. Read `flow.flowGraph` (see "Hand-set `_meta._flowGraph`").
- **`tools/list` assertions.** The listing names no state field since 0.24: `stateUpdates` is an untyped record, and `_meta` sends no graph. Rewrite the assertions as in rewrite 4.
- **"Send X on start" text.** Delete sentences in the flow `description` or a field's `.describe()` that tell the model to send a field on `start`. The model reads field names from `fields` on the first question now, and a directory review flags steering text in a tool description. The model only sees `fields` at the first pause, so a node that runs before the first interrupt or widget and reads such a field needs a fallback for an empty value, or a question placed before it.
- **Values that fail their schema, and undeclared keys.** 0.23 merged every `stateUpdates` key as sent. 0.25 drops a key the state does not declare, and drops a value for a field not yet asked when it fails the field's schema (`"yes"` for a `z.boolean()`). If a node reads a key that is not in `state`, add it to `state`.

Skip rewrites 1, 2 and 3 of the 0.24 skill. Every other step of this skill applies to a 0.23 project as written. A 0.23 flow already let the conversation write computed fields, so rewrite 2 below closes a hole the project has had all along.

## Procedure

1. **Bump the dependency.**
   ```bash
   bun add @waniwani/sdk@^0.25.0
   ```
2. **Collect the call sites.**
   ```bash
   bun run typecheck
   rg -l "createFlow\(" --glob '!node_modules'
   rg -n "_flowGraph" --glob '!node_modules'
   rg -n "state\.\w+((\?)?\.\w+)*\s*(\?\?|\|\|)|state\.\w+((\?)?\.\w+)*\s*\?\s*\{\s*\}|if \(!?state\.\w+" --glob '!node_modules' --glob '!*.test.*'
   rg -n -i "agree|consent|terms|accept|reviewed|confirm|attest|declar|eligib|health|medical|signature" --glob '!node_modules' --glob '!*.test.*'
   rg -n -i "price|premium|quote|amount|policy|eligible|lookup|vehicle|version" --glob '!node_modules' --glob '!*.test.*'
   rg -n "[a-z]Id\b|validate:|showWidget\(" --glob '!node_modules' --glob '!*.test.*'
   rg -n -i "do not ask the user|answer from the conversation|set by the flow" --glob '!node_modules'
   rg -n "\.start\(|continueWith\(|resetWith\(|listTools\(|nextStep|toMatchSnapshot|toMatchInlineSnapshot" --glob '*.test.*'
   ```
   Keep the hits inside files that call `createFlow`, or that a flow's nodes import.
3. **Build a field table for every flow.** For each key in `createFlow({ state })`, and each member of a `z.object` group, record:
   - which interrupt question asks it (`key: { question: ... }` inside `interrupt({ ... })`), or which widget fills it (`showWidget({ field: "key" })`),
   - which node returns it (`return { key: ... }`), and whether that node keeps an existing value (`state.key ?? ...`, `state.key ? {} : ...`, `if (!state.key)`),
   - which question's `validate` returns it (a validator can return an object, and the engine merges it into state),
   - which nodes and conditional edges read it.

   Then put each field in one class, checking in this order:

   | Class | Test | Action |
   | --- | --- | --- |
   | **Computed** | A node or a validator returns it, no question asks it, and a wrong value changes money, eligibility, a record kept for the user or a backend, or which lookup runs. Typical names: price, premium, quote, eligibility result, policy number, lookup id, vehicle version, a timestamp for an audit trail | Rewrite 2 |
   | **Must be asked** | A question or widget asks it, and the answer only counts when the user gives it to that question: consent, terms, attestation, a declaration, a health or eligibility answer, a pick the user must make on a widget they see | Rewrite 1 |
   | **0.24 workaround** | A question with `context` such as "Answer from the conversation. Do not ask the user.", or a node added only to set a value the model knows (a locale, a classification the opener implies) | Rewrite 3 |
   | **Derived** | A node returns it, and a wrong value only changes wording or display | Delete any guard so the node writes it on every pass |
   | **Group asked as a whole** | A question or widget asks a `z.object` group by its key (`showWidget({ field: "upload" })`) | One member sent early fills the group, and the whole question or widget is skipped. Wrap the group in `neverPrefilled()`, or ask each member as its own field |
   | **Conversation only** | No question, node or validator writes it, and the model sends it (common on 0.23) | Keep it when a wrong value is harmless. When it changes money or eligibility, compute it in a node from asked fields and move it out of state (rewrite 2), or ask it with a question |
   | **Plain answer** | A question or widget asks it, and an earlier answer from the user is fine | No change. 0.25 fills it from the conversation and skips the question |

4. **Apply rewrites 1 to 4** below to every target.
5. **Verify, which is the completion check.**
   ```bash
   bun run typecheck && bun test
   ```
   If `package.json` has a flow eval script (such as `eval:flows`), run it too. It calls live models and costs tokens, so tell the user before you run it.
6. **Report** each flow's field table, the rewrite applied to each target, and the 0.24 workarounds you deleted.

## Rewrite 1: `neverPrefilled()` for answers that must come from their own question

Import `neverPrefilled` from `@waniwani/sdk/mcp` and wrap the field's whole schema, at the end of the chain (after `.optional()`, `.describe()` and any `redacted()`). The field leaves `fields`, and any value sent before the run asks it is dropped. Once the run asks it, the answer is written as sent.

For a widget that fills a `z.object` group, wrap the group. To close one member only, wrap that member inside the group.

```ts
// Before
import { createFlow, END, START } from "@waniwani/sdk/mcp";

state: {
  agreedToTerms: z.boolean().describe("The user accepts the terms and conditions"),
  reviewed: z.boolean().describe("The user confirmed the summary on screen"),
  plan: z.enum(["basic", "plus"]).describe("Plan the user picks on the plan card"),
},

// After
import { createFlow, END, neverPrefilled, START } from "@waniwani/sdk/mcp";

state: {
  agreedToTerms: neverPrefilled(
    z.boolean().describe("The user accepts the terms and conditions"),
  ),
  reviewed: neverPrefilled(
    z.boolean().describe("The user confirmed the summary on screen"),
  ),
  plan: neverPrefilled(
    z.enum(["basic", "plus"]).describe("Plan the user picks on the plan card"),
  ),
},
```

Mark `plan` only when the user must see the card before they pick. A widget whose `field` holds a value is skipped, so an unmarked `plan` that the user named in their first message skips the card.

## Rewrite 2: move computed values out of `state`

0.24 dropped any value sent for a field no question asks, so a node could keep a computed value in `state` safely. In 0.25 any call can set it, before the node runs or after it. A guard that keeps an existing value lets the model skip the lookup:

```ts
.addNode("lookup_vehicle", async ({ state }) =>
  state.vehicleVersionId ? {} : { vehicleVersionId: await lookupVersion(state.plate) },
)
```

Removing the guard is not enough, because a later `continue` can overwrite the value between two pauses. Move the value to a `KvStore` keyed by `ctx.sessionId`. Use `MemoryKvStore` in tests and local dev, and `WaniwaniKvStore` (with `WANIWANI_API_KEY`) or your own `KvStore` in production. `WaniwaniKvStore` throws without the key, and the flow then returns `status: "error"`, so pick the store the way the sample does or inject it. Read it back from the store in every node that needs it, and delete the field from `state`.

```ts
// Before
const flow = createFlow({
  id: "car_quote",
  title: "Car insurance quote",
  description: "Quotes car insurance for the user's car.",
  state: {
    plate: z.string().describe("License plate"),
    vehicleVersionId: z.string().optional().describe("Vehicle version, set by the flow"),
    price: z.number().optional().describe("Yearly price, set by the flow"),
  },
})
  .addNode("ask_plate", ({ interrupt }) =>
    interrupt({ plate: { question: "What is your license plate?" } }),
  )
  .addNode("lookup_vehicle", async ({ state }) =>
    state.vehicleVersionId ? {} : { vehicleVersionId: await lookupVersion(state.plate) },
  )
  .addNode("quote", async ({ state }) => ({
    price: state.price ?? (await priceFor(state.vehicleVersionId)),
  }))
  .addNode("show_quote", ({ state, showWidget }) =>
    showWidget({ tool: "show_quote", data: { price: state.price } }),
  )
  .addEdge(START, "ask_plate")
  .addEdge("ask_plate", "lookup_vehicle")
  .addEdge("lookup_vehicle", "quote")
  .addEdge("quote", "show_quote")
  .addEdge("show_quote", END)
  .compile();

// After
import { type KvStore, MemoryKvStore, WaniwaniKvStore } from "@waniwani/sdk/mcp";

type Quote = { vehicleVersionId: string; price: number };
const quotes: KvStore<Quote> = process.env.WANIWANI_API_KEY
  ? new WaniwaniKvStore<Quote>()
  : new MemoryKvStore<Quote>();

function quoteKey(sessionId: string | undefined): string {
  if (!sessionId) {
    throw new Error("car_quote needs a session id");
  }
  return `car_quote:${sessionId}`;
}

const flow = createFlow({
  id: "car_quote",
  title: "Car insurance quote",
  description: "Quotes car insurance for the user's car.",
  state: {
    plate: z.string().describe("License plate"),
  },
})
  .addNode("ask_plate", ({ interrupt }) =>
    interrupt({ plate: { question: "What is your license plate?" } }),
  )
  .addNode("quote", async ({ state, sessionId }) => {
    const vehicleVersionId = await lookupVersion(state.plate);
    const price = await priceFor(vehicleVersionId);
    await quotes.set(quoteKey(sessionId), { vehicleVersionId, price });
    return {};
  })
  .addNode("show_quote", async ({ sessionId, showWidget }) => {
    const quote = await quotes.get(quoteKey(sessionId));
    return showWidget({ tool: "show_quote", data: { price: quote?.price } });
  })
  .addEdge(START, "ask_plate")
  .addEdge("ask_plate", "quote")
  .addEdge("quote", "show_quote")
  .addEdge("show_quote", END)
  .compile();
```

The node that computes the value writes the store on every pass, with no guard, so a `reset` that changes `plate` prices the new car. A conditional edge reads only `state`, so it cannot read the store. When an edge branched on a moved field (`({ state }) => state.eligible ? "quote" : "decline"`), put an action node directly before the edge that reads the store and returns the routing field. The edge resolves in the same pass, before any call can change it. Do not put an interrupt or widget between that node and the edge: the next call merges the model's values before the edge resolves.

**A timestamp kept by `??`.** `agreedToTermsAt: state.agreedToTermsAt ?? new Date().toISOString()` keeps any ISO string the model sends. When the timestamp is an audit record, move it to the store as above. When it only feeds the next node in the same call, drop the `??` so the node writes it on every pass:

```ts
// Before
.addNode("record_consent", ({ state }) => ({
  agreedToTermsAt: state.agreedToTermsAt ?? new Date().toISOString(),
}))

// After: audit record, kept out of state.
// At module scope, picked like `quotes` above:
// const consents: KvStore<{ agreedToTermsAt: string }> = ...;
.addNode("record_consent", async ({ sessionId }) => {
  if (!sessionId) {
    throw new Error("record_consent needs a session id");
  }
  await consents.set(`consent:${sessionId}`, { agreedToTermsAt: new Date().toISOString() });
  return {};
})
```

Pair this with rewrite 1 on `agreedToTerms`, or the model can send `agreedToTerms: true` and skip the question that the timestamp records.

## Rewrite 3: drop 0.24 workarounds for model-inferred fields

A flow written for 0.24 often asks a model-inferred field with a silent interrupt question, because 0.24 dropped it otherwise:

```ts
.addNode("ask_context", ({ interrupt }) =>
  interrupt({
    locale: {
      question: "Which language is the user writing in?",
      context: "Answer from the conversation. Do not ask the user.",
    },
  }),
)
```

0.25 lists `locale` in `fields`, and the model sends it on its next call. Delete the question, and the node if it asks nothing else. Reconnect the edges around it. Keep the field in `state` with a `.describe()` that tells the model where the value comes from (`"Language the user writes in"`).

Delete the silent question only when every node that reads the field has a fallback for an empty value (`state.locale ?? "en"`). If the flow must have the value before a node reads it, keep the question. The model answers it from the conversation with one silent `continue`.

A node added in 0.24 only to copy a value the model knows into state (a classification the opener implies) goes the same way: delete it, and let the model send the field. A node that computes a field from other state stays. Its field is **Derived** or **Computed** in the field table.

The 0.24 split of one question into one question per field (`firstName`, `lastName`) and the 0.24 widget `z.object` groups keep working. Leave them.

## Rewrite 4: tests

Apply each case that matches.

**A test that asserts an early value is ignored.** 0.24 dropped a value for a field not yet asked. 0.25 writes it when it fits the schema. Assert the new behavior: the flow skips the question. For a `neverPrefilled()` field, the old assertion still holds. For a flow that asks `plate`, then `postcode`:

```ts
// Before
await harness.start("quote my car");
const result = await harness.continueWith({ plate: "1234ABC", postcode: "28001" });
expect(result.status).toBe("interrupt");
expect(result.status === "interrupt" && result.field).toBe("postcode");

// After
await harness.start("quote my car");
const result = await harness.continueWith({ plate: "1234ABC", postcode: "28001" });
expect(result.status).toBe("widget");
```

**A test that seeds a computed field.** After rewrite 2 the field is not in `state`, so `known` and `stateUpdates` cannot reach it. Stub the lookup the node calls, and assert on the response the flow stops on. Add a test that sends a forged value for the old field name and asserts the computed value wins:

```ts
const result = await harness.start("quote my car", { plate: "1234ABC", price: 1 });
expect(result.status).toBe("widget");
expect(result.status === "widget" && result.data).toEqual({ price: 300 });
```

**`harness.start(intent, known)` with a field no question asks.** 0.24 ignored the value. 0.25 writes it on `start` when it fits its schema. Delete workarounds that stepped through a silent question to set it.

**`reset` assertions.** `reset` now accepts any listed field that fits its schema, so a `reset` before the field was asked can succeed. An assertion on the error text changes to ``Nothing to correct: "reset" takes fields the flow listed in `fields` or has asked for.``

**`fields` on the first response.** Assert that consents and computed fields stay out:

```ts
const first = await harness.start("quote my car");
const listed = first.status === "interrupt" || first.status === "widget" ? first.fields : undefined;
expect(Object.keys(listed ?? {})).toContain("plate");
expect(Object.keys(listed ?? {})).not.toContain("agreedToTerms");
expect(Object.keys(listed ?? {})).not.toContain("price");
```

**`tools/list` assertions (from 0.23 only).** Read the graph from `flow.flowGraph`. Over `InMemoryTransport` the client receives the server-only wrappers as objects, so round-trip through JSON before asserting what a client would see.

```ts
// Before
expect(Object.keys(tool.inputSchema.properties.stateUpdates.properties)).toEqual(["plate", "price"]);
expect(tool._meta._flowGraph.nodes).toHaveLength(3);

// After
const [listed] = JSON.parse(JSON.stringify((await client.listTools()).tools));
expect(listed.inputSchema.properties.stateUpdates.properties).toBeUndefined();
expect(JSON.stringify(listed._meta ?? {})).not.toContain("flowGraph");
expect(flow.flowGraph.nodes).toHaveLength(3);
```

**Snapshots of `nextStep`, of the first response, or of the tool definition.** Regenerate them with `bun test --update-snapshots` and check the diff only touches the `fields` paragraph, the interrupt resume sentence, the `stateUpdates` description and the `fields` property of the output schema. A 0.23 project also gets the 0.24 listing changes in the same diff.

## Hand-set `_meta._flowGraph`

0.24 deprecated it with removal in 0.25.0. 0.25.0 still reads it and moves it off the wire, so nothing breaks yet. Delete it now so the next release cannot break it:

```ts
// Before
const nodes = flow.config._meta._flowGraph.nodes;
server.registerTool(flow.name, { ...flow.config, _meta: { ...flow.config._meta, _flowGraph: flow.flowGraph } }, flow.handler);

// After
const nodes = flow.flowGraph.nodes;
server.registerTool(flow.name, flow.config, flow.handler);
```

When you pass your own `_meta`, spread `flow.config._meta` into it. It already carries the graph for `withWaniwani`.

## Ship it

The `tools/list` input schema names no field, as in 0.24. The `stateUpdates` description text changes, and the output schema gains an optional `fields` property. A published app keeps working without resubmission. A 0.23 project's listing shrinks the way 0.24's did, because `stateUpdates` names no field: resubmit to a directory that reviews apps (the ChatGPT app directory) to show reviewers the smaller listing.

Test by hand in a real host (ChatGPT developer mode) at least once: an opener that gives every answer up front, and a run where the user names a plan before the plan card shows.

## Common mistakes

- **Wrapping the inner schema.** `neverPrefilled(z.boolean()).optional()` loses the mark: `fields` lists the field and any call writes it. Wrap the full chain: `neverPrefilled(z.boolean().optional().describe("..."))`.
- **Removing the guard and keeping the field in `state`.** Any later call can still overwrite it. A value that decides money, eligibility or a lookup leaves `state` (rewrite 2).
- **Using `neverPrefilled()` to hide a computed field.** On a field no question asks, the marker blocks writes in 0.25.0. The SDK documents it for answers a question asks, though, and documents `state` as what the conversation sees and fills. A server value in `state` is one new question away from being writable. Use rewrite 2.
- **Keying the store by the bare session id.** The flow stores its own record under `sessionId`, so a store that shares its key space overwrites the flow state. Add a prefix. An undefined id gives every session the same key, so guard it, as `quoteKey` does.
- **Deleting a silent question whose value has no fallback.** The model may not send an inferred value before the node reads it. Keep the question, or add the fallback.
- **Running the 0.23-to-0.24 skill before this one.** Its rewrites 1 to 3 add questions and nodes that 0.25 does not need. Read "Starting from 0.23" instead.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done. Almost nothing in this hop fails to compile, so the tests need to drive each flow past every consent question and every lookup, with forged values for the fields you moved.
