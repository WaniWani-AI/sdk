import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { withWaniwani } from "../index.js";
import {
	buildIntentDescription,
	createIntentCapture,
	stripIntentArgument,
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

describe("intent capture helpers", () => {
	test("describes the field, and only mentions PII when asked", () => {
		expect(buildIntentDescription(false)).toContain("user's goal");
		expect(buildIntentDescription(false)).not.toContain("PII");
		expect(buildIntentDescription(true)).toContain("PII");
	});

	test("augments a raw shape, a Zod object, and a missing schema alike", () => {
		const { augment } = capture(true);

		expect(Object.keys(shapeOf(augment({ city: z.string() }))).sort()).toEqual([
			"city",
			"intent",
		]);
		expect(
			Object.keys(shapeOf(augment(z.object({ city: z.string() })))).sort(),
		).toEqual(["city", "intent"]);
		expect(Object.keys(shapeOf(augment(undefined)))).toEqual(["intent"]);
	});

	test("leaves a tool that already declares the argument untouched", () => {
		const { augment } = capture({ argumentName: "goal" });

		expect(augment({ goal: z.string() })).toBeUndefined();
		expect(augment(z.object({ goal: z.string() }))).toBeUndefined();
	});

	test("leaves a schema it cannot extend untouched", () => {
		const union = z.union([
			z.object({ a: z.string() }),
			z.object({ b: z.string() }),
		]);
		expect(capture(true).augment(union)).toBeUndefined();
	});

	test("returns null only when capture is switched off", () => {
		expect(createIntentCapture(false)).toBeNull();
		expect(createIntentCapture(undefined)).not.toBeNull();
		expect(createIntentCapture(true)?.argumentName).toBe("intent");
		expect(createIntentCapture({ argumentName: "goal" })?.argumentName).toBe(
			"goal",
		);
	});

	test("strips the argument without copying when it is absent", () => {
		const input = { city: "Paris" };
		expect(stripIntentArgument(input, "intent")).toBe(input);
		expect(
			stripIntentArgument({ city: "Paris", intent: "book" }, "intent"),
		).toEqual({ city: "Paris" });
	});
});

describe("withWaniwani captureIntent", () => {
	// `captureIntent: true` and an omitted option must behave alike — capture is
	// on by default.
	for (const [label, captureIntent] of [
		["explicitly on", true],
		["on by default", undefined],
	] as const) {
		test(`adds the argument to tools registered after wrapping (${label})`, async () => {
			const { client } = mockClient();
			const mock = mockServer();

			await withWaniwani(mock.server, { client, captureIntent });

			mock.registerTool(
				"pricing",
				{ description: "Get pricing", inputSchema: { plan: z.string() } },
				async () => ({ text: "ok" }),
			);

			const shape = shapeOf(mock.configs.pricing?.inputSchema);
			expect(Object.keys(shape).sort()).toEqual(["intent", "plan"]);
		});
	}

	test("adds the argument to tools registered before wrapping", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		mock.registerTool(
			"pricing",
			{ description: "Get pricing", inputSchema: { plan: z.string() } },
			async () => ({ text: "ok" }),
		);

		await withWaniwani(mock.server, { client, captureIntent: true });

		const shape = shapeOf(mock._registeredTools.pricing?.inputSchema);
		expect(Object.keys(shape).sort()).toEqual(["intent", "plan"]);
	});

	test("tracks the intent but keeps it out of the tool's own input", async () => {
		const { client, tracked } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client, captureIntent: true });

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
			{ plan: "pro", intent: "compare plans before upgrading" },
			{ _meta: {} },
		);

		expect(seen).toEqual({ plan: "pro" });
		expect(tracked[0]).toMatchObject({
			event: "tool.called",
			properties: {
				name: "pricing",
				input: { plan: "pro", intent: "compare plans before upgrading" },
			},
		});
	});

	test("does not double-inject on a tool that already declares intent", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client, captureIntent: true });

		let seen: unknown;
		const declared = { action: z.string(), intent: z.string().optional() };
		mock.registerTool("flow", { inputSchema: declared }, async (input) => {
			seen = input;
			return { text: "ok" };
		});

		// Same object identity: the config was passed through untouched.
		expect(mock.configs.flow?.inputSchema).toBe(declared);

		// A flow tool reads its own `intent`, so it must still arrive.
		await mock._registeredTools.flow?.handler(
			{ action: "start", intent: "get a quote" },
			{ _meta: {} },
		);
		expect(seen).toEqual({ action: "start", intent: "get a quote" });
	});

	test("honours the tools allow-list and a renamed argument", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, {
			client,
			captureIntent: { tools: ["pricing"], argumentName: "goal" },
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

		expect(
			Object.keys(shapeOf(mock.configs.pricing?.inputSchema)).sort(),
		).toEqual(["goal", "plan"]);
		// Outside the allow-list the raw shape is passed through as declared.
		expect(
			Object.keys(mock.configs.health?.inputSchema as Record<string, unknown>),
		).toEqual(["deep"]);
	});

	test("leaves every schema alone when captureIntent is false", async () => {
		const { client } = mockClient();
		const mock = mockServer();

		await withWaniwani(mock.server, { client, captureIntent: false });

		const declared = { plan: z.string() };
		mock.registerTool("pricing", { inputSchema: declared }, async () => ({}));

		expect(mock.configs.pricing?.inputSchema).toBe(declared);
	});
});
