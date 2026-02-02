// WaniWani SDK - Main Entry

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
 * import { waniwani } from "@waniwani";
 *
 * const client = waniwani({ apiKey: "..." });
 *
 * await client.track({
 *   eventType: "tool.called",
 *   sessionId: "session-123",
 *   toolName: "pricing"
 * });
 * ```
 */
export function waniwani(config?: WaniWaniConfig): WaniWaniClient {
	const baseUrl = config?.baseUrl ?? "https://app.waniwani.ai";
	const apiKey = config?.apiKey ?? process.env.WANIWANI_API_KEY;

	const internalConfig = { baseUrl, apiKey };

	// Compose client from modules
	const tracking = createTrackingClient(internalConfig);

	return {
		...tracking,
		// Future modules will be spread here
		// ...tools,
	};
}
