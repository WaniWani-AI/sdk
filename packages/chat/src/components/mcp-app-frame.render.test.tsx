import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLIFrameElement",
	"MutationObserver",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"MessageEvent",
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

type Message = {
	jsonrpc: "2.0";
	id?: number | string;
	method?: string;
	params?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: { message: string };
};

// happy-dom gives a frame no window of its own. Each frame gets a stand-in
// that records what the renderer posts to the sandbox proxy.
const frameWindows = new WeakMap<object, { sent: Message[] }>();
Object.defineProperty(win.HTMLIFrameElement.prototype, "contentWindow", {
	configurable: true,
	get() {
		let frameWindow = frameWindows.get(this);
		if (!frameWindow) {
			const sent: Message[] = [];
			frameWindow = {
				sent,
				postMessage: (message: Message) => {
					sent.push(message);
				},
			} as { sent: Message[] };
			frameWindows.set(this, frameWindow);
		}
		return frameWindow;
	},
});

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { McpAppFrame } = await import("./mcp-app-frame");
const { MCP_APP_SANDBOX_PROXY_URL } = await import(
	"../lib/mcp-app-sandbox-proxy"
);
type Props = Parameters<typeof McpAppFrame>[0];
type Root = ReturnType<typeof createRoot>;

const WIDGET_HTML = "<!DOCTYPE html><html><body>widget</body></html>";
const realFetch = globalThis.fetch;

let container: HTMLDivElement;
let root: Root;
let requestedUrls: string[];

