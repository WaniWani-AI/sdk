import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
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
	"HTMLAnchorElement",
	"HTMLTextAreaElement",
	"HTMLInputElement",
	"HTMLScriptElement",
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
	"MutationObserver",
	"IntersectionObserver",
	"ResizeObserver",
	"customElements",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const;
for (const key of DOM_GLOBALS) {
	Object.assign(globalThis, { [key]: Reflect.get(win, key) });
}
Object.assign(globalThis, {
	window: win,
	IS_REACT_ACT_ENVIRONMENT: true,
	indexedDB: new IDBFactory(),
	IDBKeyRange,
});
Object.assign(win, { SyntaxError });

const REAL_FETCH = globalThis.fetch;

const { act } = await import("react");
await import("../embed");

const TOKEN = "wwp_abc123";
const API = "https://api.example.test/api/mcp/chat";
const TOOLS_URL = "https://api.example.test/api/mcp/chat/webmcp";
const LIST_PATH = "https://api.example.test/api/mcp/chat/webmcp/tools";
const CHAT_HOSTS = "#waniwani-chat-embed, [data-waniwani-embed]";

type Registered = {
	name: string;
	execute: (args: Record<string, unknown>) => Promise<unknown>;
};

type Seen = {
	url: string;
	method: string;
	body: unknown;
	chatHostsPresent: number;
};

function chat() {
	const api = window.WaniWani?.chat;
	if (!api) {
		throw new Error("embed did not install WaniWani.chat");
	}
	return api;
}

function isListing(request: Seen): boolean {
	const path = request.url.split("?")[0];
	if (request.method === "GET") {
		return path === LIST_PATH;
	}
	const body = request.body;
	return (
		path === TOOLS_URL &&
		typeof body === "object" &&
		body !== null &&
		"action" in body &&
		body.action === "list"
	);
}

function installFetch(listing: (request: Seen) => Response) {
	const seen: Seen[] = [];
	globalThis.fetch = Object.assign(
		async (input: string | URL | Request, init?: RequestInit) => {
			const raw = init?.body;
			const request: Seen = {
				url: input instanceof Request ? input.url : String(input),
				method: (
					init?.method ?? (input instanceof Request ? input.method : "GET")
				).toUpperCase(),
				body: typeof raw === "string" ? safeJson(raw) : null,
				chatHostsPresent: document.querySelectorAll(CHAT_HOSTS).length,
			};
			seen.push(request);
			if (isListing(request)) {
				return listing(request);
			}
			if (request.url.split("?")[0] === TOOLS_URL) {
				return Response.json({ content: [], widget: null });
			}
			return Response.json({});
		},
		{ preconnect: REAL_FETCH.preconnect },
	);
	return seen;
}

function safeJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function installModelContext() {
	const registered: Registered[] = [];
	Object.defineProperty(document, "modelContext", {
		configurable: true,
		writable: true,
		value: {
			registerTool: (tool: Registered) => {
				registered.push(tool);
				return Promise.resolve();
			},
		},
	});
	return registered;
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

const consoleSpies: Array<{ mockRestore: () => void }> = [];
let consoleErrors: unknown[][] = [];

beforeEach(() => {
	win.sessionStorage.clear();
	win.localStorage.clear();
	Reflect.deleteProperty(document, "modelContext");
	consoleErrors = [];
	consoleSpies.push(
		spyOn(console, "info").mockImplementation(() => {}),
		spyOn(console, "warn").mockImplementation(() => {}),
		spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			consoleErrors.push(args);
		}),
	);
});

afterEach(() => {
	act(() => {
		chat().destroy();
	});
	for (const el of document.querySelectorAll(
		`${CHAT_HOSTS}, [data-waniwani-webmcp]`,
	)) {
		el.remove();
	}
	Reflect.deleteProperty(document, "modelContext");
	globalThis.fetch = REAL_FETCH;
	for (const spy of consoleSpies.splice(0)) {
		spy.mockRestore();
	}
});

const SEARCH = { name: "search", description: "Search" };

