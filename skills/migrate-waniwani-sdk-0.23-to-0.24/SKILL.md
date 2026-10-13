---
name: migrate-waniwani-sdk-0.23-to-0.24
description: "Migrate a project from @waniwani/sdk 0.23.x to 0.24.x and auto-apply its breaking change to flows: the tool listing no longer names state fields under stateUpdates, `start` merges no stateUpdates, and `continue` and `reset` merge only fields the run has asked through an interrupt question or a widget's `field`. A field the conversation writes without any question asking for it (sent by the model on start, extracted from an opener, sent back by a widget, or a second field filled from one question) is never set. The flow graph moved off the wire, so `flow.config._meta._flowGraph` is gone from the type and from tools/list. Covers computing such fields in a node or asking them with an interrupt, widget group fields, the createFlowTestHarness `start(intent, known)` change, and `neverPrefilled()` for releases that hold early answers. Trigger when the user is on @waniwani/sdk 0.23.x and wants to move to 0.24, asks to migrate to 0.24, or after bumping sees any of: a flow asks again for something the user already said, a field the model used to send on start (a locale, a flag inferred from the user's intent) or a value computed on start is never set, a widget's answer is ignored, `reset` returns `Nothing to correct`, a type error on `_meta._flowGraph`, or tests that assert the `stateUpdates` schema or `_meta._flowGraph` in tools/list fail."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.23 → 0.24