beforeEach(() => {
	container = document.createElement("div") as unknown as HTMLDivElement;
	document.body.appendChild(container as unknown as Node);
	root = createRoot(container);
	requestedUrls = [];
	globalThis.fetch = (async (url: string) => {
		requestedUrls.push(url);
		return new Response(WIDGET_HTML, {
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}) as typeof fetch;
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	globalThis.fetch = realFetch;
});

function baseProps(overrides: Partial<Props> = {}): Props {
	return {
		resourceUri: "ui://widget/quote.html",
		toolInput: { plan: "basic" },
		toolResult: {
			content: [{ type: "text", text: "Quote ready" }],
			structuredContent: { price: 12 },
			_meta: { waniwani: { flowId: "quote" } },
		},
		resourceEndpoint: "https://app.example.com/api/mcp/chat/resource?token=t",
		chatSessionId: "session-1",
		...overrides,
	};
}

/** Renders the frame, waits for the iframe, and plays the proxy's side of the protocol. */
async function mount(props: Props) {
	await act(async () => {
		root.render(createElement(McpAppFrame, props));
	});
	// The resource loads in an effect; let its promise settle.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	const iframe = container.querySelector("iframe");
	if (!iframe) {
		throw new Error("no iframe rendered");
	}
	const frameWindow = (
		iframe as unknown as { contentWindow: { sent: Message[] } }
	).contentWindow;
	const sent = frameWindow.sent;

	const fromFrame = async (data: Message) => {
		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data,
					source: frameWindow as unknown as MessageEventSource,
					origin: "null",
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};
	return { iframe, sent, fromFrame };
}

async function initialize(fromFrame: (data: Message) => Promise<void>) {
	await fromFrame({
		jsonrpc: "2.0",
		method: "ui/notifications/sandbox-proxy-ready",
		params: {},
	});
	await fromFrame({
		jsonrpc: "2.0",
		id: 1,
		method: "ui/initialize",
		params: {},
	});
	await fromFrame({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
}

describe("McpAppFrame on MCPAppRenderer", () => {
	test("loads the built-in proxy and hands it the widget HTML", async () => {
		const { iframe, sent, fromFrame } = await mount(baseProps());

		expect(iframe.getAttribute("src")).toBe(MCP_APP_SANDBOX_PROXY_URL);
		expect(requestedUrls).toEqual([
			"https://app.example.com/api/mcp/chat/resource?token=t&uri=ui%3A%2F%2Fwidget%2Fquote.html",
		]);

		await fromFrame({
			jsonrpc: "2.0",
			method: "ui/notifications/sandbox-proxy-ready",
			params: {},
		});
		const ready = sent.find(
			(m) => m.method === "ui/notifications/sandbox-resource-ready",
		);
		expect(ready?.params?.html).toBe(WIDGET_HTML);
		expect(ready?.params?.sandbox).not.toContain("allow-same-origin");
	});

	test("sends the tool input, and the result with the chat session id", async () => {
		const { sent, fromFrame } = await mount(baseProps());
		await initialize(fromFrame);

		const init = sent.find((m) => m.id === 1);
		expect(init?.result?.hostInfo).toEqual({
			name: "Waniwani Chat",
			version: "1.0.0",
		});
		expect(init?.result?.hostContext).toEqual({
			theme: "light",
			displayMode: "inline",
		});
		expect(
			sent.find((m) => m.method === "ui/notifications/tool-input")?.params,
		).toEqual({ arguments: { plan: "basic" } });
		const result = sent.find(
			(m) => m.method === "ui/notifications/tool-result",
		)?.params;
		expect(result?.structuredContent).toEqual({ price: 12 });
		expect(result?._meta).toEqual({
			waniwani: { flowId: "quote", sessionId: "session-1" },
		});
	});

	test("does not send the result again when the parent re-renders with equal props", async () => {
		const { sent, fromFrame } = await mount(baseProps());
		await initialize(fromFrame);
		const before = sent.length;

		await act(async () => {
			root.render(createElement(McpAppFrame, baseProps()));
		});

		expect(sent.length).toBe(before);
	});

	test("sizes the frame from the widget's report, up to 500px", async () => {
		const { iframe, fromFrame } = await mount(baseProps());
		await initialize(fromFrame);

		await fromFrame({
			jsonrpc: "2.0",
			method: "ui/notifications/size-changed",
			params: { height: 320 },
		});
		expect((iframe as unknown as HTMLElement).style.height).toBe("320px");

		await fromFrame({
			jsonrpc: "2.0",
			method: "ui/notifications/size-changed",
			params: { height: 2000 },
		});
		expect((iframe as unknown as HTMLElement).style.height).toBe("500px");
	});

	test("lets the widget call app-visible tools only", async () => {
		const calls: string[] = [];
		const { sent, fromFrame } = await mount(
			baseProps({
				toolDefinitions: {
					get_quote: {},
					internal_score: { _meta: { ui: { visibility: ["model"] } } },
				},
				onCallTool: async ({ name }) => {
					calls.push(name);
					return { content: [{ type: "text", text: "ok" }] };
				},
			}),
		);
		await initialize(fromFrame);

		await fromFrame({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "get_quote", arguments: {} },
		});
		await fromFrame({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "internal_score", arguments: {} },
		});

		expect(calls).toEqual(["get_quote"]);
		expect(sent.find((m) => m.id === 2)?.result).toEqual({
			content: [{ type: "text", text: "ok" }],
		});
		expect(sent.find((m) => m.id === 3)?.error?.message).toContain(
			"internal_score",
		);
	});

	test("joins a tool result's text to the widget's next message, with model context", async () => {
		const followUps: unknown[] = [];
		const { fromFrame } = await mount(
			baseProps({
				onCallTool: async () => ({
					content: [{ type: "text", text: "Plan saved" }],
				}),
				onFollowUp: (message) => followUps.push(message),
			}),
		);
		await initialize(fromFrame);

		await fromFrame({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "save_plan", arguments: {} },
		});
		await fromFrame({
			jsonrpc: "2.0",
			id: 3,
			method: "ui/update-model-context",
			params: { structuredContent: { plan: "basic" } },
		});
		await fromFrame({
			jsonrpc: "2.0",
			id: 4,
			method: "ui/message",
			params: { role: "user", content: [{ type: "text", text: "Continue" }] },
		});

		expect(followUps).toHaveLength(1);
		expect(followUps[0]).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "Continue\n\nPlan saved" }],
			modelContext: { structuredContent: { plan: "basic" } },
		});
	});

	test("grants a display mode request and reports it", async () => {
		const modes: string[] = [];
		const { sent, fromFrame } = await mount(
			baseProps({ onDisplayModeChange: (mode) => modes.push(mode) }),
		);
		await initialize(fromFrame);

		await fromFrame({
			jsonrpc: "2.0",
			id: 5,
			method: "ui/request-display-mode",
			params: { mode: "fullscreen" },
		});

		expect(sent.find((m) => m.id === 5)?.result).toEqual({
			mode: "fullscreen",
		});
		expect(modes).toEqual(["fullscreen"]);
		expect(
			[...sent]
				.reverse()
				.find((m) => m.method === "ui/notifications/host-context-changed")
				?.params,
		).toEqual({ theme: "light", displayMode: "fullscreen" });
	});

	test("loads behind a hosted proxy when given a sandbox URL", async () => {
		const { iframe } = await mount(
			baseProps({ sandboxUrl: "https://sandbox.example.net/proxy.html" }),
		);
		expect(iframe.getAttribute("src")).toBe(
			"https://sandbox.example.net/proxy.html",
		);
	});
});
