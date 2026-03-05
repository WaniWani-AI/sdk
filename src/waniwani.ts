// WaniWani SDK - Main Entry

import { createKbClient } from "./kb/client.js";
import { createTrackingClient } from "./tracking/index.js";
import type { WaniWaniClient, WaniWaniConfig } from "./types.js";

/**
 * Create a WaniWani SDK client
 *
 * @param config - Configuration options
 * @returns A fully typed WaniWani client
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
export function waniwani(config?: WaniWaniConfig): WaniWaniClient {
	const baseUrl = config?.baseUrl ?? "https://app.waniwani.ai";
	const apiKey = config?.apiKey ?? process.env.WANIWANI_API_KEY;
	const trackingConfig = {
		endpointPath: config?.tracking?.endpointPath ?? "/api/mcp/events/v2/batch",
		flushIntervalMs: config?.tracking?.flushIntervalMs ?? 1_000,
		maxBatchSize: config?.tracking?.maxBatchSize ?? 20,
		maxBufferSize: config?.tracking?.maxBufferSize ?? 1_000,
		maxRetries: config?.tracking?.maxRetries ?? 3,
		retryBaseDelayMs: config?.tracking?.retryBaseDelayMs ?? 200,
		retryMaxDelayMs: config?.tracking?.retryMaxDelayMs ?? 2_000,
		shutdownTimeoutMs: config?.tracking?.shutdownTimeoutMs ?? 2_000,
	};

	const internalConfig = { baseUrl, apiKey, tracking: trackingConfig };

	// Compose client from modules
	const trackingClient = createTrackingClient(internalConfig);
	const kbClient = createKbClient(internalConfig);

	return {
		...trackingClient,
		kb: kbClient,
		_config: internalConfig,
	};
}
