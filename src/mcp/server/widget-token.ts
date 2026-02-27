/**
 * Widget token minting — fetches short-lived JWTs from the WaniWani backend
 * so browser widgets can POST events directly.
 */

interface WidgetTokenConfig {
	baseUrl: string;
	apiKey: string;
}

interface WidgetTokenResult {
	token: string;
	expiresAt: string;
}

interface CachedToken {
	token: string;
	/** Unix ms when the token expires */
	expiresAt: number;
}

/** Re-mint when < 2 minutes remain to avoid using nearly-expired tokens. */
const EXPIRY_BUFFER_MS = 2 * 60 * 1000;

export class WidgetTokenCache {
	private cached: CachedToken | null = null;
	private pending: Promise<string | null> | null = null;
	private readonly config: WidgetTokenConfig;

	constructor(config: WidgetTokenConfig) {
		this.config = config;
	}

	/**
	 * Get a valid widget token. Returns a cached token if still fresh,
	 * otherwise mints a new one. Returns `null` on failure.
	 */
	async getToken(sessionId?: string, traceId?: string): Promise<string | null> {
		if (this.cached && Date.now() < this.cached.expiresAt - EXPIRY_BUFFER_MS) {
			return this.cached.token;
		}

		// Deduplicate concurrent requests
		if (this.pending) return this.pending;

		this.pending = this.mint(sessionId, traceId).finally(() => {
			this.pending = null;
		});

		return this.pending;
	}

	private async mint(
		sessionId?: string,
		traceId?: string,
	): Promise<string | null> {
		const url = joinUrl(this.config.baseUrl, "/api/mcp/widget-tokens");

		const body: Record<string, string> = {};
		if (sessionId) body.sessionId = sessionId;
		if (traceId) body.traceId = traceId;

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.config.apiKey}`,
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) return null;

			const json = (await response.json()) as Record<string, unknown>;

			// Support both flat { token, expiresAt } and nested { data: { token, expiresAt } }
			const result = (
				json.data && typeof json.data === "object" ? json.data : json
			) as WidgetTokenResult;

			const expiresAtMs = new Date(result.expiresAt).getTime();
			if (!result.token || Number.isNaN(expiresAtMs)) return null;

			this.cached = {
				token: result.token,
				expiresAt: expiresAtMs,
			};

			return result.token;
		} catch {
			return null;
		}
	}
}

function joinUrl(baseUrl: string, path: string): string {
	const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
	return `${base}${path}`;
}
