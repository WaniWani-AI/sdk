# Events Table V2 Schema Proposal

## Goal

Provide a hybrid schema:

- Typed core columns for common analytics filters and joins
- `jsonb` payload columns for long-tail event details
- Optional `raw_legacy` payload for migration observability

## Proposed PostgreSQL Table

```sql
create table if not exists events_v2 (
  id bigserial primary key,
  ingested_at timestamptz not null default now(),

  -- Canonical envelope
  event_id text not null,
  event_type text not null,
  event_name text not null,
  source text not null,
  occurred_at timestamptz not null,

  -- Correlation
  session_id text,
  trace_id text,
  request_id text,
  correlation_id text,
  external_user_id text,

  -- Flexible payload
  properties jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  raw_legacy jsonb,

  constraint events_v2_event_id_uniq unique (event_id)
);
```

## Constraints and Validation

- `event_id` must be unique for idempotent ingest.
- `event_type` expected value from SDK today: `mcp.event`.
- `event_name` expected values today:
  - `session.started`
  - `tool.called`
  - `quote.requested`
  - `quote.succeeded`
  - `quote.failed`
  - `link.clicked`
  - `purchase.completed`

## Recommended Indexes

```sql
create index if not exists events_v2_occurred_at_idx
  on events_v2 (occurred_at desc);

create index if not exists events_v2_event_name_occurred_at_idx
  on events_v2 (event_name, occurred_at desc);

create index if not exists events_v2_session_id_occurred_at_idx
  on events_v2 (session_id, occurred_at desc)
  where session_id is not null;

create index if not exists events_v2_trace_id_idx
  on events_v2 (trace_id)
  where trace_id is not null;

create index if not exists events_v2_request_id_idx
  on events_v2 (request_id)
  where request_id is not null;

create index if not exists events_v2_properties_gin_idx
  on events_v2 using gin (properties jsonb_path_ops);

create index if not exists events_v2_metadata_gin_idx
  on events_v2 using gin (metadata jsonb_path_ops);
```

## Common Query Patterns

Top event names by day:

```sql
select date_trunc('day', occurred_at) as day, event_name, count(*)
from events_v2
where occurred_at >= now() - interval '30 days'
group by 1, 2
order by 1 desc, 3 desc;
```

Session timeline:

```sql
select occurred_at, event_name, properties
from events_v2
where session_id = $1
order by occurred_at asc;
```

Quote conversion rate:

```sql
with q as (
  select
    count(*) filter (where event_name = 'quote.requested') as requested,
    count(*) filter (where event_name = 'quote.succeeded') as succeeded
  from events_v2
  where occurred_at >= now() - interval '30 days'
)
select succeeded::float / nullif(requested, 0) as conversion_rate
from q;
```

## Backward Compatibility Expectations

- Keep V1 table/API ingest online for old SDK versions.
- V2 table is additive and does not require immediate backfill.
- Optional backfill can map V1 records into V2 shape later.
