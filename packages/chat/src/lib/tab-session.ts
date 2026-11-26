/**
 * The tab's session data, in one sessionStorage key, `waniwani-session`. It
 * lasts as long as the tab: a reload keeps it, a new tab starts empty.
 *
 * - `agent`: the session id that keys a browsing agent's flow state (WebMCP)
 */

export const TAB_SESSION_KEY = "waniwani-session";

export type TabSession = {
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
	return typeof parsed.agent === "string" ? { agent: parsed.agent } : {};
}

/** Writes the whole object, or removes the key when nothing is left in it. */
export function writeTabSession(session: TabSession): void {
	if (session.agent) {
		sessionStorage.setItem(
			TAB_SESSION_KEY,
			JSON.stringify({ agent: session.agent }),
		);
	} else {
		sessionStorage.removeItem(TAB_SESSION_KEY);
	}
}
