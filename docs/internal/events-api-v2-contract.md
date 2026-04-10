# Events API V2 Contract

## Scope

This document defines the backend contract for SDK tracking ingestion used by new `@waniwani/sdk` releases.

- New SDK versions write to V2 only: `POST /api/mcp/events/v2/batch`
- Older SDK versions may continue writing to V1: `POST /api/mcp/events`

## Endpoint

`POST /api/mcp/events/v2/batch`

## Required Headers

- `Authorization: Bearer <apiKey>`
- `Content-Type: application/json`

## Optional Headers

- `X-WaniWani-SDK: @waniwani/sdk`

## Request Schema

```json
{
  "sentAt": "2026-02-26T10:00:00.000Z",
  "source": {
    "sdk": "@waniwani/sdk",
    "version": "0.1.0"
  },
  "events": [
    {
      "id": "evt_123",
      "type": "mcp.event",
      "name": "tool.called",
      "source": "@waniwani/sdk",
      "timestamp": "2026-02-26T10:00:00.000Z",
      "correlation": {
        "sessionId": "session_1",
        "traceId": "trace_1",
        "requestId": "req_1",
        "correlationId": "corr_1",
        "externalUserId": "user_1"
      },
      "properties": {
        "name": "pricing",
        "type": "pricing"
      },
      "metadata": {
        "meta": {
          "openai/sessionId": "session_1"
        },
        "rawLegacy": {
          "eventType": "tool.called",
          "toolName": "pricing"
        }
      },
      "rawLegacy": {
        "eventType": "tool.called",
        "toolName": "pricing"
      }
    }
  ]
}
```

## Response Schema

### Full Success (`200`)

```json
{
  "accepted": 10,
  "requestId": "ingest_req_123"
}
```

### Partial Success (`200`)

```json
{
  "accepted": 8,
  "rejected": [
    {
      "eventId": "evt_9",
      "code": "temporary_unavailable",
      "message": "retry later",
      "retryable": true
    },
    {
      "eventId": "evt_10",
      "code": "validation_failed",
      "message": "invalid schema",
      "retryable": false
    }
  ],
  "requestId": "ingest_req_124"
}
```

## Error Semantics

- `400`: Permanent validation/client error. SDK does not retry these batches.
- `401`, `403`: Permanent auth error. SDK stops transport and drops subsequent events for that client instance.
- `408`, `425`, `429`, `5xx`: Retryable. SDK retries with exponential backoff.

## Server Expectations

- Preserve order of `events` as received in each batch.
- Return `eventId` in `rejected[]` for any non-accepted event.
- Set `retryable=true` for retry-safe rejections.
- Keep `requestId` stable for traceability in logs.

## Compatibility with Old SDK Versions

- V1 endpoint (`/api/mcp/events`) must remain available for older SDK releases.
- V2 backend implementation must not assume dual-write behavior from SDK.
- Migration safety depends on endpoint-version routing, not payload sniffing.
