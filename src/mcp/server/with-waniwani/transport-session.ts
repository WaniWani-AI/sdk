type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Extract session ID from MCP transport metadata (`extra.sessionId`) or
 * the raw `Mcp-Session-Id` HTTP header (`extra.requestInfo.headers`).
 */
export function extractTransportSessionId(
	extra: UnknownRecord,
): string | undefined {
	if (typeof extra.sessionId === "string" && extra.sessionId) {
		return extra.sessionId;
	}

	if (isRecord(extra.requestInfo)) {
		const rawHeaders = (extra.requestInfo as UnknownRecord).headers;
		if (isRecord(rawHeaders)) {
			// Normalize keys to lowercase — HTTP headers are case-insensitive
			// but the transport may preserve original casing (e.g. "Mcp-Session-Id").
			const headers: UnknownRecord = {};
			for (const key of Object.keys(rawHeaders)) {
				headers[key.toLowerCase()] = rawHeaders[key];
			}
			const sid = headers["mcp-session-id"];
			if (typeof sid === "string" && sid) {
				return sid;
			}
		}
	}

	return undefined;
}
