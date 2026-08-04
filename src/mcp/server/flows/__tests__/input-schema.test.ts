import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { FlowTokenContent, McpServer } from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";

class TestFlowStateStore {
	private readonly map = new Map<string, FlowTokenContent>();
	async get(key: string): Promise<FlowTokenContent | null> {
		return this.map.get(key) ?? null;
	}
	async set(key: string, value: FlowTokenContent): Promise<void> {
		this.map.set(key, value);
	}
	async delete(key: string): Promise<void> {
		this.map.delete(key);
	}
}

type RegisterToolArgs = [
	string,
	{ inputSchema: Record<string, z.ZodTypeAny> },
	unknown,
];

function registeredSchema(): Record<string, z.ZodTypeAny> {
	const registered: RegisterToolArgs[] = [];
	const server = {
		registerTool: (...args: unknown[]) => {
			registered.push(args as RegisterToolArgs);
		},
	};
	const flow = createFlow({
		id: "schema_probe",
		title: "Schema probe",
		description: "d",
		state: { color: z.string().optional() },
	})
		.addNode("ask_color", ({ interrupt }) =>
			interrupt({ color: { question: "Favorite color?" } }),
		)
		.addEdge(START, "ask_color")
		.addEdge("ask_color", END)
		.compile({ store: new TestFlowStateStore() });
	void flow.register(server as unknown as McpServer);
	const schema = registered[0]?.[1]?.inputSchema;
	if (!schema) {
		throw new Error("flow did not register an input schema");
	}
	return schema;
}

describe("generated flow tool input schema", () => {
	test("stateUpdates precedes intent and context", () => {
		expect(Object.keys(registeredSchema())).toEqual([
			"action",
			"stateUpdates",
			"intent",
			"context",
			"sessionId",
		]);
	});

	test("stateUpdates description demands extraction with the {} escape hatch", () => {
		const description = registeredSchema().stateUpdates?.description ?? "";
		expect(description).toContain("REQUIRED on every call ({} is valid)");
		expect(description).toContain("The only channel that fills flow fields");
		expect(description).toContain(
			"each answer it contains MUST be extracted here or the flow will re-ask it",
		);
		expect(description).toContain("Pass {} when it answers none");
		expect(description).toContain("never infer or derive");
	});

	test("intent description states the engine never reads it", () => {
		const description = registeredSchema().intent?.description ?? "";
		expect(description).toContain("The flow engine never reads intent");
		expect(description).toContain(
			"every concrete answer must also go in stateUpdates",
		);
	});

	test("stateUpdates stays optional in the Zod schema (no new error paths)", () => {
		expect(registeredSchema().stateUpdates?.isOptional()).toBe(true);
	});

	test("action description scopes start to a not-yet-started flow", () => {
		const description = registeredSchema().action?.description ?? "";
		expect(description).toContain(
			"only if this flow has not already been started",
		);
	});
});
