// ============================================================================
// Lightweight debug logging for the chat embed.
//
// Enabled at runtime (no rebuild) via any of:
//   - `window.WANIWANI_DEBUG = true`
//   - `localStorage.setItem("WANIWANI_DEBUG", "1")`
//
// Off by default and a no-op in production, so leaving `debugLog(...)` calls in
// the hot path costs nothing for normal visitors.
// ============================================================================

declare global {
	interface Window {
		WANIWANI_DEBUG?: boolean;
	}
}

/** Whether verbose embed logging is switched on for this page. */
export function isDebugEnabled(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	try {
		if (window.WANIWANI_DEBUG) {
			return true;
		}
		return Boolean(window.localStorage?.getItem("WANIWANI_DEBUG"));
	} catch {
		// localStorage can throw (privacy mode, sandboxed iframe) — treat as off.
		return false;
	}
}

/** `console.log` prefixed with `[Waniwani]`, gated on {@link isDebugEnabled}. */
export function debugLog(...args: unknown[]): void {
	if (isDebugEnabled()) {
		console.log("[Waniwani]", ...args);
	}
}
