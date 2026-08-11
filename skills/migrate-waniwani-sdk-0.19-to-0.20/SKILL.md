---
name: migrate-waniwani-sdk-0.19-to-0.20
description: "Migrate a project from @waniwani/sdk 0.19.x to 0.20.x and auto-apply its breaking changes: withWaniwani now captures the user's intent on every tool it wraps (on by default, opt out with captureIntent: false), createFlow no longer declares its own intent field, createFlowTestHarness().start() lost its leading intent argument, and createFlow's omitIntentPII now governs only context. Trigger when the user is on @waniwani/sdk 0.19.x and wants to move to 0.20, asks to migrate to 0.20, or hits type errors on harness.start(...) or a missing FlowToolInput.intent after bumping @waniwani/sdk."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.19 → 0.20

A self-contained migration for the single hop from `0.19.x` to `0.20.x`. Apply it when a project on 0.19 is moving to 0.20. It covers only that jump; for other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.19.x`. If it is on an older version, migrate up to 0.19 first (each jump ships its own migration skill); if it is already on 0.20+, there is nothing to do here.

## What 0.20 changes

An MCP server sees tool calls and their arguments, never the conversation that produced them. `withWaniwani` now closes that gap for **every** tool it wraps, not just flow tools: each tool's input schema gains an optional `intent` argument, the calling model fills it in with the user's goal, the value is stripped before your handler runs, and it is tracked as `properties.input.intent` on `tool.called`.

That single implementation replaces the flow-only copy, which is where the breaks come from:

- **`createFlowTestHarness().start()` lost its leading `intent` argument.** `start(intent, stateUpdates?, context?)` is now `start(stateUpdates?, context?)`. This is the only break `tsc` catches, and it is the whole migration for most projects.
- **`createFlow` no longer declares `intent`.** `FlowToolInput.intent` is gone and the flow protocol text no longer asks for it. A flow wrapped in `withWaniwani` is unaffected — the field arrives from the capture layer, alongside `action` / `context` / `stateUpdates` / `sessionId`. A flow that is **not** wrapped collects no intent at all.
- **`createFlow({ omitIntentPII: true })` now governs only the `context` field.** The intent-side instruction moved to `withWaniwani(server, { captureIntent: { omitPII: true } })`.
- **Every wrapped tool advertises one more property**, so any `tools/list` snapshot or golden file changes. Tools that declared no input schema go from zero properties to one.

**Not affected:** node handlers, flow state, the store, event ingest, and the shape of `tool.called` itself. Nothing in the engine ever read `intent`, so no flow behavior changes. Your tool handlers keep receiving exactly the parameters they declared.

## Procedure

1. **Bump the dependency.**
   ```bash
   bun add @waniwani/sdk@^0.20.0
   ```
2. **Collect the call sites.**
   ```bash
   bun run typecheck
   rg "createFlowTestHarness|omitIntentPII"
   ```
   The type checker lists every `harness.start(...)` that still passes an intent. `omitIntentPII` does not fail to compile, so grep is what finds it.
3. **Apply rewrite 1** to every `harness.start(...)` call.
4. **Apply rewrite 2** only if the project sets `omitIntentPII: true` — skipping it silently loses the PII instruction on the captured intent.
5. **Refresh tool-schema snapshots** if the project has any (`bun test --update-snapshots`, or hand-edit the golden file to include `intent`).
6. **Verify — this is the completion check.**
   ```bash
   bun run typecheck
   bun test
   ```
7. **Report** which rewrites were applied and whether any snapshot changed.

## Rewrite 1 — drop the intent argument from `harness.start(...)`

```ts
// Before
const r1 = await harness.start("I want to get pet insurance");
const r2 = await harness.start("Compare electricity rates", { zipcode: "75001" });
const r3 = await harness.start("Get a quote", { zipcode: "75001" }, "on the pricing page");

// After
const r1 = await harness.start();
const r2 = await harness.start({ zipcode: "75001" });
const r3 = await harness.start({ zipcode: "75001" }, "on the pricing page");
```

Mechanical: delete the leading string argument and shift the rest left. The intent string it carried was never read by the engine, so nothing is lost — do not try to preserve it by moving it into `stateUpdates` or `context`.

## Rewrite 2 — keep the PII instruction on the captured intent

Only when a flow sets `omitIntentPII: true`. That option still applies to the flow's `context` field, but the intent field is now the wrapper's, so the wrapper needs telling too:

```ts
// Before — one setting covered intent and context
const flow = createFlow({ id: "quote", omitIntentPII: true, /* … */ });
await withWaniwani(server);

// After — flow keeps context, wrapper takes intent
const flow = createFlow({ id: "quote", omitIntentPII: true, /* … */ });
await withWaniwani(server, { captureIntent: { omitPII: true } });
```

Neither setting redacts server-side; both add a guidance line telling the model to summarize abstractly.

## Opt out — leave tool schemas exactly as declared

Capture is on by default. A server whose published tool contract must not change (an app mid-review in a directory that snapshots tool schemas, or a strict privacy posture) turns it off:

```ts
await withWaniwani(server, { captureIntent: false });
```

Or narrows it to specific tools, and renames the argument to reuse a field a tool already collects:

```ts
await withWaniwani(server, {
  captureIntent: { tools: ["get_quote"], argumentName: "reason" },
});
```

A tool that already declares the argument name is left untouched, and its value reaches its handler as usual.

## Not covered by a shim

`harness.start()` takes the new shape with no deprecated overload. Accepting a string first argument would mean a permanently union-typed parameter (`Record<string, unknown> | string`) on a public signature, degrading editor help for the correct form, to spare test-only code from a one-line edit that the compiler points straight at.

## Common mistakes

- **Preserving the intent string.** It was observational: nothing in the engine read it. Delete it; do not fold it into `stateUpdates` or `context`.
- **Rewriting node handlers.** They never received `intent` and still do not.
- **Assuming an unwrapped flow still asks for intent.** Capture lives in `withWaniwani`. A `createFlow` used standalone (OSS path, no wrapper) collects none — wrap the server if you want it.
- **Leaving `omitIntentPII: true` as the only PII setting.** It now covers `context` only. Without rewrite 2 the captured intent carries no PII instruction.
- **Chasing a handler that "lost" an argument.** The wrapper strips `intent` before your handler runs, and restores the single-argument call shape for tools that declared no input schema, so handler signatures are unchanged.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done.
