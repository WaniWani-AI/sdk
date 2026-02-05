/**
 * Widget platform types
 */
export type WidgetPlatform = "openai" | "mcp-apps";

/**
 * Detects which platform the widget is running on.
 *
 * OpenAI injects a global `window.openai` object.
 * MCP Apps runs in a sandboxed iframe and uses postMessage.
 */
export function detectPlatform(): WidgetPlatform {
	if (typeof window !== "undefined" && "openai" in window) {
		return "openai";
	}
	return "mcp-apps";
}

/**
 * Check if running on OpenAI platform
 */
export function isOpenAI(): boolean {
	return detectPlatform() === "openai";
}

/**
 * Check if running on MCP Apps platform
 */
export function isMCPApps(): boolean {
	return detectPlatform() === "mcp-apps";
}
