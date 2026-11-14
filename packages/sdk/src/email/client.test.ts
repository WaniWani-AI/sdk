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

const VERIFY_URL = "https://example.test/api/mcp/modules/email/verify";
const TYPED = "Sam.O'Neil+news@Gmial.COM";

describe("email.verify: request", () => {
	test("posts to the verify route with the key and the SDK header", async () => {
		const calls = stubFetch(() => envelope({ result: "valid" }));

		await client().verify("sam@gmail.com");

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(VERIFY_URL);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers.authorization).toBe("Bearer wwk_test");
		expect(calls[0]?.headers["content-type"]).toBe("application/json");
		expect(calls[0]?.headers["x-waniwani-sdk"]).toBe("@waniwani/sdk");
	});

	test("the body is the typed address under `email` and nothing else", async () => {
		const calls = stubFetch(() => envelope({ result: "valid" }));

		await client().verify(TYPED);

		expect(calls[0]?.body).toEqual({ email: TYPED });
	});

	test("tolerates a trailing slash on the API URL", async () => {
		const calls = stubFetch(() => envelope({ result: "valid" }));

		await client({ apiUrl: "https://example.test/" }).verify("sam@gmail.com");

		expect(calls[0]?.url).toBe(VERIFY_URL);
	});

	test("keeps a path prefix on the API URL and still joins with one slash", async () => {
		const calls = stubFetch(() => envelope({ result: "valid" }));

		await client({ apiUrl: "https://example.test/eu/" }).verify(
			"sam@gmail.com",
		);

		expect(calls[0]?.url).toBe(
			"https://example.test/eu/api/mcp/modules/email/verify",
		);
	});

	test("throws before any request when no API key is set", async () => {
		const calls = stubFetch(() => envelope({ result: "valid" }));

		await expect(
			client({ apiKey: undefined }).verify("sam@gmail.com"),
		).rejects.toThrow("WANIWANI_API_KEY is not set");
		expect(calls).toHaveLength(0);
	});

	test("without a key, verify throws the same error send throws", async () => {
		stubFetch(() => envelope({ result: "valid" }));
		const noKey = client({ apiKey: undefined });

		const fromVerify = await noKey
			.verify("sam@gmail.com")
			.catch((caught: unknown) => caught);
		const fromSend = await noKey.send(EMAIL).catch((caught: unknown) => caught);

		expect(fromVerify).toBeInstanceOf(Error);
		expect(fromVerify).not.toBeInstanceOf(WaniWaniError);
		expect(fromSend).toBeInstanceOf(Error);
		if (fromVerify instanceof Error && fromSend instanceof Error) {
			expect(fromVerify.message).toBe(fromSend.message);
			expect(fromVerify.name).toBe(fromSend.name);
		}
	});

	test("an empty-string key counts as no key, for verify as for send", async () => {
		const calls = stubFetch(() => envelope({ result: "valid" }));
		const emptyKey = client({ apiKey: "" });

		await expect(emptyKey.verify("sam@gmail.com")).rejects.toThrow(
			"WANIWANI_API_KEY is not set",
		);
		await expect(emptyKey.send(EMAIL)).rejects.toThrow(
			"WANIWANI_API_KEY is not set",
		);
		expect(calls).toHaveLength(0);
	});

	test("works when pulled off the client, as a bare function", async () => {
		const calls = stubFetch(() => envelope({ result: "valid" }));
		const { verify } = client();

		await expect(verify("sam@gmail.com")).resolves.toEqual({
			result: "valid",
		});
		expect(calls[0]?.url).toBe(VERIFY_URL);
	});
});

