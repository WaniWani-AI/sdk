// Embed Token Authentication - JWT verification using Web Crypto API (ES256)

// ============================================================================
// Types
// ============================================================================

export interface EmbedTokenClaims {
	sub: string;
	iss: string;
	scope: string[];
	origins?: string[];
	iat: number;
	jti?: string;
}

export interface EmbedAuthOptions {
	publicKey: string;
	/**
	 * Comma-separated list of revoked token IDs (jti claims).
	 * Defaults to reading `WANIWANI_EMBED_REVOKED_JTIS` env var.
	 */
	revokedJtis?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function base64urlDecode(str: string): Uint8Array {
	// Convert base64url to standard base64
	let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
	// Add padding
	const pad = base64.length % 4;
	if (pad === 2) {
		base64 += "==";
	} else if (pad === 3) {
		base64 += "=";
	}

	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// ============================================================================
// Token Verification
// ============================================================================

export async function verifyEmbedToken(
	token: string,
	publicKeyPem: string,
): Promise<EmbedTokenClaims> {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("Invalid JWT: expected 3 parts");
	}

	const [headerB64, payloadB64, signatureB64] = parts;

	// Verify algorithm
	const header = JSON.parse(
		new TextDecoder().decode(base64urlDecode(headerB64)),
	);
	if (header.alg !== "ES256") {
		throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
	}

	// Parse payload
	const claims: EmbedTokenClaims = JSON.parse(
		new TextDecoder().decode(base64urlDecode(payloadB64)),
	);

	// Import public key from PEM (standard base64, not base64url)
	const pemBody = publicKeyPem
		.replace(/-----BEGIN PUBLIC KEY-----/, "")
		.replace(/-----END PUBLIC KEY-----/, "")
		.replace(/\s/g, "");
	const binaryStr = atob(pemBody);
	const keyData = new Uint8Array(binaryStr.length);
	for (let i = 0; i < binaryStr.length; i++) {
		keyData[i] = binaryStr.charCodeAt(i);
	}
	const key = await crypto.subtle.importKey(
		"spki",
		keyData.buffer as ArrayBuffer,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);

	// Verify signature
	const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
	const signature = base64urlDecode(signatureB64);
	const valid = await crypto.subtle.verify(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		signature.buffer as ArrayBuffer,
		signingInput,
	);

	if (!valid) {
		throw new Error("Invalid JWT signature");
	}

	// Validate claims
	if (claims.iss !== "waniwani") {
		throw new Error(`Invalid JWT issuer: ${claims.iss}`);
	}
	if (!claims.sub || typeof claims.sub !== "string") {
		throw new Error("Invalid JWT subject: sub must be a non-empty string");
	}

	return claims;
}

// ============================================================================
// Middleware
// ============================================================================

function parseRevokedJtis(options: EmbedAuthOptions): Set<string> {
	const raw =
		options.revokedJtis ?? process.env.WANIWANI_EMBED_REVOKED_JTIS ?? "";
	if (!raw) {
		return new Set();
	}
	return new Set(
		raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
}

export function createEmbedAuthMiddleware(options: EmbedAuthOptions) {
	const revokedJtis = parseRevokedJtis(options);

	return async function verifyEmbed(
		request: Request,
	): Promise<{ claims: EmbedTokenClaims | null } | Response> {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader) {
			// Allow unauthenticated GET requests (for /config, /tools)
			if (request.method === "GET") {
				return { claims: null };
			}
			return new Response(JSON.stringify({ error: "Missing authorization" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}

		const token = authHeader.replace(/^Bearer\s+/i, "");

		let claims: EmbedTokenClaims;
		try {
			claims = await verifyEmbedToken(token, options.publicKey);
		} catch {
			return new Response(
				JSON.stringify({ error: "Invalid or expired token" }),
				{
					status: 401,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		// Check jti revocation
		if (claims.jti && revokedJtis.has(claims.jti)) {
			return new Response(JSON.stringify({ error: "Token has been revoked" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}

		// Check origin restriction
		if (claims.origins && claims.origins.length > 0) {
			const origin = request.headers.get("Origin");
			if (!origin || !claims.origins.includes(origin)) {
				return new Response(JSON.stringify({ error: "Origin not allowed" }), {
					status: 403,
					headers: { "Content-Type": "application/json" },
				});
			}
		}

		return { claims };
	};
}
