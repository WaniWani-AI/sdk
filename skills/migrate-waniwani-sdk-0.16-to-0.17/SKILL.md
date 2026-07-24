---
name: migrate-waniwani-sdk-0.16-to-0.17
description: "Migrate a project from @waniwani/sdk 0.16.x to 0.17.0 and auto-apply its breaking change: useWaniwani() from @waniwani/sdk/mcp/react no longer auto-discovers its config from a WidgetProvider context or by opening its own host connection, so a bare useWaniwani() in a widget silently stops tracking. Skybridge widgets switch the import to @waniwani/sdk/mcp/react/skybridge; other hosts pass toolResponseMetadata or explicit { endpoint, source }. Trigger when the user is on @waniwani/sdk 0.16.x and wants to move to 0.17, asks to migrate to 0.17, or finds widget tracking silently stopped after bumping @waniwani/sdk to 0.17."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.16 → 0.17

A self-contained migration for the single hop from `0.16.x` to `0.17.0`. Apply it when a project on 0.16 is moving to 0.17. It covers only that jump; for other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.16.x`. If it is on an older version, migrate up to 0.16 first (that jump ships its own migration); if it is already on 0.17+, there is nothing to do here.

## What 0.17 changes

`useWaniwani()` from `@waniwani/sdk/mcp/react` is now purely host-agnostic: it resolves its config (endpoint, source, widget token, session id) from **explicit options** or from a **`toolResponseMetadata` object you pass**, and nothing else. It no longer reads a `WidgetProvider` context and no longer opens its own connection to the widget host to discover the config.

Why: on an MCP-Apps host the tool response `_meta` (which carries the Waniwani config) is delivered once, to whichever host bridge is connected and listening at that moment. In a skybridge widget that bridge is skybridge. The hook opening a second connection raced the first and missed the one-shot on Claude, so the old auto-discovery was unreliable. The fix makes the core hook take the metadata as data, and adds a skybridge adapter entry that supplies it.

**This break is invisible to `tsc`.** A bare `useWaniwani()` still typechecks — it just returns a no-op widget at runtime (no `sessionId`, `track.*` does nothing). So you cannot find the call sites by chasing type errors the way earlier SDK migrations worked. Find them by auditing imports of `useWaniwani` (step 2).

## Procedure

1. **Bump the dependency.**
   ```bash
   bun add @waniwani/sdk@^0.17.0
   ```
2. **Find every `useWaniwani` call site.** Grep for imports of `useWaniwani` from `@waniwani/sdk/mcp/react`:
   ```bash
   rg -l "from \"@waniwani/sdk/mcp/react\"" | xargs rg -l "useWaniwani"
   ```
   For each, apply the case below that matches. A call that already passes `endpoint` (Case C) needs no change.
3. **Verify — this is the completion check.**
   ```bash
   bun run typecheck
   bun test
   ```
   `typecheck` will pass whether or not you migrated (the break is a runtime no-op, not a type error), so it is a guard against regressions, not the signal that the migration is complete. The signal is: every bare `useWaniwani()` call site has been moved to Case A, B, or C.
4. **Report** which case each call site took, and any host you could not classify (flag for a human).

## Case A — skybridge-hosted widget (the common case)

The project renders widgets with skybridge (`skybridge` is a dependency, or files import from `skybridge/web`). Change the import path. The call stays bare — the adapter reads `useToolInfo().responseMetadata` for you and feeds it to the core hook.

```tsx
// Before
import { useWaniwani } from "@waniwani/sdk/mcp/react";
const wani = useWaniwani();

// After
import { useWaniwani } from "@waniwani/sdk/mcp/react/skybridge";
const wani = useWaniwani();
```

Everything else in the widget (`wani.sessionId`, `wani.track.leadQualified(...)`, `wani.identify(...)`, `wani.flush()`) is unchanged. `skybridge` is an optional peer dependency of the SDK; a skybridge project already has it, so no install is needed.

If a call passed options (`source`, `token`, `sessionId`, `metadata`), keep them — the adapter forwards them:

```tsx
const wani = useWaniwani({ source: "chatgpt" }); // still valid from the skybridge entry
```

## Case B — you already hold the host `_meta` (custom host, not skybridge)

Your host exposes the tool response metadata some other way. Pass it as `toolResponseMetadata`; keep the `@waniwani/sdk/mcp/react` import.

```tsx
// Before
const wani = useWaniwani();

// After
const wani = useWaniwani({ toolResponseMetadata: myHostToolResponseMetadata });
```

`toolResponseMetadata` is the `_meta` object (or the object that contains a `_meta`); the hook reads `_meta["waniwani/widget"]` from it. If it resolves an `endpoint` and a `source`, tracking works; otherwise the hook stays a no-op.

## Case C — explicit endpoint (bring-your-own backend)

No change. `useWaniwani({ endpoint, source })` (with optional `token` / `sessionId`) works exactly as before; explicit config never used auto-discovery.

## Not covered by a shim

There is no `@deprecated` fallback for the removed auto-discovery. The self-connect path was unreliable (a no-op on Claude), and the `WidgetProvider`-context read was part of the retired legacy widget host. Both are removed outright, not shimmed. If a project relied on the legacy `WidgetProvider` to feed `useWaniwani()`, move those widgets to Case A (skybridge) or Case B (pass the metadata).

## Common mistakes

- **Assuming a clean `typecheck` means you are done.** This break does not surface as a type error. A bare `useWaniwani()` compiles and silently tracks nothing. Audit imports, do not chase the compiler.
- **Leaving the import as `@waniwani/sdk/mcp/react` in a skybridge widget.** The bare call there is now a no-op; it must move to `@waniwani/sdk/mcp/react/skybridge`.
- **Adding a second host connection by hand to "get the `_meta`".** Do not. In a skybridge widget skybridge already owns the connection; use the adapter, which reads what skybridge captured.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test`, with every call site classified, is the definition of done.
