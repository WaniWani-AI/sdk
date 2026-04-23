/**
 * Initializes & patches Next.js functionality so an app can run as a
 * widget inside a cross-origin iframe. Used by every MCP widget host —
 * ChatGPT's sandbox, the embed's `/api/mcp/chat/resource` proxy, and any
 * future host that renders the widget on a domain other than its own
 * `baseUrl`.
 *
 * What it patches:
 * - `history.pushState` / `history.replaceState` — prevents full-origin
 *   URLs from ending up in the iframe's history (browsers reject cross-
 *   origin pushes in sandboxed iframes).
 * - `window.fetch` — rewrites same-origin requests to the widget's real
 *   `baseUrl`. Without this, relative `/api/...` calls from the widget
 *   hit the host's origin (ChatGPT sandbox, WaniWani embed proxy, etc.)
 *   and 404. `passthroughOrigins` opts specific origins out of the
 *   rewrite (see prop doc).
 * - `<html>` attribute observer — strips attributes the host injects
 *   after hydration (ChatGPT mutates `<html>` for theming), while
 *   preserving `class` / `style` / `lang`.
 *
 * More background on the ChatGPT case:
 * https://vercel.com/blog/running-next-js-inside-chatgpt-a-deep-dive-into-native-app-integration
 */
export function InitializeNextJsInIframe({
	baseUrl,
	passthroughOrigins,
}: {
	baseUrl: string;
	/**
	 * Origins whose fetches should skip the same-origin → baseUrl rewrite.
	 * Set this to the WaniWani API origin when the widget is loaded through
	 * a proxy that shares origin with the API (e.g. the embed's
	 * `/api/mcp/chat/resource` route on `app.waniwani.ai`). Without this,
	 * widget tracking calls to the WaniWani API get rewritten to the
	 * widget's own host and 404.
	 */
	passthroughOrigins?: string[];
}) {
	return (
		<>
			<base href={baseUrl}></base>
			<script>{`window.innerBaseUrl = ${JSON.stringify(baseUrl)}`}</script>
			<script>{`window.__wwPassthroughOrigins = ${JSON.stringify(passthroughOrigins ?? [])}`}</script>
			<script>{`window.__isChatGptApp = typeof window.openai !== "undefined";`}</script>
			<script>
				{"(" +
					(() => {
						const baseUrl = window.innerBaseUrl;
						const passthroughOrigins: string[] =
							(window as unknown as { __wwPassthroughOrigins: string[] })
								.__wwPassthroughOrigins ?? [];
						const htmlElement = document.documentElement;
						const observer = new MutationObserver((mutations) => {
							mutations.forEach((mutation) => {
								if (
									mutation.type === "attributes" &&
									mutation.target === htmlElement
								) {
									const attrName = mutation.attributeName;
									// Preserve class/style for theming (html.dark) and lang for i18n
									if (
										attrName &&
										attrName !== "suppresshydrationwarning" &&
										attrName !== "lang" &&
										attrName !== "class" &&
										attrName !== "style"
									) {
										htmlElement.removeAttribute(attrName);
									}
								}
							});
						});
						observer.observe(htmlElement, {
							attributes: true,
							attributeOldValue: true,
						});

						const originalReplaceState = history.replaceState.bind(history);
						history.replaceState = (
							_s: unknown,
							unused: string,
							url?: string | URL | null,
						) => {
							try {
								const u = new URL(String(url ?? ""), window.location.href);
								originalReplaceState(
									null,
									unused,
									u.pathname + u.search + u.hash,
								);
							} catch {
								/* SecurityError in sandboxed iframe */
							}
						};

						const originalPushState = history.pushState.bind(history);
						history.pushState = (
							_s: unknown,
							unused: string,
							url?: string | URL | null,
						) => {
							try {
								const u = new URL(String(url ?? ""), window.location.href);
								originalPushState(null, unused, u.pathname + u.search + u.hash);
							} catch {
								/* SecurityError in sandboxed iframe */
							}
						};

						const appOrigin = new URL(baseUrl).origin;
						const isInIframe = window.self !== window.top;

						window.addEventListener(
							"click",
							(e) => {
								const a = (e?.target as HTMLElement)?.closest("a");
								if (!a || !a.href) {
									return;
								}
								const url = new URL(a.href, window.location.href);
								if (
									url.origin !== window.location.origin &&
									url.origin !== appOrigin
								) {
									try {
										if (window.openai) {
											window.openai?.openExternal({ href: a.href });
											e.preventDefault();
										}
									} catch {
										console.warn(
											"openExternal failed, likely not in OpenAI client",
										);
									}
								}
							},
							true,
						);

						if (isInIframe && window.location.origin !== appOrigin) {
							const originalFetch = window.fetch;

							(window as { fetch: typeof window.fetch }).fetch = ((
								input: URL | RequestInfo,
								init?: RequestInit,
							): Promise<Response> => {
								let url: URL;
								if (typeof input === "string" || input instanceof URL) {
									url = new URL(input, window.location.href);
								} else {
									url = new URL(input.url, window.location.href);
								}

								if (url.origin === appOrigin) {
									if (typeof input === "string" || input instanceof URL) {
										input = url.toString();
									} else {
										input = new Request(url.toString(), input);
									}

									return originalFetch.call(window, input, {
										...init,
										mode: "cors",
									});
								}

								// Explicit passthrough list — never rewrite these.
								// Needed when the widget shares origin with a
								// non-Next-app host (e.g. the WaniWani app serving the
								// embed iframe + the tracking API from the same host).
								if (passthroughOrigins.indexOf(url.origin) !== -1) {
									return originalFetch.call(window, input, init);
								}

								if (url.origin === window.location.origin) {
									const newUrl = new URL(baseUrl);
									newUrl.pathname = url.pathname;
									newUrl.search = url.search;
									newUrl.hash = url.hash;
									url = newUrl;

									if (typeof input === "string" || input instanceof URL) {
										input = url.toString();
									} else {
										input = new Request(url.toString(), input);
									}

									return originalFetch.call(window, input, {
										...init,
										mode: "cors",
									});
								}

								return originalFetch.call(window, input, init);
							}) as typeof window.fetch;
						}
					}).toString() +
					")()"}
			</script>
		</>
	);
}
