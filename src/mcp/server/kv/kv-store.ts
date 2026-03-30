/**
 * Generic key-value store backed by the WaniWani API.
 *
 * Values are stored as JSON objects (`Record<string, unknown>`) in the
 * `/api/mcp/redis/*` endpoints. Tenant isolation is handled by the API key.
 *
 * This is the generic version — `WaniwaniFlowStore` uses this under the hood
 * with `FlowTokenContent` as the value type.
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

export interface KvStoreOptions {
	baseUrl?: string;
	apiKey?: string;
}

export class WaniwaniKvStore<T = Record<string, unknown>>
	implements KvStore<T>
{
	private readonly baseUrl: string;
	private readonly apiKey: string | undefined;

	constructor(options?: KvStoreOptions) {
		this.baseUrl = (
			options?.baseUrl ??
			process.env.WANIWANI_BASE_URL ??
			DEFAULT_BASE_URL
		).replace(/\/$/, "");
		this.apiKey = options?.apiKey ?? process.env.WANIWANI_API_KEY;
	}

	async get(key: string): Promise<T | null> {
		if (!this.apiKey) {
			return null;
		}
		try {
			const data = await this.request<T | null>("/api/mcp/redis/get", {
				key,
			});
			return data ?? null;
		} catch {
			return null;
		}
	}

	async set(key: string, value: T): Promise<void> {
		if (!this.apiKey) {
			return;
		}
		try {
			await this.request("/api/mcp/redis/set", { key, value });
		} catch {
			// Non-fatal
		}
	}

	async delete(key: string): Promise<void> {
		if (!this.apiKey) {
			return;
		}
		try {
			await this.request("/api/mcp/redis/delete", { key });
		} catch {
			// Non-fatal
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
