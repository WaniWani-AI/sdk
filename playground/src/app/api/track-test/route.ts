import { waniwani } from "@waniwani/sdk";

const client = waniwani({
	apiKey: process.env.WANIWANI_API_KEY ?? "playground-dev-key",
	apiUrl: process.env.WANIWANI_API_URL ?? "http://localhost:3000",
});

export async function POST(request: Request) {
	const body = (await request
		.json()
		.catch(() => ({}))) as { sessionId?: unknown; mode?: unknown };

	const sessionId =
		typeof body.sessionId === "string" && body.sessionId.trim().length > 0
			? body.sessionId
			: `playground-session-${Date.now()}`;

	const meta = {
		"openai/sessionId": sessionId,
		requestId: `playground-request-${Date.now()}`,
		mode: typeof body.mode === "string" ? body.mode : "manual",
	};

	const first = await client.track({
		eventType: "tool.called",
		toolName: "playground.mock",
		toolType: "support",
		meta,
		metadata: { source: "playground/track-test" },
	});

	const second = await client.track({
		event: "quote.succeeded",
		properties: { amount: 42, currency: "USD" },
		meta,
	});

	await client.flush();

	return Response.json({
		ok: true,
		sessionId,
		eventIds: [first.eventId, second.eventId],
	});
}
