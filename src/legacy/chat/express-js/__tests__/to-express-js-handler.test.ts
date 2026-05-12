import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { PassThrough, Readable } from "node:stream";

// ---------------------------------------------------------------------------
// Mocks for the underlying createApiHandler
// ---------------------------------------------------------------------------
//
// `toExpressJsHandler` calls `createApiHandler` once at construction time and
// dispatches its `route*` methods. We mock the module so each test controls
// what those methods return.

type RouteFn = (request: Request) => Promise<Response>;

interface MockApiHandler {
	routeGet: RouteFn;
	routePost: RouteFn;
	routePatch: RouteFn;
	handleOptions: () => Response;
}

let nextHandler: MockApiHandler;
const createApiHandlerMock = mock(() => nextHandler);

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../server/api-handler.js", () => ({
	createApiHandler: createApiHandlerMock,
}));

const { toExpressJsHandler } = await import("../index");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient() {
	// Minimal shape: only `_config` is read by the adapter.
	return {
		_config: { apiKey: "test-key", apiUrl: "https://test.waniwani.ai" },
	} as unknown as Parameters<typeof toExpressJsHandler>[0];
}

interface FakeReqOptions {
	method: string;
	url?: string;
	headers?: Record<string, string | string[] | undefined>;
	body?: Buffer | string | null;
}

function makeReq({
	method,
	url = "/api/waniwani",
	headers = {},
	body = null,
}: FakeReqOptions) {
	const stream = new Readable({
		read() {
			if (body !== null) {
				this.push(body);
			}
			this.push(null);
		},
	});
	const merged = { host: "localhost:3000", ...headers };
	// Express's `get(name)` is case-insensitive lookup of the header map.
	(stream as unknown as { method: string }).method = method;
	(stream as unknown as { url: string }).url = url;
	(stream as unknown as { originalUrl: string }).originalUrl = url;
	(stream as unknown as { headers: typeof merged }).headers = merged;
	(stream as unknown as { protocol: string }).protocol = "http";
	(stream as unknown as { get: (n: string) => string | undefined }).get = (
		name: string,
	) => {
		const v = merged[name.toLowerCase() as keyof typeof merged];
		return Array.isArray(v) ? v[0] : (v as string | undefined);
	};
	return stream as unknown as Parameters<
		ReturnType<typeof toExpressJsHandler>["post"]
	>[0];
}

interface FakeRes {
	statusCode: number;
	headers: Record<string, string>;
	chunks: Buffer[];
	ended: boolean;
	statusMock: ReturnType<typeof mock>;
	setHeaderMock: ReturnType<typeof mock>;
	endMock: ReturnType<typeof mock>;
	writeMock: ReturnType<typeof mock>;
	stream: PassThrough;
	awaitEnd(): Promise<void>;
}

function makeRes(): FakeRes {
	const stream = new PassThrough();
	const chunks: Buffer[] = [];
	stream.on("data", (chunk: Buffer) => chunks.push(chunk));
	const headers: Record<string, string> = {};
	const state = { statusCode: 200, ended: false };

	const ended = new Promise<void>((resolve) => {
		stream.on("end", () => resolve());
		stream.on("finish", () => resolve());
	});

	const writeMock = mock((...args: unknown[]) => {
		stream.write(args[0] as Buffer);
		return true;
	});
	const endMock = mock((...args: unknown[]) => {
		state.ended = true;
		if (args[0] !== undefined) {
			stream.write(args[0] as Buffer);
		}
		stream.end();
	});
	const setHeaderMock = mock((...args: unknown[]) => {
		const [name, value] = args as [string, unknown];
		headers[name.toLowerCase()] = String(value);
	});
	const statusMock = mock((...args: unknown[]) => {
		state.statusCode = args[0] as number;
		return res as unknown;
	});

	const res = {
		get statusCode() {
			return state.statusCode;
		},
		set statusCode(v: number) {
			state.statusCode = v;
		},
		setHeader: setHeaderMock,
		status: statusMock,
		end: endMock,
		write: writeMock,
		on: stream.on.bind(stream),
	};

	return {
		get statusCode() {
			return state.statusCode;
		},
		set statusCode(v: number) {
			state.statusCode = v;
		},
		headers,
		chunks,
		get ended() {
			return state.ended;
		},
		statusMock,
		setHeaderMock,
		endMock,
		writeMock,
		stream,
		awaitEnd: () => ended,
	} as FakeRes & { _passthrough: typeof res };
}

