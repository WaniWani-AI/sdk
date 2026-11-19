import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({
	url: "https://shop.example.com/pricing",
	settings: { disableIframePageLoading: true },
});
for (const key of [
	"document",
	"navigator",
	"localStorage",
	"sessionStorage",
	"location",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLIFrameElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"ShadowRoot",
	"Event",
	"CustomEvent",
	"MessageEvent",
	"MutationObserver",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(win as any).SyntaxError = SyntaxError;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom gives a frame no window that can receive `postMessage`. Each frame
// gets a plain object as its window before it mounts, because the widget
// renderer keeps the window it finds on mount.
const frameWindows = new WeakMap<
	object,
	{ postMessage: (msg: unknown) => void }
>();
Object.defineProperty(win.HTMLIFrameElement.prototype, "contentWindow", {
	configurable: true,
	get() {
		let view = frameWindows.get(this);
		if (!view) {
			view = { postMessage: () => {} };
			frameWindows.set(this, view);
		}
		return view;
	},
});

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { startWebMcp } = await import("../webmcp-bootstrap");
const { WebMcpOverlay } = await import("../webmcp-overlay");

const REAL_FETCH = globalThis.fetch;

type Registered = {
	name: string;
	execute: (args: Record<string, unknown>) => Promise<unknown>;
};

type Captured = {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
};

const WIDGET = {
	viewUri: "ui://views/ext-apps/book.html?v=abc",
	tool: "show-book-call",
	data: { slot: "09:00" },
	result: { content: [] },
	interactive: true,
};

function installModelContext() {
	const registered: Registered[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).document.modelContext = {
		registerTool: (tool: Registered) => {
			registered.push(tool);
			return Promise.resolve();
		},
	};
	return registered;
}

// The widget renderer fetches the view's HTML from the resource endpoint.
function isResourceRequest(url: string) {
	return url.includes("/resource?");
}
const VIEW_HTML = new Response("<p>view</p>", {
	headers: { "content-type": "text/html" },
});

function installFetch() {
	const requests: Captured[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).fetch = async (input: unknown, init?: RequestInit) => {
		if (isResourceRequest(String(input))) {
			return VIEW_HTML.clone();
		}
		const body = JSON.parse(String(init?.body ?? "{}")) as Record<
			string,
			unknown
		>;
		requests.push({
			url: String(input),
			headers: { ...(init?.headers as Record<string, string>) },
			body,
		});
		if (body.action === "list" || !init?.method || init.method === "GET") {
			return new Response(
				JSON.stringify({ tools: [{ name: "start_booking", description: "" }] }),
				{ status: 200 },
			);
		}
		if (body.name === "start_booking") {
			return new Response(JSON.stringify({ content: [], widget: WIDGET }), {
				status: 200,
			});
		}
		return new Response(
			JSON.stringify({ content: [{ type: "text", text: "slot held" }] }),
			{ status: 200 },
		);
	};
	return requests;
}

async function flush(times = 10) {
	for (let i = 0; i < times; i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

function findIframe(): HTMLIFrameElement | null {
	const direct = document.querySelector("iframe");
	if (direct) {
		return direct as HTMLIFrameElement;
	}
	for (const host of Array.from(
		document.querySelectorAll("[data-waniwani-webmcp]"),
	)) {
		const inner = host.shadowRoot?.querySelector("iframe");
		if (inner) {
			return inner as HTMLIFrameElement;
		}
	}
	return null;
}

// The frame's stand-in window collects what is posted to the view, and is the
// `event.source` of what the view posts back.
function attachFakeView(iframe: HTMLIFrameElement) {
	const replies: unknown[] = [];
	const view = iframe.contentWindow as unknown as {
		postMessage: (msg: unknown) => void;
	};
	view.postMessage = (msg: unknown) => replies.push(msg);
	const post = (data: unknown) => {
		win.dispatchEvent(
			// biome-ignore lint/suspicious/noExplicitAny: fake message source
			new win.MessageEvent("message", { data, source: view as any }),
		);
	};
	return { replies, post };
}

beforeEach(() => {
	win.sessionStorage.clear();
	// A test that renders the overlay without a server of its own still gets
	// the view's HTML.
	globalThis.fetch = Object.assign(
		async (input: string | URL | Request, init?: RequestInit) =>
			isResourceRequest(String(input))
				? VIEW_HTML.clone()
				: REAL_FETCH(input, init),
		{ preconnect: REAL_FETCH.preconnect },
	);
});

afterEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test cleanup
	delete (globalThis as any).document.modelContext;
	globalThis.fetch = REAL_FETCH;
	document.body.innerHTML = "";
});

describe("a view's own tools/call on the WebMCP overlay", () => {
	test("goes out with the embed's bearer token and the tab's session, like the agent's call", async () => {
		const registered = installModelContext();
		const requests = installFetch();

		const handle = startWebMcp({
			token: "wwp_public_token",
			api: "https://app.example.com",
			channelId: "ch-1",
			// biome-ignore lint/suspicious/noExplicitAny: partial embed config
		} as any);
		expect(handle).not.toBeNull();
		await flush();
		expect(registered.map((t) => t.name)).toEqual(["start_booking"]);

		await act(async () => {
			await registered[0]?.execute({});
		});
		await flush();

		const iframe = findIframe();
		expect(iframe).not.toBeNull();
		if (!iframe) {
			return;
		}
		const { replies, post } = attachFakeView(iframe);

		await act(async () => {
			post({
				jsonrpc: "2.0",
				id: 7,
				method: "tools/call",
				params: { name: "hold_slot", arguments: { slot: "09:00" } },
			});
		});
		await flush();

		const agentCall = requests.find((r) => r.body.name === "start_booking");
		const viewCall = requests.find((r) => r.body.name === "hold_slot");
		expect(viewCall).toBeDefined();
		expect(viewCall?.url).toBe(agentCall?.url ?? "missing");
		expect(viewCall?.headers.Authorization).toBe("Bearer wwp_public_token");
		expect(viewCall?.headers).toEqual(agentCall?.headers ?? {});
		expect(viewCall?.body).toMatchObject({
			action: "call",
			name: "hold_slot",
			arguments: { slot: "09:00" },
			channelId: "ch-1",
		});
		expect(typeof viewCall?.body.sessionId).toBe("string");
		expect(viewCall?.body.sessionId).toBe(agentCall?.body.sessionId ?? "x");
		expect(viewCall?.body.visitorId).toBe(agentCall?.body.visitorId ?? "x");

		expect(replies).toContainEqual({
			jsonrpc: "2.0",
			id: 7,
			result: { content: [{ type: "text", text: "slot held" }] },
		});

		handle?.destroy();
	});
});

describe("WebMcpOverlay", () => {
	test("hands a view's tools/call name and arguments to onCallTool and relays its answer", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		const seen: Array<[string, Record<string, unknown> | undefined]> = [];
		const onCallTool = async ({
			name,
			arguments: args,
		}: {
			name: string;
			arguments?: Record<string, unknown>;
		}) => {
			seen.push([name, args]);
			return {
				content: [{ type: "text" as const, text: `ran ${name}` }],
				widget: null,
			};
		};

		await act(async () => {
			root.render(
				createElement(WebMcpOverlay, {
					widget: WIDGET,
					onCallTool,
					resourceEndpoint: "https://app.example.com/api/resource?token=t",
					onClose: () => {},
				}),
			);
		});
		await flush();

		const iframe = findIframe();
		expect(iframe).not.toBeNull();
		if (!iframe) {
			return;
		}
		const { replies, post } = attachFakeView(iframe);

		await act(async () => {
			post({
				jsonrpc: "2.0",
				id: "a",
				method: "tools/call",
				params: { name: "quote", arguments: { plan: "pro", seats: 3 } },
			});
		});
		await flush(3);

		expect(seen).toEqual([["quote", { plan: "pro", seats: 3 }]]);
		expect(replies).toContainEqual({
			jsonrpc: "2.0",
			id: "a",
			result: { content: [{ type: "text", text: "ran quote" }], widget: null },
		});

		await act(async () => root.unmount());
	});

	test("a rejected onCallTool reaches the view as a JSON-RPC error", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				createElement(WebMcpOverlay, {
					widget: WIDGET,
					onCallTool: () =>
						Promise.reject(new Error("webmcp call failed: 401")),
					resourceEndpoint: "https://app.example.com/api/resource",
					onClose: () => {},
				}),
			);
		});
		await flush();

		const iframe = findIframe();
		if (!iframe) {
			throw new Error("no iframe");
		}
		const { replies, post } = attachFakeView(iframe);

		await act(async () => {
			post({
				jsonrpc: "2.0",
				id: 9,
				method: "tools/call",
				params: { name: "quote" },
			});
		});
		await flush(3);

		expect(replies).toContainEqual({
			jsonrpc: "2.0",
			id: 9,
			error: { code: -32603, message: "webmcp call failed: 401" },
		});

		await act(async () => root.unmount());
	});
});
