---
name: migrate-waniwani-sdk-0.15-to-0.16
description: "Migrate a project from @waniwani/sdk 0.15.x to 0.16.0 and auto-apply every breaking change of that release: the typed useWaniwani track surface (string track()/step()/conversion()/capture and DOM auto-capture removed), the waniwani/widget tool-response meta key, the track.lead() removal, and the V2-envelope createTrackingRoute. Trigger when the user is on @waniwani/sdk 0.15.x and wants to move to 0.16, asks to migrate to 0.16, or has a build that broke after bumping @waniwani/sdk to 0.16."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.15 → 0.16

A self-contained migration for the single hop from `0.15.x` to `0.16.0`. Apply it when a project on 0.15 is moving to 0.16. It covers only that jump; for other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.15.x`. If it is on an older version, migrate up to 0.15 first (that jump ships its own migration); if it is already on 0.16+, there is nothing to do here.

## What 0.16 changes

Tracking becomes one typed `track` client on four surfaces (server `waniwani()`, the scoped client in tool handlers and flow nodes, `useWaniwani()` in MCP-app widgets, and `chat.track` on chat host pages), each attaching session identity automatically. Five breaking changes result, all mechanical.

## Procedure

1. **Bump the dependency.**
   ```bash
   bun add @waniwani/sdk@^0.16.0
   ```
2. **Apply changes 1–5 below.** Skip any with no matching call sites and note it in the report.
3. **Verify — this is the completion check.**
   ```bash
   bun run typecheck
   bun test
   ```
   Every remaining type error points at a call site the new API rejects; each is one of the changes below.
4. **Report** which changes applied, which were skipped for lack of call sites, and anything that needed a judgment call (a string `track()` name with no typed equivalent).

## 1. `useWaniwani()` returns the typed server `track` surface

`useWaniwani()` now returns `{ sessionId, track, identify, flush }`, where `track` is the same `TrackFn` as the server client. **Removed:** string-based `track(name, properties)`, `step(name, meta)`, `conversion(name, data)`, the `capture` option, and all DOM auto-capture (a single `widget_render` event still fires automatically on mount).

Auto-fix, in order:

1. Delete any `capture` option passed to `useWaniwani({ ... })`.
2. Replace `wani.step(<name>, <meta>)` and `wani.conversion(<name>, <data>)` with the typed revenue helper for that funnel stage:
   - price shown → `wani.track.priceShown({ amount, currency })`
   - options compared → `wani.track.pricesCompared({ options })`
   - a choice made → `wani.track.optionSelected({ id, amount, currency })`
   - qualification bar met → `wani.track.leadQualified({ externalId?, email?, name? })`
   - a conversion → `wani.track.converted({ amount, currency })`
3. Rewrite string calls `wani.track("<name>", <props>)`:
   - `<name>` is a typed event (`quote.requested`, `quote.succeeded`, `quote.failed`, `link.clicked`, `purchase.completed`, or a revenue event) → object form: `wani.track({ event: "<name>", properties: <props> })`.
   - otherwise → pick the closest typed event; custom event names are not part of the typed surface (flag these in the report).
4. Remove any imports of `AutoCaptureToggles` or `WidgetTrackFn`; the widget `track` is the same `TrackFn` type as the server client (from `@waniwani/sdk`).

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

## 2. Widget auto-capture event names removed from `EventType`

`widget_click`, `widget_link_click`, `widget_error`, `widget_scroll`, `widget_form_field`, and `widget_form_submit` are gone from the `EventType` union (`widget_render` remains, emitted automatically). Replace any `track()` call or type position referencing a removed name with a typed taxonomy event. There is no runtime replacement — DOM auto-capture never fired reliably and was removed rather than reworked.

## 3. Widget config `_meta` key renamed to `waniwani/widget`

`withWaniwani` injects the widget tracking config (endpoint, token, session id, source) into each tool response under `_meta["waniwani/widget"]`, following the `waniwani/*` namespace every other SDK meta key uses. `useWaniwani()` reads the new key itself, so most projects need no change. Only code that read the old bare key directly must be updated:

```ts
// Before
const config = toolResponseMetadata?.waniwani;
// After
const config = toolResponseMetadata?.["waniwani/widget"];
```

**Deploy both sides together.** A 0.15 widget paired with a 0.16 server (or the reverse) resolves no tracking config, because the key names no longer match.

## 4. `track.lead()` removed

The `track.lead()` alias (deprecated in 0.15.1) is gone.

1. Replace every `.track.lead(` with `.track.leadQualified(`.
2. Replace `event: "lead"` with `event: "lead_qualified"` in generic `track()` calls — the runtime no longer rewrites the old name.

```ts
// Before
await client.track.lead({ email: "jane@acme.com", externalUserId: "user_123" });
// After
await client.track.leadQualified({ email: "jane@acme.com", externalUserId: "user_123" });
```

(If the project already moved off `.lead()` when it took 0.15, this change has no call sites — skip it.)

## 5. `createTrackingRoute` accepts the V2 batch envelope

The proxy route now parses the V2 batch shape (`{ events: [{ id, name, correlation, properties, ... }] }`), which is exactly what `createFrontendClient` and `useWaniwani({ endpoint })` send — so SDK-to-SDK proxy setups need no change. Only a hand-rolled client posting the old snake_case payload (`event_type`, `session_id`, `event_name`) must switch to the V2 envelope: event name at `name`, identity under `correlation`, payload under `properties`.

## Worth adopting in the same pass (non-breaking)

- **`context.waniwani.sessionId`** on the scoped client — store it with your own records, then attribute an off-platform `client.track.converted({ sessionId })` back to the conversation later.
- **`chat.track` / `chat.identify`** on the chat embed global (`WaniWani.chat.*`) and on the `WaniwaniChat` `ChatHandle` ref — the host page can now send funnel events with the chat session attached.
- **`createFrontendClient`** and the **`EVENT_TYPES`** runtime constant from `@waniwani/sdk`; **`extractScopedClient`** from `@waniwani/sdk/mcp`.
- **`visitorId`** as a first-class identity field — ingest now accepts `sessionId` OR `externalUserId` OR `visitorId`.

## Common mistakes

- **Upgrading only one side of a widget setup.** Change 3 requires the MCP server and its widgets to move to 0.16 together.
- **Recreating `step()` with a custom event name.** The typed taxonomy is closed; model funnel steps with the revenue events.
- **Leaving `capture` in place because it still typechecks.** It is accepted but ignored; delete it.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done for this migration.
