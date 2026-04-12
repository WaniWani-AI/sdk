import { describe, expect, test } from "bun:test";
import type { TrackInput } from "../../../../tracking/@types.js";
import { withWaniwani } from "../index.js";

function mockClient() {
	const tracked: TrackInput[] = [];
	let flushed = 0;
	return {
		client: {
			track: async (event: TrackInput) => {
				tracked.push(event);
				return { eventId: `evt_mock_${tracked.length}` };
			},
			identify: async (
				_userId: string,
				_properties?: Record<string, unknown>,
				_meta?: Record<string, unknown>,
			) => {
				return { eventId: "evt_mock_identify" };
			},
			flush: async () => {
				flushed += 1;
			},
			kb: {
				ingest: async () => ({
					ingested: 0,
					errors: [],
					chunksIngested: 0,
					filesProcessed: 0,
				}),
				search: async () => [],
				sources: async () => [],
			},
			_config: {
				apiUrl: "https://test.waniwani.ai",
				apiKey: undefined,
				tracking: {
					endpointPath: "/api/mcp/events/v2/batch",
					flushIntervalMs: 1000,
					maxBatchSize: 20,
					maxBufferSize: 1000,
					maxRetries: 3,
					retryBaseDelayMs: 200,
					retryMaxDelayMs: 2000,
					shutdownTimeoutMs: 2000,
				},
			},
		},
		tracked,
		get flushed() {
			return flushed;
		},
	};
}

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
type RegisterToolArgs = [string, Record<string, unknown>, Handler];
type RegisteredToolEntry = {
	handler: Handler;
	_meta?: Record<string, unknown>;
};

function mockServer() {
	const registered: RegisterToolArgs[] = [];
	const _registeredTools: Record<string, RegisteredToolEntry> = {};
	const server = {
		_registeredTools,
		registerTool: (...args: unknown[]) => {
			const typed = args as RegisterToolArgs;
			registered.push(typed);
			// Mirror the MCP SDK: store the (possibly wrapped) handler plus the
			// definition `_meta` in `_registeredTools[name]`. In-place wrapping
			// reassigns `entry.handler` and reads `entry._meta`.
			const definitionMeta = (typed[1] as { _meta?: Record<string, unknown> })
				?._meta;
			_registeredTools[typed[0]] = {
				handler: typed[2],
				...(definitionMeta && { _meta: definitionMeta }),
			};
		},
	};
	return {
		server: server as unknown as Parameters<typeof withWaniwani>[0],
		registered,
		_registeredTools,
		registerTool: (...args: unknown[]) => {
			(server.registerTool as (...a: unknown[]) => void)(...args);
		},
	};
}

