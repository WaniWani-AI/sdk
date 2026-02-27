# WaniWani App: Widget Token Minting & Auth

Implementation plan for adding widget token support to the WaniWani backend app, enabling browser-side widgets to send tracking events directly without a server-side proxy.

## Architecture

```
MCP Server (withWaniwani)
  │
  ├─ POST /api/mcp/widget-tokens  (API key auth)
  │   → Returns short-lived JWT
  │   → Injects { token, endpoint } into tool response _meta.waniwani
  │
  └─ Browser Widget (useWaniwani)
      → POST /api/mcp/events/v2/batch  (JWT auth)
      → Events go directly to the WaniWani backend
```

## Changes Required

### 1. Create Widget Token Minting Endpoint

**File**: `src/app/api/mcp/widget-tokens/route.ts`

**Method**: `POST /api/mcp/widget-tokens`

**Auth**: Existing `authenticateApiKey()` from `src/lib/mcp/analytics/@auth.ts`

**Request body**:
```json
{
  "sessionId": "optional-session-id",
  "traceId": "optional-trace-id"
}
```

**Response**:
```json
{
  "token": "eyJ...",
  "expiresAt": "2026-02-26T10:15:00.000Z"
}
```

**Implementation**:
```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/mcp/analytics/@auth";

const bodySchema = z.object({
  sessionId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
}).strict();

// Widget tokens expire after 15 minutes
const TOKEN_EXPIRY_SECONDS = 15 * 60;

// Use AUTH_SECRET env var (same as Better Auth uses for JWT signing)
function getSigningKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET not configured");
  return new TextEncoder().encode(secret);
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate via API key (same as other MCP endpoints)
    const { environmentId, orgId } = await authenticateApiKey(request);

    // 2. Parse optional body
    let body: z.infer<typeof bodySchema> = {};
    try {
      const raw = await request.json();
      const parsed = bodySchema.safeParse(raw);
      if (parsed.success) body = parsed.data;
    } catch {
      // Empty body is fine — sessionId/traceId are optional
    }

    // 3. Mint JWT
    const now = Math.floor(Date.now() / 1000);
    const exp = now + TOKEN_EXPIRY_SECONDS;

    const token = await new SignJWT({
      eid: environmentId,
      oid: orgId,
      sid: body.sessionId,
      tid: body.traceId,
      scope: "widget:events",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(getSigningKey());

    return NextResponse.json({
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("API_KEY")) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("[Widget Token Error]", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
```

### 2. Create Widget Token Verification Utility

**File**: `src/lib/mcp/analytics/@widget-auth.ts`

This utility verifies widget JWTs and returns the same `McpApiKeyContext`-compatible shape so the events route can use either auth method.

```typescript
import { jwtVerify } from "jose";

const WIDGET_TOKEN_PREFIX = "eyJ"; // JWT always starts with base64-encoded "{"

export interface WidgetTokenContext {
  environmentId: string;
  orgId: string;
  sessionId?: string;
  traceId?: string;
}

function getSigningKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET not configured");
  return new TextEncoder().encode(secret);
}

export function isWidgetToken(token: string): boolean {
  return token.startsWith(WIDGET_TOKEN_PREFIX);
}

export async function verifyWidgetToken(token: string): Promise<WidgetTokenContext> {
  const { payload } = await jwtVerify(token, getSigningKey(), {
    algorithms: ["HS256"],
  });

  const scope = payload.scope as string | undefined;
  if (scope !== "widget:events") {
    throw new Error("Invalid token scope");
  }

  const eid = payload.eid as string | undefined;
  const oid = payload.oid as string | undefined;

  if (!eid || !oid) {
    throw new Error("Invalid widget token: missing environment or org ID");
  }

  return {
    environmentId: eid,
    orgId: oid,
    sessionId: payload.sid as string | undefined,
    traceId: payload.tid as string | undefined,
  };
}
```

### 3. Update V2 Batch Events Route Auth

**File**: `src/app/api/mcp/events/v2/batch/route.ts`

Update the `POST` handler to accept **either** an API key (`wwk_*`) or a widget JWT.

**Changes** (modify the existing auth block near line 140):

