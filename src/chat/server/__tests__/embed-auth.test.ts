import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, createSign } from "node:crypto";
import {
	verifyEmbedToken,
	createEmbedAuthMiddleware,
} from "../embed-auth";

// ---------------------------------------------------------------------------
// Test keypair + token helpers
// ---------------------------------------------------------------------------

let publicKey: string;
let privateKey: string;
let otherPublicKey: string;

beforeAll(() => {
	const kp = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	publicKey = kp.publicKey as string;
	privateKey = kp.privateKey as string;

	const kp2 = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	otherPublicKey = kp2.publicKey as string;
});

function base64url(data: string | Buffer): string {
	return Buffer.from(data)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function signToken(
	payload: Record<string, unknown>,
	header: Record<string, unknown> = { alg: "RS256", typ: "JWT" },
	key: string = privateKey,
): string {
	const headerB64 = base64url(JSON.stringify(header));
	const payloadB64 = base64url(JSON.stringify(payload));
	const signingInput = `${headerB64}.${payloadB64}`;

	const sign = createSign("SHA256");
	sign.update(signingInput);
	const signature = sign.sign(key);

	return `${signingInput}.${base64url(signature)}`;
}

function validPayload(overrides?: Record<string, unknown>) {
	return {
		sub: "env-001",
		iss: "waniwani",
		scope: ["mcp:chat"],
		iat: Math.floor(Date.now() / 1000),
		...overrides,
	};
}

function makeRequest(
	method: string,
	headers: Record<string, string> = {},
): Request {
	return new Request("https://example.com/api/chat", {
		method,
		headers,
	});
}

// ---------------------------------------------------------------------------
// verifyEmbedToken
// ---------------------------------------------------------------------------

describe("verifyEmbedToken", () => {
	test("valid token returns claims", async () => {
		const token = signToken(validPayload());
		const claims = await verifyEmbedToken(token, publicKey);

		expect(claims.sub).toBe("env-001");
		expect(claims.iss).toBe("waniwani");
		expect(claims.scope).toEqual(["mcp:chat"]);
		expect(claims.iat).toBeGreaterThan(0);
	});

	test("token with jti preserves claim", async () => {
		const token = signToken(validPayload({ jti: "abc-123" }));
		const claims = await verifyEmbedToken(token, publicKey);

		expect(claims.jti).toBe("abc-123");
	});

	test("token with origins preserves claim", async () => {
		const origins = ["https://example.com", "https://www.example.com"];
		const token = signToken(validPayload({ origins }));
		const claims = await verifyEmbedToken(token, publicKey);

		expect(claims.origins).toEqual(origins);
	});

	test("rejects token with wrong public key", async () => {
		const token = signToken(validPayload());

		await expect(verifyEmbedToken(token, otherPublicKey)).rejects.toThrow(
			"Invalid JWT signature",
		);
	});

	test("rejects malformed token (not 3 parts)", async () => {
		await expect(verifyEmbedToken("abc.def", publicKey)).rejects.toThrow(
			"expected 3 parts",
		);
	});

	test("rejects empty string", async () => {
		await expect(verifyEmbedToken("", publicKey)).rejects.toThrow(
			"expected 3 parts",
		);
	});

	test("rejects token with unsupported algorithm", async () => {
		const token = signToken(validPayload(), { alg: "HS256", typ: "JWT" });

		await expect(verifyEmbedToken(token, publicKey)).rejects.toThrow(
			"Unsupported JWT algorithm: HS256",
		);
	});

	test("rejects tampered payload", async () => {
		const token = signToken(validPayload());
		const [header, , signature] = token.split(".");
		const tamperedPayload = base64url(
			JSON.stringify({ ...validPayload(), sub: "evil-env" }),
		);
		const tampered = `${header}.${tamperedPayload}.${signature}`;

		await expect(verifyEmbedToken(tampered, publicKey)).rejects.toThrow(
			"Invalid JWT signature",
		);
	});

	test("rejects tampered signature", async () => {
		const token = signToken(validPayload());
		const tampered = `${token.slice(0, -4)}AAAA`;

		await expect(verifyEmbedToken(tampered, publicKey)).rejects.toThrow(
			"Invalid JWT signature",
		);
	});

	test("rejects wrong issuer", async () => {
		const token = signToken(validPayload({ iss: "not-waniwani" }));

		await expect(verifyEmbedToken(token, publicKey)).rejects.toThrow(
			"Invalid JWT issuer",
		);
	});

	test("rejects empty sub", async () => {
		const token = signToken(validPayload({ sub: "" }));

		await expect(verifyEmbedToken(token, publicKey)).rejects.toThrow(
			"sub must be a non-empty string",
		);
	});

	test("rejects missing sub", async () => {
		const payload = validPayload();
		delete (payload as Record<string, unknown>).sub;
		const token = signToken(payload);

		await expect(verifyEmbedToken(token, publicKey)).rejects.toThrow(
			"sub must be a non-empty string",
		);
	});

	test("handles PEM with \\n escapes", async () => {
		const escapedPem = publicKey.replace(/\n/g, "\n");
		const token = signToken(validPayload());
		const claims = await verifyEmbedToken(token, escapedPem);

		expect(claims.sub).toBe("env-001");
	});
});

// ---------------------------------------------------------------------------
// createEmbedAuthMiddleware
// ---------------------------------------------------------------------------

describe("createEmbedAuthMiddleware", () => {
	test("GET without auth header returns null claims", async () => {
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(makeRequest("GET"));

		expect(result).not.toBeInstanceOf(Response);
		expect((result as { claims: null }).claims).toBeNull();
	});

	test("POST without auth header returns 401", async () => {
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(makeRequest("POST"));

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
		const body = await (result as Response).json();
		expect(body.error).toBe("Missing authorization");
	});

	test("valid token returns claims", async () => {
		const token = signToken(validPayload());
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(
			makeRequest("POST", { Authorization: `Bearer ${token}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
		const { claims } = result as { claims: { sub: string } };
		expect(claims.sub).toBe("env-001");
	});

	test("invalid token returns 401", async () => {
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(
			makeRequest("POST", { Authorization: "Bearer garbage.token.here" }),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	test("revoked jti returns 401", async () => {
		const token = signToken(validPayload({ jti: "revoked-id" }));
		const middleware = createEmbedAuthMiddleware({
			publicKey,
			revokedJtis: "revoked-id,other-id",
		});
		const result = await middleware(
			makeRequest("POST", { Authorization: `Bearer ${token}` }),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
		const body = await (result as Response).json();
		expect(body.error).toBe("Token has been revoked");
	});

	test("non-revoked jti passes", async () => {
		const token = signToken(validPayload({ jti: "good-id" }));
		const middleware = createEmbedAuthMiddleware({
			publicKey,
			revokedJtis: "revoked-id,other-id",
		});
		const result = await middleware(
			makeRequest("POST", { Authorization: `Bearer ${token}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
	});

	test("token without jti ignores revocation list", async () => {
		const token = signToken(validPayload()); // no jti
		const middleware = createEmbedAuthMiddleware({
			publicKey,
			revokedJtis: "revoked-id",
		});
		const result = await middleware(
			makeRequest("POST", { Authorization: `Bearer ${token}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
	});

	test("empty revokedJtis string works", async () => {
		const token = signToken(validPayload({ jti: "any-id" }));
		const middleware = createEmbedAuthMiddleware({
			publicKey,
			revokedJtis: "",
		});
		const result = await middleware(
			makeRequest("POST", { Authorization: `Bearer ${token}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
	});

	test("revokedJtis with whitespace/commas parsed correctly", async () => {
		const token = signToken(validPayload({ jti: "id-2" }));
		const middleware = createEmbedAuthMiddleware({
			publicKey,
			revokedJtis: " id-1 , id-2 , id-3 ",
		});
		const result = await middleware(
			makeRequest("POST", { Authorization: `Bearer ${token}` }),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	test("origin mismatch returns 403", async () => {
		const token = signToken(
			validPayload({ origins: ["https://allowed.com"] }),
		);
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(
			makeRequest("POST", {
				Authorization: `Bearer ${token}`,
				Origin: "https://evil.com",
			}),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(403);
		const body = await (result as Response).json();
		expect(body.error).toBe("Origin not allowed");
	});

	test("origin match passes", async () => {
		const token = signToken(
			validPayload({ origins: ["https://allowed.com"] }),
		);
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(
			makeRequest("POST", {
				Authorization: `Bearer ${token}`,
				Origin: "https://allowed.com",
			}),
		);

		expect(result).not.toBeInstanceOf(Response);
	});

	test("missing Origin header with origins claim returns 403", async () => {
		const token = signToken(
			validPayload({ origins: ["https://allowed.com"] }),
		);
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(
			makeRequest("POST", { Authorization: `Bearer ${token}` }),
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(403);
	});

	test("empty origins array skips origin check", async () => {
		const token = signToken(validPayload({ origins: [] }));
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(
			makeRequest("POST", {
				Authorization: `Bearer ${token}`,
				Origin: "https://anything.com",
			}),
		);

		expect(result).not.toBeInstanceOf(Response);
	});

	test("no origins claim skips origin check", async () => {
		const token = signToken(validPayload()); // no origins
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(
			makeRequest("POST", {
				Authorization: `Bearer ${token}`,
				Origin: "https://anything.com",
			}),
		);

		expect(result).not.toBeInstanceOf(Response);
	});

	test("GET with valid auth header still returns claims", async () => {
		const token = signToken(validPayload());
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(
			makeRequest("GET", { Authorization: `Bearer ${token}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
		const { claims } = result as { claims: { sub: string } };
		expect(claims.sub).toBe("env-001");
	});

	test("Bearer prefix case-insensitive", async () => {
		const token = signToken(validPayload());
		const middleware = createEmbedAuthMiddleware({ publicKey });
		const result = await middleware(
			makeRequest("POST", { Authorization: `bearer ${token}` }),
		);

		expect(result).not.toBeInstanceOf(Response);
	});
});
