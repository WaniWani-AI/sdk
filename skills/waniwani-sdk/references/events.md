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
| **Landing** | `page.viewed` | chat widget (auto) | A visitor lands on a page where the widget is present. Auto-emitted once on widget init — no code. Attributed to an anonymous `visitorId`, **not** a session. |
| **Start** | `lead` | `track.lead({ source })` | User enters the funnel with intent (asked for a quote, started a flow). |
| (start, auto) | `tool.called` | `withWaniwani(server)` | Auto-captured for every tool call — no code. |
| **Step** | `price_shown` | `track.priceShown({ amount, currency })` | You showed the user a price. |
| **Step** | `prices_compared` | `track.pricesCompared({ options })` | You showed two or more options side by side. |
| **Step** | `option_selected` | `track.optionSelected({ id, amount, currency })` | The user picked one of those options. |
| **Conversion** | `converted` | `track.converted({ amount, currency })` | The user became paying — possibly later, off-platform. |

The conceptual "start / step / conversion" maps onto these concrete events. There is
**no generic `step()` helper and no arbitrary custom event name** in the typed surface —
model your funnel steps with the revenue events above. Emitting `track.lead(...)` once
on entry and `track.converted(...)` once on the sale is the minimum that makes a funnel;
the price/compare/select steps make it *explain why* people drop off.

## The one rule you can't skip: identity

Every event must carry **`sessionId` OR `externalUserId`**. The ingest API rejects any
event with neither — there's no server-side magic that can tie an anonymous conversion
back to a session. This is the single most common mistake, so the SDK `console.warn`s
the moment you enqueue an event without identity, even though the local enqueue still
returns an id.

- **Inside a flow node or tool handler** → identity is **automatic**. The
  request-scoped client (`context.waniwani`) already carries the session metadata, so
  `sessionId` rides along with every event. You don't pass anything.
- **From a top-level client or your own backend** → there is no request context, so you
  **must pass `externalUserId`** (or `sessionId`) yourself. This is exactly how an
  off-platform `converted` finds its original lead.
- **From the chat widget at landing time** → there is no session yet (a session is only
  created on the first message). The widget satisfies the identity rule with an anonymous
  **`visitorId`** — a stable, property-derived id persisted in the browser — sent as the
  event's `externalUserId`. This is what lets `page.viewed` count landings *before* any
  conversation, and it is the funnel's denominator for "landed → started a conversation".
  Treat `visitorId` as the anonymous device/visitor key (the equivalent of an analytics
  "device id"), distinct from a `sessionId`: one visitor can land many times and may never
  start a session.

## Ingest authentication: which token goes where

All events land at one endpoint — `POST /api/mcp/events/v2/batch` (the V2 batch envelope).
That endpoint accepts **three** `Authorization: Bearer …` credentials, and picks the right
one by prefix, so you almost never need to think about it:

| Credential | Prefix | Who uses it | Browser-safe? |
|---|---|---|---|
| **Public key** | `wwp_…` | Browser clients that already have a public token — **the chat widget**, `<script>` embed | Yes — env-scoped, CORS-safe |
| **Secret API key** | `wwk_…` | Server-side SDK / your backend | No — server only |
| **Widget JWT** | `eyJ…` | MCP-App widgets rendered inside tool responses, which have **no** public token (the JWT is minted server-side and injected into `_meta`) | Yes — short-lived |

> **Don't reach for a widget JWT just because the client is a browser.** The JWT exists
> only for the MCP-App case, where the embed has no public token. The chat widget already
> holds a `wwp_` public token (it uses it for `/chat` and `/config`), so it sends events
> with that same token — no JWT, and no bespoke per-event endpoint. The public key
> resolves to an environment/org server-side exactly like the chat routes do.

## Getting a client

There are two entry points. Prefer the scoped one inside MCP request handling.

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

await client.track.lead({ source: "newsletter", externalUserId: "user_123" });
await client.track.converted({ amount: 85, currency: "EUR", externalUserId: "user_123" });
```

Create the top-level client **once** (e.g. `lib/waniwani.ts`) and import it — don't
construct one per call.

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
| `track.lead({ source? })` | `lead` | none (identity still required) |
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
- **Identify:** `client.identify(userId, properties?)` attaches a stable external
  identity to the session — useful right before an off-platform conversion so the later
  `converted` can be joined by `externalUserId`.

## Off-platform conversions (the case this taxonomy exists for)

The hard problem: a lead chats today, but the sale closes next week on your own website,
with no live MCP session. To close that loop:

1. While the user is in the funnel, capture a **stable `externalUserId`** (your own user
   id, email hash, etc.) — e.g. via `client.identify(...)` or by carrying it on a `lead`.
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
  .addNode("capture_lead", ({ state, waniwani }) => {
    waniwani?.identify(state.email);                       // stable identity for later join
    waniwani?.track.lead({ source: "mcp_chat" });          // START
    return {};
  })
  .addNode("ask_email", ({ interrupt }) =>
    interrupt({ email: { question: "What's your email?" } }),
  )
  .addNode("show_quote", ({ state, waniwani }) => {
    waniwani?.track.priceShown({ amount: state.premium, currency: "EUR" }); // STEP
    return {};
  })
  .addEdge(START, "capture_lead")
  .addEdge("capture_lead", "ask_email")
  .addEdge("ask_email", "show_quote")
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
  `option_selected`; emit `lead` at the start and `converted` at the end.
- **Tracking call throws "WANIWANI_API_KEY is not set"** — tracking is free-tier; set
  the key (see [setup.md](setup.md)). If a code path must also run keyless, guard the
  call — inside a flow node an unguarded throw fails the whole tool call.
- **Off-platform `converted` never attributes** — the `externalUserId` on the conversion
  must match an id seen during the funnel. Capture it (via `identify` or on the `lead`)
  before the user leaves.
