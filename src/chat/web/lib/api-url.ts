/** Preserves the base's query string, so `.../chat?test=1` yields `.../chat/config?test=1` and not `.../chat?test=1/config`, which routes to the chat endpoint. `api` may be absolute or root-relative. */
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

const PLATFORM_MOUNT = "/api/mcp/";

/** Resolves a Waniwani route that lives outside the chat mount (document module, event ingest) against the origin `api` points at. `null` off the platform mount: a customer-hosted runtime serves the chat siblings and nothing else, so `<its origin>/api/mcp/…` is a 404 the caller can neither fix nor explain. */
export function platformEndpoint(api: string, path: string): string | null {
	const [rawBase = ""] = api.split("?");
	let origin = "";
	let pathname = rawBase;
	try {
		const url = new URL(rawBase);
		origin = url.origin;
		pathname = url.pathname;
	} catch {
		if (!rawBase.startsWith("/")) {
			return null;
		}
	}
	return pathname.startsWith(PLATFORM_MOUNT) ? `${origin}${path}` : null;
}
