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
		const headers = (extra.requestInfo as UnknownRecord).headers;
		if (isRecord(headers)) {
			const sid = (headers as UnknownRecord)["mcp-session-id"];
			if (typeof sid === "string" && sid) {
				return sid;
			}
		}
	}

	return undefined;
}
