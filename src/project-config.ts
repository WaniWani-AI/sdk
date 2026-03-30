import type { TrackingConfig } from "./tracking/@types.js";

/**
 * Project-level configuration for WaniWani MCP projects.
 *
 * This is the single source of truth for both CLI tools (`waniwani eval`,
 * `waniwani embed`, etc.) and the runtime SDK client (`waniwani()`).
 *
 * Create a `waniwani.config.ts` at the project root:
 * ```ts
 * import { defineConfig } from "@waniwani/sdk";
 *
 * export default defineConfig({
 *   apiKey: process.env.WANIWANI_API_KEY,
 *   evals: {
 *     mcpServerUrl: "http://localhost:3001",
 *   },
 * });
 * ```
 *
 * Then import it as a side-effect to register the config globally:
 * ```ts
 * import "./waniwani.config";
 * import { waniwani } from "@waniwani/sdk";
 *
 * const wani = waniwani(); // picks up config from defineConfig
 * ```
 */
export interface WaniWaniProjectConfig {
	/**
	 * Your MCP environment API key.
	 * Defaults to `process.env.WANIWANI_API_KEY` if not provided.
	 */
	apiKey?: string;
	/**
	 * The base URL of the WaniWani API.
	 * Defaults to `https://app.waniwani.ai`.
	 */
	apiUrl?: string;
	/** Tracking transport behavior. */
	tracking?: TrackingConfig;
	evals?: {
		/** Path to the evals directory (relative to project root).
		 *
		 * @default ./evals */
		dir?: string;
		/** MCP server URL to test against. */
		mcpServerUrl: string;
	};
	knowledgeBase?: {
		/** Path to the knowledge base directory (relative to project root).
		 *
		 * @default ./knowledge-base
		 */
		dir?: string;
	};
}

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

let _globalConfig: WaniWaniProjectConfig | undefined;

/**
 * Define and register a WaniWani project configuration.
 *
 * Calling this stores the config in a module-level variable so that
 * `waniwani()` and `withWaniwani()` can read from it automatically
 * when no explicit config is passed.
 *
 * The config is also returned for direct use.
 */
export function defineConfig(
	config: WaniWaniProjectConfig,
): WaniWaniProjectConfig {
	_globalConfig = config;
	return config;
}

/**
 * Retrieve the globally registered config (set by `defineConfig`).
 * Returns `undefined` if `defineConfig` has not been called.
 * @internal
 */
export function getGlobalConfig(): WaniWaniProjectConfig | undefined {
	return _globalConfig;
}
