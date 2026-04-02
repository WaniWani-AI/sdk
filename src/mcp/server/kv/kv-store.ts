/**
 * Generic key-value store backed by the WaniWani API.
 *
 * Values are stored as JSON objects (`Record<string, unknown>`) in the
 * `/api/mcp/redis/*` endpoints. Tenant isolation is handled by the API key.
 *
 * This is the generic version — `WaniwaniFlowStore` uses this under the hood
 * with `FlowTokenContent` as the value type.
 */

import { getGlobalConfig } from "../../../project-config.js";

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
		const globalConfig = getGlobalConfig();

		// order: options.baseUrl, process.env.WANIWANI_API_URL, globalConfig?.apiUrl, DEFAULT_BASE_URL
		this.baseUrl = (
			options?.baseUrl ??
			process.env.WANIWANI_API_URL ??
			globalConfig?.apiUrl ??
			DEFAULT_BASE_URL
		).replace(/\/$/, "");

		// order: options.apiKey, process.env.WANIWANI_API_KEY, globalConfig?.apiKey
		this.apiKey =
			options?.apiKey ?? process.env.WANIWANI_API_KEY ?? globalConfig?.apiKey;

		const keySource = options?.apiKey
			? "options"
			: process.env.WANIWANI_API_KEY
				? "env:WANIWANI_API_KEY"
				: globalConfig?.apiKey
					? "globalConfig"
					: "none";
		console.log(
			`[WaniWani KV] init: baseUrl=${this.baseUrl}, keySource=${keySource}, keyPrefix=${this.apiKey?.slice(0, 8) ?? "n/a"}`,
		);
	}

	async get(key: string): Promise<T | null> {
		if (!this.apiKey) {
			console.warn("[WaniWani KV] get: no API key configured — returning null");
			return null;
		}
		try {
			const data = await this.request<T | null>("/api/mcp/redis/get", {
				key,
			});
			return data ?? null;
		} catch (error) {
			console.error("[WaniWani KV] get failed for key:", key, error);
			return null;
		}
	}

	async set(key: string, value: T): Promise<void> {
		if (!this.apiKey) {
			console.warn("[WaniWani KV] set: no API key configured — skipping");
			return;
		}
		try {
			await this.request("/api/mcp/redis/set", { key, value });
		} catch (error) {
			console.error("[WaniWani KV] set failed for key:", key, error);
		}
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
