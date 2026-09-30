import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { z as z3 } from "zod/v3";
import { withWaniwani } from "../index.js";
import {
	buildCaptureDescriptions,
	createIntentCapture,
	stripCapturedFields,
} from "../intent-capture.js";
import { mockClient, mockServer, shapeOf } from "./test-helpers.js";

/** `createIntentCapture` returns `null` only for `false`; narrow for the tests. */
function capture(option: true | Parameters<typeof createIntentCapture>[0]) {
	const created = createIntentCapture(option);
	if (!created) {
		throw new Error("expected capture to be enabled");
	}
	return created;
}

function keysOf(schema: unknown): string[] {
	return Object.keys(shapeOf(schema)).sort();
}

describe("intent capture helpers", () => {
	test("describes both fields, and only mentions PII when asked", () => {
		const plain = buildCaptureDescriptions(false);
		expect(plain.intent).toContain("user's goal");
		expect(plain.context).toContain("situation");
		expect(plain.intent).not.toContain("PII");
		expect(plain.context).not.toContain("PII");

		const guarded = buildCaptureDescriptions(true);
		expect(guarded.intent).toContain("PII");
		expect(guarded.context).toContain("PII");
	});

	test("asks for the fields once, not on every call", () => {
		const { intent, context } = buildCaptureDescriptions(false);
		expect(intent).toContain("first call");
		expect(intent).toContain("only when the goal changes");
		expect(context).toContain("only when it changes");
	});

	test("augments a raw shape, a Zod object, and a missing schema alike", () => {
		const { augment } = capture(true);

		const fromShape = augment({ city: z.string() });
		expect(keysOf(fromShape?.schema)).toEqual(["city", "context", "intent"]);
		expect(fromShape?.fields).toEqual(["intent", "context"]);

		const fromObject = augment(z.object({ city: z.string() }));
		expect(keysOf(fromObject?.schema)).toEqual(["city", "context", "intent"]);

		const fromNothing = augment(undefined);
		expect(keysOf(fromNothing?.schema)).toEqual(["context", "intent"]);
	});

	test("adds only the field a tool does not already declare", () => {
		const { augment } = capture(true);

		const ownIntent = augment({ intent: z.string(), city: z.string() });
		expect(ownIntent?.fields).toEqual(["context"]);
		expect(keysOf(ownIntent?.schema)).toEqual(["city", "context", "intent"]);

		const ownContext = augment(z.object({ context: z.string() }));
		expect(ownContext?.fields).toEqual(["intent"]);
	});

	test("leaves a tool that declares both fields untouched", () => {
		const { augment } = capture(true);

		expect(
			augment({
				intent: z.string().optional(),
				context: z.string().optional(),
			}),
		).toBeUndefined();
		expect(
			augment(z.object({ intent: z.string(), context: z.string() })),
		).toBeUndefined();
	});

	test("keeps .strict() and refinements on an extended object", () => {
		const { augment } = capture(true);

		const strict = augment(z.object({ plan: z.string() }).strict())
			?.schema as z.ZodType;
		expect(strict.safeParse({ plan: "pro", intent: "upgrade" }).success).toBe(
			true,
		);
		expect(strict.safeParse({ plan: "pro", unknown: 1 }).success).toBe(false);

		const refined = augment(
			z
				.object({ from: z.string(), to: z.string() })
				.refine((v) => v.from !== v.to),
		)?.schema as z.ZodType;
		expect(refined.safeParse({ from: "a", to: "b", intent: "x" }).success).toBe(
			true,
		);
		expect(refined.safeParse({ from: "a", to: "a" }).success).toBe(false);
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
		expect(createIntentCapture(false)).toBeNull();
		expect(createIntentCapture(undefined)).not.toBeNull();
		expect(createIntentCapture(true)).not.toBeNull();
		expect(createIntentCapture({ omitPII: true })).not.toBeNull();
	});

	test("strips the fields without copying when none is present", () => {
		const input = { city: "Paris" };
		expect(stripCapturedFields(input, ["intent", "context"])).toBe(input);
		expect(
			stripCapturedFields(
				{ city: "Paris", intent: "book", context: "on the pricing page" },
				["intent", "context"],
			),
		).toEqual({ city: "Paris" });
		// Only the fields named are ours; a tool's own `intent` stays.
		expect(
			stripCapturedFields({ intent: "own", context: "ours" }, ["context"]),
		).toEqual({ intent: "own" });
	});
});

