/**
 * Build the resource-endpoint URL used by widget iframes to fetch their
 * HTML via GET.
 *
 * Iframe navigations can't set custom headers, so when the chat caller
 * passed an `Authorization: Bearer …` header (the embed path), we
 * propagate the token in the URL. Same-origin proxy setups (customer
 * next-js adapter) don't need this and get a plain endpoint back.
 *
 * Parameter is deliberately narrowed to `Record<string, string>` to match
 * `ChatBaseProps.headers`. Widening it to `HeadersInit` would silently
 * drop the token for `Headers`/tuple-array shapes (they need `.get()` /
 * iteration) and leave the iframe returning 401 with no clear signal.
 */
export function buildResourceEndpoint(
	api: string,
	headers: Record<string, string> | undefined,
): string {
	const authHeaderValue = headers?.Authorization;
	const resourceToken =
		typeof authHeaderValue === "string" && authHeaderValue.startsWith("Bearer ")
			? authHeaderValue.slice(7)
			: null;
	return resourceToken
		? `${api}/resource?token=${encodeURIComponent(resourceToken)}`
		: `${api}/resource`;
}
