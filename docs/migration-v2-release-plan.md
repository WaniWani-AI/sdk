# Tracking Migration Notes and Release Plan

## Migration Summary

- New SDK versions send tracking events to `POST /api/mcp/events/v2/batch` only.
- `track()` remains backward compatible with legacy payload shapes.
- Delivery is buffered + batched with retry/backoff and auth-failure stop semantics.
- Lifecycle methods are available:
  - `flush()`
  - `shutdown({ timeoutMs? })`

## Rollout Plan

1. Ship backend V2 ingest endpoint and table (`events_v2`) in production.
2. Release SDK version with V2-only transport.
3. Validate via automated gates and manual playground checklist.
4. Roll out to selected internal SDK consumers first.
5. Expand rollout to external users.

## Rollback Strategy

- If V2 ingest health regresses, pin consumers to previous SDK release that still targets V1.
- Keep V1 endpoint active while migration is in progress.
- SDK rollback is package-version rollback (no runtime feature flag required).

## Known Failure Modes

- Missing/invalid API key (`401`/`403`): transport stops and drops queued events for the client instance.
- Retryable upstream failures (`429`, `5xx`, network): retries with exponential backoff until retry budget is exhausted.
- Persistent invalid payloads (`400`): batch is dropped as permanent failure.
- Process exits without lifecycle handling: potential event loss if integrator does not call `shutdown()` in controlled shutdown paths.

## Reviewer PR Checklist

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run build`
- [ ] `bun run test`
- [ ] Manual verification followed in `docs/playground-v2-manual-verification.md`
- [ ] API contract reviewed in `docs/events-api-v2-contract.md`
- [ ] Table schema reviewed in `docs/events-table-v2-schema.md`
- [ ] README examples verified against current public API
