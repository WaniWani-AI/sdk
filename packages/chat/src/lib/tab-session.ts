/**
 * The tab's session data, in one sessionStorage key, `waniwani-session`. It
 * lasts as long as the tab: a reload keeps it, a new tab starts empty.
 *
 * - `chat`: the saved conversations, mapped by `sessionKey()` from `eve/session`
 * - `agent`: the session id that keys a browsing agent's flow state (WebMCP)
 */

export const TAB_SESSION_KEY = "waniwani-session";

export type TabSession = {
	chat?: Record<string, unknown>;
	agent?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Throws when sessionStorage is unavailable; callers decide the fallback. */
export function readTabSession(): TabSession {
	const parsed: unknown = JSON.parse(
		sessionStorage.getItem(TAB_SESSION_KEY) ?? "null",
	);
	if (!isRecord(parsed)) {
		return {};
	}
	return {
		...(isRecord(parsed.chat) && { chat: parsed.chat }),
		...(typeof parsed.agent === "string" && { agent: parsed.agent }),
	};
}

/** Writes the whole object, or removes the key when nothing is left in it. */
export function writeTabSession(session: TabSession): void {
	const kept: TabSession = {
		...(session.chat &&
			Object.keys(session.chat).length > 0 && { chat: session.chat }),
		...(session.agent && { agent: session.agent }),
	};
	if (Object.keys(kept).length > 0) {
		sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(kept));
	} else {
		sessionStorage.removeItem(TAB_SESSION_KEY);
	}
}
