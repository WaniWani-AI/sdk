// MCP Config Resolver - Lazy-loads and caches MCP environment config

import { WaniWaniError } from "../../error";

interface McpEnvironmentConfig {
	mcpServerUrl: string;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes

export function createMcpConfigResolver(
	baseUrl: string,
	apiKey: string | undefined,
) {
	let cached: { config: McpEnvironmentConfig; expiresAt: number } | null = null;
	let inflight: Promise<McpEnvironmentConfig> | null = null;

	return async function resolve(): Promise<McpEnvironmentConfig> {
		if (cached && Date.now() < cached.expiresAt) {
			return cached.config;
		}

		// Deduplicate concurrent requests (cold start scenario)
		if (inflight) {
			return inflight;
		}

		inflight = (async () => {
			if (!apiKey) {
				throw new WaniWaniError(
					"WANIWANI_API_KEY is required for createChatHandler",
					401,
				);
			}

			const response = await fetch(`${baseUrl}/api/mcp/environments/config`, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			});

			if (!response.ok) {
				const body = await response.text().catch(() => "");
				throw new WaniWaniError(
					`Failed to resolve MCP environment config: ${response.status} ${body}`,
					response.status,
				);
			}

			const data = (await response.json()) as McpEnvironmentConfig;
			cached = { config: data, expiresAt: Date.now() + TTL_MS };
			return data;
		})();

		try {
			return await inflight;
		} finally {
			inflight = null;
		}
	};
}
