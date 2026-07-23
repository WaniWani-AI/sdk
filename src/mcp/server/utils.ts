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

const TURN_COUNT_KEYS = ["waniwani/turnCount"] as const;

/** Meta key for flow execution path (nodesVisited, flowId). */
export const FLOW_META_KEY = "waniwani/flow" as const;

/**
 * Meta key under which `withWaniwani` injects the widget tracking config
 * (`{ endpoint, token, sessionId, source, geoLocation }`) into tool response
 * `_meta`. The frontend client reads it to track without any manual wiring.
 * Older SDKs wrote the same object under the bare `waniwani` key.
 */
export const WIDGET_CONFIG_META_KEY = "waniwani/widget" as const;

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

/**
 * Number of user messages in the current chat session, as counted by the
 * Waniwani app before dispatching the MCP request. Useful for MCPs that
 * gate behavior on conversation length (e.g. compulsory email verification
 * after N turns) without each MCP having to track turn state itself.
 *
 * Forwarded as `waniwani/turnCount` (non-negative integer).
 */
export function extractTurnCount(
	meta: Record<string, unknown> | undefined,
): number | undefined {
	if (!meta) {
		return undefined;
	}
	for (const key of TURN_COUNT_KEYS) {
		const value = meta[key];
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
			return value;
		}
	}
	return undefined;
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

/**
 * HTTP request headers that identify a known caller when neither `_meta` nor
 * `clientInfo` carries a source. This is the most robust Claude signal: every
 * Claude surface sends `User-Agent: Claude-User` and `x-anthropic-client` on
 * MCP HTTP requests, whereas the MCP transport carries no session id and the
 * `initialize` `clientInfo` may not be surfaced on stateless deployments.
 */
function headerValue(
	headers: Record<string, unknown>,
	key: string,
): string | undefined {
	// HTTP header names are case-insensitive; the transport may preserve the
	// original casing, so match the key case-insensitively rather than assuming
	// it was lowercased.
	const lowerKey = key.toLowerCase();
	let raw = headers[key] ?? headers[lowerKey];
	if (raw === undefined) {
		for (const headerKey of Object.keys(headers)) {
			if (headerKey.toLowerCase() === lowerKey) {
				raw = headers[headerKey];
				break;
			}
		}
	}
	const value = Array.isArray(raw) ? raw[0] : raw;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function extractSourceFromHeaders(
	headers: Record<string, unknown> | undefined,
): string | undefined {
	if (!headers) {
		return undefined;
	}
	const userAgent = headerValue(headers, "user-agent");
	const anthropicClient = headerValue(headers, "x-anthropic-client");
	if (
		(userAgent && /claude/i.test(userAgent)) ||
		(anthropicClient && /claude|anthropic/i.test(anthropicClient))
	) {
		return "claude";
	}
	// ChatGPT / OpenAI surfaces without an `openai/*` session key still send an
	// OpenAI user-agent (e.g. `ChatGPT-User`), so attribute them here too.
	if (userAgent && /chatgpt|openai/i.test(userAgent)) {
		return "chatgpt";
	}
	return undefined;
}