describe("withWaniwani", () => {
	test("emits tool.called after execution with durationMs and status ok", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		mock.registerTool("pricing", { description: "Get pricing" }, async () => ({
			text: "done",
		}));

		expect(mock.registered).toHaveLength(1);
		expect(mock.registered[0]?.[0]).toBe("pricing");

		const handler = mock.registered[0]?.[2];
		const result = await handler?.({}, { _meta: { requestId: "req-1" } });

		expect(result).toMatchObject({ text: "done" });
		expect(tracked).toHaveLength(1);
		expect(tracked[0]).toMatchObject({
			event: "tool.called",
			properties: {
				name: "pricing",
				type: "other",
				status: "ok",
				input: {},
				output: { text: "done" },
			},
		});
		const props = (tracked[0] as { properties: Record<string, unknown> })
			.properties;
		expect(typeof props.durationMs).toBe("number");
		expect(props.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("emits status error with errorMessage on handler failure", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		mock.registerTool("failing-tool", { description: "Fails" }, async () => {
			throw new Error("tool broke");
		});

		const handler = mock.registered[0]?.[2];

		let thrownError: Error | undefined;
		try {
			await handler?.({}, {});
		} catch (e) {
			thrownError = e as Error;
		}

		expect(thrownError).toBeDefined();
		expect(thrownError?.message).toBe("tool broke");

		expect(tracked).toHaveLength(1);
		expect(tracked[0]).toMatchObject({
			event: "tool.called",
			properties: {
				name: "failing-tool",
				type: "other",
				status: "error",
				errorMessage: "tool broke",
			},
		});
	});

	test("prevents double wrapping", () => {
		const { server } = mockServer();

		const wrapped1 = withWaniwani(server, {
			client: mockClient().client,
		});
		const wrapped2 = withWaniwani(wrapped1, {
			client: mockClient().client,
		});

		expect(wrapped1).toBe(wrapped2);
	});

	test("extracts _meta from extra and passes as meta", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		mock.registerTool("search", { description: "Search" }, async () => ({
			text: "ok",
		}));

		const handler = mock.registered[0]?.[2];
		await handler?.({}, { _meta: { "openai/sessionId": "session-1" } });

		expect(tracked[0]?.meta).toEqual({
			"openai/sessionId": "session-1",
		});
	});

	test("flushes after tool call when flushAfterToolCall is set", async () => {
		const mock = mockClient();
		const srv = mockServer();

		withWaniwani(srv.server, {
			client: mock.client,
			flushAfterToolCall: true,
		});

		srv.registerTool("search", { description: "Search" }, async () => ({
			text: "ok",
		}));

		const handler = srv.registered[0]?.[2];
		await handler?.({}, {});

		expect(mock.flushed).toBe(1);
	});

	test("injects widget endpoint metadata even without token cache", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		mock.registerTool("search", { description: "Search" }, async () => ({
			text: "ok",
		}));

		const handler = mock.registered[0]?.[2];
		const result = (await handler?.({}, {})) as Record<string, unknown>;
		const meta = result._meta as Record<string, unknown>;
		const waniwani = meta.waniwani as Record<string, unknown>;

		expect(waniwani.endpoint).toBe(
			"https://test.waniwani.ai/api/mcp/events/v2/batch",
		);
		expect(waniwani.token).toBe(undefined);
	});

	test("injects session and geo metadata into the first widget result", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		mock.registerTool("search", { description: "Search" }, async () => ({
			text: "ok",
		}));

		const handler = mock.registered[0]?.[2];
		const result = (await handler?.(
			{},
			{
				_meta: {
					"waniwani/sessionId": "session-1",
					"waniwani/geoLocation": {
						country: "SK",
						city: "Bratislava",
					},
				},
			},
		)) as Record<string, unknown>;
		const meta = result._meta as Record<string, unknown>;
		const waniwani = meta.waniwani as Record<string, unknown>;

		expect(waniwani.sessionId).toBe("session-1");
		expect(waniwani.geoLocation).toEqual({
			country: "SK",
			city: "Bratislava",
		});
		expect(meta["waniwani/sessionId"]).toBe("session-1");
		expect(meta["waniwani/geoLocation"]).toEqual({
			country: "SK",
			city: "Bratislava",
		});
		expect(meta["waniwani/userLocation"]).toEqual({
			country: "SK",
			city: "Bratislava",
		});
	});

	test("wraps tools registered before withWaniwani() in place", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		// Register FIRST (the register-then-wrap footgun)
		let rawCalls = 0;
		mock.registerTool("pricing", { description: "Get pricing" }, async () => {
			rawCalls += 1;
			return { text: "done" };
		});

		// Then wrap
		withWaniwani(mock.server, { client });

		// The handler stored on `_registeredTools` is the one the MCP runtime
		// invokes — that's what should now be wrapped.
		const handler = mock._registeredTools.pricing?.handler;
		expect(handler).toBeDefined();

		const extra: Record<string, unknown> = { _meta: { requestId: "req-1" } };
		const result = (await handler?.({}, extra)) as Record<string, unknown>;

		expect(rawCalls).toBe(1);
		expect(result).toMatchObject({ text: "done" });
		expect(tracked).toHaveLength(1);
		expect(tracked[0]).toMatchObject({
			event: "tool.called",
			properties: {
				name: "pricing",
				type: "other",
				status: "ok",
				input: {},
				output: { text: "done" },
			},
		});

		// Scoped client was injected into extra (same behavior as register-after path)
		expect(extra["waniwani/client"]).toBeDefined();

		// Widget endpoint metadata injected into the result
		const meta = result._meta as Record<string, unknown>;
		const waniwaniConfig = meta.waniwani as Record<string, unknown>;
		expect(waniwaniConfig.endpoint).toBe(
			"https://test.waniwani.ai/api/mcp/events/v2/batch",
		);
	});

	test("does not double-wrap across two withWaniwani() calls", async () => {
		const mockA = mockClient();
		const mockB = mockClient();
		const mock = mockServer();

		mock.registerTool("pricing", { description: "Get pricing" }, async () => ({
			text: "done",
		}));

		withWaniwani(mock.server, { client: mockA.client });
		// Second call is a no-op due to `__waniwaniWrapped`
		withWaniwani(mock.server, { client: mockB.client });

		const handler = mock._registeredTools.pricing?.handler;
		await handler?.({}, {});

		// Only the first wrap's client tracked the event; no double emission
		expect(mockA.tracked).toHaveLength(1);
		expect(mockB.tracked).toHaveLength(0);
	});

	test("wraps tools registered both before and after withWaniwani()", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		mock.registerTool("before", { description: "Before" }, async () => ({
			text: "before-result",
		}));

		withWaniwani(mock.server, { client });

		mock.registerTool("after", { description: "After" }, async () => ({
			text: "after-result",
		}));

		const beforeHandler = mock._registeredTools.before?.handler;
		const afterHandler = mock._registeredTools.after?.handler;

		await beforeHandler?.({}, {});
		await afterHandler?.({}, {});

		expect(tracked).toHaveLength(2);
		const names = tracked.map((t) => (t.properties as { name: string }).name);
		expect(names).toContain("before");
		expect(names).toContain("after");
	});

	test("forwards widget metadata from tool definition into tool result", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		// Register a widget tool the way skybridge does — widget metadata lives
		// on the tool definition _meta, the handler itself returns nothing widget-y.
		mock.registerTool(
			"magic-8-ball",
			{
				description: "For fortune-telling",
				_meta: {
					"openai/outputTemplate": "ui://widgets/apps-sdk/magic-8-ball.html",
					"ui/resourceUri": "ui://widgets/ext-apps/magic-8-ball.html",
					ui: {
						resourceUri: "ui://widgets/ext-apps/magic-8-ball.html",
					},
				},
			},
			async () => ({
				structuredContent: { answer: "It is certain" },
				content: [],
				isError: false,
			}),
		);

		const handler = mock._registeredTools["magic-8-ball"]?.handler;
		const result = (await handler?.({}, {})) as Record<string, unknown>;

		const meta = result._meta as Record<string, unknown>;
		expect(meta["openai/outputTemplate"]).toBe(
			"ui://widgets/apps-sdk/magic-8-ball.html",
		);
		expect(meta["ui/resourceUri"]).toBe(
			"ui://widgets/ext-apps/magic-8-ball.html",
		);
		expect(meta.ui).toEqual({
			resourceUri: "ui://widgets/ext-apps/magic-8-ball.html",
		});
	});

	test("forwards widget metadata for tools registered before withWaniwani()", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		// Register first (skybridge-style, with definition _meta) then wrap.
		mock.registerTool(
			"magic-8-ball",
			{
				description: "For fortune-telling",
				_meta: {
					"ui/resourceUri": "ui://widgets/ext-apps/magic-8-ball.html",
					ui: {
						resourceUri: "ui://widgets/ext-apps/magic-8-ball.html",
					},
				},
			},
			async () => ({
				structuredContent: { answer: "It is certain" },
				content: [],
				isError: false,
			}),
		);

		withWaniwani(mock.server, { client });

		const handler = mock._registeredTools["magic-8-ball"]?.handler;
		const result = (await handler?.({}, {})) as Record<string, unknown>;

		const meta = result._meta as Record<string, unknown>;
		expect(meta["ui/resourceUri"]).toBe(
			"ui://widgets/ext-apps/magic-8-ball.html",
		);
		expect(meta.ui).toEqual({
			resourceUri: "ui://widgets/ext-apps/magic-8-ball.html",
		});
	});

	test("handler-set widget metadata wins over tool definition", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		mock.registerTool(
			"magic-8-ball",
			{
				description: "For fortune-telling",
				_meta: {
					"ui/resourceUri": "ui://widgets/ext-apps/from-definition.html",
					ui: {
						resourceUri: "ui://widgets/ext-apps/from-definition.html",
					},
				},
			},
			async () => ({
				structuredContent: { answer: "Ask again later" },
				content: [],
				isError: false,
				_meta: {
					"ui/resourceUri": "ui://widgets/ext-apps/from-handler.html",
					ui: {
						resourceUri: "ui://widgets/ext-apps/from-handler.html",
					},
				},
			}),
		);

		const handler = mock.registered[0]?.[2];
		const result = (await handler?.({}, {})) as Record<string, unknown>;

		const meta = result._meta as Record<string, unknown>;
		expect(meta["ui/resourceUri"]).toBe(
			"ui://widgets/ext-apps/from-handler.html",
		);
		expect(meta.ui).toEqual({
			resourceUri: "ui://widgets/ext-apps/from-handler.html",
		});
	});

	test("bridges extra.sessionId into _meta when host provides no session ID", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		mock.registerTool("search", { description: "Search" }, async () => ({
			text: "ok",
		}));

		const handler = mock.registered[0]?.[2];
		const result = (await handler?.(
			{},
			{ sessionId: "transport-sid-123" },
		)) as Record<string, unknown>;

		// Session ID should appear in tracked event meta
		expect(tracked[0]?.meta).toMatchObject({
			"waniwani/sessionId": "transport-sid-123",
		});

		// Session ID should be injected into result _meta
		const meta = result._meta as Record<string, unknown>;
		expect(meta["waniwani/sessionId"]).toBe("transport-sid-123");
	});

	test("bridges mcp-session-id header into _meta when host provides no session ID", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		mock.registerTool("search", { description: "Search" }, async () => ({
			text: "ok",
		}));

		const handler = mock.registered[0]?.[2];
		await handler?.(
			{},
			{
				requestInfo: {
					headers: { "mcp-session-id": "header-sid-456" },
				},
			},
		);

		expect(tracked[0]?.meta).toMatchObject({
			"waniwani/sessionId": "header-sid-456",
		});
	});

	test("does not override existing _meta session ID with transport session ID", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client });

		mock.registerTool("search", { description: "Search" }, async () => ({
			text: "ok",
		}));

		const handler = mock.registered[0]?.[2];
		await handler?.(
			{},
			{
				sessionId: "transport-sid",
				_meta: { "openai/sessionId": "host-sid" },
			},
		);

		// Host-provided session ID takes precedence
		expect(tracked[0]?.meta).toMatchObject({
			"openai/sessionId": "host-sid",
		});
		expect(
			(tracked[0]?.meta as Record<string, unknown>)["waniwani/sessionId"],
		).toBe(undefined);
	});

	test("does not touch _meta when the tool definition has no widget keys", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, { client, injectWidgetToken: false });

		mock.registerTool(
			"plain-tool",
			{
				description: "No widget",
				_meta: { "waniwani/internalFlag": true },
			},
			async () => ({
				content: [{ type: "text", text: "ok" }],
				isError: false,
			}),
		);

		const handler = mock.registered[0]?.[2];
		const result = (await handler?.({}, {})) as Record<string, unknown>;

		const meta = result._meta as Record<string, unknown> | undefined;
		expect(meta?.["openai/outputTemplate"]).toBe(undefined);
		expect(meta?.["ui/resourceUri"]).toBe(undefined);
		expect(meta?.ui).toBe(undefined);
	});

	test("injects request metadata even when widget token injection is disabled", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		withWaniwani(mock.server, {
			client,
			injectWidgetToken: false,
		});

		mock.registerTool("search", { description: "Search" }, async () => ({
			text: "ok",
		}));

		const handler = mock.registered[0]?.[2];
		const result = (await handler?.(
			{},
			{
				_meta: {
					"waniwani/sessionId": "session-1",
					"waniwani/geoLocation": {
						country: "SK",
					},
				},
			},
		)) as Record<string, unknown>;
		const meta = result._meta as Record<string, unknown>;

		expect(meta["waniwani/sessionId"]).toBe("session-1");
		expect(meta["waniwani/geoLocation"]).toEqual({
			country: "SK",
		});
		expect(meta["waniwani/userLocation"]).toEqual({
			country: "SK",
		});
		expect(meta.waniwani).toBe(undefined);
	});
});
