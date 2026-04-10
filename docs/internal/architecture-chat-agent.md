# Chat Agent Architecture

> How MCP servers, the WaniWani SDK, and the WaniWani platform fit together.

## The Big Picture

There are three layers to understand:

1. **The MCP Server** — the product. Standalone, works with any MCP client (ChatGPT, Claude Desktop, etc.)
2. **The Chat Agent** — optional WaniWani-powered layer that adds a conversational interface on top of the MCP
3. **The WaniWani Platform** — showcases and manages agents, reuses the same infrastructure

The MCP is the interface. WaniWani offers the package to build it once, distribute it everywhere.

## Architecture Overview

```
                        MCP REPO (e.g. lassie, waniwani-website)
                   ┌──────────────────────────────────────────────┐
                   │                                              │
                   │   /mcp                 ← MCP Server          │
                   │   /api/waniwani/*      ← toNextJsHandler     │
                   │   /pricing, /book-call ← Widget pages        │
                   │   /playground          ← Dev chat UI         │
                   │                                              │
                   │   lib/                                       │
                   │   ├── tools/           ← Domain logic        │
                   │   ├── flows/           ← Multi-step flows    │
                   │   └── widgets/         ← Interactive UIs     │
                   │                                              │
                   └───────────────┬──────────────────────────────┘
                                   │
                          deployed (e.g. Vercel)
                                   │
                  ┌────────────────┼────────────────┐
                  │                │                 │
                  ▼                ▼                 ▼
          CUSTOMER WEBSITE    WANIWANI           AI CLIENTS
          (e.g. waniwani.ai)  PLATFORM          (ChatGPT, Claude)
                              (app.ww.ai)
```

### The three consumers of an MCP server:

| Consumer | Calls | Via |
|----------|-------|-----|
| **AI Clients** (ChatGPT, Claude Desktop) | `/mcp` directly | MCP protocol |
| **Customer's website** | `/mcp` indirectly (via WaniWani API) | `toNextJsHandler` on the website |
| **WaniWani platform** | `/mcp` indirectly (via WaniWani API) | WaniWani API directly |

## Detailed Request Flows

### Path A: AI Clients (ChatGPT, Claude Desktop)

Direct MCP protocol. No WaniWani involvement.

```
 ChatGPT / Claude Desktop
         │
         │  MCP protocol (tools/call, resources/read)
         ▼
    POST /mcp  (MCP Server)
         │
         ▼
    Tool executes → returns result
```

### Path B: Customer's Website (chat widget)

The customer's website (e.g. waniwani.ai) has its OWN `toNextJsHandler` that points to the deployed MCP.

```
 End User
    │
    ▼
 Chat Widget (on website)
    │
    │  POST /api/waniwani
    ▼
 Website's toNextJsHandler ─────── source: "website"
    │                               mcpServerUrl: "https://mcp.example.com/mcp"
    │  Bearer API key
    ▼
 WaniWani API (/api/mcp/chat)
    │
    │  MCP protocol
    ▼
 MCP Server (/mcp on deployed MCP repo)
    │
    ▼
 Tool executes → streams back through the whole chain
```

### Path C: WaniWani Platform (showcasing agents)

The platform calls the WaniWani API directly — no customer backend involved.

```
 WaniWani Platform (app.waniwani.ai)
    │
    │  Direct API call
    ▼
 WaniWani API (/api/mcp/chat)
    │
    │  MCP protocol
    ▼
 MCP Server (/mcp on deployed MCP repo)
```

### Path D: MCP Repo's Own Playground (development)

The MCP repo itself has a `toNextJsHandler` at `/api/waniwani` for local development/testing.

```
 Developer
    │
    ▼
 /playground page (in MCP repo)
    │
    │  POST /api/waniwani
    ▼
 MCP Repo's toNextJsHandler ─────── source: "playground"
    │                                 mcpServerUrl: "${baseURL}/mcp" (localhost/tunnel)
    │  Bearer API key
    ▼
 WaniWani API
    │
    ▼
 /mcp (same repo, loopback)
```

## The Two toNextJsHandler Instances

This is the key thing to understand. There are TWO `toNextJsHandler` mounts for any given agent:

### 1. Inside the MCP repo (development/playground)

```typescript
// MCP repo: app/api/waniwani/[[...path]]/route.ts
export const { GET, POST } = toNextJsHandler(wani, {
  source: "playground",
  chat: {
    mcpServerUrl: `${baseURL}/mcp`,  // points to itself
  },
});
```

