import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({
	url: "https://shop.example.com/pricing",
	settings: {
		disableIframePageLoading: true,
		disableJavaScriptFileLoading: true,
		disableCSSFileLoading: true,
	},
});
const DOM_GLOBALS = [
	"document",
	"navigator",
	"localStorage",
	"sessionStorage",
	"location",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLIFrameElement",
	"HTMLButtonElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"ShadowRoot",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"MessageEvent",
	"MutationObserver",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const;
for (const key of DOM_GLOBALS) {
	Object.assign(globalThis, { [key]: Reflect.get(win, key) });
}
Object.assign(globalThis, { window: win, IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(win, { SyntaxError });

const REAL_FETCH = globalThis.fetch;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { startWebMcp } = await import("../webmcp-bootstrap");
const { WebMcpOverlay } = await import("../webmcp-overlay");
type WebMcpHandle = import("../webmcp-bootstrap").WebMcpHandle;
type WebMcpOverlayProps = import("../webmcp-overlay").WebMcpOverlayProps;

const API = "https://api.example.test/api/mcp/chat";
const TOKEN = "wwp_abc123";

const START_TOOL = { name: "start_booking", description: "Start booking" };
const OTHER_TOOL = { name: "search", description: "Search" };

const STEP_ONE = {
	viewUri: "ui://views/book.html?v=1",
	tool: "show-book",
	data: { slot: "09:00" },
	result: { content: [] },
	interactive: true,
};
const STEP_TWO = {
	viewUri: "ui://views/confirm.html?v=2",
	tool: "show-confirm",
	data: { slot: "09:00", seats: 2 },
	result: { content: [] },
	interactive: true,
};
const STEP_THREE = {
	viewUri: "ui://views/done.html?v=3",
	tool: "show-done",
	data: {},
	result: { content: [] },
	interactive: true,
};
const PASSIVE = {
	viewUri: "ui://views/receipt.html?v=9",
	tool: "show-receipt",
	data: {},
	result: { content: [] },
	interactive: false,
};

type Registered = {
	name: string;
	execute: (args: Record<string, unknown>) => Promise<unknown>;
};

type Seen = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
};

function describeRequest(input: string | URL | Request, init?: RequestInit) {
	const raw = init?.body;
	const body = typeof raw === "string" ? JSON.parse(raw) : (raw ?? null);
	return {
		url: String(input instanceof Request ? input.url : input),
		method: (init?.method ?? "GET").toUpperCase(),
		headers: Object.fromEntries(new Headers(init?.headers).entries()),
		body,
	};
}

function field(body: unknown, key: string): unknown {
	return typeof body === "object" && body !== null && key in body
		? Reflect.get(body, key)
		: undefined;
}

function installFetch(answer: (request: Seen) => Response | Promise<Response>) {
	const seen: Seen[] = [];
	globalThis.fetch = Object.assign(
		async (input: string | URL | Request, init?: RequestInit) => {
			const request = describeRequest(input, init);
			seen.push(request);
			return answer(request);
		},
		{ preconnect: REAL_FETCH.preconnect },
	);
	return seen;
}

/** Lists `tools`; the agent's `start_booking` opens STEP_ONE; every other call answers from `byName`. */
function installServer(
	tools: unknown[],
	byName: Record<string, () => Response> = {},
) {
	return installFetch((request) => {
		if (request.method === "GET" || field(request.body, "action") === "list") {
			return Response.json({ tools });
		}
		const name = String(field(request.body, "name"));
		if (name === "start_booking") {
			return Response.json({ content: [], widget: STEP_ONE });
		}
		const handler = byName[name];
		return handler
			? handler()
			: Response.json({ content: [{ type: "text", text: "ok" }] });
	});
}

function installModelContext(pending: string[] = []) {
	const registered: Registered[] = [];
	Object.defineProperty(document, "modelContext", {
		configurable: true,
		writable: true,
		value: {
			registerTool: (tool: Registered) => {
				registered.push(tool);
				return pending.includes(tool.name)
					? new Promise<void>(() => {})
					: Promise.resolve();
			},
		},
	});
	return registered;
}

function hostElement() {
	return document.querySelector("[data-waniwani-webmcp]");
}

function iframes(): HTMLIFrameElement[] {
	const inShadow = [
		...(hostElement()?.shadowRoot?.querySelectorAll("iframe") ?? []),
	];
	return inShadow.length > 0
		? inShadow
		: [...document.querySelectorAll("iframe")];
}

function iframeSources(): string[] {
	return iframes().map((frame) => frame.getAttribute("src") ?? "");
}

function encodedUri(viewUri: string) {
	return `uri=${encodeURIComponent(viewUri)}`;
}

// happy-dom's frame window neither delivers `postMessage` nor accepts a patched
// one, so a plain object stands in as the view's window and `event.source`.
function attachFakeView(iframe: HTMLIFrameElement) {
	const replies: unknown[] = [];
	const view = { postMessage: (msg: unknown) => replies.push(msg) };
	Object.defineProperty(iframe, "contentWindow", {
		configurable: true,
		get: () => view,
	});
	const post = (data: unknown) => {
		win.dispatchEvent(
			// biome-ignore lint/suspicious/noExplicitAny: fake message source
			new win.MessageEvent("message", { data, source: view as any }),
		);
	};
	return { replies, post };
}

function replyTo(replies: unknown[], id: unknown) {
	return replies.find(
		(reply) =>
			field(reply, "id") === id && field(reply, "method") === undefined,
	);
}

async function waitFor(predicate: () => boolean) {
	const deadline = Date.now() + 2000;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("waitFor timed out");
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
}

async function settle() {
	for (let i = 0; i < 5; i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
}

let handles: WebMcpHandle[] = [];
const spies: Array<{ mockRestore: () => void }> = [];

function start(): WebMcpHandle | null {
	const handle = startWebMcp({ api: API, token: TOKEN, channelId: "ch-1" });
	if (handle) {
		handles.push(handle);
	}
	return handle;
}

/** Starts the embed, lets the agent open STEP_ONE, and returns the mounted view. */
async function mountFirstStep(pending: string[] = []) {
	const registered = installModelContext(pending);
	start();
	await waitFor(() => registered.length > 0);
	const startTool = registered.find((tool) => tool.name === "start_booking");
	await act(async () => {
		await startTool?.execute({});
	});
	await waitFor(() => iframes().length > 0);
	const frame = iframes()[0];
	if (!frame) {
		throw new Error("no iframe");
	}
	return { registered, view: attachFakeView(frame) };
}

async function viewCall(
	view: ReturnType<typeof attachFakeView>,
	id: number | string,
	params: Record<string, unknown>,
) {
	await act(async () => {
		view.post({ jsonrpc: "2.0", id, method: "tools/call", params });
	});
	await waitFor(() => replyTo(view.replies, id) !== undefined);
	await settle();
	return replyTo(view.replies, id);
}

beforeEach(() => {
	win.sessionStorage.clear();
	win.localStorage.clear();
	Reflect.deleteProperty(document, "modelContext");
	Reflect.deleteProperty(navigator, "modelContext");
	spies.push(
		spyOn(console, "info").mockImplementation(() => {}),
		spyOn(console, "error").mockImplementation(() => {}),
	);
});

afterEach(() => {
	act(() => {
		for (const handle of handles) {
			handle.destroy();
		}
	});
	handles = [];
	for (const host of document.querySelectorAll("[data-waniwani-webmcp]")) {
		host.remove();
	}
	document.body.innerHTML = "";
	Reflect.deleteProperty(document, "modelContext");
	globalThis.fetch = REAL_FETCH;
	for (const spy of spies.splice(0)) {
		spy.mockRestore();
	}
});

describe("startWebMcp: a mounted view's own tools/call", () => {
	test("an interactive step in the answer replaces the widget on screen, and the view still gets the answer", async () => {
		installServer([START_TOOL], {
			pick_slot: () =>
				Response.json({
					content: [{ type: "text", text: "picked" }],
					widget: STEP_TWO,
				}),
		});
		const { view } = await mountFirstStep();
		expect(iframeSources()[0]).toContain(encodedUri(STEP_ONE.viewUri));

		const reply = await viewCall(view, 1, {
			name: "pick_slot",
			arguments: { slot: "09:00" },
		});

		expect(reply).toEqual({
			jsonrpc: "2.0",
			id: 1,
			result: {
				content: [{ type: "text", text: "picked" }],
				widget: STEP_TWO,
			},
		});
		await waitFor(() =>
			iframeSources().some((src) => src.includes(encodedUri(STEP_TWO.viewUri))),
		);
		expect(iframeSources()).toHaveLength(1);
		expect(iframeSources()[0]).toContain(encodedUri(STEP_TWO.viewUri));
	});

	test("the step a view's call opened can itself advance to the next step", async () => {
		installServer([START_TOOL], {
			pick_slot: () => Response.json({ content: [], widget: STEP_TWO }),
			confirm: () => Response.json({ content: [], widget: STEP_THREE }),
		});
		const { view } = await mountFirstStep();

		await viewCall(view, 1, { name: "pick_slot", arguments: {} });
		await waitFor(() =>
			iframeSources().some((src) => src.includes(encodedUri(STEP_TWO.viewUri))),
		);
		const second = iframes()[0];
		if (!second) {
			throw new Error("no second iframe");
		}
		const secondView = attachFakeView(second);

		const reply = await viewCall(secondView, 2, {
			name: "confirm",
			arguments: { ok: true },
		});
		expect(field(reply, "result")).toEqual({ content: [], widget: STEP_THREE });
		await waitFor(() =>
			iframeSources().some((src) =>
				src.includes(encodedUri(STEP_THREE.viewUri)),
			),
		);
		expect(iframeSources()).toHaveLength(1);
	});

	test("an answer with widget: null leaves the current widget on screen and reaches the view", async () => {
		installServer([START_TOOL], {
			hold_slot: () =>
				Response.json({
					content: [{ type: "text", text: "held" }],
					widget: null,
				}),
		});
		const { view } = await mountFirstStep();
		const before = iframes()[0];

		const reply = await viewCall(view, 3, {
			name: "hold_slot",
			arguments: { slot: "09:00" },
		});

		expect(field(reply, "result")).toEqual({
			content: [{ type: "text", text: "held" }],
			widget: null,
		});
		expect(iframeSources()).toHaveLength(1);
		expect(iframeSources()[0]).toContain(encodedUri(STEP_ONE.viewUri));
		expect(iframes()[0]).toBe(before);
		expect(
			hostElement()?.shadowRoot?.querySelector('[role="dialog"]'),
		).not.toBeNull();
	});

	test("an answer with no widget key at all leaves the current widget on screen", async () => {
		installServer([START_TOOL], {
			hold_slot: () =>
				Response.json({ content: [{ type: "text", text: "held" }] }),
		});
		const { view } = await mountFirstStep();

		const reply = await viewCall(view, 4, { name: "hold_slot", arguments: {} });

		expect(field(reply, "result")).toEqual({
			content: [{ type: "text", text: "held" }],
		});
		expect(iframeSources()).toHaveLength(1);
		expect(iframeSources()[0]).toContain(encodedUri(STEP_ONE.viewUri));
	});

	test("a non-interactive widget in the answer leaves the current widget on screen and reaches the view", async () => {
		installServer([START_TOOL], {
			receipt: () => Response.json({ content: [], widget: PASSIVE }),
		});
		const { view } = await mountFirstStep();
		const before = iframes()[0];

		const reply = await viewCall(view, 5, { name: "receipt", arguments: {} });

		expect(field(reply, "result")).toEqual({ content: [], widget: PASSIVE });
		expect(iframeSources()).toHaveLength(1);
		expect(iframeSources()[0]).toContain(encodedUri(STEP_ONE.viewUri));
		expect(iframeSources()[0]).not.toContain(encodedUri(PASSIVE.viewUri));
		expect(iframes()[0]).toBe(before);
	});

	test("the answer's _meta and structuredContent reach the view untouched", async () => {
		const answer = {
			content: [{ type: "text", text: "quoted" }],
			structuredContent: { price: 42, currency: "EUR" },
			_meta: { "openai/outputTemplate": "ui://x", trace: "t-1" },
			widget: null,
		};
		installServer([START_TOOL], { quote: () => Response.json(answer) });
		const { view } = await mountFirstStep();

		const reply = await viewCall(view, 6, { name: "quote", arguments: {} });

		expect(field(reply, "result")).toEqual(answer);
	});

	test("a view's call the server refuses reaches the view as an error and the widget stays", async () => {
		installServer([START_TOOL], {
			pick_slot: () => new Response("nope", { status: 500 }),
		});
		const { view } = await mountFirstStep();

		const reply = await viewCall(view, 7, { name: "pick_slot", arguments: {} });

		expect(field(reply, "result")).toBeUndefined();
		expect(field(field(reply, "error"), "message")).toContain("500");
		expect(iframeSources()).toHaveLength(1);
		expect(iframeSources()[0]).toContain(encodedUri(STEP_ONE.viewUri));
	});

	test("a view's call without arguments posts arguments: {} with the tab's identity", async () => {
		const seen = installServer([START_TOOL]);
		const { view } = await mountFirstStep();

		await viewCall(view, 8, { name: "ping_tool" });

		const agentCall = seen.find(
			(r) => field(r.body, "name") === "start_booking",
		);
		const call = seen.find((r) => field(r.body, "name") === "ping_tool");
		expect(call?.method).toBe("POST");
		expect(call?.url).toBe(agentCall?.url ?? "missing");
		expect(call?.headers).toEqual(agentCall?.headers ?? {});
		expect(field(call?.body, "action")).toBe("call");
		expect(field(call?.body, "arguments")).toEqual({});
		expect(field(call?.body, "channelId")).toBe("ch-1");
		expect(field(call?.body, "sessionId")).toBe(
			field(agentCall?.body, "sessionId") ?? "missing",
		);
		expect(field(call?.body, "visitorId")).toBe(
			field(agentCall?.body, "visitorId") ?? "missing",
		);
	});

	test("a view's call before the bridge exists rejects and sends nothing", async () => {
		const seen = installServer([START_TOOL, OTHER_TOOL], {
			pick_slot: () => Response.json({ content: [], widget: STEP_TWO }),
		});
		const { view } = await mountFirstStep(["search"]);

		const reply = await viewCall(view, 9, { name: "pick_slot", arguments: {} });

		expect(field(reply, "result")).toBeUndefined();
		expect(field(field(reply, "error"), "code")).toBe(-32000);
		expect(seen.some((r) => field(r.body, "name") === "pick_slot")).toBe(false);
		expect(iframeSources()).toHaveLength(1);
		expect(iframeSources()[0]).toContain(encodedUri(STEP_ONE.viewUri));
	});
});

describe("WebMcpOverlay: a view's tools/call", () => {
	async function renderOverlay(
		props: Omit<WebMcpOverlayProps, "widget" | "resourceEndpoint" | "onClose">,
	) {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(WebMcpOverlay, {
					widget: STEP_ONE,
					resourceEndpoint: "https://app.example.com/api/resource?token=t",
					onClose: () => {},
					...props,
				}),
			);
		});
		const frame = iframes()[0];
		if (!frame) {
			throw new Error("no iframe");
		}
		return { root, view: attachFakeView(frame) };
	}

	test("with only the deprecated toolsEndpoint and headers, posts the call there and relays the JSON body", async () => {
		const answer = {
			content: [{ type: "text", text: "quoted" }],
			structuredContent: { price: 42 },
			_meta: { trace: "t-2" },
			widget: null,
		};
		const seen = installFetch(() => Response.json(answer));
		const { root, view } = await renderOverlay({
			toolsEndpoint: "https://tools.example.test/webmcp",
			headers: { Authorization: "Bearer wwp_legacy", "x-extra": "1" },
		});

		const reply = await viewCall(view, "a", {
			name: "quote",
			arguments: { plan: "pro", seats: 3 },
		});

		const calls = seen.filter(
			(r) => r.url === "https://tools.example.test/webmcp",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers["content-type"]).toBe("application/json");
		expect(calls[0]?.headers.authorization).toBe("Bearer wwp_legacy");
		expect(calls[0]?.headers["x-extra"]).toBe("1");
		expect(calls[0]?.body).toEqual({
			action: "call",
			name: "quote",
			arguments: { plan: "pro", seats: 3 },
		});
		expect(reply).toEqual({ jsonrpc: "2.0", id: "a", result: answer });

		await act(async () => root.unmount());
	});

	test("with only toolsEndpoint and no headers, still sends content-type json", async () => {
		const seen = installFetch(() =>
			Response.json({ content: [], widget: null }),
		);
		const { root, view } = await renderOverlay({
			toolsEndpoint: "https://tools.example.test/webmcp",
		});

		await viewCall(view, "b", { name: "quote" });

		const call = seen.find(
			(r) => r.url === "https://tools.example.test/webmcp",
		);
		expect(call?.headers["content-type"]).toBe("application/json");
		expect(call?.body).toEqual({
			action: "call",
			name: "quote",
			arguments: {},
		});

		await act(async () => root.unmount());
	});

	for (const status of [400, 401, 404, 500, 503]) {
		test(`a ${status} from toolsEndpoint reaches the view as an error, never a result`, async () => {
			installFetch(() =>
				Response.json({ content: [{ type: "text", text: "x" }] }, { status }),
			);
			const { root, view } = await renderOverlay({
				toolsEndpoint: "https://tools.example.test/webmcp",
			});

			const reply = await viewCall(view, `s${status}`, {
				name: "quote",
				arguments: {},
			});

			expect(field(reply, "result")).toBeUndefined();
			expect(field(field(reply, "error"), "code")).toBe(-32000);

			await act(async () => root.unmount());
		});
	}

	test("with neither onCallTool nor toolsEndpoint, the call rejects and nothing is fetched", async () => {
		const seen = installFetch(() => Response.json({ content: [] }));
		const { root, view } = await renderOverlay({});

		const reply = await viewCall(view, "c", { name: "quote", arguments: {} });

		expect(field(reply, "result")).toBeUndefined();
		expect(field(field(reply, "error"), "code")).toBe(-32000);
		expect(seen.filter((r) => r.method === "POST")).toEqual([]);

		await act(async () => root.unmount());
	});

	test("headers alone without toolsEndpoint still reject", async () => {
		const seen = installFetch(() => Response.json({ content: [] }));
		const { root, view } = await renderOverlay({
			headers: { Authorization: "Bearer wwp_legacy" },
		});

		const reply = await viewCall(view, "d", { name: "quote", arguments: {} });

		expect(field(field(reply, "error"), "code")).toBe(-32000);
		expect(seen.filter((r) => r.method === "POST")).toEqual([]);

		await act(async () => root.unmount());
	});

	test("with both onCallTool and toolsEndpoint, onCallTool wins and the endpoint is never hit", async () => {
		const seen = installFetch(() =>
			Response.json({ content: [{ type: "text", text: "from endpoint" }] }),
		);
		const calls: Array<{ name: string; arguments?: Record<string, unknown> }> =
			[];
		const { root, view } = await renderOverlay({
			toolsEndpoint: "https://tools.example.test/webmcp",
			headers: { Authorization: "Bearer wwp_legacy" },
			onCallTool: async (params: {
				name: string;
				arguments?: Record<string, unknown>;
			}) => {
				calls.push(params);
				return {
					content: [{ type: "text", text: "from onCallTool" }],
					widget: null,
				};
			},
		});

		const reply = await viewCall(view, "e", {
			name: "quote",
			arguments: { plan: "pro" },
		});

		expect(calls).toEqual([{ name: "quote", arguments: { plan: "pro" } }]);
		expect(field(reply, "result")).toEqual({
			content: [{ type: "text", text: "from onCallTool" }],
			widget: null,
		});
		expect(
			seen.filter((r) => r.url === "https://tools.example.test/webmcp"),
		).toEqual([]);

		await act(async () => root.unmount());
	});

	test("onCallTool receives the { name, arguments } object the frame passes, with arguments defaulted to {}", async () => {
		const calls: unknown[] = [];
		const { root, view } = await renderOverlay({
			onCallTool: async (params: unknown) => {
				calls.push(params);
				return { content: [], widget: null };
			},
		});

		await viewCall(view, "f", { name: "quote" });

		expect(calls).toEqual([{ name: "quote", arguments: {} }]);

		await act(async () => root.unmount());
	});
});
