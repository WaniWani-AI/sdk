import { afterEach, describe, expect, test } from "bun:test";
import type { KbClient } from "@waniwani/core/kb/types";
import type { TrackInput } from "@waniwani/core/tracking/@types";
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

function captureCalls(data: unknown = { id: "log_1" }): CapturedCall[] {
	const calls: CapturedCall[] = [];
	globalThis.fetch = Object.assign(
		async (input: unknown, init?: RequestInit) => {
			calls.push({
				url: String(input),
				authorization: new Headers(init?.headers).get("authorization"),
				body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
			});
			return new Response(
				JSON.stringify({ success: true, message: "ok", data }),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
		{ preconnect: () => {} },
	);
	return calls;
}

function scoped(
	meta: Record<string, unknown>,
	config: { apiUrl?: string; apiKey?: string } = {
		apiUrl: "https://example.test",
		apiKey: "wwk_test",
	},
) {
	return createScopedClient(
		{
			track: async (_event: TrackInput) => ({ eventId: "evt" }),
			identify: async () => ({ eventId: "evt" }),
			kb: {} as KbClient,
		},
		meta,
		config,
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

describe("context.waniwani.email.verify", () => {
	test("reaches the verify route with the resolved API URL and key", async () => {
		const calls = captureCalls({ result: "valid" });

		await scoped({}).email.verify("sam@gmail.com");

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(
			"https://example.test/api/mcp/modules/email/verify",
		);
		expect(calls[0]?.authorization).toBe("Bearer wwk_test");
	});

	test("posts the address alone, with no sessionId even when the request has one", async () => {
		const calls = captureCalls({ result: "valid" });

		await scoped({ "waniwani/sessionId": "sess-9" }).email.verify(
			"sam@gmail.com",
		);

		expect(calls[0]?.body).toEqual({ email: "sam@gmail.com" });
	});

	test("resolves with the platform's verification", async () => {
		captureCalls({
			result: "invalid",
			reason: "domain_typo",
			suggestion: "sam@gmail.com",
		});

		await expect(scoped({}).email.verify("sam@gmial.com")).resolves.toEqual({
			result: "invalid",
			reason: "domain_typo",
			suggestion: "sam@gmail.com",
		});
	});

	test("a trailing slash on the resolved API URL gives one slash", async () => {
		const calls = captureCalls({ result: "valid" });

		await scoped(
			{},
			{ apiUrl: "https://example.test/", apiKey: "wwk_test" },
		).email.verify("sam@gmail.com");

		expect(calls[0]?.url).toBe(
			"https://example.test/api/mcp/modules/email/verify",
		);
	});

	test("throws before any request when withWaniwani resolved no key", async () => {
		const calls = captureCalls({ result: "valid" });

		await expect(
			scoped({}, { apiUrl: "https://example.test" }).email.verify(
				"sam@gmail.com",
			),
		).rejects.toThrow("WANIWANI_API_KEY is not set");
		expect(calls).toHaveLength(0);
	});

	test("works when pulled off the scoped client, as a bare function", async () => {
		const calls = captureCalls({ result: "risky", reason: "no_mx_record" });
		const { verify } = scoped({}).email;

		await expect(verify("sam@site-only.fr")).resolves.toEqual({
			result: "risky",
			reason: "no_mx_record",
		});
		expect(calls[0]?.url).toBe(
			"https://example.test/api/mcp/modules/email/verify",
		);
	});
});
