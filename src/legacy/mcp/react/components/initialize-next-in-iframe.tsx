/**
 * Patches `history`, `<html>` mutations and `window.fetch` so a Next.js
 * widget can run inside a cross-origin iframe host. Reads its config from
 * `window.innerBaseUrl` and `window.__wwPassthroughOrigins`, which the
 * surrounding `<script>` tags set before this runs.
 *
 * Exported so tests can drive it directly. Production code never imports
 * it — the component below stringifies it into the SSR HTML.
 */
export function applyIframePatches(): void {
	const baseUrl = window.innerBaseUrl;
	const passthroughOrigins: string[] =
		(window as unknown as { __wwPassthroughOrigins: string[] })
			.__wwPassthroughOrigins ?? [];
	const htmlElement = document.documentElement;
	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			if (mutation.type === "attributes" && mutation.target === htmlElement) {
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
			originalReplaceState(null, unused, u.pathname + u.search + u.hash);
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
			if (url.origin !== window.location.origin && url.origin !== appOrigin) {
				try {
					if (window.openai) {
						window.openai?.openExternal({ href: a.href });
						e.preventDefault();
					}
				} catch {
					console.warn("openExternal failed, likely not in OpenAI client");
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
			// Only string inputs without a scheme (or `//host`) are treated
			// as relative. URL/Request instances are always absolute, so
			// the caller already chose the target host.
			const isRelativeString =
				typeof input === "string" &&
				!/^[a-z][a-z0-9+.-]*:/i.test(input) &&
				!input.startsWith("//");

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

			if (passthroughOrigins.indexOf(url.origin) !== -1) {
				return originalFetch.call(window, input, init);
			}

			// Rewrite *relative* same-origin requests to the widget's real
			// `baseUrl`. Absolute URLs are left alone — they're the
			// caller's explicit target (e.g. SDK transport posting to the
			// WaniWani API on the same origin as the iframe).
			if (isRelativeString && url.origin === window.location.origin) {
				const newUrl = new URL(baseUrl);
				newUrl.pathname = url.pathname;
				newUrl.search = url.search;
				newUrl.hash = url.hash;
				url = newUrl;
				input = url.toString();

				return originalFetch.call(window, input, {
					...init,
					mode: "cors",
				});
			}

			return originalFetch.call(window, input, init);
		}) as typeof window.fetch;

		const wsAppOrigin = appOrigin.replace(/^http/, "ws");
		const OriginalWebSocket = window.WebSocket;
		const PatchedWebSocket = ((
			url: string | URL,
			protocols?: string | string[],
		) => {
			const parsed = new URL(String(url), window.location.href);
			if (
				parsed.origin === window.location.origin ||
				parsed.origin === window.location.origin.replace(/^http/, "ws")
			) {
				const rewritten = new URL(wsAppOrigin);
				rewritten.pathname = parsed.pathname;
				rewritten.search = parsed.search;
				rewritten.hash = parsed.hash;
				return new OriginalWebSocket(rewritten.toString(), protocols);
			}
			return new OriginalWebSocket(url, protocols);
		}) as unknown as typeof WebSocket;
		PatchedWebSocket.prototype = OriginalWebSocket.prototype;
		Object.assign(PatchedWebSocket, {
			CONNECTING: OriginalWebSocket.CONNECTING,
			OPEN: OriginalWebSocket.OPEN,
			CLOSING: OriginalWebSocket.CLOSING,
			CLOSED: OriginalWebSocket.CLOSED,
		});
		(window as { WebSocket: typeof WebSocket }).WebSocket = PatchedWebSocket;
	}
}

const PATCH_SCRIPT = `(${applyIframePatches.toString()})()`;

/**
 * Initializes & patches Next.js functionality so an app can run as a
 * widget inside a cross-origin iframe. Used by every MCP widget host —
 * ChatGPT's sandbox, the embed's `/api/mcp/chat/resource` proxy, and any
 * future host that renders the widget on a domain other than its own
 * `baseUrl`.
 *
 * See `applyIframePatches` for the patch behavior.
 *
 * More background on the ChatGPT case:
 * https://vercel.com/blog/running-next-js-inside-chatgpt-a-deep-dive-into-native-app-integration
 *
 * @deprecated Legacy MCP-widget-in-host stack (used with `createResource`/`createTool`).
 *   Preserved for back-compat; will move to `@waniwani/sdk/legacy/react` in a future minor
 *   release.
 */
export function InitializeNextJsInIframe({
	baseUrl,
	passthroughOrigins,
}: {
	baseUrl: string;
	/**
	 * Origins whose fetches should skip the relative same-origin → baseUrl
	 * rewrite. Only needed for relative-URL calls that resolve to an
	 * origin you do not want forwarded to `baseUrl` — absolute URLs are
	 * never rewritten regardless of this list.
	 */
	passthroughOrigins?: string[];
}) {
	return (
		<>
			<base href={baseUrl}></base>
			<script>{`window.innerBaseUrl = ${JSON.stringify(baseUrl)}`}</script>
			<script>{`window.__wwPassthroughOrigins = ${JSON.stringify(passthroughOrigins ?? [])}`}</script>
			<script>{`window.__isChatGptApp = typeof window.openai !== "undefined";`}</script>
			<script>{PATCH_SCRIPT}</script>
		</>
	);
}
