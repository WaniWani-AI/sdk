---
name: migrate-waniwani-sdk-0.22-to-0.23
description: "Migrate a project from @waniwani/sdk 0.22.x to 0.23.x and auto-apply its breaking change: withWaniwani's captureTelemetry option and the CaptureTelemetryOptions type are removed in favour of captureIntent / CaptureIntentOptions, and every wrapped tool advertises one optional `intent` string instead of the nested `telemetry` object, so tools/list snapshots and tests that pass `telemetry` in tool arguments change. Trigger when the user is on @waniwani/sdk 0.22.x and wants to move to 0.23, asks to migrate to 0.23, or hits a type error on `captureTelemetry` / `CaptureTelemetryOptions` after bumping @waniwani/sdk."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.22 → 0.23

A self-contained migration for the single hop from `0.22.x` to `0.23.x`. It covers only that jump; for other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.22.x`. If it is on an older version, migrate up to 0.22 first; if it is already on 0.23+, there is nothing to do here.

## What 0.23 changes

`withWaniwani` adds one argument to every tool it wraps so the calling model can say why the user came. In 0.22 that argument was a nested `telemetry` object (`{ intent, context }`) the model was asked to fill after every user message. In 0.23 it is one optional string, sent only on the model's first call to the app:

```json
"intent": {
  "type": "string",
  "description": "Brief summary of what the user wants and what prompted it, in their words. Send only on your first call to this app."
}
```

The shape follows OpenAI's plugin guidelines, which allow "a brief, task-specific user intent field" and rule out broad contextual fields and accumulated conversation context.

Breaking, and visible to `tsc`:

| 0.22 | 0.23 |
| --- | --- |
| `withWaniwani(server, { captureTelemetry })` | `withWaniwani(server, { captureIntent })` |
| `import type { CaptureTelemetryOptions } from "@waniwani/sdk/mcp"` | `import type { CaptureIntentOptions } from "@waniwani/sdk/mcp"` |

There is no deprecated alias. In plain JavaScript a leftover `captureTelemetry` is ignored and capture stays on, so search for it even when nothing fails to compile.

Behavior changes, not visible to `tsc`:

- **`tools/list`.** Each wrapped tool lists an `intent` string instead of a `telemetry` object. Snapshot tests of tool schemas change.
- **Tool call arguments.** A test that calls a wrapped tool with `telemetry: { intent }` should pass `intent: "..."` instead. A leftover `telemetry` key is stripped by schema validation, except on a tool whose schema is `.strict()`, which rejects the call.
- **Tools with their own `intent` argument** are left alone in 0.23 and record nothing. In 0.22 they got a `telemetry` argument beside it.
- **Tools with their own `telemetry` argument** gain the `intent` string in 0.23. Their own `telemetry` still reaches the handler unchanged.

**Untouched:** the `tool.called` event still records the captured value under `properties.telemetry` (`{ intent }` for plain tools, `{ intent, context }` copied from a flow's own arguments); flow tools keep their `intent` / `context` arguments and their schema; `{ tools, omitPII }` mean the same thing under `captureIntent`; handlers never see the injected argument.

## Procedure

1. **Bump the dependency.**
   ```bash
   bun add @waniwani/sdk@^0.23.0
   ```
2. **Collect the call sites.**
   ```bash
   bun run typecheck
   rg "captureTelemetry|CaptureTelemetryOptions" -l
   rg "telemetry:\s*\{" -l
   ```
3. **Apply rewrites 1 and 2** below.
4. **Verify, which is the completion check.**
   ```bash
   bun run typecheck && bun test
   ```
5. **Report** which files each rewrite touched, and whether the app is listed in a reviewed directory (see "Ship it").

## Rewrite 1: `captureTelemetry` becomes `captureIntent`

A rename of the option and its type. The value keeps its shape: `true`, `false`, or `{ tools?, omitPII? }`.

```ts
// Before
import { withWaniwani, type CaptureTelemetryOptions } from "@waniwani/sdk/mcp";

const capture: CaptureTelemetryOptions = { omitPII: true };
await withWaniwani(server, { captureTelemetry: capture });

// After
import { withWaniwani, type CaptureIntentOptions } from "@waniwani/sdk/mcp";

const capture: CaptureIntentOptions = { omitPII: true };
await withWaniwani(server, { captureIntent: capture });
```

Apps built with `@waniwani/kit` set this under `tracking` in `waniwani.config.ts`. Rename it there the same way once the app is on a kit release whose `TrackingOptions` names `captureIntent`.

## Rewrite 2: tests that see the injected argument

Only tests that inspect a wrapped tool's advertised schema or pass the injected argument themselves need this.

```ts
// Before
expect(Object.keys(listed.inputSchema.properties)).toEqual(["plan", "telemetry"]);
await client.callTool({
  name: "get_quote",
  arguments: { plan: "premium", telemetry: { intent: "Compare home insurance" } },
});

// After
expect(Object.keys(listed.inputSchema.properties)).toEqual(["intent", "plan"]);
await client.callTool({
  name: "get_quote",
  arguments: { plan: "premium", intent: "Compare home insurance" },
});
```

Assertions on the recorded event keep working: the value is still at `properties.telemetry.intent`. A `properties.telemetry.context` from a plain tool no longer appears; only flows send `context`.

## Ship it

The argument is optional, so a published app keeps working without resubmission. A directory that reviews apps (the ChatGPT app directory) shows the tool metadata from your last submission until you submit a new version, so resubmit to move reviewers onto the 0.23 shape. The argument collects free text about the user's goal: mention it in the app's privacy policy, or pass `captureIntent: false`.

## Common mistakes

- **Keeping `captureTelemetry` in JavaScript.** Nothing fails; the option is ignored and capture runs with defaults. Rename it.
- **Adding `context` back to a plain tool.** There is no separate context argument. What prompted the request is part of the one `intent` sentence.
- **Reading `input.intent` as the user's intent on a plain tool.** The injected value is stripped from `input` and recorded under `properties.telemetry.intent`. A plain tool's `input.intent` is its own argument.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done.
