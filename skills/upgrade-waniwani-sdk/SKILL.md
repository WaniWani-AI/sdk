---
name: upgrade-waniwani-sdk
description: "Upgrade a project's @waniwani/sdk across versions and auto-apply every breaking-change migration, including the 0.15 to 0.16 tracking unification (typed useWaniwani track surface, waniwani/widget meta key, track.lead removal, V2 tracking route). Trigger when the user wants to upgrade or bump @waniwani/sdk, migrate to 0.16, fix a build broken by an SDK version bump, or asks what changed between SDK versions."
metadata:
  author: Waniwani
---

# Upgrade `@waniwani/sdk`

Bump the dependency, apply every breaking-change migration between the old and new version in order, and verify with the project's own checks. `@waniwani/sdk` is `0.x`, so minor bumps can break the public API; every break ships a mechanical recipe below, designed to be applied without judgment calls.

Hosted changelog (source of truth for anything newer than this file): [docs.waniwani.ai/sdk/changelog](https://docs.waniwani.ai/sdk/changelog)

## Procedure

1. **Find the version delta.** Read the currently installed version from the lockfile or `node_modules/@waniwani/sdk/package.json`, and the target version (latest unless the user named one).
2. **Bump.**
   ```bash
   bun add @waniwani/sdk@latest   # or @<target-version>
   ```
3. **Apply each migration below whose version is greater than the old version and at most the new version, in version order.** Skip any with no call sites; say so in the report.
4. **Verify.**
   ```bash
   bun run typecheck
   bun test
   ```
   Remaining type errors are the migration's to-do list; each one points at a call site the new API rejects.
5. **Report.** List each migration applied, each skipped (no call sites), and anything that needed a judgment call.

## 0.16.0: unified tracking client on every surface

Tracking is one typed `track` client on four surfaces (server `waniwani()`, the scoped client in tool handlers and flow nodes, `useWaniwani()` in MCP-app widgets, `chat.track` on chat host pages). The browser surfaces send the same typed events as the server with session identity attached automatically. Five mechanical migrations:

### 1. `useWaniwani()` returns the typed server `track` surface

`useWaniwani()` returns `{ sessionId, track, identify, flush }` where `track` is the server's `TrackFn`. Removed: string-based `track(name, properties)`, `step(name, meta)`, `conversion(name, data)`, the `capture` option, and DOM auto-capture.

Auto-fix, in this order:

1. Delete any `capture` option passed to `useWaniwani()`.
2. Replace `wani.step(<name>, <meta>)` and `wani.conversion(<name>, <data>)` with the typed revenue helper matching the funnel stage:
   - a price being shown: `wani.track.priceShown({ amount, currency })`
   - options compared: `wani.track.pricesCompared({ options })`
   - a choice made: `wani.track.optionSelected({ id, amount, currency })`
   - qualification bar met: `wani.track.leadQualified({ externalId?, email?, name? })`
   - a conversion: `wani.track.converted({ amount, currency })`
3. Replace string calls `wani.track("<name>", <props>)`:
   - `<name>` is a typed event (`quote.requested`, `quote.succeeded`, `quote.failed`, `link.clicked`, `purchase.completed`, or a revenue event): rewrite to the object form `wani.track({ event: "<name>", properties: <props> })`.
   - anything else: pick the closest typed event; custom names are not part of the typed surface.
4. Remove imports of `AutoCaptureToggles` or `WidgetTrackFn`; the widget `track` is the same `TrackFn` type as the server client (exported from `@waniwani/sdk`).

```tsx
// Before
const wani = useWaniwani({ capture: { click: true, scroll: true } });
wani.track("plan_viewed", { plan: "pro" });
wani.step("selected_plan");
wani.conversion("purchase", { amount: 49 });

// After
const wani = useWaniwani();
wani.track.priceShown({ amount: 49, currency: "EUR" });
wani.track.optionSelected({ id: "pro", amount: 49, currency: "EUR" });
wani.track.converted({ amount: 49, currency: "EUR" });
```

### 2. Widget auto-capture event names removed from `EventType`

`widget_click`, `widget_link_click`, `widget_error`, `widget_scroll`, `widget_form_field`, and `widget_form_submit` are gone from the union (`widget_render` remains, emitted automatically once per widget mount). Replace any `track()` call or type position referencing a removed name with a typed taxonomy event.

### 3. Widget config `_meta` key renamed to `waniwani/widget`

`withWaniwani` injects the widget tracking config (endpoint, token, session id, source) under `_meta["waniwani/widget"]`. `useWaniwani()` reads the new key by itself; only code reading the key directly needs the rename:

```ts
// Before
const config = toolResponseMetadata?.waniwani;
// After
const config = toolResponseMetadata?.["waniwani/widget"];
```

Server and widgets must upgrade together; a 0.15 widget against a 0.16 server (or the reverse) resolves no tracking config.

### 4. `track.lead()` removed

Deprecated since 0.15.1, removed on schedule.

1. Replace every `.track.lead(` with `.track.leadQualified(`.
2. Replace `event: "lead"` with `event: "lead_qualified"` in generic `track()` calls; the runtime no longer rewrites the old name.

### 5. `createTrackingRoute` accepts the V2 batch envelope

The proxy route parses the V2 batch shape (`{ events: [{ id, name, correlation, properties, ... }] }`), which is exactly what `createFrontendClient` and `useWaniwani({ endpoint })` send, so SDK-to-SDK setups need no change. Hand-rolled clients posting the old snake_case payload (`event_type`, `session_id`, `event_name`) must switch to the V2 envelope: name at `name`, identity under `correlation`, payload under `properties`.

### Worth adopting in the same pass (non-breaking)

- `context.waniwani.sessionId` on the scoped client: store it with your records, then attribute an off-platform `track.converted({ sessionId })` back to the conversation.
- `chat.track` / `chat.identify` on the chat embed global and the `WaniwaniChat` ref handle.
- `createFrontendClient` and the `EVENT_TYPES` runtime constant from `@waniwani/sdk`; `extractScopedClient` from `@waniwani/sdk/mcp`.
- `visitorId` as a first-class identity field (`sessionId` OR `externalUserId` OR `visitorId` satisfies ingest).

## 0.15.0: `track.lead()` renamed to `track.leadQualified()`

Covered by migration 4 above when crossing both versions. Additionally: type imports `RevenueLeadInput` become `RevenueLeadQualifiedInput` and `LeadProperties` become `LeadQualifiedProperties`.

## 0.14.0: `addConditionalEdge(from, condition)` gains an explicit target list

`addConditionalEdge(from, to, condition)`: collect every node id the condition function can return (including `END`), pass them as the `to` array in the second position.

```ts
// Before
.addConditionalEdge("check", (s) => (s.ok ? "done" : "retry"))
// After
.addConditionalEdge("check", ["done", "retry"], (s) => (s.ok ? "done" : "retry"))
```

## Common mistakes

- **Upgrading only one side of a widget setup.** Migration 3 requires the MCP server and its widgets to move to 0.16 together.
- **Recreating `step()` with a custom event name.** The typed taxonomy is closed; model funnel steps with the revenue events.
- **Leaving `capture` in place because it typechecks as `unknown`.** It does nothing; delete it.
- **Skipping the verify step.** `bun run typecheck` is the migration's completion check; a clean pass plus green tests is the definition of done.
