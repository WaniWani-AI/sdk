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

const { act } = await import("react");
const { startWebMcp } = await import("../webmcp-bootstrap");
const { createWebMcpBridge } = await import("../../../../webmcp");
const { saveCachedConfig } = await import("../remote-config");
type EmbedConfig = import("../config").EmbedConfig;
type WebMcpHandle = import("../webmcp-bootstrap").WebMcpHandle;

const API = "https://api.example.test/api/mcp/chat";
const TOKEN = "wwp_abc123";
const TOOLS_URL = "https://api.example.test/api/mcp/chat/webmcp";
const LIST_PATH = "https://api.example.test/api/mcp/chat/webmcp/tools";

const SEARCH_TOOL = { name: "search", description: "Search the docs" };
const BOOK_TOOL = { name: "book_demo", description: "Book a demo" };

const WIDGET_ONE = {
	viewUri: "ui://views/book.html?v=1",
	tool: "show-book",
	data: {},
	result: { content: [] },
	interactive: true,
};
const WIDGET_TWO = {
	viewUri: "ui://views/quote.html?v=2",
	tool: "show-quote",
	data: {},
	result: { content: [] },
	interactive: true,
};

type Registered = {
	name: string;
	execute: (
		args: Record<string, unknown>,
		options?: { signal?: AbortSignal },
	) => Promise<{ content: unknown[] }>;
};

type Seen = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
};

function describeRequest(
	input: string | URL | Request,
	init?: RequestInit,
): Seen {
	const raw = init?.body;
	const body = typeof raw === "string" ? JSON.parse(raw) : (raw ?? null);
	if (input instanceof Request) {
		return {
			url: input.url,
			method: input.method.toUpperCase(),
			headers: Object.fromEntries(input.headers.entries()),
			body,
		};
	}
	return {
		url: String(input),
		method: (init?.method ?? "GET").toUpperCase(),
		headers: Object.fromEntries(new Headers(init?.headers).entries()),
		body,
	};
}

function splitUrl(url: string | undefined) {
	const parsed = new URL(url ?? "", "https://page.invalid");
	return {
		path: `${parsed.origin}${parsed.pathname}`,
		params: [...parsed.searchParams.entries()].sort(([a], [b]) =>
			a.localeCompare(b),
		),
	};
}

