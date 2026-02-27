/**
 * Next.js 16 Proxy (replaces middleware.ts)
 *
 * PURPOSE: Adds CORS headers for widget iframe embedding in ChatGPT/Claude.
 * Widgets run in sandboxed iframes at different origins, requiring CORS headers
 * for cross-origin fetch requests and RSC navigation.
 *
 * @see https://vercel.com/blog/running-next-js-inside-chatgpt-a-deep-dive-into-native-app-integration
 *
 * IMPORTANT NOTES:
 *
 * 1. In Next.js 16, proxy.ts runs on Node.js runtime (not Edge).
 *    The function MUST return a valid Response object.
 *
 * 2. MCP endpoints (/mcp, /sse, /message) are EXCLUDED from this proxy.
 *    The mcp-handler package handles these routes directly.
 *    Including them causes "Expected an instance of Response" errors.
 *
 * 3. CORRECT pattern for setting response headers:
 *      const response = NextResponse.next();
 *      response.headers.set("Header-Name", "value");
 *      return response;
 *
 *    WRONG (will cause errors):
 *      return NextResponse.next({ headers: {...} });  // ❌ Invalid API
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 */
import type { NextRequest } from "next/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export function proxy(request: NextRequest) {
  // Handle preflighted requests (OPTIONS)
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // For all other requests, return undefined to continue processing.
  // CORS headers for non-OPTIONS requests are handled by next.config.ts headers().
  // NextResponse.next() is NOT valid in proxy.ts — it fails the instanceof Response check.
  return undefined;
}

export const config = {
  matcher: [
    /**
     * Match all paths EXCEPT:
     * - /mcp, /sse, /message - MCP protocol endpoints (handled by mcp-handler)
     * - /_next - Next.js internal routes
     * - Static files (paths containing a dot, e.g., .js, .css, .ico)
     *
     * DO NOT add MCP endpoints to this proxy - it breaks Claude Desktop/mcp-remote connections.
     */
    "/((?!api|mcp|sse|message|_next|favicon.ico|.*\\.).*)",
  ],
};
