import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Project-level configuration for WaniWani MCP projects.
 *
 * Mirrors the JSON Schema hosted at https://app.waniwani.ai/waniwani.json.
 * The canonical config file is `waniwani.json` at the project root:
 *
 * ```json
 * {
 *   "$schema": "https://app.waniwani.ai/waniwani.json",
 *   "orgId": "...",
 *   "projectId": "..."
 * }
 * ```
 *
 * `waniwani()` and the CLI both read this file automatically — no
 * explicit import is required.
 */
export interface WaniWaniProjectConfig {
	/** URL of the JSON Schema for editor autocomplete. Ignored at runtime. */
	$schema?: string;
	/** WaniWani organization ID this project belongs to. */
	orgId?: string;
	/** WaniWani MCP project ID. */
	projectId?: string;
	/**
	 * The base URL of the WaniWani API.
	 * Defaults to `https://app.waniwani.ai`.
	 */
	apiUrl?: string;
	/**
	 * Local port the MCP listens on during `waniwani dev`. Overridden by
	 * `--port`. Defaults to 3000.
	 */
	devPort?: number;
}

// ---------------------------------------------------------------------------
// waniwani.json loader
// ---------------------------------------------------------------------------

const CONFIG_FILENAME = "waniwani.json";

let _cached: WaniWaniProjectConfig | null | undefined;

/**
 * Load `waniwani.json` from the current working directory.
 *
 * Returns `null` if the file doesn't exist or the runtime doesn't support
 * synchronous filesystem reads (e.g. edge / worker runtimes). Cached after
 * the first call.
 *
 * @internal
 */
export function loadProjectConfig(): WaniWaniProjectConfig | null {
	if (_cached !== undefined) {
		return _cached;
	}

	try {
		const filePath = resolve(process.cwd(), CONFIG_FILENAME);
		if (!existsSync(filePath)) {
			_cached = null;
			return null;
		}
		const raw = readFileSync(filePath, "utf-8");
		_cached = JSON.parse(raw) as WaniWaniProjectConfig;
		return _cached;
	} catch {
		_cached = null;
		return null;
	}
}

/**
 * Reset the cached config. Test-only.
 *
 * @internal
 */
export function resetProjectConfigCache(): void {
	_cached = undefined;
}

// ---------------------------------------------------------------------------
// Legacy: defineConfig + globalThis registration
// ---------------------------------------------------------------------------

const GLOBAL_KEY = "__waniwani_config__" as const;

/**
 * Register a WaniWani project configuration on `globalThis`.
 *
 * @deprecated Create a `waniwani.json` at the project root instead. The SDK
 *   and CLI both auto-load that file — no `defineConfig` call required.
 *   See https://app.waniwani.ai/waniwani.json for the schema.
 */
export function defineConfig(
	config: WaniWaniProjectConfig,
): WaniWaniProjectConfig {
	(globalThis as Record<string, unknown>)[GLOBAL_KEY] = config;
	return config;
}

/**
 * Retrieve the globally registered config (set by `defineConfig`).
 *
 * @deprecated Use `loadProjectConfig()` instead. `defineConfig` is going away.
 * @internal
 */
export function getGlobalConfig(): WaniWaniProjectConfig | undefined {
	return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as
		| WaniWaniProjectConfig
		| undefined;
}
