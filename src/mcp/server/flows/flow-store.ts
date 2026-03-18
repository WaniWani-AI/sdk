/**
 * Server-side flow state store.
 *
 * Flow state is stored via the WaniWani API, keyed by session ID.
 * The session ID comes from _meta (provided by the MCP client on every call),
 * so the LLM doesn't need to round-trip anything.
 *
 * Tenant isolation is handled by the API key — no manual key prefixing needed.
 *
 * The `FlowStore` interface is exported for custom implementations.
 */

import type { FlowTokenContent } from "./@types";

// ============================================================================
// Interface
// ============================================================================

export interface FlowStore {
	get(key: string): Promise<FlowTokenContent | null>;
	set(key: string, value: FlowTokenContent): Promise<void>;
	delete(key: string): Promise<void>;
}

// ============================================================================
// WaniWani API implementation
// ============================================================================

const SDK_NAME = "@waniwani/sdk";
const DEFAULT_BASE_URL = "https://app.waniwani.ai";

export class WaniwaniFlowStore implements FlowStore {
	private readonly baseUrl: string;
	private readonly apiKey: string | undefined;

	constructor(options?: { baseUrl?: string; apiKey?: string }) {
		this.baseUrl = (
			options?.baseUrl ??
			process.env.WANIWANI_BASE_URL ??
			DEFAULT_BASE_URL
		).replace(/\/$/, "");
		this.apiKey = options?.apiKey ?? process.env.WANIWANI_API_KEY;
	}

	async get(key: string): Promise<FlowTokenContent | null> {
		if (!this.apiKey) {
			return null;
		}
		try {
			const data = await this.request<FlowTokenContent | null>(
				"/api/mcp/redis/get",
				{ key },
			);
			return data ?? null;
		} catch {
			return null;
		}
	}

	async set(key: string, value: FlowTokenContent): Promise<void> {
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

	private async request<T>(path: string, body: unknown): Promise<T> {
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
			throw new Error(text || `Flow state API error: HTTP ${response.status}`);
		}

		const json = (await response.json()) as { data: T };
		return json.data;
	}
}
