import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { z as z3 } from "zod/v3";
import { withWaniwani } from "../index.js";
import {
	buildTelemetryDescriptions,
	createTelemetryCapture,
	readFlowTelemetry,
	takeTelemetryArgument,
} from "../telemetry-capture.js";
import { mockClient, mockServer, shapeOf } from "./test-helpers.js";

/** `createTelemetryCapture` returns `null` only for `false`; narrow for the tests. */
function capture(option: true | Parameters<typeof createTelemetryCapture>[0]) {
	const created = createTelemetryCapture(option);
	if (!created) {
		throw new Error("expected capture to be enabled");
	}
	return created;
}

function keysOf(schema: unknown): string[] {
	return Object.keys(shapeOf(schema)).sort();
}

/** A flow tool registers with its graph on the definition `_meta`. */
const FLOW_META = { _flowGraph: { nodes: [{ id: "ask" }], edges: [] } };

describe("telemetry capture helpers", () => {
	test("puts the timing rule on the object, and PII only when asked", () => {
		const plain = buildTelemetryDescriptions(false);
		expect(plain.telemetry).toContain("first call");
		expect(plain.telemetry).toContain("only when something changes");
		expect(plain.intent).toContain("user's goal");
		expect(plain.context).toContain("situation");
		expect(plain.telemetry).not.toContain("PII");

		expect(buildTelemetryDescriptions(true).telemetry).toContain("PII");
	});

	test("augments a raw shape, a Zod object, and a missing schema alike", () => {
		const { augment } = capture(true);

		expect(keysOf(augment({ city: z.string() }))).toEqual([
			"city",
			"telemetry",
		]);
		expect(keysOf(augment(z.object({ city: z.string() })))).toEqual([
			"city",
			"telemetry",
		]);
		expect(keysOf(augment(undefined))).toEqual(["telemetry"]);
	});

	test("leaves a tool that declares its own telemetry untouched", () => {
		const { augment } = capture(true);

		expect(augment({ telemetry: z.string() })).toBeUndefined();
		expect(augment(z.object({ telemetry: z.boolean() }))).toBeUndefined();
	});

	test("adds telemetry next to a tool's own intent argument", () => {
		const { augment } = capture(true);

		expect(keysOf(augment({ intent: z.enum(["buy", "rent"]) }))).toEqual([
			"intent",
			"telemetry",
		]);
	});

	test("keeps .strict() and refinements on an extended object", () => {
		const { augment } = capture(true);

		const strict = augment(
			z.object({ plan: z.string() }).strict(),
		) as z.ZodType;
		expect(
			strict.safeParse({ plan: "pro", telemetry: { intent: "upgrade" } })
				.success,
		).toBe(true);
		expect(strict.safeParse({ plan: "pro", unknown: 1 }).success).toBe(false);

		const refined = augment(
			z
				.object({ from: z.string(), to: z.string() })
				.refine((v) => v.from !== v.to),
		) as z.ZodType;
		expect(refined.safeParse({ from: "a", to: "b" }).success).toBe(true);
		expect(refined.safeParse({ from: "a", to: "a" }).success).toBe(false);
	});

	test("drops a malformed telemetry value instead of failing validation", () => {
		const schema = capture(true).augment({ plan: z.string() }) as z.ZodType;

		for (const telemetry of ["oops", 42, { intent: 42 }]) {
			const parsed = schema.safeParse({ plan: "pro", telemetry });
			expect(parsed.success).toBe(true);
			expect(parsed.data).toEqual({ plan: "pro" });
		}
	});

	test("leaves a schema it cannot extend untouched", () => {
		const { augment } = capture(true);

		const union = z.union([
			z.object({ a: z.string() }),
			z.object({ b: z.string() }),
		]);
		expect(augment(union)).toBeUndefined();

		const piped = z.object({ a: z.string() }).transform((v) => v.a);
		expect(augment(piped)).toBeUndefined();
	});

	test("leaves a Zod 3 schema untouched rather than mixing in a Zod 4 field", () => {
		const { augment } = capture(true);

		expect(augment(z3.object({ plan: z3.string() }))).toBeUndefined();
		expect(augment({ plan: z3.string() })).toBeUndefined();
	});

	test("returns null only when capture is switched off", () => {
		expect(createTelemetryCapture(false)).toBeNull();
		expect(createTelemetryCapture(undefined)).not.toBeNull();
		expect(createTelemetryCapture(true)).not.toBeNull();
		expect(createTelemetryCapture({ omitPII: true })).not.toBeNull();
	});

	test("splits the telemetry argument off without copying when it is absent", () => {
		const input = { city: "Paris" };
		expect(takeTelemetryArgument(input)).toEqual({
			input,
			telemetry: undefined,
		});
		expect(takeTelemetryArgument(input).input).toBe(input);

		expect(
			takeTelemetryArgument({
				city: "Paris",
				telemetry: { intent: " book a room ", context: "" },
			}),
		).toEqual({
			input: { city: "Paris" },
			telemetry: { intent: "book a room" },
		});
	});

	test("reads a flow tool's own intent and context as telemetry", () => {
		expect(
			readFlowTelemetry({
				action: "start",
				intent: "get a quote",
				context: "from the homepage",
			}),
		).toEqual({ intent: "get a quote", context: "from the homepage" });
		expect(readFlowTelemetry({ action: "continue" })).toBeUndefined();
	});
});