A self-contained migration for the single hop from `0.23.x` to `0.24.x`. It covers only that jump; for other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.23.x`. If it is on an older version, migrate up to 0.23 first; if it is already on 0.24+, run the procedure anyway, since most of this hop is invisible to `tsc` and a project can compile on 0.24 while its flows lose answers.

Projects with no `createFlow` call have nothing to migrate. Bump the dependency, run the completion check, and stop.

## What 0.24 changes

In 0.23 a flow tool listed its whole Zod state schema under `stateUpdates` in `tools/list`, and any call could write any state field. A model told to "always include `locale` on start" set it, and so could text injected into the conversation, including fields the flow computes for itself, such as a vehicle id that decides what gets priced.

In 0.24 the listing names no field. Each interrupt or widget response names the fields it asks for, with their `fieldSchema`. The engine records the fields a run has asked (`asked` on the session record) and merges `stateUpdates` only for those. A question on a `z.object` group accepts every key inside it.

Two behaviors ship under 0.24.x, and the rewrites below work on both:

- **0.24.0 to 0.24.2** drop every value sent for a field the run has not asked yet. When the flow later asks that question, the model answers it from earlier messages with one silent `continue`, and the user is not asked again.
- **The first 0.24.x release after 0.24.2 that includes held answers** (WAN-1464, no version number decided yet) keeps those values on the session record (`held`). When an interrupt question asks for one, the engine fills it in the same call and runs the question's validator. A widget's field is never filled from the hold, and neither is a field no question asks.

Tell which one the project has after the bump:

```bash
grep -q neverPrefilled node_modules/@waniwani/sdk/dist/mcp/index.d.ts && echo held || echo dropped
```

Breaking, and visible to `tsc`:

| 0.23 | 0.24 |
| --- | --- |
| `flow.config._meta._flowGraph` is typed `FlowGraph` | `flow.config._meta` is `Record<string, unknown>`, so reading anything off `_flowGraph` fails to compile. Read the graph from `flow.flowGraph` |

Breaking, and not visible to `tsc`:

| Call | 0.23 | 0.24.0 to 0.24.2 | Held-answers release |
| --- | --- | --- | --- |
| `start` with `stateUpdates` | Merged into state, filled nodes skipped | Ignored | Held until an interrupt question asks each field |
| `continue` with a field not asked yet | Merged | Dropped | Held the same way |
| `continue` or `reset` with a field no question or widget ever asks | Merged | Dropped | Held and never applied |
| A widget's `continue` carrying keys other than its `field` | Merged | Dropped | Held. Only an interrupt question can use them |
| `reset` with no asked field | Merged, flow restarts | Error: `Nothing to correct: "reset" takes fields the flow has asked for.` | A state field updates the hold and the current step runs again. A key outside the state schema still errors |

A key that is not a state field is dropped on every 0.24.x release, and a held value that fails its field's Zod schema is dropped when its question comes up.

Other behavior changes:

- **`tools/list`.** A flow's `stateUpdates` is an untyped record, the same for every flow. The definition `_meta` still carries the flow graph and the redacted-fields list for `withWaniwani`, wrapped in an object whose `toJSON` returns `undefined`, so a serializing transport never sends them. Snapshot tests of the listing change.
- **Hand-set `_meta._flowGraph`.** `withWaniwani` still reads it and moves it off the wire. It is deprecated and stops being read in 0.25.0.
- **`createFlowTestHarness`.** `start(intent, known)` no longer sends `known` as `stateUpdates`. It starts empty, then answers each question whose field `known` holds with a `continue`, until the flow asks something `known` has no value for. A value in `known` for a field no question asks is ignored.
- **`nextStep` text on interrupts.** It now tells the model to answer questions the user already settled. Snapshot tests of it change.
- **Sessions in flight.** A record written by 0.23 has no `asked`, so its next call merges everything once. No action.

**Untouched:** node handlers and their return values (a value a node returns always writes state), the `interrupt` and `showWidget` signatures, validators, `redacted()`, `intro`, the `state` schema itself, and widget `data`.

## Procedure

1. **Bump the dependency.**
   ```bash
   bun add @waniwani/sdk@^0.24.0
   ```
2. **Note which behavior you got** with the `grep` above. Rewrite 6 applies only to `held`.
3. **Collect the call sites.**
   ```bash
   bun run typecheck
   rg -n "_flowGraph" --glob '!node_modules'
   rg -l "createFlow\(" --glob '!node_modules'
   rg -n "stateUpdates" --glob '!node_modules'
   rg -n -i "on start|in stateUpdates|always (include|send)|pre-?fill" --glob '!node_modules'
   rg -n "\.start\(|resetWith\(|listTools\(" --glob '*.test.*'
   ```
4. **Build a field table for every flow.** For each key in `createFlow({ state })`, record which of these write it:
   - an interrupt question (the key appears as `key: { question: ... }` inside an `interrupt({ ... })` call),
   - a widget (`showWidget({ field: "key" })`, or a `z.object` group the widget's `field` names),
   - a node return value (`return { key: ... }` from a node),
   - the conversation (the flow `description` or the field's `.describe()` tells the model to send it, a question's `context` tells the model to put a value in it, a widget sends it back, or a test sends it in `stateUpdates`).

   A field the conversation writes and that has no interrupt question and no widget field is a target. So is a field that only a node return writes but that a test seeds through `stateUpdates`.
5. **Apply rewrites 1 to 5** below to every target, then rewrite 6 if the project is on the held-answers release.
6. **Verify, which is the completion check.**
   ```bash
   bun run typecheck && bun test
   ```
7. **Report** each flow's targets, the rewrite applied to each, which behavior the project runs (`held` or `dropped`), and whether the app is listed in a reviewed directory (see "Ship it").

## Rewrite 1: a field the conversation writes and no question asks

Pick the branch by these checks, in order:

1. A node already falls back to another source when the field is empty (`state.locale ?? localeFrom(meta)`): use **1a** with that source.
2. The value is a function of other state fields: use **1a**.
3. Anything else, such as the language the user writes in or a flag inferred from their intent: use **1b**.

**1a. Compute it in a node.** Add an action node right before the first node that reads the field. It returns the field, computed from what the node has (`state`, `meta`, a lookup). Make the field `.optional()` and describe it as set by the flow.

**1b. Ask it.** Add the field as a question in an `interrupt`, in a node placed before the first node that reads it. When the model can answer it from the conversation, say so in the question's `context`.

In both branches, delete the sentence in `description` or `.describe()` that tells the model to send the field. On 0.24.0 to 0.24.2 a 1b question costs one silent model call when the user already gave the answer. On the held-answers release a value the model sent on `start` fills a 1b question in the same call.

```ts
// Before
const flow = createFlow({
  id: "rate_comparison",
  title: "Compare electricity rates",
  description:
    "Compares the user's electricity tariff with current offers. On start, always include locale, transferAllowed and ageBand in stateUpdates.",
  state: {
    locale: z.enum(["es", "en"]).describe("Language the user writes in. Always send it on start."),
    transferAllowed: z
      .boolean()
      .describe("True if the user is moving home or changing the contract holder"),
    birthDate: z.string().describe("Date of birth, YYYY-MM-DD"),
    ageBand: z.enum(["under_26", "26_plus"]).describe("Age band, from the birth date"),
  },
})
  .addNode("ask_birth_date", ({ interrupt }) =>
    interrupt({ birthDate: { question: "What is your date of birth?" } }),
  )
  .addNode("show_offer", ({ state, showWidget }) =>
    showWidget({
      tool: "show_offer",
      data: { locale: state.locale, transferAllowed: state.transferAllowed, ageBand: state.ageBand },
    }),
  )
  .addEdge(START, "ask_birth_date")
  .addEdge("ask_birth_date", "show_offer")
  .addEdge("show_offer", END)
  .compile({ store: new MemoryKvStore() });

