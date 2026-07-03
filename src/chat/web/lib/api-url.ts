/**
 * Build a sibling endpoint URL from the chat `api` base.
 *
 * The `api` base is a full path to the chat endpoint (e.g.
 * `https://app.waniwani.ai/api/mcp/chat`) and every sibling endpoint
 * (`/config`, `/tools`, `/resource`) lives one segment deeper. Callers used to
 * build these by string concatenation (`` `${api}/config` ``), which breaks
 * when `api` carries a query string: internal surfaces append markers like
 * `?test=1` to the base, and naive concatenation produces
 * `.../chat?test=1/config` — the browser then reads `test=1/config` as the
 * query and hits the wrong route (a GET to the chat endpoint → 405).
 *
 * This inserts `path` before any existing query string, preserves the base's
 * own query params (so a marker like `test=1` propagates to siblings), and
 * merges in `params`. `api` may be absolute or root-relative (the default
 * `/api/waniwani`); the base and query are split textually so both forms work
 * without a document origin.
 */
export function buildApiUrl(
	api: string,
	path: string,
	params?: Record<string, string>,
): string {
	const [rawBase, rawQuery = ""] = api.split("?");
	const base = rawBase.replace(/\/$/, "");
	const search = new URLSearchParams(rawQuery);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			search.set(key, value);
		}
	}
	const query = search.toString();
	return `${base}${path}${query ? `?${query}` : ""}`;
}
