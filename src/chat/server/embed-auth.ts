// Embed Token Authentication — opaque token verification against allowlist

// ============================================================================
// Types
// ============================================================================

export interface EmbedAuthOptions {
	/**
	 * Comma-separated list of allowed embed tokens (wwp_... format).
	 * Defaults to reading `WANIWANI_EMBED_TOKENS` env var.
	 */
	tokens?: string;
}

// ============================================================================
// Token Parsing
// ============================================================================

function parseTokenSet(options: EmbedAuthOptions): Set<string> {
	const raw = options.tokens ?? process.env.WANIWANI_EMBED_TOKENS ?? "";
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

// ============================================================================
// Middleware
// ============================================================================

export function createEmbedAuthMiddleware(options: EmbedAuthOptions) {
	const allowedTokens = parseTokenSet(options);

	return async function verifyEmbed(
		request: Request,
	): Promise<{ token: string | null } | Response> {
		const authHeader = request.headers.get("Authorization");

		if (!authHeader) {
			if (request.method === "GET") {
				return { token: null };
			}
			return new Response(JSON.stringify({ error: "Missing authorization" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}

		const token = authHeader.replace(/^Bearer\s+/i, "");

		if (!allowedTokens.has(token)) {
			return new Response(
				JSON.stringify({ error: "Invalid or revoked token" }),
				{
					status: 401,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		return { token };
	};
}