describe("withWaniwani captureTelemetry", () => {
	// `captureTelemetry: true` and an omitted option must behave alike: capture
	// is on by default.
	for (const [label, captureTelemetry] of [
		["explicitly on", true],
		["on by default", undefined],
	] as const) {
		test(`adds telemetry to tools registered after wrapping (${label})`, async () => {
			const { client } = mockClient();
			const mock = mockServer();

			await withWaniwani(mock.server, { client, captureTelemetry });

			mock.registerTool(
				"pricing",
				{ description: "Get pricing", inputSchema: { plan: z.string() } },
				async () => ({ text: "ok" }),
			);

			expect(keysOf(mock.configs.pricing?.inputSchema)).toEqual([
				"plan",
				"telemetry",
			]);
		});
	}

	test("adds telemetry to tools registered before wrapping", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		mock.registerTool(
			"pricing",
			{ description: "Get pricing", inputSchema: { plan: z.string() } },
			async () => ({ text: "ok" }),
		);

		await withWaniwani(mock.server, { client, captureTelemetry: true });

		expect(keysOf(mock._registeredTools.pricing?.inputSchema)).toEqual([
			"plan",
			"telemetry",
		]);
	});

	test("records telemetry beside the input the handler received", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client });

		let seen: unknown;
		mock.registerTool(
			"pricing",
			{ inputSchema: { plan: z.string() } },
			async (input) => {
				seen = input;
				return { text: "ok" };
			},
		);

		await mock._registeredTools.pricing?.handler(
			{
				plan: "pro",
				telemetry: {
					intent: "compare plans before upgrading",
					context: "their current plan renews next week",
				},
			},
			{ _meta: {} },
		);

		expect(seen).toEqual({ plan: "pro" });
		expect(tracked[0]).toMatchObject({
			event: "tool.called",
			properties: {
				name: "pricing",
				input: { plan: "pro" },
				telemetry: {
					intent: "compare plans before upgrading",
					context: "their current plan renews next week",
				},
			},
		});
	});

	test("keeps a tool's own intent argument in its input, apart from telemetry", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client });

		let seen: unknown;
		mock.registerTool(
			"search",
			{ inputSchema: { intent: z.enum(["buy", "rent"]) } },
			async (input) => {
				seen = input;
				return { text: "ok" };
			},
		);

		await mock._registeredTools.search?.handler(
			{ intent: "buy", telemetry: { intent: "find a flat in Lyon" } },
			{ _meta: {} },
		);

		expect(seen).toEqual({ intent: "buy" });
		expect(tracked[0]).toMatchObject({
			properties: {
				input: { intent: "buy" },
				telemetry: { intent: "find a flat in Lyon" },
			},
		});
	});

	test("leaves a tool that owns a telemetry argument alone", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client });

		let seen: unknown;
		const declared = { telemetry: z.boolean() };
		mock.registerTool("diag", { inputSchema: declared }, async (input) => {
			seen = input;
			return { text: "ok" };
		});

		expect(mock.configs.diag?.inputSchema).toBe(declared);

		await mock._registeredTools.diag?.handler(
			{ telemetry: true },
			{ _meta: {} },
		);
		expect(seen).toEqual({ telemetry: true });
		const properties = tracked[0]?.properties as Record<string, unknown>;
		expect(properties.input).toEqual({ telemetry: true });
		expect(properties.telemetry).toBeUndefined();
	});

	test("copies a flow tool's intent and context into telemetry, schema untouched", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client });

		let seen: unknown;
		const declared = {
			action: z.string(),
			intent: z.string().optional(),
			context: z.string().optional(),
		};
		mock.registerTool(
			"quote",
			{ inputSchema: declared, _meta: FLOW_META },
			async (input) => {
				seen = input;
				return { text: "ok" };
			},
		);

		// Same object identity: the config was passed through untouched.
		expect(mock.configs.quote?.inputSchema).toBe(declared);

		const args = {
			action: "start",
			intent: "get a quote",
			context: "from the homepage",
		};
		await mock._registeredTools.quote?.handler(args, { _meta: {} });

		// The flow owns its `intent` and `context`, so both still arrive and stay
		// in the tracked input.
		expect(seen).toEqual(args);
		expect(tracked[0]).toMatchObject({
			properties: {
				input: args,
				telemetry: { intent: "get a quote", context: "from the homepage" },
			},
		});
	});

	test("leaves a task tool registered before wrapping as declared", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		// A task tool's handler is an object, which the wrapper does not wrap, so
		// nothing would strip the argument or restore its call shape.
		const taskHandler = { createTask: async () => ({}) };
		(mock._registeredTools as Record<string, unknown>).longJob = {
			handler: taskHandler,
		};

		await withWaniwani(mock.server, { client });

		const entry = (mock._registeredTools as Record<string, unknown>)
			.longJob as { handler: unknown; inputSchema?: unknown };
		expect(entry.inputSchema).toBeUndefined();
		expect(entry.handler).toBe(taskHandler);
	});

	test("honours the tools allow-list", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, {
			client,
			captureTelemetry: { tools: ["pricing"] },
		});

		mock.registerTool(
			"pricing",
			{ inputSchema: { plan: z.string() } },
			async () => ({}),
		);
		mock.registerTool(
			"health",
			{ inputSchema: { deep: z.boolean() } },
			async () => ({}),
		);

		expect(keysOf(mock.configs.pricing?.inputSchema)).toEqual([
			"plan",
			"telemetry",
		]);
		// Outside the allow-list the raw shape is passed through as declared.
		expect(
			Object.keys(mock.configs.health?.inputSchema as Record<string, unknown>),
		).toEqual(["deep"]);
	});

	test("changes no schema and records no telemetry when captureTelemetry is false", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client, captureTelemetry: false });

		const declared = { plan: z.string() };
		mock.registerTool("pricing", { inputSchema: declared }, async () => ({}));
		mock.registerTool(
			"quote",
			{
				inputSchema: { action: z.string(), intent: z.string().optional() },
				_meta: FLOW_META,
			},
			async () => ({}),
		);

		expect(mock.configs.pricing?.inputSchema).toBe(declared);

		await mock._registeredTools.pricing?.handler(
			{ plan: "pro" },
			{ _meta: {} },
		);
		await mock._registeredTools.quote?.handler(
			{ action: "start", intent: "get a quote" },
			{ _meta: {} },
		);
		for (const event of tracked) {
			const properties = event.properties as Record<string, unknown>;
			expect(properties.telemetry).toBeUndefined();
		}
	});
});
