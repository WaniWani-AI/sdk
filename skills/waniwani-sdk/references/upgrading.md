# Upgrading `@waniwani/sdk`

The SDK is `0.x`, so **minor bumps can contain breaking changes**. Whenever you raise the `@waniwani/sdk` version in a project — bumping `package.json`, running `bun add @waniwani/sdk@latest`, or resolving a failed build after an upgrade — treat it as a migration, not a no-op.

## Procedure (run on every minor bump)

1. **Find the version delta.** Note the version you are coming from (the one in the lockfile / `package.json` before the bump) and the version you are moving to.
2. **Read the changelog.** Open [docs.waniwani.ai/sdk/changelog](https://docs.waniwani.ai/sdk/changelog) (source: `sdk/changelog.mdx` in the docs repo). Start at the **Breaking changes at a glance** table, then read every `## <version>:` section whose version is **greater than your old version and less than or equal to your new version**.
3. **Apply each breaking-change migration.** Every breaking change in the changelog ships with a before/after and a mechanical migration (often a codemod recipe). Apply them in version order. They are designed to be auto-applied by an agent in a single pass — do so without asking, then report what you changed.
4. **Verify.** Run the project's checks:
   ```bash
   bun run typecheck
   bun test
   ```
   The type errors after a bump are the migration's to-do list — each one points at a call site the new API rejects.
5. **Report.** Summarize which breaking changes applied to this codebase and which did not (e.g. "no `addConditionalEdge` call sites, nothing to do").

Deprecations (struck-through signatures, `@deprecated` JSDoc) are **not** breaking — the old shape keeps working until the removal version listed in the notice. Migrate them opportunistically, but a build does not require it.

## Non-breaking additions (no migration required)

These entries add capability without changing existing behavior — listed so the surface is discoverable, not because an upgrade needs action.

### Chat widget customization tokens + escape hatch

New `ChatTheme` tokens on `appearance.variables`: `userBubbleTextColor`, `assistantBubbleTextColor`, `messagePaddingX`, `messagePaddingY`, `messageMaxWidth`, `fontSize`, `lineHeight`. New `appearance.assistantBubble` flag (opt-in filled assistant bubble; default `false`). New React `classNames` prop (`ChatClassNames`: `root`, `header`, `message`, `userBubble`, `assistantBubble`, `input`) and stable Shadow-DOM-reachable classes for `data-css` (`.ww-message`, `.ww-message-user`, `.ww-message-assistant`, `.ww-bubble`, `.ww-header`, `.ww-input`). See `references/chat-widget.md`.

One behavioral note (not a break): `messageBorderRadius` / `--ww-msg-radius` is now applied to message bubbles (it was previously inert). Its default is pinned to `8px`, which equals the value bubbles rendered before, so existing widgets are visually unchanged. Only a consumer who explicitly set `messageBorderRadius` will now see it take effect — the intended behavior.

## Currently auto-fixable breaking changes

This list mirrors the changelog so you can apply migrations without a network fetch. Always cross-check against the live changelog for anything newer than this file.

### 0.16.0: unified tracking client on every surface

One typed `track` client everywhere (server, scoped client, `useWaniwani()`, `chat.track`). Five breaking changes, all mechanical:

**1. `useWaniwani()` surface.** Returns `{ sessionId, track, identify, flush }` where `track` is the same typed `TrackFn` as the server client. Removed: string-based `track(name, properties)`, `step(name, meta)`, `conversion(name, data)`, and the `capture` option (DOM auto-capture no longer exists; one `widget_render` event is emitted automatically on init).

Auto-fix:
1. Delete any `capture` option passed to `useWaniwani()`.
2. Replace `wani.step(...)` / `wani.conversion(...)` with the typed revenue helper matching the funnel stage (`track.optionSelected(...)`, `track.converted(...)`).
3. Replace `wani.track("<name>", props)` with the object form `wani.track({ event: "<name>", properties: props })` when `<name>` is a typed event; otherwise pick the closest typed event (custom names are not part of the typed surface).

```tsx
// Before
const wani = useWaniwani({ capture: { click: true } });
wani.track("plan_viewed", { plan: "pro" });
wani.conversion("purchase", { amount: 49 });

// After
const wani = useWaniwani();
wani.track.priceShown({ amount: 49, currency: "EUR" });
wani.track.converted({ amount: 49, currency: "EUR" });
```

**2. Widget auto-capture event names removed from `EventType`.** `widget_click`, `widget_link_click`, `widget_error`, `widget_scroll`, `widget_form_field`, `widget_form_submit` are gone (`widget_render` remains, auto-emitted). Replace any reference with a typed taxonomy event.

**3. Widget config meta key renamed.** `withWaniwani` injects the widget tracking config under `_meta["waniwani/widget"]` (formerly the bare `waniwani` key). Only code reading the key directly needs the rename; `useWaniwani()` handles it. Upgrade server and widgets together.

**4. `track.lead()` removed** (deprecated since 0.15.1). Replace `.track.lead(` with `.track.leadQualified(`. The runtime no longer rewrites the event name `"lead"`; send `"lead_qualified"`.

**5. `createTrackingRoute` accepts the V2 batch envelope.** The proxy route parses `{ events: [{ id, name, correlation, properties, ... }] }`, which is what `createFrontendClient` / `useWaniwani({ endpoint })` send. Hand-rolled clients posting the old snake_case payload (`event_type`, `session_id`) must switch to the V2 envelope.

New, non-breaking additions worth adopting during the same pass: `context.waniwani.sessionId` (store it to attribute off-platform conversions), `chat.track` / `chat.identify` on the chat embed and `ChatHandle`, `createFrontendClient` and `EVENT_TYPES` from `@waniwani/sdk`, `extractScopedClient` from `@waniwani/sdk/mcp`, and `visitorId` as a correlation field.

### 0.15.0: `track.lead()` → `track.leadQualified()`, event `"lead"` → `"lead_qualified"`

The lead event is named `lead_qualified`, its helper is `track.leadQualified()`, and it carries richer properties: `externalId` (your CRM/lead record id, the strongest dedup key), `email`, and `name`. Types renamed: `RevenueLeadInput` → `RevenueLeadQualifiedInput`, `LeadProperties` → `LeadQualifiedProperties`.

**Auto-fix:**

1. Replace every `.track.lead(` call with `.track.leadQualified(`.
2. Replace `event: "lead"` with `event: "lead_qualified"` in generic `track()` calls (and `eventType: "lead"` in the legacy shape).
3. Replace type imports: `RevenueLeadInput` → `RevenueLeadQualifiedInput`, `LeadProperties` → `LeadQualifiedProperties`.
4. Where the call site has them, enrich the event with `externalId`, `email`, and `name` (all optional).

```ts
// Before
await client.track.lead({ source: "newsletter", externalUserId: "user_123" });

// After
await client.track.leadQualified({
  externalId: "lead_abc123",
  email: "jane@example.com",
  externalUserId: "user_123",
});
```

Semantics note: `lead_qualified` fires when the person meets your qualification bar (qualifying questions answered, demo requested, CRM push done), not at flow entry. If the old `lead` call sat on the flow's first node, move it to the node where qualification completes. See [docs.waniwani.ai/sdk/tracking/instrumentation](https://docs.waniwani.ai/sdk/tracking/instrumentation).

Since 0.15.1, `track.lead()` also exists as a `@deprecated` alias emitting `lead_qualified` (removed in 0.16.0), and the transport normalizes the runtime name `"lead"` to `"lead_qualified"`. Migrate anyway; on 0.15.0 exactly the alias is absent.

After applying, run `bun run typecheck && bun test`.

### 0.14.0 — `addConditionalEdge(from, condition)` → `addConditionalEdge(from, to, condition)`

The reachable nodes are now declared explicitly as the second argument; the condition's return type is constrained to that list.

**Auto-fix:** for every two-argument `.addConditionalEdge(` call, read the condition body, collect every node name (string literal or `END`) it can return, and insert that deduplicated list as a new second argument. Leave the condition as the third argument.

```ts
// Before
.addConditionalEdge("route_country", (state) => {
  if (state.country === "FR") return "fr_path";
  if (state.country === "DE") return "de_path";
  return "default_path";
})

// After
.addConditionalEdge(
  "route_country",
  ["fr_path", "de_path", "default_path"],
  (state) => {
    if (state.country === "FR") return "fr_path";
    if (state.country === "DE") return "de_path";
    return "default_path";
  },
)
```

After applying, run `bun run typecheck`. The compiler now checks each condition's return value against `to`, so any missing target surfaces as `Type '"x"' is not assignable to type '"a" | "b"'` — add the missing node to `to`. Over-declaring is harmless.