function actionOf(request: Seen): unknown {
	const body = request.body;
	return typeof body === "object" && body !== null && "action" in body
		? body.action
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

/** The GET lists `tools`; each `call` answers with the next widget, if any. */
function installServer(tools: unknown[], widgets: unknown[] = []) {
	const queue = [...widgets];
	return installFetch((request) => {
		if (request.method === "GET") {
			return Response.json({ tools });
		}
		if (actionOf(request) === "list") {
			return Response.json({ tools });
		}
		return Response.json({ content: [], widget: queue.shift() ?? null });
	});
}

function installModelContext() {
	const registered: Registered[] = [];
	const signals: Array<AbortSignal | undefined> = [];
	Object.defineProperty(document, "modelContext", {
		configurable: true,
		writable: true,
		value: {
			registerTool: (tool: Registered, options?: { signal?: AbortSignal }) => {
				registered.push(tool);
				signals.push(options?.signal);
				return Promise.resolve();
			},
		},
	});
	return { registered, signals };
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

function config(overrides: Partial<EmbedConfig> = {}): EmbedConfig {
	return { api: API, token: TOKEN, ...overrides };
}

function hostElement() {
	return document.querySelector("[data-waniwani-webmcp]");
}

function iframeSources(): string[] {
	const root = hostElement()?.shadowRoot;
	return [...(root?.querySelectorAll("iframe") ?? [])].map(
		(frame) => frame.getAttribute("src") ?? "",
	);
}

/** Drains microtasks without letting a single macrotask run. */
async function microtasksUntil(predicate: () => boolean) {
	for (let i = 0; i < 500 && !predicate(); i++) {
		await Promise.resolve();
	}
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
const consoleSpies: Array<{ mockRestore: () => void }> = [];
let consoleErrors: unknown[][] = [];

function start(input: EmbedConfig): WebMcpHandle | null {
	const handle = startWebMcp(input);
	if (handle) {
		handles.push(handle);
	}
	return handle;
}

beforeEach(() => {
	win.sessionStorage.clear();
	win.localStorage.clear();
	Reflect.deleteProperty(document, "modelContext");
	Reflect.deleteProperty(navigator, "modelContext");
	consoleErrors = [];
	consoleSpies.push(
		spyOn(console, "info").mockImplementation(() => {}),
		spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			consoleErrors.push(args);
		}),
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
	Reflect.deleteProperty(document, "modelContext");
	globalThis.fetch = REAL_FETCH;
	for (const spy of consoleSpies.splice(0)) {
		spy.mockRestore();
	}
});

describe("startWebMcp", () => {
	describe("stays out of the way", () => {
		test("on a browser with no modelContext: null, no request, no host", () => {
			const seen = installServer([SEARCH_TOOL]);

			expect(start(config({ channelId: "ch_1" }))).toBeNull();
			expect(seen).toEqual([]);
			expect(hostElement()).toBeNull();
		});

		test("when the page switches it off", () => {
			installModelContext();
			const seen = installServer([SEARCH_TOOL]);

			expect(start(config({ webmcp: { enabled: false } }))).toBeNull();
			expect(seen).toEqual([]);
			expect(hostElement()).toBeNull();
		});

		test("when the channel's cached switch is off", () => {
			installModelContext();
			const seen = installServer([SEARCH_TOOL]);
			saveCachedConfig(API, TOKEN, undefined, { webmcp: { enabled: false } });

			expect(start(config())).toBeNull();
			expect(seen).toEqual([]);
			expect(hostElement()).toBeNull();
		});

		test("with an empty token", () => {
			installModelContext();
			const seen = installServer([SEARCH_TOOL]);

			expect(start(config({ token: "" }))).toBeNull();
			expect(seen).toEqual([]);
			expect(hostElement()).toBeNull();
		});
	});

	test("the listing GET is on the wire before startWebMcp returns, bare of headers", () => {
		installModelContext();
		const seen = installServer([SEARCH_TOOL]);

		const handle = start(config({ channelId: "ch_1" }));

		expect(handle).not.toBeNull();
		expect(seen).toHaveLength(1);
		expect(seen[0]?.method).toBe("GET");
		expect(seen[0]?.headers).toEqual({});
		expect(seen[0]?.body).toBeNull();
		expect(splitUrl(seen[0]?.url)).toEqual({
			path: LIST_PATH,
			params: [
				["channel", "ch_1"],
				["token", "wwp_abc123"],
			],
		});
	});

	test("a host page whose DOM setup throws starts no bridge and requests nothing", () => {
		installModelContext();
		const seen = installServer([SEARCH_TOOL]);
		const shadowSpy = spyOn(
			win.HTMLElement.prototype,
			"attachShadow",
		).mockImplementation(() => {
			throw new Error("attachShadow blocked");
		});

		try {
			expect(() => start(config())).toThrow("attachShadow blocked");
		} finally {
			shadowSpy.mockRestore();
		}

		expect(seen).toEqual([]);
	});

	test("lists and calls with the channel the cached config resolved when the markup names none", async () => {
		const { registered } = installModelContext();
		const seen = installServer([SEARCH_TOOL]);
		saveCachedConfig(API, TOKEN, undefined, { channelId: "ch_cached" });

		start(config());
		await waitFor(() => registered.length === 1);
		await registered[0]?.execute({});

		expect(splitUrl(seen[0]?.url).params).toEqual([
			["channel", "ch_cached"],
			["token", "wwp_abc123"],
		]);
		expect(seen[1]?.body).toMatchObject({
			action: "call",
			channelId: "ch_cached",
		});
	});

	test("getTools is empty until registration finishes, then names each tool in the order served", async () => {
		const { registered } = installModelContext();
		const listing = deferred<Response>();
		installFetch((request) =>
			request.method === "GET"
				? listing.promise
				: Response.json({ content: [], widget: null }),
		);

		const handle = start(config());
		expect(handle?.getTools()).toEqual([]);
		await settle();
		expect(handle?.getTools()).toEqual([]);

		listing.resolve(Response.json({ tools: [BOOK_TOOL, SEARCH_TOOL] }));
		await waitFor(() => (handle?.getTools().length ?? 0) > 0);

		expect(handle?.getTools()).toEqual(["book_demo", "search"]);
		expect(registered.map((tool) => tool.name)).toEqual([
			"book_demo",
			"search",
		]);
	});

	test("an empty tool list leaves getTools empty and registers nothing", async () => {
		const { registered } = installModelContext();
		installServer([]);

		const handle = start(config());
		await settle();

		expect(handle?.getTools()).toEqual([]);
		expect(registered).toEqual([]);
	});

	test("a listing whose GET and POST both fail publishes nothing and is logged", async () => {
		const { registered } = installModelContext();
		const seen = installFetch(() => new Response("down", { status: 500 }));

		const handle = start(config());
		await settle();

		expect(handle?.getTools()).toEqual([]);
		expect(registered).toEqual([]);
		expect(seen.map(({ method }) => method)).toEqual(["GET", "POST"]);
		expect(consoleErrors.length).toBeGreaterThan(0);
	});

	describe("a bridge that rejects", () => {
		// `tools: [null]` throws inside the bridge's own per-tool catch, which is
		// the one malformed listing left that rejects instead of resolving.
		test("precondition: a null tool entry makes the bridge itself reject", async () => {
			installModelContext();
			installServer([null]);
			const logger = { error: () => {}, info: () => {} };

			const settled = await createWebMcpBridge({
				endpoint: TOOLS_URL,
				listEndpoint: `${LIST_PATH}?token=${TOKEN}`,
				sessionId: "s1",
				logger,
			}).then(
				() => "resolved",
				() => "rejected",
			);

			expect(settled).toBe("rejected");
		});

		test("is caught and logged, and the handle still tears down", async () => {
			const { registered } = installModelContext();
			installServer([null]);
			const unhandled: unknown[] = [];
			const onUnhandled = (reason: unknown) => {
				unhandled.push(reason);
			};
			process.on("unhandledRejection", onUnhandled);

			try {
				const handle = start(config());
				await settle();

				expect(unhandled).toEqual([]);
				expect(
					consoleErrors.some((args) =>
						args.some((arg) => arg instanceof Error),
					),
				).toBe(true);
				expect(handle?.getTools()).toEqual([]);
				expect(registered).toEqual([]);

				act(() => {
					handle?.destroy();
				});
				expect(hostElement()).toBeNull();
			} finally {
				process.off("unhandledRejection", onUnhandled);
			}
		});
	});

	test("a listing refused with 404 still publishes through the POST, with the token header", async () => {
		const { registered } = installModelContext();
		const seen = installFetch((request) =>
			request.method === "GET"
				? new Response(null, { status: 404 })
				: Response.json({ tools: [SEARCH_TOOL] }),
		);

		const handle = start(config({ channelId: "ch_1" }));
		await waitFor(() => (handle?.getTools().length ?? 0) > 0);

		expect(handle?.getTools()).toEqual(["search"]);
		expect(registered.map((tool) => tool.name)).toEqual(["search"]);
		expect(seen[1]?.url).toBe(TOOLS_URL);
		expect(seen[1]?.headers.authorization).toBe("Bearer wwp_abc123");
		expect(seen[1]?.body).toMatchObject({ action: "list", channelId: "ch_1" });
	});

	test("an agent's call posts to the tools endpoint with the token as a header", async () => {
		const { registered } = installModelContext();
		const seen = installServer([SEARCH_TOOL]);

		start(config({ channelId: "ch_1" }));
		await waitFor(() => registered.length === 1);
		await registered[0]?.execute({ q: "pricing" });

		expect(seen).toHaveLength(2);
		expect(seen[1]?.url).toBe(TOOLS_URL);
		expect(seen[1]?.method).toBe("POST");
		expect(seen[1]?.headers.authorization).toBe("Bearer wwp_abc123");
		expect(seen[1]?.body).toMatchObject({
			action: "call",
			name: "search",
			arguments: { q: "pricing" },
			channelId: "ch_1",
		});
	});

	describe("widget delivery", () => {
		test("a widget emitted before the overlay subscribes reaches it once it does", async () => {
			const { registered } = installModelContext();
			installServer([SEARCH_TOOL], [WIDGET_ONE]);

			start(config());
			let macrotaskRan = false;
			setImmediate(() => {
				macrotaskRan = true;
			});
			await microtasksUntil(() => registered.length === 1);
			expect(registered).toHaveLength(1);
			await registered[0]?.execute({});
			expect(macrotaskRan).toBe(false);
			expect(iframeSources()).toEqual([]);

			await waitFor(() => iframeSources().length > 0);

			expect(iframeSources()).toHaveLength(1);
			expect(iframeSources()[0]).toContain(
				"uri=ui%3A%2F%2Fviews%2Fbook.html%3Fv%3D1",
			);
			expect(
				hostElement()?.shadowRoot?.querySelector('[role="dialog"]'),
			).not.toBeNull();
		});

		test("of two widgets emitted before the overlay subscribes, the later one is on screen", async () => {
			const { registered } = installModelContext();
			installServer([SEARCH_TOOL], [WIDGET_ONE, WIDGET_TWO]);

			start(config());
			let macrotaskRan = false;
			setImmediate(() => {
				macrotaskRan = true;
			});
			await microtasksUntil(() => registered.length === 1);
			await registered[0]?.execute({});
			await registered[0]?.execute({});
			expect(macrotaskRan).toBe(false);

			await waitFor(() => iframeSources().length > 0);
			await settle();

			expect(iframeSources()).toHaveLength(1);
			expect(iframeSources()[0]).toContain(
				"uri=ui%3A%2F%2Fviews%2Fquote.html%3Fv%3D2",
			);
		});

		test("a widget emitted after the overlay mounted is shown, and a second replaces it", async () => {
			const { registered } = installModelContext();
			installServer([SEARCH_TOOL], [WIDGET_ONE, WIDGET_TWO]);

			start(config());
			await waitFor(() => registered.length === 1);
			await settle();
			expect(iframeSources()).toEqual([]);

			await act(async () => {
				await registered[0]?.execute({});
			});
			await waitFor(() => iframeSources().length > 0);
			expect(iframeSources()).toHaveLength(1);
			expect(iframeSources()[0]).toContain(
				"uri=ui%3A%2F%2Fviews%2Fbook.html%3Fv%3D1",
			);

			await act(async () => {
				await registered[0]?.execute({});
			});
			await waitFor(() =>
				iframeSources().some((src) => src.includes("quote.html")),
			);
			expect(iframeSources()).toHaveLength(1);
			expect(iframeSources()[0]).toContain(
				"uri=ui%3A%2F%2Fviews%2Fquote.html%3Fv%3D2",
			);
		});
	});

	describe("destroy", () => {
		test("before the bridge resolves, leaves no tool registered once it does", async () => {
			const { signals } = installModelContext();
			const listing = deferred<Response>();
			const seen = installFetch(() => listing.promise);

			const handle = start(config());
			expect(seen).toHaveLength(1);
			act(() => {
				handle?.destroy();
			});
			expect(hostElement()).toBeNull();

			listing.resolve(Response.json({ tools: [SEARCH_TOOL, BOOK_TOOL] }));
			await settle();

			expect(signals.filter((signal) => signal?.aborted !== true)).toEqual([]);
		});

		test("before a listing that fails is harmless", async () => {
			const { registered } = installModelContext();
			const listing = deferred<Response>();
			installFetch(() => listing.promise);

			const handle = start(config());
			act(() => {
				handle?.destroy();
			});
			listing.resolve(new Response(null, { status: 500 }));
			await settle();

			expect(registered).toEqual([]);
			expect(hostElement()).toBeNull();
		});

		test("after registration unregisters every tool and removes the host, and a second call is harmless", async () => {
			const { registered, signals } = installModelContext();
			installServer([SEARCH_TOOL, BOOK_TOOL]);

			const handle = start(config());
			await waitFor(() => (handle?.getTools().length ?? 0) === 2);
			expect(signals.map((signal) => signal?.aborted)).toEqual([false, false]);
			expect(hostElement()).not.toBeNull();

			act(() => {
				handle?.destroy();
			});
			act(() => {
				handle?.destroy();
			});

			expect(registered).toHaveLength(2);
			expect(signals.map((signal) => signal?.aborted)).toEqual([true, true]);
			expect(hostElement()).toBeNull();
		});
	});
});
