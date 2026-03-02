# @waniwani

SDK for [app.waniwani.ai](https://app.waniwani.ai) with MCP tracking, widget helpers, and chat tooling.

## Warning

This is pre-alpha software:

- APIs can change without notice
- Behavior can change between releases

## Installation

```bash
npm install @waniwani
```

## Quick Start

```typescript
import { waniwani } from "@waniwani";

const client = waniwani({
  apiKey: "your-api-key", // or WANIWANI_API_KEY
});

const { eventId } = await client.track({
  event: "tool.called",
  properties: { name: "pricing", type: "pricing" },
  meta: extra._meta,
});

await client.flush();
```

## Events API V2

New SDK versions send tracking data to **V2 only**:

- Endpoint: `POST /api/mcp/events/v2/batch`
- Transport: buffered batching with immediate scheduling, interval flush, size-threshold flush
- Resilience: retry/backoff on transient failures, permanent stop on auth failures

Legacy `track()` input shapes remain supported and are mapped internally to canonical V2 events.

## API

### `waniwani(config?)`

```typescript
const client = waniwani({
  apiKey: "...", // defaults to WANIWANI_API_KEY env var
  baseUrl: "...", // defaults to https://app.waniwani.ai
  tracking: {
    endpointPath: "/api/mcp/events/v2/batch",
    flushIntervalMs: 1000,
    maxBatchSize: 20,
    maxBufferSize: 1000,
    maxRetries: 3,
    retryBaseDelayMs: 200,
    retryMaxDelayMs: 2000,
    shutdownTimeoutMs: 2000,
  },
});
```

### `client.track(event)`

Accepts modern and legacy shapes and returns `{ eventId: string }` immediately after enqueue.

Modern shape:

```typescript
await client.track({
  event: "quote.succeeded",
  properties: { amount: 99, currency: "USD" },
  meta: extra._meta,
});
```

Legacy-compatible shape:

```typescript
await client.track({
  eventType: "tool.called",
  sessionId: "session-123",
  toolName: "pricing",
  toolType: "pricing",
  metadata: { source: "legacy" },
});
```

### `client.flush()`

Flushes buffered events.

### `client.shutdown(options?)`

Flushes and stops transport. Returns:

```typescript
{ timedOut: boolean; pendingEvents: number }
```

## Event Types

- `session.started`
- `tool.called`
- `quote.requested`
- `quote.succeeded`
- `quote.failed`
- `link.clicked`
- `purchase.completed`

## Declarative Event Tracking

Track conversions and funnel steps without writing JavaScript — just add data attributes to your HTML elements.

### `data-ww-conversion`

Fires a conversion event on click. Format: `name key:value key:value ...`

```html
<button data-ww-conversion="purchase value:49.99 currency:EUR">Buy Now</button>
<button data-ww-conversion="signup">Sign Up Free</button>
```

| Token | Description |
|-------|-------------|
| First token | Conversion name (required) |
| `value:N` | Numeric conversion value (defaults to `0`) |
| `currency:X` | Currency code (defaults to `USD`) |
| Any `key:value` | Included as event metadata |

### `data-ww-step`

Fires a funnel step event on click with an auto-incrementing sequence number. Format: `name key:value key:value ...`

```html
<button data-ww-step="pricing">View Pricing</button>
<button data-ww-step="select-plan plan:premium">Select Plan</button>
<button data-ww-step="checkout">Checkout</button>
```

Clicking these in order produces steps with `step_sequence` 1, 2, 3. Extra `key:value` pairs are included as event metadata.

Both attributes use `closest()` to walk up the DOM tree, so clicking a child element (e.g. an icon inside a button) works automatically.

## Quality Gates

Run from repo root:

```bash
bun run typecheck && bun run lint && bun run build && bun run test
```

## Verification and Contracts

- Manual playground flow: [`docs/playground-v2-manual-verification.md`](docs/playground-v2-manual-verification.md)
- Events API V2 contract: [`docs/events-api-v2-contract.md`](docs/events-api-v2-contract.md)
- Events table V2 proposal: [`docs/events-table-v2-schema.md`](docs/events-table-v2-schema.md)
- Migration and release plan: [`docs/migration-v2-release-plan.md`](docs/migration-v2-release-plan.md)

## License

MIT
