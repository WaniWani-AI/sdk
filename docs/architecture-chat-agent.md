# Chat Agent Architecture

> How the WaniWani SDK connects end-user chat widgets to customer agents via the WaniWani API.

## Overview

The SDK provides an embeddable chat widget + a server-side proxy (`toNextJsHandler`) that customers mount on their backend. The WaniWani platform reuses the same API to showcase agents directly.

## Request Flow

```
                        CUSTOMER INFRA                           WANIWANI CLOUD
                    ┌─────────────────────┐               ┌──────────────────────┐
                    │                     │               │                      │
 ┌──────────┐      │  ┌───────────────┐  │   Bearer key  │  ┌──────────────┐   │
 │  Chat     │ POST │  │toNextJsHandler│  │ ────────────> │  │ WaniWani API │   │
 │  Widget   │ ───> │  │/api/waniwani/*│  │               │  │ /api/mcp/chat│   │
 │ (browser) │ <─── │  │               │  │ <──────────── │  │              │   │
 │           │  SSE │  │ beforeRequest │  │   SSE stream  │  └──────┬───────┘   │
 └──────────┘      │  │    hook       │  │               │         │           │
                    │  └───────────────┘  │               │         │tools/call │
                    │                     │               │         ▼           │
                    └─────────────────────┘               │  ┌──────────────┐   │
                                                          │  │  MCP Server  │   │
 ┌───────────────┐                                        │  │(customer's   │   │
 │ WaniWani      │  direct call (same API, no proxy)      │  │ tools)       │   │
 │ Platform      │ ─────────────────────────────────────> │  └──────────────┘   │
 │ (app.ww.ai)   │                                        │                      │
 └───────────────┘                                        └──────────────────────┘
```

## Components

### Client-side: Chat Widget (`src/chat/web/`)

- React component (`<ChatBar>`, `<ChatEmbed>`) embedded on the customer's website
- Collects visitor context: UA, device, screen, timezone, language, referrer
- Generates a stable `visitorId` (SHA256 hash stored in localStorage)
- Sends messages via POST to the customer's API endpoint
- Receives SSE stream back and renders the conversation

### Server-side: `toNextJsHandler` (`src/chat/server/`)

A thin API gateway mounted on the customer's backend (e.g. `app/api/waniwani/[[...path]]/route.ts`).

**Routes exposed:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/waniwani` | Chat — proxies messages to WaniWani API |
| POST | `/api/waniwani/tool` | Tool call — direct MCP tool execution |
| GET | `/api/waniwani/resource?uri=...` | Widget HTML — serves MCP resource content |
| GET | `/api/waniwani/config` | Debug info (debug/eval flags) |
| GET/POST | `/api/waniwani/scenarios` | Eval mode only (requires `WANIWANI_EVAL=1`) |

**What it does on each chat request:**

1. Parses the request body (messages, sessionId, modelContext)
2. Extracts geo from platform headers (Vercel `x-vercel-ip-*`, Cloudflare `cf-*`)
3. Runs the `beforeRequest` hook (customer's custom auth/logic)
4. Resolves the MCP server URL via WaniWani config API (cached 5min)
5. Proxies to `POST /api/mcp/chat` with `Authorization: Bearer <apiKey>`
6. Streams the SSE response back to the client

### WaniWani API (`/api/mcp/chat`)

- Validates the API key
- Orchestrates the LLM conversation with the customer's MCP server
- Calls tools on the MCP server as needed
- Streams responses back

### MCP Server (customer-owned)

- The actual agent logic and tools
- Hosted wherever the customer wants (same repo, separate service, etc.)
- Called by the WaniWani API via MCP protocol (`tools/call`)

## Security Model

```
 Browser ──────> Customer Backend ──────> WaniWani API ──────> MCP Server
   │                    │                       │                    │
   │  NO auth by       │  beforeRequest hook   │  API key          │  MCP protocol
   │  default           │  (customer's auth)    │  (validated)      │  (trusted)
   │                    │                       │                    │
   ▼                    ▼                       ▼                    ▼
 OPEN               CUSTOMER'S              WANIWANI'S           INTERNAL
                    RESPONSIBILITY          RESPONSIBILITY
```

### What's protected today

- **API key**: stays on the server, never sent to the browser. Used as `Bearer` token on all upstream requests.
- **Session management**: `x-session-id` header round-trip. WaniWani API creates/validates sessions.
- **Source tracking**: `source` option identifies which chat instance sent the request (for analytics separation).
- **Auth failure handling**: 401/403 from WaniWani API immediately stops the transport and drops all buffered events.

### What customers MUST do

The `/api/waniwani` endpoint is open by default. Without additional protection, anyone can POST to it and start chatting. Customers should:

1. **Use `beforeRequest` hook** — check session cookies, JWTs, or any auth token. Throw to reject.

```typescript
toNextJsHandler(client, {
  beforeRequest: async ({ request }) => {
    const session = await getSession(request);
    if (!session) throw new Error("Unauthorized");
  }
});
```

2. **Add rate limiting** — at the infra level (Vercel/Cloudflare rate limiting on `/api/waniwani/*`)
3. **Configure CORS** — only allow their own domain(s)

### What WaniWani should consider adding

- **Built-in rate limiter option** in `toNextJsHandler` (e.g. `rateLimit: { windowMs: 60000, max: 20 }`)
- **Default CORS helper** in the handler options
- **Server-side abuse detection** — flag sessions with abnormal message volumes at the API level
- **Documentation** making it explicit that `beforeRequest` is the auth boundary

## Platform Reuse (WaniWani App showcasing agents)

The WaniWani platform (app.waniwani.ai) reuses the same architecture to showcase customer agents:

```
 Path A (end user):    Chat Widget → Customer's /api/waniwani → WaniWani API → MCP Server
 Path B (platform):    WaniWani App → WaniWani API directly   →                MCP Server
```

- Path B skips the customer's backend entirely — WaniWani owns the API
- The MCP server doesn't know or care which path called it
- Conversations are real (not simulated), using the actual agent
- Sessions from Path B should use a distinct `source` value (e.g. `"waniwani-platform"`) to keep analytics clean

### Why this is sound

- One agent (MCP server), two clients (customer widget, WaniWani platform), one shared API layer
- Standard BFF (Backend-for-Frontend) proxy pattern — same as Stripe, Intercom, etc.
- The customer embeds a client-side widget, it talks to their backend, which proxies to the vendor API with a secret key
- No duplication of agent logic, no "demo mode" vs "real mode" divergence

## Key Files

| File | Purpose |
|------|---------|
| `src/chat/server/next-js/index.ts` | `toNextJsHandler` — entry point |
| `src/chat/server/api-handler.ts` | Core router (routeGet, routePost) |
| `src/chat/server/handle-chat.ts` | Chat proxy to WaniWani API |
| `src/chat/server/handle-tool.ts` | Direct MCP tool execution |
| `src/chat/server/handle-resource.ts` | MCP widget HTML serving |
| `src/chat/server/mcp-config-resolver.ts` | MCP URL resolution (5min cache) |
| `src/chat/server/geo.ts` | Geo extraction from platform headers |
| `src/chat/server/@types.ts` | `BeforeRequestContext`, handler options |
| `src/chat/web/hooks/use-chat-engine.ts` | Client-side request builder |
| `src/chat/web/hooks/use-call-tool.ts` | Tool call dispatcher |
| `src/chat/web/lib/visitor-context.ts` | Visitor fingerprinting |
| `src/tracking/transport.ts` | Event batch transport with retry |
