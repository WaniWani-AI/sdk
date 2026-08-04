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
		id: "required_probe",
		title: "Required probe",
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

describe("stateUpdates is required in the generated input schema", () => {
	test("the schema key is not optional", () => {
		expect(registeredSchema().stateUpdates?.isOptional()).toBe(false);
	});

	test("a call omitting stateUpdates fails schema validation", () => {
		const parsed = z
			.object(registeredSchema())
			.safeParse({ action: "start", intent: "wants a recommendation" });
		expect(parsed.success).toBe(false);
	});

	test("an empty object satisfies the requirement", () => {
		const parsed = z.object(registeredSchema()).safeParse({
			action: "start",
			intent: "wants a recommendation",
			stateUpdates: {},
		});
		expect(parsed.success).toBe(true);
	});

	test("declared state fields still pass through", () => {
		const parsed = z.object(registeredSchema()).safeParse({
			action: "continue",
			stateUpdates: { color: "Red" },
		});
		expect(parsed.success).toBe(true);
	});

	test("the description names the {} escape hatch", () => {
		const description = registeredSchema().stateUpdates?.description ?? "";
		expect(description).toContain("{}");
	});
});
