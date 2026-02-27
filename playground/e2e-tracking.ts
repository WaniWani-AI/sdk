/**
 * E2E tracking test script.
 *
 * Tests `withWaniwani` (server-level auto-tracking) and direct
 * `client.track()` against a running backend.
 *
 * Usage:
 *   WANIWANI_API_KEY=your-key bun run playground/e2e-tracking.ts
 *
 * Expects backend on http://localhost:3000 (or set WANIWANI_BASE_URL).
 */

import { waniwani } from "../src/waniwani.js";
import { withWaniwani } from "../src/mcp/server/with-waniwani.js";

const baseUrl = process.env.WANIWANI_BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.WANIWANI_API_KEY ?? "playground-dev-key";

const client = waniwani({ apiKey, baseUrl });

console.log(`\n[e2e-tracking] Backend: ${baseUrl}`);
console.log("[e2e-tracking] API Key: %s\n", apiKey.slice(0, 8) + "...");

// ─── Test 1: Direct client.track() ──────────────────────────────────────────

console.log("── Test 1: Direct client.track() ──");

const meta = {
	"openai/sessionId": `e2e-session-${Date.now()}`,
	requestId: `e2e-request-${Date.now()}`,
};

const toolResult = await client.track({
	event: "tool.called",
	properties: { name: "e2e-pricing", type: "pricing" },
	meta,
});
console.log("  tool.called → eventId:", toolResult.eventId);

const quoteResult = await client.track({
	event: "quote.succeeded",
	properties: { amount: 99, currency: "EUR" },
	meta,
});
console.log("  quote.succeeded → eventId:", quoteResult.eventId);

await client.flush();
console.log("  flushed ✓\n");

// ─── Test 2: withWaniwani (server auto-tracking) ────────────────────────────

console.log("── Test 2: withWaniwani (server auto-tracking) ──");

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
const registeredHandlers: Array<{ name: string; handler: Handler }> = [];

const mockServer = {
	registerTool: (name: string, _config: unknown, handler: Handler) => {
		registeredHandlers.push({ name, handler });
	},
};

withWaniwani(mockServer as Parameters<typeof withWaniwani>[0], {
	client,
	flushAfterToolCall: true,
	toolType: "pricing",
	metadata: { source: "e2e-tracking" },
});

mockServer.registerTool(
	"e2e-search",
	{ description: "E2E test tool" },
	async (_input: unknown, _extra: unknown) => {
		return { text: "search result" };
	},
);

const toolHandler = registeredHandlers[0];
if (toolHandler) {
	const result = await toolHandler.handler(
		{ query: "test" },
		{
			_meta: {
				"openai/sessionId": `e2e-wrapped-session-${Date.now()}`,
				requestId: `e2e-wrapped-request-${Date.now()}`,
			},
		},
	);
	console.log("  tool invoked → result:", JSON.stringify(result));
	console.log("  auto-tracked tool.called + flushed ✓\n");
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

const shutdown = await client.shutdown({ timeoutMs: 5000 });
console.log(
	"[e2e-tracking] shutdown →",
	shutdown.timedOut ? "timed out" : "clean",
	`(${shutdown.pendingEvents} pending)`,
);
console.log("[e2e-tracking] done ✓\n");
