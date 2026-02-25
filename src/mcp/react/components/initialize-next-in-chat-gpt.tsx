/**
 *
 * Initializes & patches Next.js functionalities
 * so it can be run inside the ChatGPT iframe:
 * - history.pushState / history.replaceState - Prevents full-origin URLs in history
 * - window.fetch - Rewrites same-origin requests to use the correct base URL
 * - window.WebSocket - Rewrites WebSocket URLs that resolve against sandbox origin
 * - html attribute observer - Prevents ChatGPT from modifying the root element
 *
 * More information about this component can be found here:
 *
 * https://vercel.com/blog/running-next-js-inside-chatgpt-a-deep-dive-into-native-app-integration
 */
export function InitializeNextJsInChatGpt({ baseUrl }: { baseUrl: string }) {
	return (
		<>
			<base href={baseUrl}></base>
			<script>{`window.innerBaseUrl = ${JSON.stringify(baseUrl)}`}</script>
			<script>{`window.__isChatGptApp = typeof window.openai !== "undefined";`}</script>
			<script>
				{"(" +
					(() => {
						const baseUrl = window.innerBaseUrl;
						const htmlElement = document.documentElement;
						const observer = new MutationObserver((mutations) => {
							mutations.forEach((mutation) => {
								if (
									mutation.type === "attributes" &&
									mutation.target === htmlElement
								) {
									const attrName = mutation.attributeName;
									// Preserve class/style so consumers can use html.dark { ... } for theming
									if (
										attrName &&
										attrName !== "suppresshydrationwarning" &&
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

						const originalReplaceState = history.replaceState;
						history.replaceState = (_s, unused, url) => {
							const u = new URL(url ?? "", window.location.href);
							const href = u.pathname + u.search + u.hash;
							originalReplaceState.call(history, unused, href);
						};

						const originalPushState = history.pushState;
						history.pushState = (_s, unused, url) => {
							const u = new URL(url ?? "", window.location.href);
							const href = u.pathname + u.search + u.hash;
							originalPushState.call(history, unused, href);
						};

						const appOrigin = new URL(baseUrl).origin;
						const isInIframe = window.self !== window.top;

						window.addEventListener(
							"click",
							(e) => {
								const a = (e?.target as HTMLElement)?.closest("a");
								if (!a || !a.href) return;
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

							window.fetch = (
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
							};

							// Proxy WebSocket to rewrite URLs that resolve against
							// the sandbox iframe origin instead of the app origin
							// (fixes HMR when base-uri CSP blocks <base href>)
							const OrigWS = window.WebSocket;
							const WsProxy = ((url: string, protocols?: string | string[]) => {
								try {
									const parsed = new URL(url, window.location.href);
									if (parsed.origin !== appOrigin) {
										const wsOrigin = appOrigin.replace(/^http/, "ws");
										url =
											wsOrigin + parsed.pathname + parsed.search + parsed.hash;
									}
								} catch {
									const wsOrigin = appOrigin.replace(/^http/, "ws");
									url = wsOrigin + (url.startsWith("/") ? "" : "/") + url;
								}
								return protocols !== undefined
									? new OrigWS(url, protocols)
									: new OrigWS(url);
							}) as unknown as typeof WebSocket;
							WsProxy.prototype = OrigWS.prototype;
							Object.defineProperties(WsProxy, {
								CONNECTING: { value: OrigWS.CONNECTING },
								OPEN: { value: OrigWS.OPEN },
								CLOSING: { value: OrigWS.CLOSING },
								CLOSED: { value: OrigWS.CLOSED },
							});
							window.WebSocket = WsProxy;
						}
					}).toString() +
					")()"}
			</script>
		</>
	);
}
