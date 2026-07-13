// Waniwani SDK - Main Entry

import { createKbClient } from "./kb/client.js";
import {
	getGlobalConfig,
	loadProjectConfig,
	type WaniWaniProjectConfig,
} from "./project-config.js";
import { createTrackingClient } from "./tracking/index.js";
import type { WaniWaniClient, WaniWaniConfig } from "./types.js";

/**
 * Create a Waniwani SDK client
 *
 * @param config - Configuration options. When omitted, reads `waniwani.json`
 *   from the current working directory, then falls back to env vars.
 * @returns A fully typed Waniwani client
 *
 * @example
 * ```typescript
 * import { waniwani } from "@waniwani/sdk";
 * import { toNextJsHandler } from "@waniwani/sdk/next-js";
 *
 * const wani = waniwani({ apiKey: "..." });
 *
 * // Next.js route handler
 * export const { GET, POST } = toNextJsHandler(wani, {
 *   chat: { systemPrompt: "You are a helpful assistant." },
 * });
 * ```
 */
export function waniwani(
	config?: WaniWaniConfig | WaniWaniProjectConfig,
): WaniWaniClient {
	const projectConfig = config ?? loadProjectConfig() ?? getGlobalConfig();
	const effective = projectConfig as
		| (WaniWaniConfig & WaniWaniProjectConfig)
		| undefined;

	const apiUrl =
		effective?.apiUrl ??
		process.env.WANIWANI_API_URL ??
		"https://app.waniwani.ai";
	const apiKey = effective?.apiKey ?? process.env.WANIWANI_API_KEY;
	const trackingConfig = {
		endpointPath:
			effective?.tracking?.endpointPath ?? "/api/mcp/events/v2/batch",
		flushIntervalMs: effective?.tracking?.flushIntervalMs ?? 1_000,
		maxBatchSize: effective?.tracking?.maxBatchSize ?? 20,
		maxBufferSize: effective?.tracking?.maxBufferSize ?? 1_000,
		maxRetries: effective?.tracking?.maxRetries ?? 3,
		retryBaseDelayMs: effective?.tracking?.retryBaseDelayMs ?? 200,
		retryMaxDelayMs: effective?.tracking?.retryMaxDelayMs ?? 2_000,
		shutdownTimeoutMs: effective?.tracking?.shutdownTimeoutMs ?? 2_000,
	};

	const internalConfig = { apiUrl, apiKey, tracking: trackingConfig };

	// Compose client from modules
	const trackingClient = createTrackingClient(internalConfig);
	const kbClient = createKbClient(internalConfig);

	return {
		...trackingClient,
		kb: kbClient,
		_config: internalConfig,
	};
}
