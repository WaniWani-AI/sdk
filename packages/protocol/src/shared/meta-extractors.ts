// ============================================================================
// Meta key extraction helpers
// ============================================================================

/** Pick the first non-empty string value from `meta` matching the given keys. */
export function pickFirst(
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
	"openai/session",
	"sessionId",
	"conversationId",
	"mcp-session-id",
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

const VISITOR_ID_KEYS = ["waniwani/visitorId", "visitorId"] as const;

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

export function extractVisitorId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	return meta ? pickFirst(meta, VISITOR_ID_KEYS) : undefined;
}

export function extractCorrelationId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	return meta ? pickFirst(meta, CORRELATION_ID_KEYS) : undefined;
}

const SOURCE_SESSION_KEYS = [
	{ key: "openai/sessionId", source: "chatgpt" },
	{ key: "openai/session", source: "chatgpt" },
] as const;

/**
 * Client identifiers advertised via MCP `initialize` → `clientInfo.name` that
 * the SDK maps to a known source. Match is case-insensitive substring on the
 * advertised name, so this catches "Claude", "Claude Code", "claude-ai", etc.
 * without having to enumerate every surface.
 *
 * ChatGPT is primarily identified by its `openai/*` session key (see
 * SOURCE_SESSION_KEYS), but a session without that key still resolves here from
 * the advertised client name so assistant traffic is attributed consistently.
 * First match wins, so order the needles most-specific first.
 */
const CLIENT_INFO_NAME_SOURCES: ReadonlyArray<{
	needle: string;
	source: string;
}> = [
	{ needle: "claude", source: "claude" },
	{ needle: "chatgpt", source: "chatgpt" },
	{ needle: "openai", source: "chatgpt" },
	{ needle: "gemini", source: "gemini" },
];

export type ExtractSourceClientInfo = {
	name?: string;
	version?: string;
};

export function extractSource(
	meta: Record<string, unknown> | undefined,
	clientInfo?: ExtractSourceClientInfo,
): string | undefined {
	if (meta) {
		const explicit = meta["waniwani/source"];
		if (typeof explicit === "string" && explicit.length > 0) {
			return explicit;
		}
		for (const { key, source } of SOURCE_SESSION_KEYS) {
			const value = meta[key];
			if (typeof value === "string" && value.length > 0) {
				return source;
			}
		}
	}
	// Fall back to MCP `initialize` clientInfo.name when no _meta key matches.
	// Claude surfaces (Code, Desktop, claude.ai connector, Anthropic API MCP
	// connector) don't expose a namespaced session id in _meta but do advertise
	// themselves in the handshake. Per-MCP-session clientInfo is captured by the
	// MCP transport and exposed via server.getClientVersion().
	const name = clientInfo?.name;
	if (typeof name === "string" && name.length > 0) {
		const lower = name.toLowerCase();
		for (const { needle, source } of CLIENT_INFO_NAME_SOURCES) {
			if (lower.includes(needle)) {
				return source;
			}
		}
	}
	return undefined;
}