- Used for development via `/playground`
- Points to its own `/mcp` endpoint (loopback)
- Source: `"playground"`
- **NOT used in production by the customer's website**

### 2. Inside the customer's website (production)

```typescript
// Website repo: app/api/waniwani/[[...path]]/route.ts
export const { GET, POST } = toNextJsHandler(client, {
  source: "website",
  chat: {
    mcpServerUrl: "https://mcp.example.com/mcp",  // points to deployed MCP
  },
});
```

- Used in production by end users
- Points to the deployed MCP server URL (external)
- Source: `"website"`
- This is where `beforeRequest` auth should go

### Why two?

The MCP repo needs a chat interface for development. The customer's website needs one for production. They're separate deployments pointing to the same MCP server, but with different configs and security contexts.

## Real-World Example: WaniWani Website

```
 managed/waniwani-website/          ← MCP REPO
 ├── /mcp                           ← MCP Server (tools, flows, widgets)
 ├── /api/waniwani                  ← Playground handler (source: "playground")
 └── deployed at wani-website-mcp.waniwani.run

 website/                           ← CUSTOMER WEBSITE (waniwani.ai)
 ├── /api/waniwani                  ← Production handler (source: "website")
 │   └── mcpServerUrl: "https://wani-website-mcp.waniwani.run/mcp"
 └── ChatCard in hero section
```

The website repo does NOT have an MCP server. It only has the chat handler pointing to the external MCP.

## Real-World Example: Lassie

```
 managed/lassie/                    ← MCP REPO
 ├── /mcp                           ← MCP Server (quote flow, FAQ, pricing)
 ├── /api/waniwani                  ← Playground handler (source: "playground")
 └── deployed at [lassie-mcp-url]

 [Lassie's website]                 ← CUSTOMER WEBSITE
 ├── /api/waniwani                  ← Production handler (source: "lassie-website")
 │   └── mcpServerUrl: "[lassie-mcp-url]/mcp"
 └── ChatCard / ChatEmbed
```

## The MCP Is the Product

The MCP server is standalone and contains all the domain logic:
- **Tools**: individual capabilities (FAQ search, show pricing, etc.)
- **Flows**: multi-step stateful conversations (quote flow, demo qualification)
- **Widgets**: interactive UIs rendered in iframes (booking calendar, pricing cards)
- **Knowledge base**: embedded docs for FAQ search

The `toNextJsHandler` is just a thin proxy that connects a chat UI to the MCP via the WaniWani API. The MCP doesn't know or care who's calling it — ChatGPT, Claude, the customer's website, or the WaniWani platform all look the same.

## Security Model

```
                    WHO               BOUNDARY              RESPONSIBILITY
                    ─────             ────────              ──────────────

 AI Clients ──────► /mcp              MCP protocol          MCP server itself
                                      (no auth by default)

 End Users ───────► /api/waniwani     beforeRequest hook     Customer
                    (website)

 WaniWani ────────► WaniWani API      API key                WaniWani
 Platform           directly
```

### The open endpoint problem

The customer's `/api/waniwani` is open by default. CORS is permissive (`Access-Control-Allow-Origin: *`) so any domain can call it — CORS is not an abuse defense, it only stops browsers on other origins from reading responses, not scripts/curl/servers. Without additional protection, anyone can POST and start chatting.

**Customer's responsibility:**

1. **`beforeRequest` hook** — check session cookies, JWTs, or any auth token. Throw to reject.

```typescript
toNextJsHandler(client, {
  beforeRequest: async ({ request }) => {
    const session = await getSession(request);
    if (!session) throw new Error("Unauthorized");
  }
});
```

2. **Rate limiting** — at the infra level (Vercel/Cloudflare rate limiting)

**WaniWani should consider adding:**
- Built-in rate limiter option in `toNextJsHandler` (IP + session based)
- Server-side abuse detection (flag abnormal session volumes)

## Current Quirk: Platform Showcase

The WaniWani platform wants to showcase agents using real conversations. Today it calls the WaniWani API directly (Path C). This works, but there's a subtlety:

- The MCP repo's `/api/waniwani` (playground) is a development tool, not meant for production showcase
- The customer's `/api/waniwani` (website) is for end users, not for the platform
- The platform bypasses both and calls the API directly

This is actually the cleanest approach — the platform doesn't need a proxy, it owns the API. Just ensure `source` tracking distinguishes platform sessions from real user sessions.

## Key SDK Files

| File | Purpose |
|------|---------|
| `src/chat/server/next-js/index.ts` | `toNextJsHandler` entry point |
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