describe("email.verify: the answer", () => {
	test("a valid address resolves with result alone, no reason or suggestion key", async () => {
		stubFetch(() => envelope({ result: "valid" }));

		const verification = await client().verify("sam@gmail.com");

		expect(verification).toEqual({ result: "valid" });
		expect(Object.keys(verification)).toEqual(["result"]);
	});

	test("an invalid address is an answer, not an error: 200 resolves with result and reason", async () => {
		stubFetch(() => envelope({ result: "invalid", reason: "syntax" }));

		const verification = await client().verify("not an address");

		expect(verification).toEqual({ result: "invalid", reason: "syntax" });
		expect(Object.keys(verification).sort()).toEqual(["reason", "result"]);
	});

	test("a domain typo resolves with result, reason and the suggestion", async () => {
		stubFetch(() =>
			envelope({
				result: "invalid",
				reason: "domain_typo",
				suggestion: "sam@gmail.com",
			}),
		);

		await expect(client().verify("sam@gmial.com")).resolves.toEqual({
			result: "invalid",
			reason: "domain_typo",
			suggestion: "sam@gmail.com",
		});
	});

	test("a risky address resolves with its reason", async () => {
		stubFetch(() => envelope({ result: "risky", reason: "no_mx_record" }));

		await expect(client().verify("sam@site-only.fr")).resolves.toEqual({
			result: "risky",
			reason: "no_mx_record",
		});
	});

	test("an unknown result keeps both a reason and a suggestion when both came back", async () => {
		stubFetch(() =>
			envelope({
				result: "unknown",
				reason: "dns_error",
				suggestion: "sam@outlook.com",
			}),
		);

		await expect(client().verify("sam@outlok.com")).resolves.toEqual({
			result: "unknown",
			reason: "dns_error",
			suggestion: "sam@outlook.com",
		});
	});

	test("a suggestion without a reason is kept and no reason key appears", async () => {
		stubFetch(() => envelope({ result: "risky", suggestion: "sam@gmail.com" }));

		const verification = await client().verify("sam@gmial.com");

		expect(verification).toEqual({
			result: "risky",
			suggestion: "sam@gmail.com",
		});
		expect(Object.keys(verification).sort()).toEqual(["result", "suggestion"]);
	});

	test("an empty-string suggestion the platform sent is kept", async () => {
		stubFetch(() =>
			envelope({ result: "invalid", reason: "domain_typo", suggestion: "" }),
		);

		const verification = await client().verify("sam@gmial.com");

		expect(verification).toEqual({
			result: "invalid",
			reason: "domain_typo",
			suggestion: "",
		});
	});

	test("the envelope's success and message never leak into the result", async () => {
		stubFetch(() => envelope({ result: "valid" }));

		const verification = await client().verify("sam@gmail.com");

		expect(verification).not.toHaveProperty("success");
		expect(verification).not.toHaveProperty("message");
		expect(verification).not.toHaveProperty("data");
	});

	test("a refusal becomes WaniWaniError with its code, detail and status", async () => {
		stubFetch(() =>
			refusal(
				422,
				JSON.stringify({
					success: false,
					code: "VALIDATION_ERROR",
					message: "VALIDATION_ERROR",
					error: "VALIDATION_ERROR",
					detail: "email is required",
				}),
			),
		);

		const error = await client()
			.verify("")
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(WaniWaniError);
		if (error instanceof WaniWaniError) {
			expect(error.message).toBe("VALIDATION_ERROR: email is required");
			expect(error.status).toBe(422);
		}
	});

	test("a rate-limit 429 throws WaniWaniError with status 429 and the platform message", async () => {
		stubFetch(() =>
			refusal(
				429,
				JSON.stringify({
					success: false,
					message:
						"Too many email checks in a short time. Please wait a moment.",
				}),
			),
		);

		const error = await client()
			.verify("sam@gmail.com")
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(WaniWaniError);
		if (error instanceof WaniWaniError) {
			expect(error.message).toBe(
				"Too many email checks in a short time. Please wait a moment.",
			);
			expect(error.status).toBe(429);
		}
	});

	test("a non-2xx answer throws even when its body carries a verification", async () => {
		stubFetch(() => envelope({ result: "invalid", reason: "syntax" }, 400));

		const error = await client()
			.verify("not an address")
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(WaniWaniError);
		if (error instanceof WaniWaniError) {
			expect(error.status).toBe(400);
		}
	});

	test("a 401 throws WaniWaniError with status 401", async () => {
		stubFetch(() =>
			refusal(401, JSON.stringify({ success: false, message: "UNAUTHORIZED" })),
		);

		const error = await client()
			.verify("sam@gmail.com")
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(WaniWaniError);
		if (error instanceof WaniWaniError) {
			expect(error.message).toBe("UNAUTHORIZED");
			expect(error.status).toBe(401);
		}
	});

	test("a body that is not JSON surfaces as is, with the status", async () => {
		stubFetch(() => new Response("Bad gateway", { status: 502 }));

		const error = await client()
			.verify("sam@gmail.com")
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(WaniWaniError);
		if (error instanceof WaniWaniError) {
			expect(error.message).toBe("Bad gateway");
			expect(error.status).toBe(502);
		}
	});

	test("an empty body names the status with the same label send uses", async () => {
		stubFetch(() => new Response("", { status: 503 }));

		const error = await client()
			.verify("sam@gmail.com")
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(WaniWaniError);
		if (error instanceof WaniWaniError) {
			expect(error.message).toBe("Email API error: HTTP 503");
			expect(error.status).toBe(503);
		}
	});
});
