import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// The bridge only needs `document`/`navigator` to probe for `modelContext`, a
// `window` to hang the pagehide listener on, and `fetch`. No React, no MCP SDK.
// ---------------------------------------------------------------------------

const win = new Window({ url: "https://shop.example/pricing" });
for (const key of ["document", "navigator", "Event", "CustomEvent"] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).location = win.location;

const { createWebMcpBridge, supportsWebMcp } = await import("../bridge");

type Registered = {
	name: string;
	description: string;
	inputSchema?: Record<string, unknown>;
	annotations?: Record<string, unknown>;
	execute: (
		args: Record<string, unknown>,
		options?: { signal?: AbortSignal },
	) => Promise<{ content: Array<Record<string, unknown>> }>;
};

// Bun runs every test file in one process, so a `globalThis.fetch` left
// installed here answers the tracking suites' requests too. Captured once and
// put back after each test.
const REAL_FETCH = globalThis.fetch;

const ENDPOINT = "https://acme.mcp.example/api/webmcp/tools";
const SILENT = { error: () => {}, info: () => {} } as unknown as Console;

/** Stand in for `document.modelContext`, recording what the bridge registers. */
function installModelContext() {
	const registered: Registered[] = [];
	const signals: Array<AbortSignal | undefined> = [];
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).document.modelContext = {
		registerTool: (tool: Registered, options?: { signal?: AbortSignal }) => {
			registered.push(tool);
			signals.push(options?.signal);
			return Promise.resolve();
		},
	};
	return { registered, signals };
}

/** Answers `list` with `tools`, and every `call` with the next queued result. */
function installFetch(tools: unknown[], callResults: unknown[] = []) {
	const calls: Array<Record<string, unknown>> = [];
	const queue = [...callResults];
	const fetchMock = mock(async (..._args: unknown[]) => {
		const init = _args[1] as RequestInit | undefined;
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		calls.push(body);
		const payload = body.action === "list" ? { tools } : queue.shift();
		return {
			ok: true,
			status: 200,
			json: async () => payload,
		} as unknown as Response;
	});
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).fetch = fetchMock;
	return { calls, fetchMock };
}

const SEARCH_TOOL = {
	name: "search",
	description: "Search the docs",
	inputSchema: { type: "object", properties: { q: { type: "string" } } },
	annotations: { readOnlyHint: true },
};

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test cleanup
	delete (globalThis as any).document.modelContext;
	// biome-ignore lint/suspicious/noExplicitAny: test cleanup
	delete (globalThis as any).navigator.modelContext;
});

afterEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test cleanup
	delete (globalThis as any).document.modelContext;
	globalThis.fetch = REAL_FETCH;
});

describe("supportsWebMcp", () => {
	test("false on a browser with no modelContext", () => {
		expect(supportsWebMcp()).toBe(false);
	});

	test("true when it hangs off document", () => {
		installModelContext();
		expect(supportsWebMcp()).toBe(true);
	});

	// The getter moved from Navigator to Document mid-spec, so both are live.
	test("true when it hangs off navigator", () => {
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).navigator.modelContext = { registerTool: () => {} };
		expect(supportsWebMcp()).toBe(true);
	});

	test("false for an object that is not a model context", () => {
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).document.modelContext = { somethingElse: true };
		expect(supportsWebMcp()).toBe(false);
	});
});

