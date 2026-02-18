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

	const internalConfig = { baseUrl, apiKey };

	// Compose client from modules
	const tracking = createTrackingClient(internalConfig);

	return {
		...tracking,
		_config: internalConfig,
	};
}
