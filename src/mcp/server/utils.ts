// ============================================================================
// Meta key extraction helpers
// ============================================================================

/** Pick the first non-empty string value from `meta` matching the given keys. */
function pickFirst(
	meta: Record<string, unknown>,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const value = meta[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

// --- Key lists (ordered by priority) ---

const SESSION_ID_KEYS = [
	"waniwani/sessionId",
	"openai/sessionId",
	"sessionId",
	"conversationId",
	"anthropic/sessionId",
] as const;

const REQUEST_ID_KEYS = [
	"waniwani/requestId",
	"openai/requestId",
	"requestId",
	"mcp/requestId",
] as const;

const TRACE_ID_KEYS = [
	"waniwani/traceId",
	"openai/traceId",
	"traceId",
	"mcp/traceId",
	"openai/requestId",
	"requestId",
] as const;

const EXTERNAL_USER_ID_KEYS = [
	"waniwani/userId",
	"openai/userId",
	"externalUserId",
	"userId",
	"actorId",
] as const;

const CORRELATION_ID_KEYS = ["correlationId", "openai/requestId"] as const;

// --- Extractors ---

export function extractSessionId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	return meta ? pickFirst(meta, SESSION_ID_KEYS) : undefined;
}

export function extractRequestId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	return meta ? pickFirst(meta, REQUEST_ID_KEYS) : undefined;
}

export function extractTraceId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	return meta ? pickFirst(meta, TRACE_ID_KEYS) : undefined;
}

export function extractExternalUserId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	return meta ? pickFirst(meta, EXTERNAL_USER_ID_KEYS) : undefined;
}

export function extractCorrelationId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	return meta ? pickFirst(meta, CORRELATION_ID_KEYS) : undefined;
}

const SOURCE_SESSION_KEYS = [
	{ key: "waniwani/sessionId", source: "chatbar" },
	{ key: "openai/sessionId", source: "chatgpt" },
	{ key: "anthropic/sessionId", source: "claude" },
] as const;

export function extractSource(
	meta: Record<string, unknown> | undefined,
): string {
	if (!meta) {
		return "@waniwani/sdk";
	}
	for (const { key, source } of SOURCE_SESSION_KEYS) {
		const value = meta[key];
		if (typeof value === "string" && value.length > 0) {
			return source;
		}
	}
	return "@waniwani/sdk";
}