// After
function ageBandOf(birthDate: string | undefined): "under_26" | "26_plus" {
  const age = new Date().getFullYear() - Number(birthDate?.slice(0, 4));
  return age < 26 ? "under_26" : "26_plus";
}

const flow = createFlow({
  id: "rate_comparison",
  title: "Compare electricity rates",
  description: "Compares the user's electricity tariff with current offers.",
  state: {
    locale: z.enum(["es", "en"]).describe("Language the user writes in"),
    transferAllowed: z
      .boolean()
      .describe("True if the user is moving home or changing the contract holder"),
    birthDate: z.string().describe("Date of birth, YYYY-MM-DD"),
    ageBand: z.enum(["under_26", "26_plus"]).optional().describe("Age band, set by the flow"),
  },
})
  .addNode("ask_context", ({ interrupt }) =>
    interrupt({
      locale: {
        question: "Which language is the user writing in?",
        context: "Answer from the conversation. Do not ask the user.",
      },
      transferAllowed: {
        question: "Are you moving home or changing the contract holder?",
        context: "Answer from the conversation if the user already said it.",
      },
    }),
  )
  .addNode("ask_birth_date", ({ interrupt }) =>
    interrupt({ birthDate: { question: "What is your date of birth?" } }),
  )
  .addNode("derive_age_band", ({ state }) => ({ ageBand: ageBandOf(state.birthDate) }))
  .addNode("show_offer", ({ state, showWidget }) =>
    showWidget({
      tool: "show_offer",
      data: { locale: state.locale, transferAllowed: state.transferAllowed, ageBand: state.ageBand },
    }),
  )
  .addEdge(START, "ask_context")
  .addEdge("ask_context", "ask_birth_date")
  .addEdge("ask_birth_date", "derive_age_band")
  .addEdge("derive_age_band", "show_offer")
  .addEdge("show_offer", END)
  .compile({ store: new MemoryKvStore() });
```

`locale` and `transferAllowed` take branch 1b. `ageBand` takes branch 1a, and a call that sends it is now ignored on every 0.24.x.

## Rewrite 2: one question that fills several fields

A question whose `context` tells the model to split the answer into a second field ("put the last name in `lastName`") writes a field nothing asks. Add every field it fills as its own question in the same `interrupt` call. The model still asks them in one message.

```ts
// Before
interrupt({
  firstName: {
    question: "What is your name?",
    context: "Put the first name in firstName and the last name in lastName.",
  },
})

// After
interrupt({
  firstName: { question: "What is your first name?" },
  lastName: { question: "And your last name?" },
})
```

## Rewrite 3: a widget that sends back values

A widget's `continue` merges only the widget's `field`. Give every widget that sends values a `field`. When it sends more than one value, group them in one `z.object` state field, name the group as the widget's `field`, and copy the members out in an action node after the widget.

```ts
// Before
state: {
  isManualFlow: z.boolean().describe("True when the user skips the upload"),
},
// ...
.addNode("show_upload", ({ showWidget }) => showWidget({ tool: "show_upload_card" }))
// the widget resumes the flow with { isManualFlow: true, uploadStartedAt: 1760000000000 }

// After
state: {
  upload: z
    .object({
      status: z.enum(["uploaded", "manual"]),
      startedAt: z.number().optional(),
    })
    .describe("What the upload card returned"),
  isManualFlow: z.boolean().optional().describe("Set by the flow"),
},
// ...
.addNode("show_upload", ({ showWidget }) =>
  showWidget({ tool: "show_upload_card", field: "upload" }),
)
.addNode("read_upload", ({ state }) => ({
  isManualFlow: state.upload?.status === "manual",
}))
.addEdge("show_upload", "read_upload")
// the widget resumes the flow with { upload: { status: "manual", startedAt: 1760000000000 } }
// or with dot-paths: { "upload.status": "manual" }
```

Update the widget's own code (or the instruction its tool response gives the model) so it sends the group key. A widget with a `field` is skipped when that field is already filled, so a widget that can show twice in one run needs the node after it to clear the group (`upload: undefined`).

## Rewrite 4: tests

Apply each case that matches.

**`harness.start(intent, known)` with a field no question asks.** The value is ignored now. Put the inputs the node computes from in `known` and let the node run. For a value that comes from a lookup, stub the lookup.

```ts
// Before
const result = await harness.start("compare my rates", { birthDate: "2010-05-01", ageBand: "under_26" });

