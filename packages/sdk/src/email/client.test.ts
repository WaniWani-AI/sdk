import { afterEach, describe, expect, test } from "bun:test";
import { WaniWaniError } from "../error.js";
import { createEmailClient } from "./client.js";

const SEND_URL = "https://example.test/api/mcp/modules/email/send";
const LOG_ID = "00000000-0000-4000-8000-0000000000dd";
const HTML =
	'<!DOCTYPE html><html><body><p style="color:#111">Bonjour {{name}}, voilà votre récap ✓</p></body></html>';
const EMAIL = { to: "visitor@example.com", subject: "Your recap", html: HTML };

interface CapturedCall {
	url: string;
	method: string | undefined;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function stubFetch(nextResponse: () => Response): CapturedCall[] {
	const calls: CapturedCall[] = [];
	globalThis.fetch = Object.assign(
		async (input: unknown, init?: RequestInit) => {
			const headers: Record<string, string> = {};
			new Headers(init?.headers).forEach((value, key) => {
				headers[key] = value;
			});
			calls.push({
				url: String(input),
				method: init?.method,
				headers,
				body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
			});
			return nextResponse();
		},
		{ preconnect: () => {} },
	);
	return calls;
}

function envelope(data: unknown, status = 200): Response {
	return new Response(JSON.stringify({ success: true, message: "ok", data }), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function refusal(status: number, body: string): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "application/json" },
	});
}

function client(overrides?: { apiUrl?: string; apiKey?: string | undefined }) {
	return createEmailClient({
		apiUrl: overrides?.apiUrl ?? "https://example.test",
		apiKey: "apiKey" in (overrides ?? {}) ? overrides?.apiKey : "wwk_test",
	});
}

describe("email.send: request", () => {
	test("posts to the send route with the key and the SDK header", async () => {
		const calls = stubFetch(() => envelope({ id: LOG_ID }));

		await client().send(EMAIL);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(SEND_URL);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers.authorization).toBe("Bearer wwk_test");
		expect(calls[0]?.headers["content-type"]).toBe("application/json");
		expect(calls[0]?.headers["x-waniwani-sdk"]).toBe("@waniwani/sdk");
	});

	test("sends the HTML untouched", async () => {
		const calls = stubFetch(() => envelope({ id: LOG_ID }));

		await client().send(EMAIL);

		expect(calls[0]?.body.html).toBe(HTML);
	});

	test("sends only what the caller gave: no text, replyTo or sessionId key", async () => {
		const calls = stubFetch(() => envelope({ id: LOG_ID }));

		await client().send(EMAIL);

		expect(Object.keys(calls[0]?.body ?? {}).sort()).toEqual([
			"html",
			"subject",
			"to",
		]);
	});

	test("sends text, replyTo and sessionId when given", async () => {
		const calls = stubFetch(() => envelope({ id: LOG_ID }));

		await client().send({
			...EMAIL,
			text: "Bonjour",
			replyTo: "sales@example.com",
			sessionId: "sess-1",
		});

		expect(calls[0]?.body).toMatchObject({
			text: "Bonjour",
			replyTo: "sales@example.com",
			sessionId: "sess-1",
		});
	});

	test("sends cc and bcc as given, one address or a list", async () => {
		const calls = stubFetch(() => envelope({ id: LOG_ID }));

		await client().send({
			...EMAIL,
			cc: "manager@example.com",
			bcc: ["audit@example.com", "archive@example.com"],
		});

		expect(calls[0]?.body.cc).toBe("manager@example.com");
		expect(calls[0]?.body.bcc).toEqual([
			"audit@example.com",
			"archive@example.com",
		]);
	});

	test("sends a text-only email with no html key", async () => {
		const calls = stubFetch(() => envelope({ id: LOG_ID }));

		await client().send({
			to: EMAIL.to,
			subject: EMAIL.subject,
			text: "Bonjour",
		});

		expect(Object.keys(calls[0]?.body ?? {}).sort()).toEqual([
			"subject",
			"text",
			"to",
		]);
	});

	test("does not forward a key outside the contract, such as a from address", async () => {
		const calls = stubFetch(() => envelope({ id: LOG_ID }));
		const input = { ...EMAIL, from: "Someone <someone@example.com>" };

		await client().send(input);

		expect(calls[0]?.body).not.toHaveProperty("from");
	});

	test("tolerates a trailing slash on the API URL", async () => {
		const calls = stubFetch(() => envelope({ id: LOG_ID }));

		await client({ apiUrl: "https://example.test/" }).send(EMAIL);

		expect(calls[0]?.url).toBe(SEND_URL);
	});

	test("throws before any request when no API key is set", async () => {
		const calls = stubFetch(() => envelope({ id: LOG_ID }));

		await expect(client({ apiKey: undefined }).send(EMAIL)).rejects.toThrow(
			"WANIWANI_API_KEY is not set",
		);
		expect(calls).toHaveLength(0);
	});
});

describe("email.send: the answer", () => {
	test("resolves with the log row id", async () => {
		stubFetch(() => envelope({ id: LOG_ID }));

		await expect(client().send(EMAIL)).resolves.toEqual({ id: LOG_ID });
	});

	test("a refusal becomes WaniWaniError with its code, detail and status", async () => {
		stubFetch(() =>
			refusal(
				422,
				JSON.stringify({
					success: false,
					code: "EMAIL_REJECTED",
					message: "EMAIL_REJECTED",
					error: "EMAIL_REJECTED",
					detail: "Invalid `to` field.",
				}),
			),
		);

		const error = await client()
			.send(EMAIL)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(WaniWaniError);
		if (error instanceof WaniWaniError) {
			expect(error.message).toBe("EMAIL_REJECTED: Invalid `to` field.");
			expect(error.status).toBe(422);
		}
	});

	test("a refusal without a detail carries the code alone", async () => {
		stubFetch(() =>
			refusal(
				400,
				JSON.stringify({
					success: false,
					code: "ENVIRONMENT_HAS_NO_AGENT",
					message: "ENVIRONMENT_HAS_NO_AGENT",
					error: "ENVIRONMENT_HAS_NO_AGENT",
				}),
			),
		);

		const error = await client()
			.send(EMAIL)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(WaniWaniError);
		if (error instanceof WaniWaniError) {
			expect(error.message).toBe("ENVIRONMENT_HAS_NO_AGENT");
			expect(error.status).toBe(400);
		}
	});

	test("a body that is not JSON surfaces as is", async () => {
		stubFetch(() => new Response("Bad gateway", { status: 502 }));

		await expect(client().send(EMAIL)).rejects.toThrow("Bad gateway");
	});

	test("an empty body names the status", async () => {
		stubFetch(() => new Response("", { status: 502 }));

		await expect(client().send(EMAIL)).rejects.toThrow(
			"Email API error: HTTP 502",
		);
	});
});
