/**
 * Creates a namespaced logger that writes to console.log when enabled,
 * or is a no-op when disabled.
 *
 * @example
 * const log = createLogger("chat", debug);
 * log("→ POST", request.url);  // [waniwani:chat] → POST ...
 */
export function createLogger(
	namespace: string,
	enabled: boolean,
): (...args: unknown[]) => void {
	return enabled
		? (...args: unknown[]) => console.log(`[waniwani:${namespace}]`, ...args)
		: () => {};
}