// After
const result = await harness.start("compare my rates", {
  locale: "en",
  transferAllowed: true,
  birthDate: "2010-05-01",
});
expect(result.status).toBe("widget");
```

**A raw handler call that sends `stateUpdates` on `start` and expects nodes to be skipped.** Replace it with `harness.start(intent, known)`, or send one `continue` per question. A test that asserts the skip itself must branch on the behavior (`held` fills the interrupt question, `dropped` asks it).

**`tools/list` assertions.** Read the graph from `flow.flowGraph`. Over `InMemoryTransport` the client receives the server-only wrappers as objects, so round-trip through JSON before asserting what a client would see.

```ts
// Before
expect(Object.keys(tool.inputSchema.properties.stateUpdates.properties)).toEqual(["birthDate", "locale"]);
expect(tool._meta._flowGraph.nodes).toHaveLength(4);

// After
const [listed] = JSON.parse(JSON.stringify((await client.listTools()).tools));
expect(listed.inputSchema.properties.stateUpdates.properties).toBeUndefined();
expect(JSON.stringify(listed._meta ?? {})).not.toContain("flowGraph");
expect(flow.flowGraph.nodes).toHaveLength(4);
```

**`reset` before the field was asked.** On 0.24.0 to 0.24.2 it returns `status: "error"`. Answer the question first, then call `resetWith`.

**Snapshots of `nextStep` or of the listing.** Regenerate them with `bun test --update-snapshots` and check the diff only touches those strings.

## Rewrite 5: `_meta._flowGraph`

Read the graph from the compiled flow, and stop setting the key by hand. `flow.config._meta` already carries the graph for `withWaniwani`.

```ts
// Before
const nodes = flow.config._meta._flowGraph.nodes;
server.registerTool(flow.name, { ...flow.config, _meta: { ...flow.config._meta, _flowGraph: flow.flowGraph } }, flow.handler);

// After
const nodes = flow.flowGraph.nodes;
server.registerTool(flow.name, flow.config, flow.handler);
```

When you pass your own `_meta`, spread `flow.config._meta` into it. A hand-set `_flowGraph` keeps working until 0.25.0.

## Rewrite 6: `neverPrefilled()` for consent (held-answers release only)

Skip this on 0.24.0 to 0.24.2: `neverPrefilled` does not exist there and the import fails to compile.

On the held-answers release, an answer the user gave early fills its interrupt question without the question going out. For a consent or an attestation asked through `interrupt`, wrap the field's schema in `neverPrefilled()` so only an answer sent while that question is on the table counts. Apply it at the end of the schema chain. It combines with `redacted()`. A consent asked through a widget needs nothing, since a widget's field is never filled from the hold.

```ts
// Before
import { createFlow } from "@waniwani/sdk/mcp";

state: {
  shareConsent: z.boolean().describe("Agrees to share data with partners"),
},

// After
import { createFlow, neverPrefilled } from "@waniwani/sdk/mcp";

state: {
  shareConsent: neverPrefilled(z.boolean().describe("Agrees to share data with partners")),
},
```

## No rewrite: openers that extract everything

A first node that asks one open question and tells the model to fill other fields from the answer keeps working when later nodes ask those fields. On 0.24.0 to 0.24.2 each later node costs one silent `continue`. On the held-answers release the values the model sends are held and fill those questions. Fields in that opener that no later node asks are targets of rewrite 1.

## Ship it

The flow tool's listing shrinks: `stateUpdates` names no field, description or enum value, and `_meta` sends no graph. A published app keeps working without resubmission, because the server keeps only the asked fields from whatever the old listing makes the model send. A directory that reviews apps (the ChatGPT app directory) shows the tool metadata from your last submission until you submit a new version, so resubmit to show reviewers the smaller listing, which no longer lists personal fields such as ID numbers or birth dates.

## Common mistakes

- **Asking a computed field with an interrupt.** A lookup id or a price must stay unasked, or the conversation can set it again. Use rewrite 1a.
- **Leaving "send X on start" in the flow description.** The description is the consent card a ChatGPT user approves, and steering text there gets flagged. The question from rewrite 1b carries that instruction now.
- **Expecting a widget's field to fill from an early answer.** No 0.24.x release does that. The widget shows and the user picks.
- **Asserting `tools/list` `_meta` over `InMemoryTransport` without a JSON round trip.** The wrappers are still there as objects. A real transport drops them.
- **Importing `neverPrefilled` on 0.24.0 to 0.24.2.** It only exists from the held-answers release.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done. A flow that compiles can still lose answers, so the tests need to drive each rewritten flow to the node that reads the moved field.
