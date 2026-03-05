// KB Client — thin HTTP wrapper for knowledge base API

import { WaniWaniError } from "../error.js";
import type { InternalConfig } from "../types.js";
import type {
	KbClient,
	KbIngestFile,
	KbIngestResult,
	KbSearchOptions,
	KbSource,
	SearchResult,
} from "./types.js";

const SDK_NAME = "@waniwani/sdk";

export function createKbClient(config: InternalConfig): KbClient {
	const { baseUrl, apiKey } = config;

	function requireApiKey(): string {
		if (!apiKey) {
			throw new Error("WANIWANI_API_KEY is not set");
		}
		return apiKey;
	}

	async function request<T>(
		method: "GET" | "POST",
		path: string,
		body?: unknown,
	): Promise<T> {
		const key = requireApiKey();
		const url = `${baseUrl.replace(/\/$/, "")}${path}`;

		const headers: Record<string, string> = {
			Authorization: `Bearer ${key}`,
			"X-WaniWani-SDK": SDK_NAME,
		};

		const init: RequestInit = { method, headers };

		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
			init.body = JSON.stringify(body);
		}

		const response = await fetch(url, init);

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new WaniWaniError(
				text || `KB API error: HTTP ${response.status}`,
				response.status,
			);
		}

		return response.json() as Promise<T>;
	}

	return {
		async ingest(files: KbIngestFile[]): Promise<KbIngestResult> {
			return request<KbIngestResult>("POST", "/api/mcp/kb/ingest", {
				files,
			});
		},

		async search(
			query: string,
			options?: KbSearchOptions,
		): Promise<SearchResult[]> {
			return request<SearchResult[]>("POST", "/api/mcp/kb/search", {
				query,
				...options,
			});
		},

		async sources(): Promise<KbSource[]> {
			return request<KbSource[]>("GET", "/api/mcp/kb/sources");
		},
	};
}
