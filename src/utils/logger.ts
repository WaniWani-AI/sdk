type LogLevel = "debug" | "warn" | "error" | "none";

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	warn: 1,
	error: 2,
	none: 3,
};

function getGlobalLevel(): LogLevel {
	const explicit = process.env.WANIWANI_LOG_LEVEL as LogLevel | undefined;
	if (explicit && explicit in LEVELS) {
		return explicit;
	}
	if (process.env.WANIWANI_DEBUG) {
		return "debug";
	}
	return "none";
}

/**
 * Creates a namespaced logger that writes to stderr when the log level permits.
 *
 * When `enabled` is omitted the logger checks `WANIWANI_LOG_LEVEL` (or falls
 * back to `WANIWANI_DEBUG` for backward compat). Pass an explicit boolean to
 * override the env-var check (e.g. from a user-facing `debug` option).
 *
 * Output goes to **stderr** (`console.error`), not stdout. On a stdio-transport
 * MCP server stdout is the JSON-RPC channel, so debug logging must stay on
 * stderr to avoid corrupting the protocol stream.
 *
 * @example
 * const log = createLogger("chat");          // env-var driven
 * const log = createLogger("chat", debug);   // explicit override
 */
export function createLogger(
	namespace: string,
	enabled?: boolean,
): (...args: unknown[]) => void {
	const active = enabled ?? getGlobalLevel() === "debug";
	return active
		? (...args: unknown[]) => console.error(`[waniwani:${namespace}]`, ...args)
		: () => {};
}
