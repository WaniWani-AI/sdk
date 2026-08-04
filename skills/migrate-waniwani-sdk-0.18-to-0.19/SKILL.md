---
name: migrate-waniwani-sdk-0.18-to-0.19
description: "Migrate a project from @waniwani/sdk 0.18.x to 0.19.x (first published: 0.19.1) and auto-apply its breaking change: suggestion.clicked (WidgetEvent / WidgetEventDetail from @waniwani/sdk/chat) gained a required properties.origin field (channel | page | flow | followup). Reading events through onEvent needs no changes; only code constructing a suggestion.clicked event literal must add origin. Also covers the SuggestionsConfig.dynamic deprecation (use origins) and how to opt in to flow-driven suggestion pills. Trigger when the user is on @waniwani/sdk 0.18.x and wants to move to 0.19, asks to migrate to 0.19, or hits type errors on suggestion.clicked literals after bumping @waniwani/sdk."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.18 → 0.19

A self-contained migration for the single hop from `0.18.x` to `0.19.x` (the first published 0.19 release is `0.19.1`; `0.19.0` was never published to npm). Apply it when a project on 0.18 is moving to 0.19. It covers only that jump; for other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.18.x`. If it is on an older version, migrate up to 0.18 first (each jump ships its own migration skill); if it is already on 0.19+, there is nothing to do here.

## What 0.19 changes

Flow `interrupt({ suggestions })` values now also render as clickable pills above the input in the Waniwani chat widget, gated by a named origin list. Almost all of it is additive; the one break:

- **`suggestion.clicked` gained a required `properties.origin` field** — `"channel" | "page" | "flow" | "followup"`, reporting which provider supplied the clicked pill. On 0.18.x the payload was `{ text, index }`. The field is part of `WidgetEventDetail` / `WidgetEvent` from `@waniwani/sdk/chat`.

Also shipped (no action required):

- `SuggestionsConfig.origins` (`SuggestionOrigin[]`) replaces the `dynamic` boolean on the `<ChatEmbed>` primitive. `dynamic` is **deprecated but still works**: `true` maps to every origin, `false` to none, `origins` wins when both are set.
- `suggestionOrigins` on `<WaniwaniChat>` overrides and `data-suggestion-origins` on the `<script>` embed. Default everywhere is `["channel", "page", "followup"]` — flow-driven pills stay opt-in.
- Flow tool results always carry `_meta["waniwani/suggestions"]` (exported as `SUGGESTIONS_META_KEY` / `SuggestionsMeta`). Additive; hosts that ignore `_meta` are unaffected.

> **Skip the origin config if you are heading past 0.19.** The next minor drops it: the pill row resolves a fixed, non-configurable hierarchy (flow > followup > page > channel) and flow pills render with no opt-in. `SuggestionsConfig.origins` / `.dynamic` become accepted-and-ignored, and `suggestionOrigins` / `data-suggestion-origins` are removed outright. Adopting `origins` here only to delete it one hop later is wasted work — land the `suggestion.clicked` break below and leave the origin config alone. `suggestions={false}` on `<ChatEmbed>` keeps working as the kill switch.

**Not affected:** reading widget events through `onEvent` — `origin` is a new, always-populated field, so existing readers keep compiling and running. Other MCP hosts (ChatGPT, Claude) see no behavior change.

This break **is** visible to `tsc`: every hand-constructed `suggestion.clicked` literal typed as `WidgetEvent` / `WidgetEventDetail` fails to typecheck after the bump, so the compiler output is the complete call-site list.

## Procedure

1. **Bump the dependency.**
   ```bash
   bun add @waniwani/sdk@^0.19.1
   ```
2. **Collect the call sites.** Run the type checker and/or grep:
   ```bash
   bun run typecheck
   rg "suggestion\.clicked"
   ```
   Only *constructions* of the event literal need changes (test fixtures, custom adapters). `onEvent` handlers that read `event.name === "suggestion.clicked"` are fine as-is.
3. **Apply rewrite 1** to every construction site.
4. **Optionally apply rewrite 2** (deprecation, not required to compile).
5. **Verify — this is the completion check.**
   ```bash
   bun run typecheck
   bun test
   ```
6. **Report** which rewrite each call site took.

## Rewrite 1 — add `origin` to `suggestion.clicked` literals

```ts
// Before
const event: WidgetEvent = {
  mode: "inline",
  timestamp: Date.now(),
  name: "suggestion.clicked",
  properties: { text: "Book a demo", index: 0 },
};

// After
const event: WidgetEvent = {
  mode: "inline",
  timestamp: Date.now(),
  name: "suggestion.clicked",
  properties: { text: "Book a demo", index: 0, origin: "channel" },
};
```

Pick the value by what the fixture stands in for: `"channel"` for starter prompts, `"page"` for per-URL starter prompts, `"flow"` for a flow-driven pill, `"followup"` for a generated follow-up. When the fixture doesn't care, use `"channel"`.

## Rewrite 2 — `dynamic` → `origins` (deprecation, optional)

Only on the `<ChatEmbed>` primitive's `suggestions` prop:

```tsx
// Before
<ChatEmbed suggestions={{ initial: ["Pricing?"], dynamic: true }} />
<ChatEmbed suggestions={{ initial: ["Pricing?"], dynamic: false }} />

// After
<ChatEmbed suggestions={{ initial: ["Pricing?"], origins: ["channel", "page", "flow", "followup"] }} />
<ChatEmbed suggestions={{ initial: ["Pricing?"], origins: [] }} />
```

`dynamic` keeps working in 0.19 (`origins` wins when both are set), so this rewrite is opportunistic — apply it when touching the file anyway.

## Opt-in — render flow-driven pills

Not a migration, but the reason to upgrade. If your flows declare `interrupt({ suggestions })`, include `"flow"` in the host surface's origins to render them as pills:

- `<WaniwaniChat>`: `overrides={{ suggestionOrigins: ["channel", "page", "flow", "followup"] }}`
- `<script>` embed: `data-suggestion-origins="channel,page,flow,followup"`
- `<ChatEmbed>`: `suggestions={{ origins: ["flow"] }}`

Pills appear only on steps with exactly one open question.

The opt-in is 0.19-only. From the next minor the hierarchy is fixed and flow pills render on every host with no config, so if you are upgrading past 0.19 skip this section entirely.

## Not covered by a shim

`origin` is required rather than optional by design: a guaranteed field is better DX for readers (the primary audience) than an optional one every reader would have to narrow. The compiler output in step 2 is the complete migration to-do list.

## Common mistakes

- **Touching `onEvent` readers.** They need no changes — `origin` is additive for anyone reading events. Only literal constructions break.
- **Adding `source` instead of `origin`.** No published version ever had a `source` field; the field is `origin`.
- **Treating `dynamic` as removed.** It is deprecated, not removed; builds do not require rewrite 2.
- **Expecting flow pills without opting in.** The default origins are `["channel", "page", "followup"]`; flow-driven pills render only when `"flow"` is included on the host surface.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done.