describe("init on a WebMCP browser", () => {
	for (const mode of ["floating", "inline", "composer", "off"] as const) {
		test(`requests the listing before any ${mode} chat host is in the DOM`, () => {
			installModelContext();
			const seen = installFetch(() => Response.json({ tools: [SEARCH] }));

			act(() => {
				chat().init({ api: API, token: TOKEN, mode });
			});

			const listing = seen.find(isListing);
			expect(listing?.method).toBe("GET");
			expect(listing?.chatHostsPresent).toBe(0);
			expect(seen.indexOf(listing ?? seen[0])).toBe(0);
		});
	}

	test("the chat host appears after the listing, so the chat still mounts", () => {
		installModelContext();
		installFetch(() => Response.json({ tools: [SEARCH] }));

		act(() => {
			chat().init({ api: API, token: TOKEN, mode: "floating" });
		});

		expect(document.querySelector("#waniwani-chat-embed")).not.toBeNull();
	});

	test("the host-supplied visitor id rides on the tool call", async () => {
		const registered = installModelContext();
		const seen = installFetch(() => Response.json({ tools: [SEARCH] }));

		act(() => {
			chat().init({
				api: API,
				token: TOKEN,
				mode: "off",
				visitorId: "host-visitor-7",
			});
		});
		await waitFor(() => registered.length === 1);
		await registered[0]?.execute({});

		const call = seen.find(
			(request) =>
				request.method === "POST" &&
				typeof request.body === "object" &&
				request.body !== null &&
				"action" in request.body &&
				request.body.action === "call",
		);
		expect(call?.body).toMatchObject({ visitorId: "host-visitor-7" });
	});

	test("the host-supplied visitor id rides on a fallback listing POST", async () => {
		const registered = installModelContext();
		const seen = installFetch((request) =>
			request.method === "GET"
				? new Response(null, { status: 404 })
				: Response.json({ tools: [SEARCH] }),
		);

		act(() => {
			chat().init({
				api: API,
				token: TOKEN,
				mode: "off",
				visitorId: "host-visitor-7",
			});
		});
		await waitFor(() => registered.length === 1);

		const post = seen.find(
			(request) => request.method === "POST" && isListing(request),
		);
		expect(post?.body).toMatchObject({
			action: "list",
			visitorId: "host-visitor-7",
		});
	});

	test("the overlay host stacks above the floating chat host", () => {
		installModelContext();
		installFetch(() => Response.json({ tools: [SEARCH] }));

		act(() => {
			chat().init({ api: API, token: TOKEN, mode: "floating" });
		});

		const overlay = document.querySelector<HTMLElement>(
			"[data-waniwani-webmcp]",
		);
		const chatHost = document.querySelector<HTMLElement>(
			"#waniwani-chat-embed",
		);
		expect(chatHost).not.toBeNull();
		expect(overlay?.style.position).toBe("relative");
		expect(overlay?.style.zIndex).toBe("2147483001");
		expect(Number(overlay?.style.zIndex)).toBeGreaterThan(
			Number(chatHost?.style.zIndex),
		);
	});

	test("a throwing startWebMcp is logged and the chat still mounts", () => {
		installModelContext();
		installFetch(() => Response.json({ tools: [SEARCH] }));
		const realAttach = win.HTMLElement.prototype.attachShadow;
		const shadowSpy = spyOn(
			win.HTMLElement.prototype,
			"attachShadow",
		).mockImplementation(function (this: HTMLElement, init: ShadowRootInit) {
			if (this.hasAttribute("data-waniwani-webmcp")) {
				throw new Error("attachShadow blocked");
			}
			return realAttach.call(this, init);
		});

		try {
			act(() => {
				chat().init({ api: API, token: TOKEN, mode: "floating" });
			});
		} finally {
			shadowSpy.mockRestore();
		}

		expect(document.querySelector("#waniwani-chat-embed")).not.toBeNull();
		expect(
			consoleErrors.some((args) =>
				args.some(
					(arg) =>
						arg instanceof Error && arg.message === "attachShadow blocked",
				),
			),
		).toBe(true);
	});
});
