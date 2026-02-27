# Playground Manual V2 Verification

## Purpose

Repeatable manual flow to validate SDK tracking behavior against a local V2 ingest mock.

## Prerequisites

- Bun installed
- Terminal access to this repository root

## 1) Run Quality Gates

```bash
bun run typecheck && bun run lint && bun run build && bun run test
```

## 2) Start Local Mock V2 Ingest

Terminal A:

```bash
cd playground
bun run mock-ingest
```

Optional failure modes:

```bash
cd playground
WW_MOCK_MODE=transient bun run mock-ingest
WW_MOCK_MODE=partial bun run mock-ingest
WW_MOCK_MODE=auth bun run mock-ingest
```

## 3) Start Playground UI

Terminal B:

```bash
cd playground
WANIWANI_API_KEY=playground-dev-key MCP_SERVER_URL=http://localhost:3001/mcp bun run dev
```

## 4) Start Demo MCP App

Terminal C:

```bash
cd playground
bun run mcp
```

## 5) Emit and Inspect V2 Events

1. Open `http://localhost:3333`
2. Click `Emit V2 Event` (top-right)
3. Confirm status badge shows emitted events
4. Inspect captured batches:

```bash
curl -s http://localhost:3000/events
```

## Success Checklist

- [ ] Request path is `/api/mcp/events/v2/batch`
- [ ] Batch envelope includes `sentAt`, `source`, and `events[]`
- [ ] Event envelope includes `id`, `type`, `name`, `source`, `timestamp`, `correlation`, `properties`, `metadata`
- [ ] Legacy-style emitted event includes mapped canonical properties and `rawLegacy`
- [ ] At least one modern event appears in same flow (`quote.succeeded`)

## Failure-Path Checklist

### Transient retry (`WW_MOCK_MODE=transient`)

- [ ] First ingest call fails with `503`
- [ ] SDK retries automatically
- [ ] Final ingest succeeds

### Partial retry (`WW_MOCK_MODE=partial`)

- [ ] First ingest returns `rejected[]` with `retryable=true`
- [ ] SDK retries the rejected event(s)

### Auth stop (`WW_MOCK_MODE=auth`)

- [ ] First ingest returns `401`
- [ ] Transport enters stopped mode
- [ ] Subsequent emit attempts do not create new ingest calls (verify via `/events` count)

## Reset Mock State

```bash
curl -X POST -s http://localhost:3000/reset
```
