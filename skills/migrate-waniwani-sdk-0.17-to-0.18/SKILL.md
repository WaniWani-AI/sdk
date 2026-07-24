---
name: migrate-waniwani-sdk-0.17-to-0.18
description: "Migrate a project from @waniwani/sdk 0.17.x to 0.18.0 and auto-apply its breaking change: the generic funnel events quote.requested, quote.succeeded, quote.failed, and purchase.completed are removed from the track() taxonomy (with the QuoteSucceededProperties / PurchaseCompletedProperties types and the legacy quoteAmount / quoteCurrency / purchaseAmount / purchaseCurrency input fields). Call sites move to the typed revenue helpers track.priceShown() and track.converted(), or are deleted. Trigger when the user is on @waniwani/sdk 0.17.x and wants to move to 0.18, asks to migrate to 0.18, or hits type errors on quote.* / purchase.completed events after bumping @waniwani/sdk."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.17 → 0.18

A self-contained migration for the single hop from `0.17.x` to `0.18.0`. Apply it when a project on 0.17 is moving to 0.18. It covers only that jump; for other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.17.x`. If it is on an older version, migrate up to 0.17 first (each jump ships its own migration skill); if it is already on 0.18+, there is nothing to do here.

## What 0.18 changes

The generic funnel events `quote.requested`, `quote.succeeded`, `quote.failed`, and `purchase.completed` are removed from `EVENT_TYPES` and the `TrackEvent` union. They predate the typed revenue taxonomy (`price_shown`, `prices_compared`, `option_selected`, `lead_qualified`, `converted`), which models the same funnel stages with typed properties and flat `track.*` helpers.

Removed with them:

- The type exports `QuoteSucceededProperties` and `PurchaseCompletedProperties` (from `@waniwani/sdk` and `@waniwani/sdk/mcp`'s tracking surface)
- The legacy input fields `quoteAmount`, `quoteCurrency`, `purchaseAmount`, `purchaseCurrency` on `LegacyTrackEvent`

**Not affected:** `link.clicked` (and `LinkClickedProperties`, legacy `linkUrl`) stays a first-class event, on both `track()` and the chat widget's separate host-page `onEvent` channel.

Unlike the 0.17 hop, this break **is** visible to `tsc`: every removed event name and type import surfaces as a type error after the bump, so the compiler output is the complete call-site list.

## Procedure

1. **Bump the dependency.**
   ```bash
   bun add @waniwani/sdk@^0.18.0
   ```
2. **Collect the call sites.** Run the type checker and/or grep:
   ```bash
   bun run typecheck
   rg "quote\.requested|quote\.succeeded|quote\.failed|purchase\.completed|QuoteSucceededProperties|PurchaseCompletedProperties|quoteAmount|purchaseAmount"
   ```
3. **Apply the rewrites below** to every hit. The `track` surface is the same on all four clients (server `waniwani()`, scoped `context.waniwani`, `useWaniwani()`, `chat.track`), so the rewrites are identical everywhere.
4. **Verify — this is the completion check.**
   ```bash
   bun run typecheck
   bun test
   ```
5. **Report** which rewrite each call site took.

## Rewrite 1 — `quote.succeeded` → `track.priceShown()`

```ts
// Before
await client.track({
  event: "quote.succeeded",
  properties: { amount: 120, currency: "EUR" },
  externalUserId: "user_123",
});

// After
await client.track.priceShown({
  amount: 120,
  currency: "EUR",
  externalUserId: "user_123",
});
```

Properties move up to the top level (the revenue helper inputs are the typed properties plus the shared tracking context). Keep every identity/context field (`sessionId`, `externalUserId`, `visitorId`, `meta`) on the call. `amount` and `currency` are **required** on `priceShown`; if the old call omitted them, supply real values from the surrounding code or flag the site for a human.

Legacy shape maps the same way: `{ eventType: "quote.succeeded", quoteAmount: 120, quoteCurrency: "EUR" }` becomes `track.priceShown({ amount: 120, currency: "EUR" })`.

## Rewrite 2 — `purchase.completed` → `track.converted()`

```ts
// Before
await client.track({
  event: "purchase.completed",
  properties: { amount: 490, currency: "EUR" },
  externalUserId: "user_123",
});

// After
await client.track.converted({
  amount: 490,
  currency: "EUR",
  externalUserId: "user_123",
});
```

Same rules as rewrite 1. Legacy `purchaseAmount` / `purchaseCurrency` map to `amount` / `currency`. `converted` also accepts `occurredAt` (ISO timestamp) for backdated off-platform sales; add it where the call site has the real conversion time.

## Rewrite 3 — `quote.requested` / `quote.failed`: delete

```ts
// Before
await client.track({ event: "quote.requested" });
await client.track({ event: "quote.failed" });

// After
// (nothing)
```

Delete the call. The funnel start is already covered by the auto-captured `tool.called` (from `withWaniwani`) and `session.started`. If the site genuinely marked a mid-funnel step (a quote form being opened, options being shown), prefer the matching revenue event instead of a bare deletion: `track.priceShown(...)` when a price was displayed, `track.pricesCompared({ options })` when several were.

## Rewrite 4 — type imports

- `QuoteSucceededProperties` → `PriceShownProperties`
- `PurchaseCompletedProperties` → `ConvertedProperties`

Note the replacements have **required** `amount` and `currency` where the removed types had them optional; the type checker points at any struct that needs filling in.

## Not covered by a shim

There is no `@deprecated` fallback: the four event names are removed outright, so old calls fail to compile rather than silently emitting events the dashboard no longer models. That is intentional; the compiler output in step 2 is the complete migration to-do list.

## Common mistakes

- **Rewriting `link.clicked`.** It is not removed. Leave those calls alone.
- **Dropping identity fields during the rewrite.** `externalUserId` / `sessionId` / `meta` on the old call must survive onto the helper input; an event without identity is rejected by the ingest API.
- **Inventing `amount` / `currency` values.** If the old `quote.succeeded` / `purchase.completed` call carried no amount, pull the real value from surrounding code; if none exists, flag the site instead of guessing.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done.