describe("withWaniwani captureIntent", () => {
	// `captureIntent: true` and an omitted option must behave alike: capture is
	// on by default.
	for (const [label, captureIntent] of [
		["explicitly on", true],
		["on by default", undefined],
	] as const) {
		test(`adds the fields to tools registered after wrapping (${label})`, async () => {
			const { client } = mockClient();
			const mock = mockServer();

			await withWaniwani(mock.server, { client, captureIntent });

			mock.registerTool(
				"pricing",
				{ description: "Get pricing", inputSchema: { plan: z.string() } },
				async () => ({ text: "ok" }),
			);

			expect(keysOf(mock.configs.pricing?.inputSchema)).toEqual([
				"context",
				"intent",
				"plan",
			]);
		});
	}

	test("adds the fields to tools registered before wrapping", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		mock.registerTool(
			"pricing",
			{ description: "Get pricing", inputSchema: { plan: z.string() } },
			async () => ({ text: "ok" }),
		);

		await withWaniwani(mock.server, { client, captureIntent: true });

		expect(keysOf(mock._registeredTools.pricing?.inputSchema)).toEqual([
			"context",
			"intent",
			"plan",
		]);
	});

	test("tracks both fields but keeps them out of the tool's own input", async () => {
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
				intent: "compare plans before upgrading",
				context: "their current plan renews next week",
			},
			{ _meta: {} },
		);

		expect(seen).toEqual({ plan: "pro" });
		expect(tracked[0]).toMatchObject({
			event: "tool.called",
			properties: {
				name: "pricing",
				input: {
					plan: "pro",
					intent: "compare plans before upgrading",
					context: "their current plan renews next week",
				},
				injectedInputFields: ["intent", "context"],
			},
		});
	});

	test("passes a tool's own intent through and marks only what it added", async () => {
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
			{ intent: "buy", context: "browsing listings in Lyon" },
			{ _meta: {} },
		);

		expect(seen).toEqual({ intent: "buy" });
		expect(tracked[0]).toMatchObject({
			properties: {
				input: { intent: "buy", context: "browsing listings in Lyon" },
				injectedInputFields: ["context"],
			},
		});
	});

	test("does not touch a tool that declares both fields, like a flow tool", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client });

		let seen: unknown;
		const declared = {
			action: z.string(),
			intent: z.string().optional(),
			context: z.string().optional(),
		};
		mock.registerTool("flow", { inputSchema: declared }, async (input) => {
			seen = input;
			return { text: "ok" };
		});

		// Same object identity: the config was passed through untouched.
		expect(mock.configs.flow?.inputSchema).toBe(declared);

		// A flow tool owns its `intent` and `context`, so both must still arrive.
		await mock._registeredTools.flow?.handler(
			{ action: "start", intent: "get a quote", context: "from the homepage" },
			{ _meta: {} },
		);
		expect(seen).toEqual({
			action: "start",
			intent: "get a quote",
			context: "from the homepage",
		});
		const properties = tracked[0]?.properties as Record<string, unknown>;
		expect(properties.injectedInputFields).toBeUndefined();
	});

	test("leaves a task tool registered before wrapping as declared", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		// A task tool's handler is an object, which the wrapper does not wrap, so
		// nothing would strip the fields or restore its call shape.
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
			captureIntent: { tools: ["pricing"] },
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
			"context",
			"intent",
			"plan",
		]);
		// Outside the allow-list the raw shape is passed through as declared.
		expect(
			Object.keys(mock.configs.health?.inputSchema as Record<string, unknown>),
		).toEqual(["deep"]);
	});

	test("leaves every schema alone when captureIntent is false", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client, captureIntent: false });

		const declared = { plan: z.string() };
		mock.registerTool("pricing", { inputSchema: declared }, async () => ({}));

		expect(mock.configs.pricing?.inputSchema).toBe(declared);

		await mock._registeredTools.pricing?.handler(
			{ plan: "pro" },
			{ _meta: {} },
		);
		const properties = tracked[0]?.properties as Record<string, unknown>;
		expect(properties.injectedInputFields).toBeUndefined();
	});
});
