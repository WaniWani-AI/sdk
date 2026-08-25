import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { SUGGESTIONS_META_KEY } from "../../utils";
import type {
	FlowTokenContent,
	McpServer,
	RegisteredFlow,
	RegisteredTool,
} from "../@types";
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

const mockPlanPickerTool: RegisteredTool = {
	id: "plan_picker",
	title: "Plan Picker",
	description: "Show plan picker widget",
	register: async () => {},
};

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
type RegisterToolArgs = [string, Record<string, unknown>, Handler];

const TEST_SESSION_ID = "test-session-suggestions";
const TEST_INTENT = "Qualify the user for this flow.";

function startInput(stateUpdates?: Record<string, unknown>) {
	return {
		action: "start" as const,
		intent: TEST_INTENT,
		...(stateUpdates ? { stateUpdates } : {}),
	};
}

function mockServer() {
	const registered: RegisterToolArgs[] = [];
	const server = {
		registerTool: (...args: unknown[]) => {
			registered.push(args as RegisterToolArgs);
		},
	};
	return { server: server as unknown as McpServer, registered };
}

/** Register a compiled flow and run one `start` call, returning the raw result. */
async function runStart(
	flow: RegisteredFlow,
	stateUpdates?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const mock = mockServer();
	await flow.register(mock.server);
	const handler = mock.registered[0]?.[2];
	// A fresh `_meta` object per call — `compile.ts` mutates it in place, and a
	// shared object here would leak one test's suggestions into the next.
	return (await handler?.(startInput(stateUpdates), {
		_meta: { sessionId: TEST_SESSION_ID },
	})) as Record<string, unknown>;
}

function metaOf(result: Record<string, unknown>): Record<string, unknown> {
	return (result._meta ?? {}) as Record<string, unknown>;
}

