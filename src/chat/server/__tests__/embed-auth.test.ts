import { describe, expect, test } from "bun:test";
import { createEmbedAuthMiddleware } from "../embed-auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TOKEN = "wwp_abc123def456ghi789jkl0";
const OTHER_TOKEN = "wwp_zzz999yyy888xxx777www6";
const TOKENS = `${VALID_TOKEN},${OTHER_TOKEN}`;

function makeRequest(
	method: string,
	headers: Record<string, string> = {},
): Request {
	return new Request("https://example.com/api/chat", { method, headers });
}

// ---------------------------------------------------------------------------
// createEmbedAuthMiddleware
// ---------------------------------------------------------------------------

describe("createEmbedAuthMiddleware", () => {
	// -- No auth header --

	test("GET without auth header returns null token", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: TOKENS });
		const result = await mw(makeRequest("GET"));

		expect(result).not.toBeInstanceOf(Response);
		expect((result as { token: null }).token).toBeNull();
	});

	test("POST without auth header returns 401", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: TOKENS });
		const result = await mw(makeRequest("POST"));

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
		const body = await (result as Response).json();
		expect(body.error).toBe("Missing authorization");
	});

	// -- Valid token --

	test("valid token returns token string", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: TOKENS });
		const result = await mw(
			makeRequest("POST", { Authorization: `Bearer ${VALID_TOKEN}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
		expect((result as { token: string }).token).toBe(VALID_TOKEN);
	});

	test("second valid token also accepted", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: TOKENS });
		const result = await mw(
			makeRequest("POST", { Authorization: `Bearer ${OTHER_TOKEN}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
		expect((result as { token: string }).token).toBe(OTHER_TOKEN);
	});

	test("GET with valid token returns token", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: TOKENS });
		const result = await mw(
			makeRequest("GET", { Authorization: `Bearer ${VALID_TOKEN}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
		expect((result as { token: string }).token).toBe(VALID_TOKEN);
	});

	// -- Invalid token --

	test("unknown token returns 401", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: TOKENS });
		const result = await mw(
			makeRequest("POST", { Authorization: "Bearer wwp_unknown_garbage" }),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
		const body = await (result as Response).json();
		expect(body.error).toBe("Invalid or revoked token");
	});

	test("empty Bearer value returns 401", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: TOKENS });
		const result = await mw(makeRequest("POST", { Authorization: "Bearer " }));

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	test("non-Bearer auth scheme returns 401", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: TOKENS });
		const result = await mw(
			makeRequest("POST", { Authorization: `Basic ${VALID_TOKEN}` }),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	// -- Token parsing --

	test("tokens with whitespace parsed correctly", async () => {
		const mw = createEmbedAuthMiddleware({
			tokens: ` ${VALID_TOKEN} , ${OTHER_TOKEN} `,
		});
		const result = await mw(
			makeRequest("POST", { Authorization: `Bearer ${VALID_TOKEN}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
	});

	test("empty tokens string rejects everything", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: "" });
		const result = await mw(
			makeRequest("POST", { Authorization: `Bearer ${VALID_TOKEN}` }),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	test("single token (no comma) works", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: VALID_TOKEN });
		const result = await mw(
			makeRequest("POST", { Authorization: `Bearer ${VALID_TOKEN}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
	});

	// -- Revocation = remove from list --

	test("removing token from list revokes it", async () => {
		// Only OTHER_TOKEN in list, VALID_TOKEN removed
		const mw = createEmbedAuthMiddleware({ tokens: OTHER_TOKEN });

		const result = await mw(
			makeRequest("POST", { Authorization: `Bearer ${VALID_TOKEN}` }),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	// -- Bearer case insensitive --

	test("bearer prefix case-insensitive", async () => {
		const mw = createEmbedAuthMiddleware({ tokens: TOKENS });
		const result = await mw(
			makeRequest("POST", { Authorization: `bearer ${VALID_TOKEN}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
	});

	// -- No embedAuth configured --

	test("no tokens option reads from env (empty = rejects)", async () => {
		const mw = createEmbedAuthMiddleware({});
		const result = await mw(
			makeRequest("POST", { Authorization: `Bearer ${VALID_TOKEN}` }),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});
});
