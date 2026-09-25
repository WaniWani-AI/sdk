import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example/pricing" });
Object.assign(globalThis, {
	document: win.document,
	navigator: win.navigator,
	Event: win.Event,
	CustomEvent: win.CustomEvent,
	window: win,
	location: win.location,
});

const { createWebMcpBridge } = await import("../bridge");

const REAL_FETCH = globalThis.fetch;

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

type Seen = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
};

const ENDPOINT = "https://app.example.test/api/mcp/chat/webmcp";
const LIST =
	"https://app.example.test/api/mcp/chat/webmcp/tools?token=wwp_abc&channel=ch_1";
const HEADERS = { Authorization: "Bearer wwp_abc" };

const SEARCH_TOOL = {
	name: "search",
	description: "Search the docs",
	inputSchema: { type: "object", properties: { q: { type: "string" } } },
	annotations: { readOnlyHint: true },
};
const BOOK_TOOL = { name: "book_demo" };

function readBody(body: unknown): unknown {
	if (typeof body !== "string") {
		return body ?? null;
	}
	return JSON.parse(body);
}

function describeRequest(
	input: string | URL | Request,
	init?: RequestInit,
): Seen {
	if (input instanceof Request) {
		return {
			url: input.url,
			method: input.method.toUpperCase(),
			headers: Object.fromEntries(input.headers.entries()),
			body: readBody(init?.body),
		};
	}
	return {
		url: String(input),
		method: (init?.method ?? "GET").toUpperCase(),
		headers: Object.fromEntries(new Headers(init?.headers).entries()),
		body: readBody(init?.body),
	};
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

function recordingLogger() {
	const errors: unknown[][] = [];
	const infos: unknown[][] = [];
	return {
		errors,
		infos,
		logger: {
			error: (...args: unknown[]) => {
				errors.push(args);
			},
			info: (...args: unknown[]) => {
				infos.push(args);
			},
		},
	};
}

function isListPost(request: Seen): boolean {
	const body = request.body;
	return (
		request.method === "POST" &&
		typeof body === "object" &&
		body !== null &&
		"action" in body &&
		body.action === "list"
	);
}

function descriptors(registered: Registered[]) {
	return registered.map(({ execute: _execute, ...rest }) => rest);
}

const OPTIONS = {
	endpoint: ENDPOINT,
	listEndpoint: LIST,
	headers: HEADERS,
	sessionId: "tab-1",
	visitorId: "visitor-1",
	channelId: "ch_1",
};

function restoreFetch() {
	globalThis.fetch = REAL_FETCH;
}

beforeEach(() => {
	Reflect.deleteProperty(document, "modelContext");
	Reflect.deleteProperty(navigator, "modelContext");
});

afterEach(() => {
	Reflect.deleteProperty(document, "modelContext");
	restoreFetch();
});

describe("createWebMcpBridge with a listEndpoint", () => {
	test("lists with one bare GET: no headers, no body, no POST behind it", async () => {
		installModelContext();
		const seen = installFetch(() =>
			Response.json({ tools: [SEARCH_TOOL, BOOK_TOOL] }),
		);
		const { logger } = recordingLogger();

		const bridge = await createWebMcpBridge({ ...OPTIONS, logger });

		expect(seen).toEqual([
			{ url: LIST, method: "GET", headers: {}, body: null },
		]);
		expect(bridge?.tools.map((tool) => tool.name)).toEqual([
			"search",
			"book_demo",
		]);
	});

	test("registers the GET's tools with the descriptor the browser needs, in the order served", async () => {
		const { registered } = installModelContext();
		installFetch(() => Response.json({ tools: [SEARCH_TOOL, BOOK_TOOL] }));
		const { logger } = recordingLogger();

		await createWebMcpBridge({ ...OPTIONS, logger });

		expect(descriptors(registered)).toEqual([
			{
				name: "search",
				description: "Search the docs",
				inputSchema: {
					type: "object",
					properties: { q: { type: "string" } },
				},
				annotations: { readOnlyHint: true },
			},
			{ name: "book_demo", description: "" },
		]);
	});

	test("a GET listing and a POST listing of the same tools register identically", async () => {
		const tools = [
			BOOK_TOOL,
			SEARCH_TOOL,
			{ name: "quote", description: "Get a quote", _meta: { ui: {} } },
		];
		const { logger } = recordingLogger();

		const viaGet = installModelContext();
		installFetch(() => Response.json({ tools }));
		const getBridge = await createWebMcpBridge({ ...OPTIONS, logger });
		restoreFetch();

		const viaPost = installModelContext();
		installFetch(() => Response.json({ tools }));
		const postBridge = await createWebMcpBridge({
			...OPTIONS,
			listEndpoint: undefined,
			logger,
		});

		expect(descriptors(viaGet.registered)).toEqual(
			descriptors(viaPost.registered),
		);
		expect(getBridge?.tools).toEqual(postBridge?.tools ?? []);
		expect(viaGet.registered.map((tool) => tool.name)).toEqual([
			"book_demo",
			"search",
			"quote",
		]);
	});

	const STATUSES = [400, 401, 403, 404, 405, 406, 410, 500, 502, 503];
	const getFailures: Array<[string, () => Response]> = [
		...STATUSES.map((status): [string, () => Response] => [
			`a ${status}`,
			() => new Response("not here", { status }),
		]),
		[
			"a network or CORS failure",
			() => {
				throw new TypeError("Failed to fetch");
			},
		],
		[
			"a 200 whose body is not JSON",
			() =>
				new Response("<!doctype html><title>Shop</title>", {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
		],
		["a 204 with no body", () => new Response(null, { status: 204 })],
	];

	for (const [failure, failGet] of getFailures) {
		describe(`${failure} on the GET`, () => {
			test("falls back to the list POST on the tools endpoint, with the headers", async () => {
				installModelContext();
				const seen = installFetch((request) =>
					request.method === "GET"
						? failGet()
						: Response.json({ tools: [SEARCH_TOOL] }),
				);
				const { logger, errors } = recordingLogger();

				const bridge = await createWebMcpBridge({ ...OPTIONS, logger });

				expect(errors).toEqual([]);

				expect(seen.map(({ url, method }) => ({ url, method }))).toEqual([
					{ url: LIST, method: "GET" },
					{ url: ENDPOINT, method: "POST" },
				]);
				expect(seen[1]?.headers).toEqual({
					"content-type": "application/json",
					authorization: "Bearer wwp_abc",
				});
				expect(seen[1]?.body).toEqual({
					action: "list",
					sessionId: "tab-1",
					visitorId: "visitor-1",
					channelId: "ch_1",
					page: { url: "https://shop.example/pricing", title: "" },
				});
				expect(bridge?.tools.map((tool) => tool.name)).toEqual(["search"]);
			});

			test("and a failing POST behind it is a failed listing: logged, disposed, null", async () => {
				const { registered } = installModelContext();
				const seen = installFetch((request) =>
					request.method === "GET"
						? failGet()
						: new Response("boom", { status: 500 }),
				);
				const { logger, errors, infos } = recordingLogger();

				const bridge = await createWebMcpBridge({ ...OPTIONS, logger });

				expect(bridge).toBeNull();
				expect(infos).toHaveLength(1);
				expect(seen).toHaveLength(2);
				expect(registered).toEqual([]);
				expect(errors).toHaveLength(1);
			});

			test("and a POST that never reaches the server is a failed listing", async () => {
				installModelContext();
				installFetch((request) => {
					if (request.method === "GET") {
						return failGet();
					}
					throw new TypeError("Failed to fetch");
				});
				const { logger, errors } = recordingLogger();

				expect(await createWebMcpBridge({ ...OPTIONS, logger })).toBeNull();
				expect(errors).toHaveLength(1);
			});
		});
	}

	for (const status of STATUSES) {
		test(`a ${status} GET's own tools are ignored in favour of the POST's`, async () => {
			installModelContext();
			installFetch((request) =>
				request.method === "GET"
					? Response.json({ tools: [{ name: "stale" }] }, { status })
					: Response.json({ tools: [SEARCH_TOOL] }),
			);
			const { logger } = recordingLogger();

			const bridge = await createWebMcpBridge({ ...OPTIONS, logger });

			expect(bridge?.tools.map((tool) => tool.name)).toEqual(["search"]);
		});
	}

	test("a 2xx JSON GET is used with no POST and nothing logged as a fallback", async () => {
		installModelContext();
		const seen = installFetch(() => Response.json({ tools: [SEARCH_TOOL] }));
		const { logger, errors, infos } = recordingLogger();

		await createWebMcpBridge({ ...OPTIONS, logger });

		expect(seen.map(({ method }) => method)).toEqual(["GET"]);
		expect(errors).toEqual([]);
		expect(infos.some((args) => String(args[0]).includes("POST"))).toBe(false);
	});

	test("the fallback POST leaves out the ids it was not given", async () => {
		installModelContext();
		const seen = installFetch((request) =>
			request.method === "GET"
				? new Response(null, { status: 404 })
				: Response.json({ tools: [] }),
		);
		const { logger } = recordingLogger();

		await createWebMcpBridge({
			endpoint: ENDPOINT,
			listEndpoint: LIST,
			sessionId: "tab-1",
			logger,
		});

		expect(seen[1]?.body).toEqual({
			action: "list",
			sessionId: "tab-1",
			page: { url: "https://shop.example/pricing", title: "" },
		});
		expect(seen[1]?.headers).toEqual({ "content-type": "application/json" });
	});

	test("a failed listing (GET and POST both 500) takes its pagehide listener back off the window", async () => {
		installModelContext();
		installFetch(() => new Response(null, { status: 500 }));
		const added: unknown[] = [];
		const removed: unknown[] = [];
		const realAdd = window.addEventListener.bind(window);
		const realRemove = window.removeEventListener.bind(window);
		const addSpy = spyOn(window, "addEventListener").mockImplementation(
			(type: string, listener: EventListenerOrEventListenerObject) => {
				if (type === "pagehide") {
					added.push(listener);
				}
				realAdd(type, listener);
			},
		);
		const removeSpy = spyOn(window, "removeEventListener").mockImplementation(
			(type: string, listener: EventListenerOrEventListenerObject) => {
				if (type === "pagehide") {
					removed.push(listener);
				}
				realRemove(type, listener);
			},
		);
		const { logger } = recordingLogger();

		try {
			expect(await createWebMcpBridge({ ...OPTIONS, logger })).toBeNull();
		} finally {
			addSpy.mockRestore();
			removeSpy.mockRestore();
		}

		expect(added).toHaveLength(1);
		expect(removed).toEqual(added);
	});

	describe("a 2xx whose body is not a tool list", () => {
		const degenerate: Array<[string, unknown]> = [
			["an object without tools", {}],
			["JSON null", null],
			["an empty tool list", { tools: [] }],
		];
		for (const [label, body] of degenerate) {
			test(`${label} registers nothing and still returns a live bridge`, async () => {
				const { registered } = installModelContext();
				const seen = installFetch((request) =>
					isListPost(request)
						? Response.json({ tools: [SEARCH_TOOL] })
						: Response.json(body),
				);
				const { logger, errors } = recordingLogger();

				const bridge = await createWebMcpBridge({ ...OPTIONS, logger });

				expect(bridge).not.toBeNull();
				expect(bridge?.tools).toEqual([]);
				expect(registered).toEqual([]);
				expect(seen).toHaveLength(1);
				expect(errors).toEqual([]);
			});
		}

		const notLists: Array<[string, unknown]> = [
			["a string", "search"],
			["an object", { name: "search" }],
			["a number", 3],
			["null", null],
		];
		const paths: Array<[string, { listEndpoint?: string }]> = [
			["GET", {}],
			["POST", { listEndpoint: undefined }],
		];
		for (const [shape, tools] of notLists) {
			for (const [via, extra] of paths) {
				test(`a tools field that is ${shape} resolves an empty bridge by ${via}`, async () => {
					const { registered } = installModelContext();
					const seen = installFetch(() => Response.json({ tools }));
					const { logger } = recordingLogger();

					const bridge = await createWebMcpBridge({
						...OPTIONS,
						...extra,
						logger,
					});

					expect(bridge).not.toBeNull();
					expect(bridge?.tools).toEqual([]);
					expect(registered).toEqual([]);
					expect(seen.map(({ method }) => method)).toEqual([via]);
				});
			}
		}
	});

	describe("without a usable listEndpoint", () => {
		const variants: Array<[string, { listEndpoint?: string }]> = [
			["absent", {}],
			["undefined", { listEndpoint: undefined }],
			["empty", { listEndpoint: "" }],
		];
		for (const [label, extra] of variants) {
			test(`${label} lists by POST alone, as before`, async () => {
				installModelContext();
				const seen = installFetch(() =>
					Response.json({ tools: [SEARCH_TOOL] }),
				);
				const { logger } = recordingLogger();

				const bridge = await createWebMcpBridge({
					endpoint: ENDPOINT,
					headers: HEADERS,
					sessionId: "tab-1",
					channelId: "ch_1",
					logger,
					...extra,
				});

				expect(seen.map(({ url, method }) => ({ url, method }))).toEqual([
					{ url: ENDPOINT, method: "POST" },
				]);
				expect(seen[0]?.headers.authorization).toBe("Bearer wwp_abc");
				expect(bridge?.tools.map((tool) => tool.name)).toEqual(["search"]);
			});
		}
	});

	describe("a tool call", () => {
		test("after a GET listing posts to the tools endpoint with the headers, never to the list URL", async () => {
			const { registered } = installModelContext();
			const seen = installFetch((request) =>
				request.method === "GET"
					? Response.json({ tools: [SEARCH_TOOL] })
					: Response.json({
							content: [{ type: "text", text: "found it" }],
							widget: null,
						}),
			);
			const { logger } = recordingLogger();

			await createWebMcpBridge({ ...OPTIONS, logger });
			const result = await registered[0]?.execute({ q: "pricing" });

			expect(result).toEqual({
				content: [{ type: "text", text: "found it" }],
			});
			expect(seen).toHaveLength(2);
			expect(seen[1]?.url).toBe(ENDPOINT);
			expect(seen[1]?.method).toBe("POST");
			expect(seen[1]?.headers).toEqual({
				"content-type": "application/json",
				authorization: "Bearer wwp_abc",
			});
			expect(seen[1]?.body).toEqual({
				action: "call",
				name: "search",
				arguments: { q: "pricing" },
				sessionId: "tab-1",
				visitorId: "visitor-1",
				channelId: "ch_1",
				page: { url: "https://shop.example/pricing", title: "" },
			});
		});

		test("after a fallback listing still posts to the tools endpoint", async () => {
			const { registered } = installModelContext();
			const seen = installFetch((request) => {
				if (request.method === "GET") {
					return new Response(null, { status: 405 });
				}
				return isListPost(request)
					? Response.json({ tools: [SEARCH_TOOL] })
					: Response.json({ content: [], widget: null });
			});
			const { logger } = recordingLogger();

			await createWebMcpBridge({ ...OPTIONS, logger });
			await registered[0]?.execute({});
			await registered[0]?.execute({});

			expect(seen.map(({ url, method }) => `${method} ${url}`)).toEqual([
				`GET ${LIST}`,
				`POST ${ENDPOINT}`,
				`POST ${ENDPOINT}`,
				`POST ${ENDPOINT}`,
			]);
		});
	});

	test("dispose after a GET listing aborts every registration, twice without throwing", async () => {
		const { signals } = installModelContext();
		installFetch(() => Response.json({ tools: [SEARCH_TOOL, BOOK_TOOL] }));
		const { logger } = recordingLogger();

		const bridge = await createWebMcpBridge({ ...OPTIONS, logger });
		expect(signals.map((signal) => signal?.aborted)).toEqual([false, false]);

		bridge?.dispose();
		bridge?.dispose();

		expect(signals.map((signal) => signal?.aborted)).toEqual([true, true]);
	});

	test("makes no request at all on a browser with no modelContext", async () => {
		const seen = installFetch(() => Response.json({ tools: [SEARCH_TOOL] }));
		const { logger } = recordingLogger();

		expect(await createWebMcpBridge({ ...OPTIONS, logger })).toBeNull();
		expect(seen).toEqual([]);
	});
});
