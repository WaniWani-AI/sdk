# KvStore adapters

`createFlow` persists flow state through the tiny `KvStore` interface from `@waniwani/sdk/mcp`. Implement it against any backend you have — Redis, Upstash, Cloudflare KV, DynamoDB, SQLite, a Postgres table, anything with `get`/`set`/`delete`.

## Interface

```ts
export interface KvStore<T = Record<string, unknown>> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}
```

The engine handles serialization, session-key derivation, expiry semantics, and concurrency. Your adapter only has to ferry plain JSON-serializable values.

## Built-in implementations

### `MemoryKvStore` (OSS, dev only)

```ts
import { MemoryKvStore } from "@waniwani/sdk/mcp";

const flow = createFlow({ /* … */ }).compile({ store: new MemoryKvStore() });
```

In-process `Map`. Lost on restart. Use for local development, unit tests, and one-off scripts.

### `WaniwaniKvStore` (free tier, hosted)

Selected automatically when `WANIWANI_API_KEY` is set and no explicit `store` is passed:

```ts
// env: WANIWANI_API_KEY=wwk_...
const flow = createFlow({ /* … */ }).compile(); // ← no store argument
```

Persists against `app.waniwani.ai`. State survives restarts and shows up in the dashboard with funnel analytics.

## Adapter recipes

### Upstash Redis (serverless, HTTP)

Works on Vercel, Netlify, Cloudflare Workers, anywhere with HTTP egress.

```ts
import type { KvStore } from "@waniwani/sdk/mcp";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const upstashStore: KvStore = {
  async get(key) {
    return (await redis.get(key)) as never;
  },
  async set(key, value) {
    await redis.set(key, value);
  },
  async delete(key) {
    await redis.del(key);
  },
};
```

### Node Redis (`ioredis`)

Long-running Node servers with a managed Redis (Render, Railway, Fly, ElastiCache).

```ts
import type { KvStore } from "@waniwani/sdk/mcp";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);

export const redisStore: KvStore = {
  async get(key) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  async set(key, value) {
    await redis.set(key, JSON.stringify(value));
  },
  async delete(key) {
    await redis.del(key);
  },
};
```

### Cloudflare Workers KV

```ts
import type { KvStore } from "@waniwani/sdk/mcp";

export function cloudflareKvStore(ns: KVNamespace): KvStore {
  return {
    async get(key) {
      return ns.get<Record<string, unknown>>(key, "json");
    },
    async set(key, value) {
      await ns.put(key, JSON.stringify(value));
    },
    async delete(key) {
      await ns.delete(key);
    },
  };
}

// In your worker:
const flow = createFlow({ /* … */ }).compile({
  store: cloudflareKvStore(env.FLOW_STATE_KV),
});
```

Bind the KV namespace in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "FLOW_STATE_KV"
id = "..."
```

### DynamoDB

```ts
import type { KvStore } from "@waniwani/sdk/mcp";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = "flow_state";

export const dynamoStore: KvStore = {
  async get(key) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: key } }));
    return (res.Item?.value as never) ?? null;
  },
  async set(key, value) {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: key, value } }));
  },
  async delete(key) {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: key } }));
  },
};
```

DynamoDB table needs a single string partition key named `pk`. No sort key required.

### SQLite (`better-sqlite3`)

Quick local persistence without standing up a separate service.

```ts
import type { KvStore } from "@waniwani/sdk/mcp";
import Database from "better-sqlite3";

const db = new Database("flow-state.db");
db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)");

const getStmt = db.prepare("SELECT value FROM kv WHERE key = ?");
const setStmt = db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)");
const delStmt = db.prepare("DELETE FROM kv WHERE key = ?");

export const sqliteStore: KvStore = {
  async get(key) {
    const row = getStmt.get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  },
  async set(key, value) {
    setStmt.run(key, JSON.stringify(value));
  },
  async delete(key) {
    delStmt.run(key);
  },
};
```

### Postgres (drizzle-orm)

```ts
import type { KvStore } from "@waniwani/sdk/mcp";
import { drizzle } from "drizzle-orm/postgres-js";
import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import postgres from "postgres";

const flowState = pgTable("flow_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
});

const db = drizzle(postgres(process.env.DATABASE_URL!));

export const postgresStore: KvStore = {
  async get(key) {
    const [row] = await db.select().from(flowState).where(eq(flowState.key, key));
    return row?.value ?? null;
  },
  async set(key, value) {
    await db
      .insert(flowState)
      .values({ key, value })
      .onConflictDoUpdate({ target: flowState.key, set: { value } });
  },
  async delete(key) {
    await db.delete(flowState).where(eq(flowState.key, key));
  },
};
```

## What gets stored

Each MCP session maps to one key. The engine stores:

- The current node name (or `END` when complete)
- The merged state object so far
- A pending widget reference, if the current node is a `showWidget` step

Keys are derived from `_meta.waniwani/sessionId` (or `Mcp-Session-Id` when transport-bridged). Values are JSON-serializable plain objects. No binary data, no large blobs.

## Choosing a backend

| Goal | Pick |
|---|---|
| Local dev, tests, ephemeral | `MemoryKvStore` |
| Zero infra, dashboards + funnel included | `WaniwaniKvStore` (free tier) |
| Vercel / Netlify / serverless edge | Upstash Redis |
| Cloudflare Workers | Workers KV |
| AWS Lambda | DynamoDB |
| Long-running Node + managed Redis | `ioredis` |
| Have a Postgres database already | Postgres adapter |
| Single-node Node.js with persistence | SQLite |

## Encryption at rest

If your backend cannot guarantee encryption at rest and your flow state contains sensitive fields (mark them with `redacted()` in the state schema first), wrap your adapter with envelope encryption. `WaniwaniKvStore` already does this when `WANIWANI_ENCRYPTION_KEY` is set; you can reuse the same helpers from `src/mcp/server/kv/crypto.ts` for your own adapter.
