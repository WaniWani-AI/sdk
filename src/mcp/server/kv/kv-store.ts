/**
 * Generic key-value store backed by the WaniWani API.
 *
 * Values are stored as JSON objects (`Record<string, unknown>`) in the
 * `/api/mcp/redis/*` endpoints. Tenant isolation is handled by the API key.
 *
 * Config is read from env vars:
 * - `WANIWANI_API_KEY` (required)
 * - `WANIWANI_API_URL` (optional, defaults to https://app.waniwani.ai)
 */

// ============================================================================
// Interface
// ============================================================================

export interface KvStore<T = Record<string, unknown>> {
	get(key: string): Promise<T | null>;
	set(key: string, value: T): Promise<void>;
	delete(key: string): Promise<void>;
}

// ============================================================================
// WaniWani API implementation
// ============================================================================

const SDK_NAME = "@waniwani/sdk";
const DEFAULT_BASE_URL = "https://app.waniwani.ai";

export class WaniwaniKvStore<T = Record<string, unknown>>
	implements KvStore<T>
{
	private get baseUrl(): string {
		return (process.env.WANIWANI_API_URL ?? DEFAULT_BASE_URL).replace(
			/\/$/,
			"",
		);
	}

	private get apiKey(): string | undefined {
		return process.env.WANIWANI_API_KEY;
	}

	async get(key: string): Promise<T | null> {
		if (!this.apiKey) {
			throw new Error(
				"[WaniWani KV] No API key configured. Set WANIWANI_API_KEY env var.",
			);
		}
		const data = await this.request<T | null>("/api/mcp/redis/get", { key });
		return data ?? null;
	}

	async set(key: string, value: T): Promise<void> {
		if (!this.apiKey) {
			throw new Error(
				"[WaniWani KV] No API key configured. Set WANIWANI_API_KEY env var.",
			);
		}
		await this.request("/api/mcp/redis/set", { key, value });
	}

	async delete(key: string): Promise<void> {
		if (!this.apiKey) {
			return;
		}
		try {
			await this.request("/api/mcp/redis/delete", { key });
		} catch (error) {
			console.error("[WaniWani KV] delete failed for key:", key, error);
		}
	}

	private async request<R>(path: string, body: unknown): Promise<R> {
		const url = `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
				"X-WaniWani-SDK": SDK_NAME,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(text || `KV store API error: HTTP ${response.status}`);
		}

		const json = (await response.json()) as { data: R };
		return json.data;
	}
}