```typescript
// Add import at top of file
import { isWidgetToken, verifyWidgetToken } from "@/lib/mcp/analytics/@widget-auth";

// Replace the single authenticateApiKey call with dual-auth:
export async function POST(request: NextRequest) {
  const requestId = getRequestId();

  try {
    // --- AUTH: Accept either API key (wwk_*) or widget JWT ---
    let environmentId: string;
    let orgId: string;

    const authHeader = request.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (bearerToken && isWidgetToken(bearerToken)) {
      // Widget JWT auth
      try {
        const ctx = await verifyWidgetToken(bearerToken);
        environmentId = ctx.environmentId;
        orgId = ctx.orgId;
      } catch {
        return NextResponse.json(
          { error: "INVALID_WIDGET_TOKEN", requestId },
          { status: 401 }
        );
      }
    } else {
      // API key auth (existing behavior)
      const ctx = await authenticateApiKey(request);
      environmentId = ctx.environmentId;
      orgId = ctx.orgId;
    }

    // ... rest of the handler stays the same, using environmentId and orgId ...
```

### 4. Add CORS Headers for Widget Requests

**File**: `src/app/api/mcp/events/v2/batch/route.ts`

Add an `OPTIONS` handler and CORS headers to the POST response so browser widgets can call the endpoint directly.

```typescript
// Add OPTIONS handler for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

// In the POST handler, add CORS headers to every response:
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Apply to all NextResponse.json calls, e.g.:
return NextResponse.json(
  { accepted, requestId },
  { status: 200, headers: corsHeaders }
);
```

### 5. Relax Metadata Schema Validation

**File**: `src/app/api/mcp/events/v2/batch/route.ts`

The current `metadataSchema` uses `.strict()` which rejects any extra keys. Widget events send richer metadata (viewport info, click coordinates, etc.) in the `metadata` field. Change from `.strict()` to `.passthrough()`:

```typescript
// Before:
const metadataSchema = z
  .object({
    meta: z.record(z.string(), z.unknown()).optional(),
    rawLegacy: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// After:
const metadataSchema = z
  .object({
    meta: z.record(z.string(), z.unknown()).optional(),
    rawLegacy: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
```

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/app/api/mcp/widget-tokens/route.ts` | **Create** | New endpoint to mint widget JWTs |
| `src/lib/mcp/analytics/@widget-auth.ts` | **Create** | Widget JWT verification utility |
| `src/app/api/mcp/events/v2/batch/route.ts` | **Modify** | Accept widget JWTs + add CORS + relax metadata schema |

## Testing

1. **Mint a token**:
```bash
curl -X POST http://localhost:3000/api/mcp/widget-tokens \
  -H "Authorization: Bearer wwk_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test-session"}'
```

2. **Send events with widget token**:
```bash
curl -X POST http://localhost:3000/api/mcp/events/v2/batch \
  -H "Authorization: Bearer <jwt-from-step-1>" \
  -H "Content-Type: application/json" \
  -d '{
    "sentAt": "2026-02-26T10:00:00.000Z",
    "source": { "sdk": "@waniwani/sdk", "version": "0.1.20" },
    "events": [{
      "id": "evt_test-1",
      "type": "mcp.event",
      "name": "widget_click",
      "source": "widget",
      "timestamp": "2026-02-26T10:00:00.000Z",
      "correlation": { "sessionId": "test-session" },
      "properties": { "target_tag": "button" },
      "metadata": {}
    }]
  }'
```

3. **Verify existing API key auth still works** (regression):
```bash
curl -X POST http://localhost:3000/api/mcp/events/v2/batch \
  -H "Authorization: Bearer wwk_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{ ... same batch payload ... }'
```

4. **Verify expired token is rejected** (mint a token, wait 15 min or mock expiry, try to use it).

5. **Verify CORS preflight works**:
```bash
curl -X OPTIONS http://localhost:3000/api/mcp/events/v2/batch \
  -H "Origin: https://some-widget.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type, Authorization" \
  -v
```

## Notes

- The `jose` library is already a dependency (used for Better Auth JWKS verification).
- `AUTH_SECRET` env var is already set in all environments.
- `MCP_EVENT_V2_NAME_ENUM` already includes the widget event types (`widget_render`, `widget_click`, etc.).
- The widget token has a `scope: "widget:events"` claim to prevent misuse — it can only be used for event ingestion, not for other API key-protected endpoints.
