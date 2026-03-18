const SESSION_ID_KEYS = [
	"waniwani/sessionId",
	"openai/sessionId",
	"sessionId",
	"conversationId",
	"anthropic/sessionId",
] as const;

/**
 * Extracts the session ID from the _meta field of the MCP request.
 *
 * @param meta - The _meta field of the MCP request.
 * @returns The session ID, or undefined if not found.
 */
export function extractSessionId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	if (!meta) {
		return undefined;
	}
	for (const key of SESSION_ID_KEYS) {
		const value = meta[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}