describe("flow result _meta suggestions", () => {
	test("emits the key for a single open question with suggestions", async () => {
		const flow = createFlow({
			id: "single_question_flow",
			title: "Single question",
			description: "Asks one question",
			state: {
				plan: z.enum(["Bronze", "Silver", "Gold"]).describe("Chosen plan"),
			},
		})
			.addNode({
				id: "ask_plan",
				label: "Ask plan",
				run: ({ interrupt }) =>
					interrupt({
						plan: {
							question: "Which plan fits you?",
							suggestions: ["Bronze", "Silver", "Gold"],
						},
					}),
			})
			.addEdge(START, "ask_plan")
			.addEdge("ask_plan", END)
			.compile({ store: new TestFlowStateStore() });

		const result = await runStart(flow);

		expect(metaOf(result)[SUGGESTIONS_META_KEY]).toEqual({
			suggestions: ["Bronze", "Silver", "Gold"],
		});
	});

	test("leaves structuredContent unchanged", async () => {
		const flow = createFlow({
			id: "structured_content_flow",
			title: "Structured content",
			description: "Asks one question",
			state: { plan: z.enum(["Bronze", "Gold"]).describe("Chosen plan") },
		})
			.addNode({
				id: "ask_plan",
				label: "Ask plan",
				run: ({ interrupt }) =>
					interrupt({
						plan: {
							question: "Which plan fits you?",
							suggestions: ["Bronze", "Gold"],
						},
					}),
			})
			.addEdge(START, "ask_plan")
			.addEdge("ask_plan", END)
			.compile({ store: new TestFlowStateStore() });

		const result = await runStart(flow);
		const structured = result.structuredContent as Record<string, unknown>;

		expect(structured.status).toBe("interrupt");
		expect(structured.suggestions).toEqual(["Bronze", "Gold"]);
	});

	test("emits an empty array when the single question declares no suggestions", async () => {
		const flow = createFlow({
			id: "no_suggestions_flow",
			title: "No suggestions",
			description: "Asks one open question",
			state: { breed: z.string().describe("Pet breed") },
		})
			.addNode({
				id: "ask_breed",
				label: "Ask breed",
				run: ({ interrupt }) =>
					interrupt({ breed: { question: "What breed is your pet?" } }),
			})
			.addEdge(START, "ask_breed")
			.addEdge("ask_breed", END)
			.compile({ store: new TestFlowStateStore() });

		const result = await runStart(flow);

		expect(metaOf(result)[SUGGESTIONS_META_KEY]).toEqual({ suggestions: [] });
	});

	test("emits an empty array when more than one question is open", async () => {
		const flow = createFlow({
			id: "multi_question_flow",
			title: "Multi question",
			description: "Asks two questions at once",
			state: {
				petName: z.string().describe("Pet name"),
				petType: z.enum(["dog", "cat"]).describe("Pet type"),
			},
		})
			.addNode({
				id: "ask_pet",
				label: "Ask pet",
				run: ({ interrupt }) =>
					interrupt({
						petName: { question: "What's your pet's name?" },
						petType: {
							question: "What type of pet do you have?",
							suggestions: ["dog", "cat"],
						},
					}),
			})
			.addEdge(START, "ask_pet")
			.addEdge("ask_pet", END)
			.compile({ store: new TestFlowStateStore() });

		const result = await runStart(flow);

		expect(metaOf(result)[SUGGESTIONS_META_KEY]).toEqual({ suggestions: [] });
	});

	test("emits the key once a multi-question interrupt has one question left", async () => {
		const flow = createFlow({
			id: "partially_filled_flow",
			title: "Partially filled",
			description: "Asks two questions at once",
			state: {
				petName: z.string().describe("Pet name"),
				petType: z.enum(["dog", "cat"]).describe("Pet type"),
			},
		})
			.addNode({
				id: "ask_pet",
				label: "Ask pet",
				run: ({ interrupt }) =>
					interrupt({
						petName: { question: "What's your pet's name?" },
						petType: {
							question: "What type of pet do you have?",
							suggestions: ["dog", "cat"],
						},
					}),
			})
			.addEdge(START, "ask_pet")
			.addEdge("ask_pet", END)
			.compile({ store: new TestFlowStateStore() });

		// `petName` arrives pre-filled, so only `petType` is still open and the
		// engine collapses to the single-question shorthand.
		const result = await runStart(flow, { petName: "Rex" });

		expect(metaOf(result)[SUGGESTIONS_META_KEY]).toEqual({
			suggestions: ["dog", "cat"],
		});
	});

	test("emits an empty array for a widget step", async () => {
		const flow = createFlow({
			id: "widget_flow",
			title: "Widget",
			description: "Shows a widget",
			state: { plan: z.string().describe("Chosen plan") },
		})
			.addNode({
				id: "show_plans",
				label: "Show plans",
				run: ({ showWidget }) =>
					showWidget({ tool: mockPlanPickerTool, field: "plan" }),
			})
			.addEdge(START, "show_plans")
			.addEdge("show_plans", END)
			.compile({ store: new TestFlowStateStore() });

		const result = await runStart(flow);

		expect(metaOf(result)[SUGGESTIONS_META_KEY]).toEqual({ suggestions: [] });
	});

	test("emits an empty array when the flow completes", async () => {
		const flow = createFlow({
			id: "complete_flow",
			title: "Complete",
			description: "Completes immediately",
			state: { done: z.boolean().describe("Whether the flow finished") },
		})
			.addNode({
				id: "finish",
				label: "Finish",
				run: () => ({ done: true }),
			})
			.addEdge(START, "finish")
			.addEdge("finish", END)
			.compile({ store: new TestFlowStateStore() });

		const result = await runStart(flow);
		const structured = result.structuredContent as Record<string, unknown>;

		expect(structured.status).toBe("complete");
		expect(metaOf(result)[SUGGESTIONS_META_KEY]).toEqual({ suggestions: [] });
	});

	test("always carries the suggestions key on a flow result, regardless of status", async () => {
		const flows = [
			createFlow({
				id: "invariant_interrupt_flow",
				title: "Invariant interrupt",
				description: "Asks one open question",
				state: { breed: z.string().describe("Pet breed") },
			})
				.addNode({
					id: "ask_breed",
					label: "Ask breed",
					run: ({ interrupt }) =>
						interrupt({ breed: { question: "What breed is your pet?" } }),
				})
				.addEdge(START, "ask_breed")
				.addEdge("ask_breed", END)
				.compile({ store: new TestFlowStateStore() }),
			createFlow({
				id: "invariant_complete_flow",
				title: "Invariant complete",
				description: "Completes immediately",
				state: { done: z.boolean().describe("Whether the flow finished") },
			})
				.addNode({ id: "finish", label: "Finish", run: () => ({ done: true }) })
				.addEdge(START, "finish")
				.addEdge("finish", END)
				.compile({ store: new TestFlowStateStore() }),
			createFlow({
				id: "invariant_widget_flow",
				title: "Invariant widget",
				description: "Shows a widget",
				state: { plan: z.string().describe("Chosen plan") },
			})
				.addNode({
					id: "show_plans",
					label: "Show plans",
					run: ({ showWidget }) =>
						showWidget({ tool: mockPlanPickerTool, field: "plan" }),
				})
				.addEdge(START, "show_plans")
				.addEdge("show_plans", END)
				.compile({ store: new TestFlowStateStore() }),
		];

		for (const flow of flows) {
			const result = await runStart(flow);
			const meta = metaOf(result)[SUGGESTIONS_META_KEY];

			expect(meta).toBeDefined();
			expect(
				Array.isArray((meta as { suggestions: unknown }).suggestions),
			).toBe(true);
		}
	});
});
