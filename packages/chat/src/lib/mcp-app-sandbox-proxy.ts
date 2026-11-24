/**
 * The sandbox proxy page a widget frame loads when the chat is given no
 * `sandboxUrl`.
 *
 * `MCPAppRenderer` puts every widget behind two iframes: an outer proxy page,
 * then an inner frame that holds the widget's HTML. The renderer talks to the
 * proxy; the proxy writes the widget into the inner frame and relays JSON-RPC
 * both ways. The renderer expects a hosted page on its own origin. Without one,
 * this page loads as a `data:` URL, which has an opaque origin, and the inner
 * frame is sandboxed without `allow-same-origin`, so the widget can reach
 * neither the host page nor any site's cookies.
 *
 * It follows the parameters `MCPAppRenderer` sends in
 * `ui/notifications/sandbox-resource-ready`: `html`, plus `csp`, `sandbox` and
 * `allow` when the resource asks for them.
 */

const PROXY_READY = "ui/notifications/sandbox-proxy-ready";
const RESOURCE_READY = "ui/notifications/sandbox-resource-ready";

/**
 * The proxy announces itself on load, and again until the host answers. The
 * renderer listens from an effect, which can run after a `data:` frame has
 * already loaded, so a single announcement can land before anyone listens.
 */
const ANNOUNCE_INTERVAL_MS = 100;
const ANNOUNCE_ATTEMPTS = 50;

function proxyScript(): string {
	return `(function () {
	var inner = null;
	var loaded = false;
	var attempts = 0;

	function withCsp(html, csp) {
		if (typeof csp !== "string" || csp.length === 0) {
			return html;
		}
		var meta = '<meta http-equiv="Content-Security-Policy" content="' +
			csp.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '">';
		var head = /<head[^>]*>/i.exec(html);
		if (head) {
			var at = head.index + head[0].length;
			return html.slice(0, at) + meta + html.slice(at);
		}
		var doctype = /^\\s*<!doctype[^>]*>/i.exec(html);
		if (doctype) {
			return doctype[0] + meta + html.slice(doctype[0].length);
		}
		return meta + html;
	}

	function announce() {
		if (loaded || attempts >= ${ANNOUNCE_ATTEMPTS}) {
			return;
		}
		attempts += 1;
		window.parent.postMessage({ jsonrpc: "2.0", method: "${PROXY_READY}", params: {} }, "*");
		setTimeout(announce, ${ANNOUNCE_INTERVAL_MS});
	}

	window.addEventListener("message", function (event) {
		var data = event.data;
		if (event.source === window.parent) {
			if (data && data.method === "${RESOURCE_READY}") {
				if (loaded) {
					return;
				}
				loaded = true;
				var params = data.params || {};
				inner = document.createElement("iframe");
				inner.setAttribute("sandbox", typeof params.sandbox === "string" ? params.sandbox : "allow-scripts");
				if (typeof params.allow === "string" && params.allow.length > 0) {
					inner.setAttribute("allow", params.allow);
				}
				inner.srcdoc = withCsp(typeof params.html === "string" ? params.html : "", params.csp);
				document.body.appendChild(inner);
				return;
			}
			if (inner && inner.contentWindow) {
				inner.contentWindow.postMessage(data, "*");
			}
			return;
		}
		if (inner && event.source === inner.contentWindow) {
			window.parent.postMessage(data, "*");
		}
	});

	announce();
})();`;
}

/** The proxy page as HTML. */
export const MCP_APP_SANDBOX_PROXY_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><script>${proxyScript()}</script></body></html>`;

/** The proxy page as a `data:` URL, usable as an iframe `src` without a server. */
export const MCP_APP_SANDBOX_PROXY_URL = `data:text/html;charset=utf-8,${encodeURIComponent(MCP_APP_SANDBOX_PROXY_HTML)}`;