// Make TypeScript happy: the FakeRes's underlying object satisfies the
// adapter's ExpressLikeResponse shape. We expose it via a thin wrapper.
function asResponse(fr: FakeRes) {
	return {
		get statusCode() {
			return fr.statusCode;
		},
		set statusCode(v: number) {
			fr.statusCode = v;
		},
		setHeader: fr.setHeaderMock,
		status: fr.statusMock,
		end: fr.endMock,
		write: fr.writeMock,
		on: fr.stream.on.bind(fr.stream),
	} as unknown as Parameters<ReturnType<typeof toExpressJsHandler>["post"]>[1];
}

// ---------------------------------------------------------------------------
// Default mock state
// ---------------------------------------------------------------------------

beforeEach(() => {
	nextHandler = {
		routeGet: async () => new Response("ok", { status: 200 }),
		routePost: async () => new Response("ok", { status: 200 }),
		routePatch: async () => new Response("ok", { status: 200 }),
		handleOptions: () => new Response(null, { status: 204 }),
	};
	createApiHandlerMock.mockClear();
});

afterEach(() => {
	createApiHandlerMock.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toExpressJsHandler", () => {
	test("returns { get, post, patch, options } and nothing else", () => {
		const handler = toExpressJsHandler(makeClient(), { source: "test" });
		expect(typeof handler.get).toBe("function");
		expect(typeof handler.post).toBe("function");
		expect(typeof handler.patch).toBe("function");
		expect(typeof handler.options).toBe("function");
		expect(Object.keys(handler).sort()).toEqual([
			"get",
			"options",
			"patch",
			"post",
		]);
	});

	test("forwards client config and source to createApiHandler", () => {
		toExpressJsHandler(makeClient(), {
			source: "my-app",
			chat: { mcpServerUrl: "https://example.com/mcp" },
		});
		expect(createApiHandlerMock).toHaveBeenCalledTimes(1);
		const args = createApiHandlerMock.mock.calls[0]?.[0] as Record<
			string,
			unknown
		>;
		expect(args.apiKey).toBe("test-key");
		expect(args.apiUrl).toBe("https://test.waniwani.ai");
		expect(args.source).toBe("my-app");
		expect(args.mcpServerUrl).toBe("https://example.com/mcp");
	});

	test("OPTIONS preflight: status 204, ends without next()", async () => {
		const handler = toExpressJsHandler(makeClient(), { source: "test" });
		const fr = makeRes();
		const next = mock(() => {});
		handler.options(makeReq({ method: "OPTIONS" }), asResponse(fr));
		await fr.awaitEnd();
		expect(fr.statusCode).toBe(204);
		expect(fr.endMock).toHaveBeenCalled();
		expect(next).not.toHaveBeenCalled();
	});

	test("streaming POST: chunks arrive in order", async () => {
		const chunks = ["chunk-one\n", "chunk-two\n", "chunk-three\n"];
		nextHandler.routePost = async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					const enc = new TextEncoder();
					for (const c of chunks) {
						controller.enqueue(enc.encode(c));
					}
					controller.close();
				},
			});
			return new Response(stream, {
				status: 200,
				headers: { "content-type": "text/plain" },
			});
		};

		const handler = toExpressJsHandler(makeClient(), { source: "test" });
		const fr = makeRes();
		const next = mock(() => {});

		await new Promise<void>((resolve, reject) => {
			fr.stream.on("end", () => resolve());
			fr.stream.on("error", reject);
			handler.post(
				makeReq({ method: "POST", body: Buffer.from("{}") }),
				asResponse(fr),
				next,
			);
		});

		expect(next).not.toHaveBeenCalled();
		expect(fr.statusCode).toBe(200);
		expect(fr.headers["content-type"]).toBe("text/plain");
		const body = Buffer.concat(fr.chunks).toString("utf-8");
		expect(body).toBe(chunks.join(""));
	});

	test("propagates response headers verbatim", async () => {
		nextHandler.routeGet = async () =>
			new Response("hello", {
				status: 200,
				headers: {
					"content-type": "text/html; charset=utf-8",
					"x-foo": "bar",
				},
			});

		const handler = toExpressJsHandler(makeClient(), { source: "test" });
		const fr = makeRes();
		const next = mock(() => {});

		await new Promise<void>((resolve, reject) => {
			fr.stream.on("end", resolve);
			fr.stream.on("error", reject);
			handler.get(makeReq({ method: "GET" }), asResponse(fr), next);
		});

		expect(fr.headers["content-type"]).toBe("text/html; charset=utf-8");
		expect(fr.headers["x-foo"]).toBe("bar");
	});

	test("forwards Express request body as Web Request body", async () => {
		const captured: { request?: Request; bodyText?: string } = {};
		nextHandler.routePost = async (request) => {
			captured.request = request;
			captured.bodyText = await request.text();
			return new Response("ok", { status: 200 });
		};

		const handler = toExpressJsHandler(makeClient(), { source: "test" });
		const fr = makeRes();
		const next = mock(() => {});
		const payload = JSON.stringify({ hello: "world" });

		await new Promise<void>((resolve, reject) => {
			fr.stream.on("end", resolve);
			fr.stream.on("error", reject);
			handler.post(
				makeReq({
					method: "POST",
					url: "/api/waniwani",
					headers: { "content-type": "application/json" },
					body: Buffer.from(payload),
				}),
				asResponse(fr),
				next,
			);
		});

		expect(next).not.toHaveBeenCalled();
		expect(captured.bodyText).toBe(payload);
		expect(captured.request?.method).toBe("POST");
		expect(captured.request?.headers.get("content-type")).toBe(
			"application/json",
		);
	});

	test("error path: thrown error invokes next(err) and does not end response", async () => {
		const boom = new Error("boom");
		nextHandler.routePost = async () => {
			throw boom;
		};

		const handler = toExpressJsHandler(makeClient(), { source: "test" });
		const fr = makeRes();
		const next = mock(() => {});

		await Promise.resolve(
			handler.post(
				makeReq({ method: "POST", body: Buffer.from("{}") }),
				asResponse(fr),
				next,
			),
		);
		// Adapter is async — give microtasks a chance to flush.
		await new Promise((r) => setImmediate(r));

		expect(next).toHaveBeenCalledTimes(1);
		expect(next.mock.calls[0]?.[0]).toBe(boom);
		expect(fr.endMock).not.toHaveBeenCalled();
	});

	test("method dispatch: get/post/patch each call the matching route", async () => {
		const calls: string[] = [];
		nextHandler.routeGet = async () => {
			calls.push("get");
			return new Response("g", { status: 200 });
		};
		nextHandler.routePost = async () => {
			calls.push("post");
			return new Response("p", { status: 200 });
		};
		nextHandler.routePatch = async () => {
			calls.push("patch");
			return new Response("a", { status: 200 });
		};

		const handler = toExpressJsHandler(makeClient(), { source: "test" });

		const drive = (
			method: "get" | "post" | "patch",
			body: Buffer | null = null,
		) =>
			new Promise<void>((resolve, reject) => {
				const fr = makeRes();
				fr.stream.on("end", resolve);
				fr.stream.on("error", reject);
				handler[method](
					makeReq({ method: method.toUpperCase(), body }),
					asResponse(fr),
					() => reject(new Error("unexpected next()")),
				);
			});

		await drive("get");
		await drive("post", Buffer.from("{}"));
		await drive("patch", Buffer.from("{}"));

		expect(calls).toEqual(["get", "post", "patch"]);
	});
});
