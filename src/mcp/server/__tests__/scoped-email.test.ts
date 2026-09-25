import { afterEach, describe, expect, test } from "bun:test";
import type { KbClient } from "../../../kb/types.js";
import type { TrackInput } from "../../../tracking/@types.js";
import { createScopedClient } from "../scoped-client.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

interface CapturedCall {
	url: string;
	authorization: string | null;
	body: Record<string, unknown>;
}

function captureCalls(): CapturedCall[] {
	const calls: CapturedCall[] = [];
	globalThis.fetch = Object.assign(
		async (input: unknown, init?: RequestInit) => {
			calls.push({
				url: String(input),
				authorization: new Headers(init?.headers).get("authorization"),
				body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
			});
			return new Response(
				JSON.stringify({ success: true, message: "ok", data: { id: "log_1" } }),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
		{ preconnect: () => {} },
	);
	return calls;
}

function scoped(meta: Record<string, unknown>) {
	return createScopedClient(
		{
			track: async (_event: TrackInput) => ({ eventId: "evt" }),
			identify: async () => ({ eventId: "evt" }),
			kb: {} as KbClient,
		},
		meta,
		{ apiUrl: "https://example.test", apiKey: "wwk_test" },
	);
}

const EMAIL = {
	to: "visitor@example.com",
	subject: "Your recap",
	html: "<p>Hi</p>",
};

describe("context.waniwani.email", () => {
	test("fills sessionId from the request meta", async () => {
		const calls = captureCalls();

		await scoped({ "waniwani/sessionId": "sess-9" }).email.send(EMAIL);

		expect(calls[0]?.body.sessionId).toBe("sess-9");
	});

	test("keeps a sessionId the caller passed", async () => {
		const calls = captureCalls();

		await scoped({ "waniwani/sessionId": "sess-9" }).email.send({
			...EMAIL,
			sessionId: "sess-own",
		});

		expect(calls[0]?.body.sessionId).toBe("sess-own");
	});

	test("sends no sessionId when the host gave none", async () => {
		const calls = captureCalls();

		await scoped({}).email.send(EMAIL);

		expect(calls[0]?.body).not.toHaveProperty("sessionId");
	});

	test("uses the API URL and key withWaniwani resolved", async () => {
		const calls = captureCalls();

		const result = await scoped({}).email.send(EMAIL);

		expect(calls[0]?.url).toBe(
			"https://example.test/api/mcp/modules/email/send",
		);
		expect(calls[0]?.authorization).toBe("Bearer wwk_test");
		expect(result).toEqual({ id: "log_1" });
	});
});
