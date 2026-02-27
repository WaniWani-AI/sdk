const port = Number(process.env.PORT ?? 3000);
const mode = process.env.WW_MOCK_MODE ?? "success";
const mcpServerUrl = process.env.MCP_SERVER_URL ?? "http://localhost:3001/mcp";

let batchCount = 0;
const capturedBatches: unknown[] = [];

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

Bun.serve({
	port,
	async fetch(request) {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return json({ ok: true, mode, batchCount });
		}

		if (url.pathname === "/events" && request.method === "GET") {
			return json({ mode, batchCount, batches: capturedBatches });
		}

		if (url.pathname === "/reset" && request.method === "POST") {
			batchCount = 0;
			capturedBatches.length = 0;
			return json({ ok: true });
		}

		if (
			url.pathname === "/api/mcp/environments/config" &&
			request.method === "GET"
		) {
			return json({ mcpServerUrl });
		}

		if (
			url.pathname === "/api/mcp/events/v2/batch" &&
			request.method === "POST"
		) {
			const body = await request
				.json()
				.catch(() => ({ events: [] as Array<{ id: string }> }));
			batchCount += 1;
			capturedBatches.push(body);

			const eventCount = Array.isArray((body as { events?: unknown[] }).events)
				? ((body as { events: unknown[] }).events.length ?? 0)
				: 0;

			console.log(
				`[mock-v2-ingest] batch #${batchCount} mode=${mode} events=${eventCount}`,
			);

			if (mode === "auth") {
				return json({ error: "unauthorized" }, 401);
			}

			if (mode === "transient" && batchCount === 1) {
				return json({ error: "temporary upstream issue" }, 503);
			}

			if (mode === "partial" && batchCount === 1) {
				const events = ((body as { events?: Array<{ id?: string }> }).events ?? [])
					.filter((event): event is { id: string } => typeof event?.id === "string");

				const rejected = events.slice(0, 1).map((event) => ({
					eventId: event.id,
					code: "temporary_unavailable",
					retryable: true,
				}));

				return json({ accepted: Math.max(0, eventCount - rejected.length), rejected });
			}

			return json({ accepted: eventCount, requestId: `mock_req_${batchCount}` });
		}

		return json({ error: "Not Found", path: url.pathname }, 404);
	},
});

console.log(
	`[mock-v2-ingest] listening on http://localhost:${port} (mode=${mode})`,
);
console.log("[mock-v2-ingest] endpoints: /health, /events, /reset, /api/mcp/events/v2/batch");
