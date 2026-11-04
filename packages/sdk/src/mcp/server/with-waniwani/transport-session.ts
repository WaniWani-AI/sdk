type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Extract session ID from MCP transport metadata (`extra.sessionId`),
 * the raw `Mcp-Session-Id` HTTP header, or the `X-Waniwani-Session-Id`
 * header (set by stateless serverless deployments).
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
			const waniSid = headers["x-waniwani-session-id"];
			if (typeof waniSid === "string" && waniSid) {
				return waniSid;
			}
		}
	}

	return undefined;
}
