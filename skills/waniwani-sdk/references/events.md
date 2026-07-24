# Tracking & Funnel Events (`@waniwani/sdk`)

Events are how a flow or MCP app becomes a *measurable funnel*. A flow tells you a
user passed through some steps; events tell you whether those steps led to revenue —
including conversions that happen **later and off-platform** (on the customer's own
site, days or months after the chat).

The taxonomy is deliberately **opinionated and revenue-first** — a small set of typed,
first-class events with meaningful properties, not a generic "event name + bag of
properties" soup. That opinion is what lets the dashboard build funnels and attribute
revenue without per-customer configuration. Use the typed helpers; reach for raw
`track({ event })` only for the events the taxonomy already names.

**Tier:** event tracking is a **free-tier** feature — it needs `WANIWANI_API_KEY`.
Calling `track.*` or `identify()` without a key **throws** (`WANIWANI_API_KEY is not
set`) — if a code path must also run keyless, guard the call. `withWaniwani(server)`
itself is safe to call without a key: its own auto-capture is internally guarded and
session-metadata bridging still works. See [setup.md](setup.md) to get a key.

## The funnel model: start → steps → conversion

Think of instrumentation as three stages. Emit at least the **start** and the
**conversion**; the steps in between are what make the funnel diagnosable.

| Funnel stage | Emit | Helper / source | When |
|---|---|---|---|
| **Landing** | `page.viewed` | chat widget (auto) | A visitor lands on a page where the widget is present. Auto-emitted once on widget init — no code. Attributed to an anonymous `visitorId`, **not** a session. Opt out per-surface with `disablePageView` / `data-disable-page-view` (see [chat-widget.md](./chat-widget.md#event-tracking)). |
| (start, auto) | `tool.called` | `withWaniwani(server)` | Auto-captured for every tool call — no code. |
| **Qualification** | `lead_qualified` | `track.leadQualified({ externalId?, email?, name? })` | The person met your qualification bar (finished the qualifying questions, requested a demo, matched your target profile). Fires once per flow run, at the node where qualification completes, not at flow entry. |
| **Step** | `price_shown` | `track.priceShown({ amount, currency })` | You showed the user a price. |
| **Step** | `prices_compared` | `track.pricesCompared({ options })` | You showed two or more options side by side. |
| **Step** | `option_selected` | `track.optionSelected({ id, amount, currency })` | The user picked one of those options. |
| **Conversion** | `converted` | `track.converted({ amount, currency })` | The user became paying — possibly later, off-platform. |

Events produced by the chat widget (`page.viewed`, `chat.user_message`,
`chat.assistant_message`) also carry `properties.mode` (`"floating"` for the floating
bar, `"inline"` for an in-page mount) so funnels can be sliced by embed surface.

The conceptual "start / step / conversion" maps onto these concrete events. There is
**no generic `step()` helper and no arbitrary custom event name** in the typed surface —
model your funnel steps with the revenue events above. Emitting `track.leadQualified(...)`
once at the qualification bar and `track.converted(...)` once on the sale is the minimum
that makes a funnel; the price/compare/select steps make it *explain why* people drop off.

Note the distinction `lead_qualified` draws: a user sharing an email mid-conversation is
`identify(userId, { email })`, not a qualified lead. `identify` attaches identity;
`lead_qualified` declares your qualification bar was met. Most flows emit both, at
different nodes. For per-node placement rules (and a skill that applies them
automatically), see [docs.waniwani.ai/sdk/tracking/instrumentation](https://docs.waniwani.ai/sdk/tracking/instrumentation).

## The one rule you can't skip: identity

Every event must carry **`sessionId`, `externalUserId`, or `visitorId`**. The ingest API
rejects any event with none of the three, so the SDK `console.warn`s the moment you
enqueue an event without identity, even though the local enqueue still returns an id.

- **Inside a flow node or tool handler** → identity is **automatic**. The
  request-scoped client (`context.waniwani`) already carries the session metadata, so
  `sessionId` rides along with every event. You don't pass anything. The resolved id is
  readable as `context.waniwani.sessionId`; store it with your own records to link back
  to the session later.
- **Inside an MCP-app widget or on a chat host page** → identity is **automatic** too.
  `useWaniwani().track` stamps the session id injected by `withWaniwani`;
  `chat.track` carries the server-assigned chat session (and the anonymous `visitorId`
  before one exists). See the widget/chat section below.
- **From a top-level client or your own backend** → there is no request context, so you
  **must pass `externalUserId`** (or a stored `sessionId`) yourself. This is exactly how
  an off-platform `converted` finds its original lead.
- **`visitorId`** is the anonymous device/visitor key (the equivalent of an analytics
  "device id"), distinct from a `sessionId`: one visitor can land many times and may
  never start a session. The chat widget's `page.viewed` carries only a `visitorId`,
  deliberately, so landings don't mint sessions and the "landed → started a
  conversation" funnel stays meaningful. It is a first-class `TrackInput` field.

## Ingest authentication: which token goes where

All events land at one endpoint — `POST /api/mcp/events/v2/batch` (the V2 batch envelope).
That endpoint accepts **three** `Authorization: Bearer …` credentials, and picks the right
one by prefix, so you almost never need to think about it:

| Credential | Prefix | Who uses it | Browser-safe? |
|---|---|---|---|
| **Public key** | `wwp_…` | Browser clients that already have a public token — **the chat widget**, `<script>` embed | Yes — env-scoped, CORS-safe |
| **Secret API key** | `wwk_…` | Server-side SDK / your backend | No — server only |
| **Widget JWT** | `eyJ…` | MCP-App widgets rendered inside tool responses, which have **no** public token (the JWT is minted server-side and injected into `_meta["waniwani/widget"]`) | Yes — short-lived |

> **Don't reach for a widget JWT just because the client is a browser.** The JWT exists
> only for the MCP-App case, where the embed has no public token. The chat widget already
> holds a `wwp_` public token (it uses it for `/chat` and `/config`), so it sends events
> with that same token — no JWT, and no bespoke per-event endpoint. The public key
> resolves to an environment/org server-side exactly like the chat routes do.

## Getting a client

The same `track` surface (callable + flat revenue helpers) exists on four surfaces.
Prefer the scoped one inside MCP request handling; use the browser ones inside widgets
and chat host pages.

**1. Scoped client — inside flows / tool handlers (recommended).** Wrap the server once
with `withWaniwani(server)`, then read `waniwani` off the node context. Meta is
pre-attached, so identity is carried for you:

```ts
import { createFlow, START, END, withWaniwani } from "@waniwani/sdk/mcp";

const quoteFlow = createFlow({ /* … */ })
  .addNode("show_quote", ({ state, waniwani }) => {
    // `waniwani` is the request-scoped client (undefined if withWaniwani() wasn't called)
    waniwani?.track.priceShown({ amount: state.premium, currency: "EUR" });
    return {};
  })
  // …
  .compile();

withWaniwani(server); // auto-captures tool.called, injects context.waniwani
```

**2. Top-level client — anywhere (server startup, your backend, scripts).** Create one
client and pass identity explicitly:

```ts
import { waniwani } from "@waniwani/sdk";

const client = waniwani(); // reads WANIWANI_API_KEY from env

await client.track.leadQualified({ email: "jane@acme.com", externalUserId: "user_123" });
await client.track.converted({ amount: 85, currency: "EUR", externalUserId: "user_123" });
```

Create the top-level client **once** (e.g. `lib/waniwani.ts`) and import it — don't
construct one per call.

**3. Widget client (inside MCP-app widgets).** `useWaniwani()` returns
`{ sessionId, track, identify, flush }` where `track` is the same typed `TrackFn`. Config
(endpoint, widget token, session id, source) comes from the `_meta["waniwani/widget"]`
object `withWaniwani` injects into tool responses. The hook is host-agnostic: it takes
that metadata as data and never opens a host connection of its own. One `widget_render`
event is emitted automatically on init.

For **skybridge-hosted** widgets, import the hook from the skybridge adapter entry and
call it bare — it reads skybridge's `useToolInfo().responseMetadata` for you:

```tsx
import { useWaniwani } from "@waniwani/sdk/mcp/react/skybridge";

const wani = useWaniwani();
wani.track.optionSelected({ id: "pro", amount: 49, currency: "EUR" });
```

On any other host, import from `@waniwani/sdk/mcp/react` and hand it the metadata your
host exposes, or an explicit endpoint:

```tsx
import { useWaniwani } from "@waniwani/sdk/mcp/react";

const wani = useWaniwani({ toolResponseMetadata }); // the host's tool-response _meta
// or, bring-your-own backend:
const wani2 = useWaniwani({ endpoint: "https://…/v2/track", source: "chatgpt" });
```

With no resolved endpoint and source, the hook is a no-op (tracks nothing).

**4. Chat host page (next to the chat widget).** The `<script>` embed exposes
`WaniWani.chat.track` / `WaniWani.chat.identify`; the `WaniwaniChat` React component
exposes the same on its `ChatHandle` ref (`track` / `identify` are absent on the bare
`ChatEmbed`, which holds no Waniwani credential). Events ride the widget's public
`wwp_` token, carry the chat `sessionId` once assigned and the anonymous `visitorId`
before that.

```js
WaniWani.chat.track.converted({ amount: 85, currency: "EUR" });
```

For custom browser surfaces, `createFrontendClient` from `@waniwani/sdk` is the
primitive both of the above wrap: pass `{ endpoint, token, source, identity }` and get
the same client. `createTrackingRoute` from `@waniwani/sdk/mcp` is its proxy
counterpart when no Waniwani credential may ship to the browser: it accepts the V2
batch envelope and forwards it with the secret key.

## Revenue helpers (typed)

All five attach **flat** on `track` (i.e. `client.track.priceShown(...)`, not
`client.track.revenue.*`). Each maps to one first-class event with a typed property
shape. Every input also accepts the shared tracking context (`sessionId`,
`externalUserId`, `meta`, …).

| Call | Event | Required properties |
|---|---|---|
| `track.priceShown({ amount, currency, itemId?, label? })` | `price_shown` | `amount`, `currency` |
| `track.pricesCompared({ options: [{ id, amount, currency }] })` | `prices_compared` | `options[]` |
| `track.optionSelected({ id, amount, currency })` | `option_selected` | `id`, `amount`, `currency` |
| `track.leadQualified({ externalId?, email?, name? })` | `lead_qualified` | none (identity still required; `externalId` is the strongest dedup key) |
| `track.converted({ amount, currency, occurredAt? })` | `converted` | `amount`, `currency` |

`occurredAt` on `converted` is an ISO timestamp for **backdating** an off-platform sale
to when it actually happened (the event may be sent months later).

## Generic and auto-captured events

The typed event names are a **closed taxonomy**, not an open string. Alongside the
revenue helpers there are a few other named events you can send with the generic
callable form `client.track({ event, properties })`: `session.started`, `tool.called`,
`quote.requested` / `quote.succeeded` / `quote.failed`, `link.clicked`,
`purchase.completed`, `user.identified`.

```ts
await client.track({ event: "quote.succeeded", properties: { amount: 120, currency: "EUR" }, externalUserId: "user_123" });
```

- **Auto-capture:** `withWaniwani(server)` emits `tool.called` for every tool
  invocation — a zero-instrumentation activity trail under your funnel. Wrapping the
  server is safe without an API key (its auto-capture is internally guarded and
  session metadata still bridges) — but your own `track.*` calls still throw keyless;
  see the tier note above.
- **KB retrieval trace:** when a wrapped tool handler calls `client.kb.search()`, the
  `tool.called` event for that tool carries `properties.kbSearch`: an array of
  `{ query, resultCount, results: [{ source, heading, score }] }`, one entry per
  search. It is metadata only — chunk bodies stay in the tool's own output. This makes
  retrieval a deterministic, first-class signal without a separate event.
- **Identify:** `client.identify(userId, properties?)` attaches a stable external
  identity to the session — useful right before an off-platform conversion so the later
  `converted` can be joined by `externalUserId`.

## Off-platform conversions (the case this taxonomy exists for)

The hard problem: a lead chats today, but the sale closes next week on your own website,
with no live MCP session. To close that loop:

1. While the user is in the funnel, capture a **stable `externalUserId`** (your own user
   id, email hash, etc.) — e.g. via `client.identify(...)` or by carrying it on a
   `lead_qualified`.
2. Later, from your **backend**, emit `converted` carrying that same `externalUserId`.
   The dashboard joins it back to the original lead.

```ts
// In your backend webhook, when the deal closes:
import { client } from "./lib/waniwani"; // the singleton created above

await client.track.converted({
  amount: 85,
  currency: "EUR",
  externalUserId: "user_123",      // same id seen during the funnel — this is the join key
  occurredAt: "2026-06-09T10:00:00Z",
});
```

If you can't run the SDK where the conversion happens, post to the public events route
directly — `POST /api/v2/mcp/events` (the old `/api/mcp/events/v2/batch` still works as
an alias). Auth is `Authorization: Bearer <token>` with an env public key (`wwp_…`,
safe client-side, CORS enabled), a widget JWT, or the secret API key (`wwk_…`).

The wire envelope is stricter than the SDK inputs — note where each field lives:
`name` (not `event`), identity inside `correlation`, and `occurredAt` inside
`properties`. `id` is the idempotency key.

```json
{
  "sentAt": "2026-06-09T10:00:05Z",
  "source": { "sdk": "acme-billing-webhook", "version": "1.0.0" },
  "events": [
    {
      "id": "evt_a1b2c3",
      "type": "mcp.event",
      "name": "converted",
      "source": "acme-billing-webhook",
      "timestamp": "2026-06-09T10:00:05Z",
      "correlation": { "externalUserId": "ada@acme.com" },
      "properties": { "amount": 85, "currency": "EUR", "occurredAt": "2026-06-09T10:00:00Z" }
    }
  ]
}
```

See [setup.md](setup.md) and [docs.waniwani.ai](https://docs.waniwani.ai) for full
contract details (partial accept/reject semantics, response shape).

## Complete example

A flow that emits the whole funnel, plus the off-platform conversion from a backend:

```ts
import { createFlow, START, END, withWaniwani } from "@waniwani/sdk/mcp";
import { z } from "zod";

export const quoteFlow = createFlow({
  id: "insurance_quote",
  title: "Insurance Quote",
  description: "Use when the user wants an insurance quote.",
  state: {
    email: z.string().describe("Work email"),
    premium: z.number().describe("Quoted monthly premium"),
  },
})
  .addNode("ask_email", ({ interrupt }) =>
    interrupt({ email: { question: "What's your email?" } }),
  )
  .addNode("qualify_lead", ({ state, waniwani }) => {
    waniwani?.identify(state.email);                       // stable identity for later join
    waniwani?.track.leadQualified({                        // QUALIFICATION bar met
      email: state.email,
    });
    return {};
  })
  .addNode("show_quote", ({ state, waniwani }) => {
    waniwani?.track.priceShown({ amount: state.premium, currency: "EUR" }); // STEP
    return {};
  })
  .addEdge(START, "ask_email")
  .addEdge("ask_email", "qualify_lead")
  .addEdge("qualify_lead", "show_quote")
  .addEdge("show_quote", END)
  .compile();

withWaniwani(server); // auto-captures tool.called; injects context.waniwani
```

```ts
// Elsewhere — your billing webhook, when the policy is actually purchased:
import { client } from "./lib/waniwani"; // one waniwani() client, created once

await client.track.converted({
  amount: 85,
  currency: "EUR",
  externalUserId: "ada@acme.com", // the email we identified during the flow
});
```

## Common mistakes

- **Event with no `sessionId` or `externalUserId`** — the ingest API rejects it and the
  SDK warns at enqueue time. Inside a flow/handler use `context.waniwani` (identity is
  automatic); from a top-level client or backend, pass `externalUserId`.
- **`context.waniwani` is `undefined`** — you didn't call `withWaniwani(server)`. The
  scoped client and auto-capture only exist once the server is wrapped.
- **Reaching for `client.track.revenue.priceShown()`** — the helpers are **flat**:
  `client.track.priceShown()`. There is no `.revenue` namespace.
- **Looking for a `step()` helper or sending a custom event name** — the taxonomy is a
  closed, typed set. Model funnel steps with `price_shown` / `prices_compared` /
  `option_selected`; emit `lead_qualified` at the qualification bar and `converted` at
  the end.
- **Emitting `lead_qualified` at flow entry** — entering a funnel is not qualifying
  (`tool.called` already covers activity). Place it at the node where your qualification
  bar is met, and fire it once per flow run.
- **Tracking call throws "WANIWANI_API_KEY is not set"** — tracking is free-tier; set
  the key (see [setup.md](setup.md)). If a code path must also run keyless, guard the
  call — inside a flow node an unguarded throw fails the whole tool call.
- **Off-platform `converted` never attributes** — the `externalUserId` on the conversion
  must match an id seen during the funnel. Capture it (via `identify` or on the `lead_qualified`)
  before the user leaves.
