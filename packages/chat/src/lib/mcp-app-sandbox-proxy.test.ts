import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	MCP_APP_SANDBOX_PROXY_HTML,
	MCP_APP_SANDBOX_PROXY_URL,
} from "./mcp-app-sandbox-proxy";

type Listener = (event: { source: unknown; data: unknown }) => void;

/**
 * Runs the proxy page's script against a happy-dom document, with a stand-in
 * parent window and inner frame windows that record what they are sent.
 */
function runProxy() {
	const page = new Window({ url: "https://sandbox.example.net" });
	const innerSent: unknown[] = [];
	const innerWindow = {
		postMessage: (message: unknown) => innerSent.push(message),
	};
	Object.defineProperty(page.HTMLIFrameElement.prototype, "contentWindow", {
		configurable: true,
		get: () => innerWindow,
	});

	const parentSent: unknown[] = [];
	const parent = {
		postMessage: (message: unknown) => parentSent.push(message),
	};
	const listeners: Listener[] = [];
	const proxyWindow = {
		parent,
		addEventListener: (_type: string, listener: Listener) =>
			listeners.push(listener),
	};
	const script = /<script>([\s\S]*)<\/script>/.exec(
		MCP_APP_SANDBOX_PROXY_HTML,
	)?.[1];
	if (!script) {
		throw new Error("proxy page has no script");
	}
	new Function("window", "document", "setTimeout", script)(
		proxyWindow,
		page.document,
		() => 0,
	);
	const dispatch = (source: unknown, data: unknown) => {
		for (const listener of listeners) {
			listener({ source, data });
		}
	};
	return { page, parent, parentSent, innerWindow, innerSent, dispatch };
}

describe("sandbox proxy page", () => {
	test("is served as a data: URL of the page", () => {
		expect(MCP_APP_SANDBOX_PROXY_URL).toBe(
			`data:text/html;charset=utf-8,${encodeURIComponent(MCP_APP_SANDBOX_PROXY_HTML)}`,
		);
	});

	test("announces itself to the host", () => {
		const { parentSent } = runProxy();
		expect(parentSent[0]).toEqual({
			jsonrpc: "2.0",
			method: "ui/notifications/sandbox-proxy-ready",
			params: {},
		});
	});

	test("writes the widget into a sandboxed inner frame, with the CSP in its head", () => {
		const { page, parent, dispatch } = runProxy();
		dispatch(parent, {
			jsonrpc: "2.0",
			method: "ui/notifications/sandbox-resource-ready",
			params: {
				html: "<!DOCTYPE html><html><head><title>w</title></head><body>w</body></html>",
				csp: "default-src 'none'; img-src \"x\"",
				sandbox: "allow-scripts allow-forms",
				allow: "camera",
			},
		});

		const frames = page.document.querySelectorAll("iframe");
		expect(frames.length).toBe(1);
		const frame = frames[0];
		expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
		expect(frame?.getAttribute("allow")).toBe("camera");
		expect(frame?.getAttribute("srcdoc")).toBe(
			'<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src &quot;x&quot;"><title>w</title></head><body>w</body></html>',
		);
	});

	test("keeps the doctype first when the widget HTML has no head", () => {
		const { page, parent, dispatch } = runProxy();
		dispatch(parent, {
			method: "ui/notifications/sandbox-resource-ready",
			params: {
				html: "<!DOCTYPE html><div>w</div>",
				csp: "default-src 'none'",
			},
		});
		expect(page.document.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
			'<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><div>w</div>',
		);
	});

	test("loads the widget once, however often the host answers", () => {
		const { page, parent, dispatch } = runProxy();
		const ready = {
			method: "ui/notifications/sandbox-resource-ready",
			params: { html: "<p>w</p>" },
		};
		dispatch(parent, ready);
		dispatch(parent, ready);
		expect(page.document.querySelectorAll("iframe").length).toBe(1);
	});

	test("relays messages both ways, and drops messages from anyone else", () => {
		const { parent, parentSent, innerWindow, innerSent, dispatch } = runProxy();
		dispatch(parent, {
			method: "ui/notifications/sandbox-resource-ready",
			params: { html: "<p>w</p>" },
		});
		const toWidget = { jsonrpc: "2.0", method: "ui/notifications/tool-input" };
		const toHost = { jsonrpc: "2.0", id: 1, method: "ui/initialize" };
		dispatch(parent, toWidget);
		dispatch(innerWindow, toHost);
		dispatch({ postMessage() {} }, { jsonrpc: "2.0", method: "spoofed" });

		expect(innerSent).toEqual([toWidget]);
		expect(parentSent.slice(1)).toEqual([toHost]);
	});
});