describe("createWebMcpBridge", () => {
	test("does nothing on a browser with no modelContext", async () => {
		const { fetchMock } = installFetch([SEARCH_TOOL]);
		const bridge = await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "s1",
			logger: SILENT,
		});
		expect(bridge).toBeNull();
		// Not even the list call: an ordinary visit costs no network.
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("registers every advertised tool with its schema and annotations", async () => {
		const { registered } = installModelContext();
		installFetch([SEARCH_TOOL, { name: "book_demo", description: "Book" }]);

		const bridge = await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "s1",
			logger: SILENT,
		});

		expect(registered.map((t) => t.name)).toEqual(["search", "book_demo"]);
		expect(registered[0]?.inputSchema).toEqual(SEARCH_TOOL.inputSchema);
		expect(registered[0]?.annotations).toEqual(SEARCH_TOOL.annotations);
		expect(bridge?.tools.map((t) => t.name)).toEqual(["search", "book_demo"]);
	});

	test("sends identity, channel and page on every request", async () => {
		installModelContext();
		const { calls } = installFetch(
			[SEARCH_TOOL],
			[{ content: [], widget: null }],
		);

		await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "tab-session",
			visitorId: "visitor-42",
			channelId: "ch-1",
			logger: SILENT,
		});

		expect(calls[0]).toMatchObject({
			action: "list",
			sessionId: "tab-session",
			visitorId: "visitor-42",
			channelId: "ch-1",
			page: { url: "https://shop.example/pricing" },
		});
	});

	// Ingest drops what it cannot attribute to a channel, so this riding on the
	// call and not only on the list is the difference between a conversion that
	// lands and one that vanishes.
	test("carries the channel on a call, not only on the list", async () => {
		const { registered } = installModelContext();
		const { calls } = installFetch(
			[SEARCH_TOOL],
			[{ content: [], widget: null }],
		);

		await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "s1",
			channelId: "ch-1",
			logger: SILENT,
		});
		await registered[0]?.execute({});

		expect(calls[1]).toMatchObject({ action: "call", channelId: "ch-1" });
	});

	test("authenticates with the headers it was given", async () => {
		installModelContext();
		let seen: HeadersInit | undefined;
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).fetch = mock(async (..._args: unknown[]) => {
			const init = _args[1] as RequestInit | undefined;
			seen = init?.headers;
			return {
				ok: true,
				status: 200,
				json: async () => ({ tools: [] }),
			} as unknown as Response;
		});

		await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "s1",
			headers: { Authorization: "Bearer wwp_abc" },
			logger: SILENT,
		});

		expect(seen).toMatchObject({
			"content-type": "application/json",
			Authorization: "Bearer wwp_abc",
		});
	});

	test("a call forwards arguments and returns the content", async () => {
		const { registered } = installModelContext();
		const { calls } = installFetch(
			[SEARCH_TOOL],
			[{ content: [{ type: "text", text: "found it" }], widget: null }],
		);

		await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "tab-session",
			visitorId: "visitor-42",
			logger: SILENT,
		});

		const result = await registered[0]?.execute({ q: "pricing" });
		expect(result).toEqual({ content: [{ type: "text", text: "found it" }] });
		expect(calls[1]).toMatchObject({
			action: "call",
			name: "search",
			arguments: { q: "pricing" },
			sessionId: "tab-session",
			visitorId: "visitor-42",
		});
	});

	test("hands a resolved widget to the host and still answers the agent", async () => {
		const { registered } = installModelContext();
		const widget = {
			viewUri: "ui://views/ext-apps/book.html?v=abc",
			tool: "show-book-call",
			data: {},
			result: { content: [] },
			interactive: true,
		};
		installFetch(
			[SEARCH_TOOL],
			[{ content: [{ type: "text", text: "{}" }], widget }],
		);

		const seen: unknown[] = [];
		await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "s1",
			onWidget: (payload) => seen.push(payload),
			logger: SILENT,
		});

		const result = await registered[0]?.execute({});
		expect(seen).toEqual([widget]);
		expect(result?.content).toEqual([{ type: "text", text: "{}" }]);
	});

	// A page with no widget host is a supported deployment, not a broken one.
	test("survives having no onWidget", async () => {
		const { registered } = installModelContext();
		installFetch(
			[SEARCH_TOOL],
			[
				{
					content: [],
					widget: { viewUri: "ui://x" },
				},
			],
		);

		await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "s1",
			logger: SILENT,
		});
		expect(await registered[0]?.execute({})).toEqual({ content: [] });
	});

	test("a tool the browser refuses does not take the others with it", async () => {
		const registered: Registered[] = [];
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).document.modelContext = {
			registerTool: (tool: Registered) => {
				if (tool.name === "broken") {
					return Promise.reject(new Error("refused"));
				}
				registered.push(tool);
				return Promise.resolve();
			},
		};
		installFetch([
			{ name: "broken", description: "" },
			SEARCH_TOOL,
			{ name: "book_demo", description: "" },
		]);

		const bridge = await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "s1",
			logger: SILENT,
		});

		expect(registered.map((t) => t.name)).toEqual(["search", "book_demo"]);
		expect(bridge?.tools.map((t) => t.name)).toEqual(["search", "book_demo"]);
	});

	test("a failed list registers nothing rather than throwing", async () => {
		installModelContext();
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).fetch = mock(
			async () => ({ ok: false, status: 503 }) as unknown as Response,
		);

		expect(
			await createWebMcpBridge({
				endpoint: ENDPOINT,
				sessionId: "s1",
				logger: SILENT,
			}),
		).toBeNull();
	});

	test("registration is scoped to a signal, and dispose aborts it", async () => {
		const { signals } = installModelContext();
		installFetch([SEARCH_TOOL]);

		const bridge = await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "s1",
			logger: SILENT,
		});

		const signal = signals[0];
		expect(signal).toBeDefined();
		expect(signal?.aborted).toBe(false);
		bridge?.dispose();
		expect(signal?.aborted).toBe(true);
		// Idempotent: a host that disposes and then unloads must not throw.
		bridge?.dispose();
	});

	test("the agent's abort reaches the request", async () => {
		const { registered } = installModelContext();
		let seenSignal: AbortSignal | undefined;
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).fetch = mock(async (..._args: unknown[]) => {
			const init = _args[1] as
				| (RequestInit & { signal?: AbortSignal })
				| undefined;
			const body = JSON.parse(String(init?.body)) as { action: string };
			if (body.action === "call") {
				seenSignal = init?.signal;
			}
			return {
				ok: true,
				status: 200,
				json: async () =>
					body.action === "list"
						? { tools: [SEARCH_TOOL] }
						: { content: [], widget: null },
			} as unknown as Response;
		});

		await createWebMcpBridge({
			endpoint: ENDPOINT,
			sessionId: "s1",
			logger: SILENT,
		});

		const controller = new AbortController();
		await registered[0]?.execute({}, { signal: controller.signal });
		expect(seenSignal).toBe(controller.signal);
	});
});
