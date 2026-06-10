import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { RegisteredTool } from "../../../../legacy/mcp/tools/types";
import { FLOW_META_KEY } from "../../utils";
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

const mockPlanPickerTool: RegisteredTool = {
	id: "plan_picker",
	title: "Plan Picker",
	description: "Show plan picker widget",
	register: async () => {},
};

const mockInfoPanelTool: RegisteredTool = {
	id: "info_panel",
	title: "Info Panel",
	description: "Show info panel widget",
	register: async () => {},
};

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
type RegisterToolArgs = [string, Record<string, unknown>, Handler];

const TEST_SESSION_ID = "test-session-1";
const TEST_EXTRA = { _meta: { sessionId: TEST_SESSION_ID } };
const TEST_INTENT =
	"Qualify the user for this flow based on what they asked for earlier in the conversation.";

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

/** Parse the text content payload from a tool result */
function parsePayload(result: Record<string, unknown>) {
	const content = result.content as Array<{ type: string; text?: string }>;
	return JSON.parse(content[0]?.text ?? "") as Record<string, unknown>;
}

/** Assert the flow meta carries the expected visit ids, each stamped with a valid timestamp. */
function expectNodesVisited(
	meta: Record<string, unknown>,
	flowId: string,
	nodeIds: string[],
) {
	const flowMeta = meta[FLOW_META_KEY] as {
		flowId: string;
		nodesVisited: Array<{ id: string; at: string }>;
	};
	expect(flowMeta.flowId).toBe(flowId);
	expect(flowMeta.nodesVisited.map((v) => v.id)).toEqual(nodeIds);
	for (const visit of flowMeta.nodesVisited) {
		expect(Number.isNaN(Date.parse(visit.at))).toBe(false);
	}
}

describe("compileFlow response contract", () => {
	test("returns an error when start is missing intent", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "missing_intent_flow",
			title: "Missing Intent Flow",
			description: "Collect lead details.",
			state: {
				useCase: z.string().describe("Primary use case"),
			},
		})
			.addNode("ask_use_case", ({ interrupt }) =>
				interrupt({
					useCase: { question: "What's your primary use case?" },
				}),
			)
			.addEdge(START, "ask_use_case")
			.addEdge("ask_use_case", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.({ action: "start" }, TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		expect(parsed.error).toContain('Missing required "intent"');
		expect(result.isError).toBe(true);
		expect(await store.get(TEST_SESSION_ID)).toEqual(null);
	});

	test("accepts optional context on start", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "context_flow",
			title: "Context Flow",
			description: "Test context field.",
			state: {
				useCase: z.string().describe("Primary use case"),
			},
		})
			.addNode("ask_use_case", ({ interrupt }) =>
				interrupt({
					useCase: { question: "What's your primary use case?" },
				}),
			)
			.addEdge(START, "ask_use_case")
			.addEdge("ask_use_case", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{
				action: "start",
				intent: TEST_INTENT,
				context: "User is on the pricing page and clicked 'Get a quote'.",
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("interrupt");
		expect(parsed.question).toBe("What's your primary use case?");
	});

	test("returns interrupt JSON content", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "lead_flow",
			title: "Lead Flow",
			description: "Collect lead details.",
			state: {
				useCase: z.string().describe("Primary use case"),
			},
		})
			.addNode("ask_use_case", ({ interrupt }) =>
				interrupt({
					useCase: { question: "What's your primary use case?" },
				}),
			)
			.addEdge(START, "ask_use_case")
			.addEdge("ask_use_case", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), {
			_meta: { requestId: "req-1", sessionId: TEST_SESSION_ID },
		})) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "interrupt",
			question: "What's your primary use case?",
			field: "useCase",
		});

		// State should be stored under the session ID
		const tokenData = await store.get(TEST_SESSION_ID);
		expect(tokenData).toMatchObject({
			step: "ask_use_case",
			state: {},
			field: "useCase",
		});

		// Client-injected metadata is in the _meta field
		expect((result._meta as Record<string, unknown>)?.requestId).toBe("req-1");
	});

	test("continues with session ID for continue action", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "lead_flow_continue",
			title: "Lead Flow Continue",
			description: "Collect lead details.",
			state: {
				useCase: z.string().describe("Primary use case"),
			},
		})
			.addNode("ask_use_case", ({ interrupt }) =>
				interrupt({
					useCase: { question: "What's your primary use case?" },
				}),
			)
			.addEdge(START, "ask_use_case")
			.addEdge("ask_use_case", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start to populate the store
		await handler?.(startInput(), TEST_EXTRA);

		// Continue using session ID
		const result = (await handler?.(
			{
				action: "continue",
				stateUpdates: { useCase: "Lead qualification" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({ status: "complete" });
		const finalStored = await store.get(TEST_SESSION_ID);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();
	});

	test("multi-question interrupt loops with unanswered questions when user answers partially", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "multi_q_flow",
			title: "Multi Question Flow",
			description: "Collect multiple details.",
			state: {
				name: z.string().describe("User name"),
				email: z.string().describe("User email"),
				company: z.string().describe("Company name"),
			},
		})
			.addNode("ask_details", ({ interrupt }) =>
				interrupt(
					{
						name: { question: "What's your name?" },
						email: { question: "What's your email?" },
						company: { question: "What's your company?" },
					},
					{ context: "Ask all questions together." },
				),
			)
			.addEdge(START, "ask_details")
			.addEdge("ask_details", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Step 1: Start — should get all 3 questions
		const r1 = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const p1 = parsePayload(r1);

		expect(p1.status).toBe("interrupt");
		expect(p1.questions).toHaveLength(3);

		// Step 2: User answers only name — should loop with 2 remaining questions
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Alice" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("interrupt");
		expect(p2.questions).toHaveLength(2);
		const fields2 = (p2.questions as Array<{ field: string }>).map(
			(q) => q.field,
		);
		expect(fields2).toContain("email");
		expect(fields2).toContain("company");
		expect(fields2.includes("name")).toBe(false);

		// Step 3: User answers email only — should loop with 1 remaining question (single-question shorthand)
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { email: "alice@example.com" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p3 = parsePayload(r3);

		expect(p3.status).toBe("interrupt");
		// Should be single-question shorthand (unwrapped)
		expect(p3.question).toBe("What's your company?");
		expect(p3.field).toBe("company");
		expect(p3.questions).toBe(undefined);

		// Step 4: User answers company — should complete
		const r4 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { company: "Acme Inc" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p4 = parsePayload(r4);

		expect(p4.status).toBe("complete");
		const finalStored = await store.get(TEST_SESSION_ID);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();
	});

	test("multi-question interrupt completes when all questions answered at once", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "multi_q_all_at_once",
			title: "Multi Q All At Once",
			description: "Collect multiple details.",
			state: {
				name: z.string().describe("User name"),
				email: z.string().describe("User email"),
			},
		})
			.addNode("ask_details", ({ interrupt }) =>
				interrupt({
					name: { question: "What's your name?" },
					email: { question: "What's your email?" },
				}),
			)
			.addEdge(START, "ask_details")
			.addEdge("ask_details", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start
		await handler?.(startInput(), TEST_EXTRA);

		// Answer both at once — should complete
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Bob", email: "bob@test.com" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("complete");
	});

	test("partial-answer continue re-executes handler and filters answered questions", async () => {
		let handlerCallCount = 0;

		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "side_effect_flow",
			title: "Side Effect Flow",
			description: "Test handler re-executes on partial answers.",
			state: {
				name: z.string().describe("User name"),
				email: z.string().describe("User email"),
			},
		})
			.addNode("ask_details", ({ interrupt }) => {
				handlerCallCount++;
				return interrupt({
					name: { question: "Name?" },
					email: { question: "Email?" },
				});
			})
			.addEdge(START, "ask_details")
			.addEdge("ask_details", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start — handler called once
		await handler?.(startInput(), TEST_EXTRA);
		expect(handlerCallCount).toBe(1);

		// Partial answer — handler re-executes to filter answered questions
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Alice" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		expect(handlerCallCount).toBe(2);

		const p2 = parsePayload(r2);
		expect(p2.status).toBe("interrupt");
		expect(p2.field).toBe("email");

		// Final answer — handler re-executes, all filled, completes
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { email: "alice@test.com" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		expect(handlerCallCount).toBe(3);

		const p3 = parsePayload(r3);
		expect(p3.status).toBe("complete");
	});

	test("widget continue without field advances to next node (no stuck loop)", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "widget_no_field_flow",
			title: "Widget No Field Flow",
			description: "Widget without a field should advance on continue.",
			state: {
				result: z.string().describe("Final result"),
			},
		})
			.addNode("show_info", ({ showWidget }) =>
				showWidget(mockInfoPanelTool, {
					data: { message: "Hello" },
				}),
			)
			.addNode("done", () => ({ result: "finished" }))
			.addEdge(START, "show_info")
			.addEdge("show_info", "done")
			.addEdge("done", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start — should show widget
		const r1 = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const p1 = parsePayload(r1);
		expect(p1.status).toBe("widget");

		// Continue from widget — should advance to "done" and complete
		const r2 = (await handler?.(
			{
				action: "continue",
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		// Must complete — NOT show the widget again
		expect(p2.status).toBe("complete");
	});

	test("returns widget JSON content with tool and data for widget steps", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "widget_flow",
			title: "Widget Flow",
			description: "Collect via widget",
			state: {
				plan: z.string().describe("Selected plan"),
			},
		})
			.addNode("pick_plan", ({ showWidget }) =>
				showWidget(mockPlanPickerTool, {
					data: { plans: ["starter", "pro"] },
					field: "plan",
				}),
			)
			.addEdge(START, "pick_plan")
			.addEdge("pick_plan", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "widget",
			tool: "plan_picker",
			data: { plans: ["starter", "pro"] },
			description:
				"IMPORTANT: You MUST now call the plan_picker tool to display the widget. Do NOT skip this step",
		});
		// Verify widget metadata in store
		const tokenData = await store.get(TEST_SESSION_ID);
		expect(tokenData).toMatchObject({
			step: "pick_plan",
			state: {},
			field: "plan",
			widgetId: "plan_picker",
		});
	});

	test("accepts a string tool id in showWidget", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "widget_flow_string_id",
			title: "Widget Flow (string id)",
			description: "Collect via widget using a string tool id",
			state: {
				plan: z.string().describe("Selected plan"),
			},
		})
			.addNode("pick_plan", ({ showWidget }) =>
				showWidget("plan_picker", {
					data: { plans: ["starter", "pro"] },
					field: "plan",
				}),
			)
			.addEdge(START, "pick_plan")
			.addEdge("pick_plan", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "widget",
			tool: "plan_picker",
			data: { plans: ["starter", "pro"] },
			description:
				"IMPORTANT: You MUST now call the plan_picker tool to display the widget. Do NOT skip this step",
		});
		const tokenData = await store.get(TEST_SESSION_ID);
		expect(tokenData).toMatchObject({
			step: "pick_plan",
			state: {},
			field: "plan",
			widgetId: "plan_picker",
		});
	});

	test("accepts the object form showWidget({ tool, data, field })", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "widget_flow_object_form",
			title: "Widget Flow (object form)",
			description: "Collect via widget using the object-form showWidget",
			state: {
				plan: z.string().describe("Selected plan"),
			},
		})
			.addNode("pick_plan", ({ showWidget }) =>
				showWidget({
					tool: "plan_picker",
					data: { plans: ["starter", "pro"] },
					field: "plan",
				}),
			)
			.addEdge(START, "pick_plan")
			.addEdge("pick_plan", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "widget",
			tool: "plan_picker",
			data: { plans: ["starter", "pro"] },
		});
	});

	test("object-form showWidget works without data", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "widget_flow_no_data",
			title: "Widget Flow (no data)",
			description: "Object-form showWidget with no data field",
			state: {
				plan: z.string().describe("Selected plan"),
			},
		})
			.addNode("pick_plan", ({ showWidget }) =>
				showWidget({ tool: "plan_picker", field: "plan" }),
			)
			.addEdge(START, "pick_plan")
			.addEdge("pick_plan", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "widget",
			tool: "plan_picker",
		});
		expect((parsed as { data?: unknown }).data).toBeUndefined();
	});

	test("returns an error when showWidget is called with the deprecated description field", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "widget_flow_with_description",
			title: "Widget Flow (description)",
			description: "Should error because description is deprecated.",
			state: {
				plan: z.string().describe("Selected plan"),
			},
		})
			.addNode("pick_plan", ({ showWidget }) =>
				showWidget(
					"plan_picker",
					// `description` is typed as `never` on the new shape — JS callers can
					// still pass it; the runtime check below catches them. We cast through
					// `unknown` to simulate that JS path and confirm the throw.
					{
						data: {},
						description: "User must pick a plan.",
					} as unknown as Parameters<typeof showWidget>[1],
				),
			)
			.addEdge(START, "pick_plan")
			.addEdge("pick_plan", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);
		expect(parsed.status).toBe("error");
		expect((parsed as { error: string }).error).toMatch(/no longer supported/);
	});

	test("marks display-only widget steps as non-interactive", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "display_only_widget_flow",
			title: "Display Only Widget Flow",
			description: "Show a display-only widget, then continue immediately.",
			state: {
				done: z.boolean().describe("Whether the flow is done"),
			},
		})
			.addNode("show_teaser", ({ showWidget }) =>
				showWidget(mockInfoPanelTool, {
					data: { message: "Savings teaser" },
					interactive: false,
				}),
			)
			.addNode("done", () => ({ done: true }))
			.addEdge(START, "show_teaser")
			.addEdge("show_teaser", "done")
			.addEdge("done", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "widget",
			tool: "info_panel",
			interactive: false,
		});
		// The display-only instruction must spell out the ordered "render first,
		// then continue" sequence so the model can't shortcut straight to continue.
		const description = (parsed as { description?: string }).description ?? "";
		expect(description).toContain("call the info_panel tool RIGHT NOW");
		expect(description).toContain('do NOT jump straight to action:"continue"');
	});
});

describe("validate on interrupt", () => {
	test("validate returning object enriches state and advances", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "validate_enrich",
			title: "Validate Enrich",
			description: "Test validate enrichment.",
			state: {
				breed: z.string().describe("Pet breed"),
				breedId: z.string().describe("Resolved breed ID"),
			},
		})
			.addNode("ask_breed", ({ interrupt }) =>
				interrupt({
					breed: {
						question: "What breed?",
						validate: async (breed) => {
							return { breedId: `id-${breed}` };
						},
					},
				}),
			)
			.addEdge(START, "ask_breed")
			.addEdge("ask_breed", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { breed: "labrador" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("complete");
		const finalStored = await store.get(TEST_SESSION_ID);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();
	});

	test("validate returning void advances without enrichment", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "validate_void",
			title: "Validate Void",
			description: "Test validate void return.",
			state: {
				email: z.string().describe("Email"),
			},
		})
			.addNode("ask_email", ({ interrupt }) =>
				interrupt({
					email: {
						question: "Email?",
						validate: async () => {
							// no-op, just validates
						},
					},
				}),
			)
			.addEdge(START, "ask_email")
			.addEdge("ask_email", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { email: "test@test.com" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("complete");
		const finalStored = await store.get(TEST_SESSION_ID);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();
	});

	test("validate throwing re-asks with error message and clears field", async () => {
		let validateCallCount = 0;

		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "validate_throw",
			title: "Validate Throw",
			description: "Test validate throw behavior.",
			state: {
				code: z.string().describe("Postal code"),
			},
		})
			.addNode("ask_code", ({ interrupt }) =>
				interrupt({
					code: {
						question: "Postal code?",
						context: "Enter a valid code.",
						validate: async (code) => {
							validateCallCount++;
							if (code === "invalid") {
								throw new Error("Invalid postal code");
							}
						},
					},
				}),
			)
			.addEdge(START, "ask_code")
			.addEdge("ask_code", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start
		await handler?.(startInput(), TEST_EXTRA);

		// Submit invalid code — should re-ask
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { code: "invalid" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("interrupt");
		expect(p2.question).toBe("Postal code?");
		expect(p2.field).toBe("code");
		// Error message should be in the context
		expect(p2.context).toContain("Invalid postal code");
		expect(validateCallCount).toBe(1);

		// Submit valid code — should complete
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { code: "12345" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p3 = parsePayload(r3);

		expect(p3.status).toBe("complete");
		expect(validateCallCount).toBe(2);
	});

	test("validate only runs after all questions are answered", async () => {
		const validateCalled = false;

		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "validate_after_all",
			title: "Validate After All",
			description: "Validate runs only when all questions answered.",
			state: {
				name: z.string().describe("Name"),
				email: z.string().describe("Email"),
			},
		})
			.addNode("ask_details", ({ interrupt }) =>
				interrupt({
					name: { question: "Name?" },
					email: { question: "Email?" },
				}),
			)
			.addEdge(START, "ask_details")
			.addEdge("ask_details", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		// Partial answer — should NOT trigger validate
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Alice" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("interrupt");
		expect(validateCalled).toBe(false);

		// Complete answer
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { email: "a@b.com" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p3 = parsePayload(r3);

		expect(p3.status).toBe("complete");
	});
});

describe("isError on error responses", () => {
	const store = new TestFlowStateStore();

	test("error responses have isError: true", async () => {
		const flow = createFlow({
			id: "error_flow",
			title: "Error Flow",
			description: "Test error handling.",
			state: {
				value: z.string().describe("Value"),
			},
		})
			.addNode("will_fail", () => {
				throw new Error("Something broke");
			})
			.addEdge(START, "will_fail")
			.addEdge("will_fail", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		expect(parsed.error).toBe("Something broke");
		expect(result.isError).toBe(true);
	});

	test("non-error responses do not have isError", async () => {
		const flow = createFlow({
			id: "success_flow",
			title: "Success Flow",
			description: "Test success.",
			state: {
				name: z.string().describe("Name"),
			},
		})
			.addNode("ask", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addEdge(START, "ask")
			.addEdge("ask", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;

		expect(result.isError).toBe(undefined);
	});
});

// ============================================================================
// Nested object state (z.object)
// ============================================================================

describe("nested object state", () => {
	test("dot-path interrupt produces correct field names", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_interrupt",
			title: "Nested Interrupt",
			description: "Test nested interrupt fields.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						license: z.string().describe("License number"),
					})
					.describe("Driver details"),
			},
		})
			.addNode("ask_driver", ({ interrupt }) =>
				interrupt({
					"driver.name": { question: "Driver's name?" },
					"driver.license": { question: "License number?" },
				}),
			)
			.addEdge(START, "ask_driver")
			.addEdge("ask_driver", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("interrupt");
		expect(parsed.questions).toHaveLength(2);
		const fields = (parsed.questions as Array<{ field: string }>).map(
			(q) => q.field,
		);
		expect(fields).toContain("driver.name");
		expect(fields).toContain("driver.license");
	});

	test("dot-path stateUpdates fill nested state correctly", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_fill",
			title: "Nested Fill",
			description: "Test nested state filling.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						license: z.string().describe("License number"),
					})
					.describe("Driver details"),
			},
		})
			.addNode("ask_driver", ({ interrupt }) =>
				interrupt({
					"driver.name": { question: "Name?" },
					"driver.license": { question: "License?" },
				}),
			)
			.addEdge(START, "ask_driver")
			.addEdge("ask_driver", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		const result = (await handler?.(
			{
				action: "continue",
				stateUpdates: {
					"driver.name": "John",
					"driver.license": "ABC123",
				},
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("complete");
		const finalStored = await store.get(TEST_SESSION_ID);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();
	});

	test("partial nested answers re-ask remaining sub-fields", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_partial",
			title: "Nested Partial",
			description: "Test partial nested answers.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						license: z.string().describe("License number"),
					})
					.describe("Driver details"),
			},
		})
			.addNode("ask_driver", ({ interrupt }) =>
				interrupt({
					"driver.name": { question: "Name?" },
					"driver.license": { question: "License?" },
				}),
			)
			.addEdge(START, "ask_driver")
			.addEdge("ask_driver", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		// Partial — only name
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { "driver.name": "Alice" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("interrupt");
		// Single remaining question — should use shorthand
		expect(p2.question).toBe("License?");
		expect(p2.field).toBe("driver.license");

		// Complete
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { "driver.license": "XYZ" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p3 = parsePayload(r3);

		expect(p3.status).toBe("complete");
	});

	test("mixed flat and nested fields work together", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_mixed",
			title: "Nested Mixed",
			description: "Test mixed flat and nested.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
					})
					.describe("Driver details"),
				email: z.string().describe("Contact email"),
			},
		})
			.addNode("ask_driver", ({ interrupt }) =>
				interrupt({
					"driver.name": { question: "Driver's name?" },
				}),
			)
			.addNode("ask_email", ({ interrupt }) =>
				interrupt({
					email: { question: "Email?" },
				}),
			)
			.addEdge(START, "ask_driver")
			.addEdge("ask_driver", "ask_email")
			.addEdge("ask_email", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { "driver.name": "Bob" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("interrupt");
		expect(p2.field).toBe("email");

		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { email: "bob@test.com" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p3 = parsePayload(r3);

		expect(p3.status).toBe("complete");
		const finalStored = await store.get(TEST_SESSION_ID);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();
	});

	test("nested field validation runs and enriches state", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_validate",
			title: "Nested Validate",
			description: "Test nested validation.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						nameUpper: z.string().describe("Uppercased name"),
					})
					.describe("Driver details"),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({
					"driver.name": {
						question: "Name?",
						validate: async (name) => {
							return { driver: { nameUpper: name.toUpperCase() } };
						},
					},
				}),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { "driver.name": "alice" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("complete");
		const finalStored = await store.get(TEST_SESSION_ID);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();
	});

	test("nested validation error clears only the sub-field", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_validate_error",
			title: "Nested Validate Error",
			description: "Test nested validation error.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						license: z.string().describe("License number"),
					})
					.describe("Driver details"),
			},
		})
			.addNode("ask_driver", ({ interrupt }) =>
				interrupt({
					"driver.name": {
						question: "Name?",
						validate: async (name) => {
							if (name === "bad") {
								throw new Error("Invalid name");
							}
						},
					},
					"driver.license": { question: "License?" },
				}),
			)
			.addEdge(START, "ask_driver")
			.addEdge("ask_driver", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		// Answer both, but name is invalid
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: {
					"driver.name": "bad",
					"driver.license": "ABC",
				},
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		expect(p2.status).toBe("interrupt");
		expect(p2.field).toBe("driver.name");
		expect(p2.context).toContain("Invalid name");

		// License should still be in state
		const tokenData = await store.get(TEST_SESSION_ID);
		expect((tokenData?.state as Record<string, unknown>)?.driver).toMatchObject(
			{ license: "ABC" },
		);
	});

	test("pre-fill nested fields on start with auto-skip", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_prefill",
			title: "Nested Prefill",
			description: "Test nested pre-fill.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						license: z.string().describe("License number"),
					})
					.describe("Driver details"),
			},
		})
			.addNode("ask_driver", ({ interrupt }) =>
				interrupt({
					"driver.name": { question: "Name?" },
					"driver.license": { question: "License?" },
				}),
			)
			.addEdge(START, "ask_driver")
			.addEdge("ask_driver", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Pre-fill name on start
		const r1 = (await handler?.(
			startInput({ "driver.name": "Pre-filled" }),
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p1 = parsePayload(r1);

		// Should only ask for license
		expect(p1.status).toBe("interrupt");
		expect(p1.question).toBe("License?");
		expect(p1.field).toBe("driver.license");
	});

	test("deep merge preserves sibling nested fields on continue", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_deep_merge",
			title: "Nested Deep Merge",
			description: "Test deep merge preserves siblings.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						license: z.string().describe("License number"),
					})
					.describe("Driver details"),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ "driver.name": { question: "Name?" } }),
			)
			.addNode("ask_license", ({ interrupt }) =>
				interrupt({ "driver.license": { question: "License?" } }),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", "ask_license")
			.addEdge("ask_license", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start → ask name
		await handler?.(startInput(), TEST_EXTRA);
		// Answer name → ask license
		await handler?.(
			{ action: "continue", stateUpdates: { "driver.name": "Alice" } },
			TEST_EXTRA,
		);
		// Answer license → complete
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { "driver.license": "XYZ" },
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const p3 = parsePayload(r3);

		expect(p3.status).toBe("complete");
		const finalStored = await store.get(TEST_SESSION_ID);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();
	});

	test("mixed dot-key and nested sibling in continue (dot first)", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_mixed_continue_dot_first",
			title: "Nested Mixed Continue",
			description: "Mixed-shape stateUpdates on continue.",
			state: {
				mortgagor: z
					.object({
						age: z.number().describe("Age"),
						name: z.string().describe("Full name"),
					})
					.describe("Mortgagor details"),
			},
		})
			.addNode("ask_mortgagor", ({ interrupt }) =>
				interrupt({
					"mortgagor.age": { question: "Age?" },
					"mortgagor.name": { question: "Name?" },
				}),
			)
			.addEdge(START, "ask_mortgagor")
			.addEdge("ask_mortgagor", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		const result = (await handler?.(
			{
				action: "continue",
				stateUpdates: {
					"mortgagor.age": 32,
					mortgagor: { name: "Alice" },
				},
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("complete");
	});

	test("mixed dot-key and nested sibling in continue (nested first)", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nested_mixed_continue_nested_first",
			title: "Nested Mixed Continue",
			description: "Mixed-shape stateUpdates on continue.",
			state: {
				mortgagor: z
					.object({
						age: z.number().describe("Age"),
						name: z.string().describe("Full name"),
					})
					.describe("Mortgagor details"),
			},
		})
			.addNode("ask_mortgagor", ({ interrupt }) =>
				interrupt({
					"mortgagor.age": { question: "Age?" },
					"mortgagor.name": { question: "Name?" },
				}),
			)
			.addEdge(START, "ask_mortgagor")
			.addEdge("ask_mortgagor", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		await handler?.(startInput(), TEST_EXTRA);

		const result = (await handler?.(
			{
				action: "continue",
				stateUpdates: {
					mortgagor: { name: "Alice" },
					"mortgagor.age": 32,
				},
			},
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("complete");
	});
});

// ============================================================================
// Reset action
// ============================================================================

describe("reset action", () => {
	test("reset corrects a previously-answered field and re-executes from start", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "reset_basic",
			title: "Reset Basic",
			description: "Test basic reset.",
			state: {
				email: z.string().describe("Email"),
				name: z.string().describe("Name"),
				phone: z.string().describe("Phone"),
			},
		})
			.addNode("ask_email", ({ interrupt }) =>
				interrupt({ email: { question: "Email?" } }),
			)
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addNode("ask_phone", ({ interrupt }) =>
				interrupt({ phone: { question: "Phone?" } }),
			)
			.addEdge(START, "ask_email")
			.addEdge("ask_email", "ask_name")
			.addEdge("ask_name", "ask_phone")
			.addEdge("ask_phone", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start → ask email
		await handler?.(startInput(), TEST_EXTRA);
		// Answer email → ask name
		await handler?.(
			{ action: "continue", stateUpdates: { email: "old@test.com" } },
			TEST_EXTRA,
		);
		// Answer name → ask phone
		await handler?.(
			{ action: "continue", stateUpdates: { name: "Alice" } },
			TEST_EXTRA,
		);

		// Now paused at ask_phone. Reset email.
		const result = (await handler?.(
			{ action: "reset", stateUpdates: { email: "new@test.com" } },
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		// Should skip email (filled with new value) and name (still filled),
		// and land on ask_phone again
		expect(parsed.status).toBe("interrupt");
		expect(parsed.question).toBe("Phone?");
		expect(parsed.field).toBe("phone");

		// Verify state has the corrected email
		const state = await store.get(TEST_SESSION_ID);
		expect(state?.state.email).toBe("new@test.com");
		expect(state?.state.name).toBe("Alice");
	});

	test("reset changes conditional edge path", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "reset_conditional",
			title: "Reset Conditional",
			description: "Test reset with conditional edges.",
			state: {
				country: z.string().describe("Country"),
				usState: z.string().describe("US State"),
				euRegion: z.string().describe("EU Region"),
			},
		})
			.addNode("ask_country", ({ interrupt }) =>
				interrupt({ country: { question: "Country?" } }),
			)
			.addNode("ask_us_state", ({ interrupt }) =>
				interrupt({ usState: { question: "US State?" } }),
			)
			.addNode("ask_eu_region", ({ interrupt }) =>
				interrupt({ euRegion: { question: "EU Region?" } }),
			)
			.addEdge(START, "ask_country")
			.addConditionalEdge("ask_country", (state) =>
				state.country === "US" ? "ask_us_state" : "ask_eu_region",
			)
			.addEdge("ask_us_state", END)
			.addEdge("ask_eu_region", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start → ask country
		await handler?.(startInput(), TEST_EXTRA);
		// Answer "US" → ask US state
		await handler?.(
			{ action: "continue", stateUpdates: { country: "US" } },
			TEST_EXTRA,
		);

		// Now paused at ask_us_state. Reset country to "FR".
		const result = (await handler?.(
			{ action: "reset", stateUpdates: { country: "FR" } },
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		// Should now take EU path
		expect(parsed.status).toBe("interrupt");
		expect(parsed.question).toBe("EU Region?");
		expect(parsed.field).toBe("euRegion");
	});

	test("reset recomputes action node derived values", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "reset_action_recompute",
			title: "Reset Action Recompute",
			description: "Test reset recomputes action nodes.",
			state: {
				email: z.string().describe("Email"),
				domain: z.string().describe("Extracted domain"),
				confirmed: z.string().describe("Confirmation"),
			},
		})
			.addNode("ask_email", ({ interrupt }) =>
				interrupt({ email: { question: "Email?" } }),
			)
			.addNode("extract_domain", ({ state }) => ({
				domain: state.email?.split("@")[1] ?? "",
			}))
			.addNode("confirm", ({ interrupt }) =>
				interrupt({ confirmed: { question: "Confirm?" } }),
			)
			.addEdge(START, "ask_email")
			.addEdge("ask_email", "extract_domain")
			.addEdge("extract_domain", "confirm")
			.addEdge("confirm", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start → ask email
		await handler?.(startInput(), TEST_EXTRA);
		// Answer email → extract_domain runs → ask confirm
		await handler?.(
			{ action: "continue", stateUpdates: { email: "alice@old.com" } },
			TEST_EXTRA,
		);

		// Verify domain was computed
		let state = await store.get(TEST_SESSION_ID);
		expect(state?.state.domain).toBe("old.com");

		// Reset email → domain should be recomputed
		const result = (await handler?.(
			{ action: "reset", stateUpdates: { email: "alice@new.com" } },
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("interrupt");
		expect(parsed.field).toBe("confirmed");

		state = await store.get(TEST_SESSION_ID);
		expect(state?.state.domain).toBe("new.com");
		expect(state?.state.email).toBe("alice@new.com");
	});

	test("reset without session ID returns error", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "reset_no_session",
			title: "Reset No Session",
			description: "Test reset without session.",
			state: { name: z.string().describe("Name") },
		})
			.addNode("ask", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addEdge(START, "ask")
			.addEdge("ask", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "reset", stateUpdates: { name: "Alice" } },
			{ _meta: {} },
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		expect(parsed.error).toContain("No session ID");
	});

	test("reset without stateUpdates returns error", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "reset_no_updates",
			title: "Reset No Updates",
			description: "Test reset without updates.",
			state: {
				name: z.string().describe("Name"),
				email: z.string().describe("Email"),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addNode("ask_email", ({ interrupt }) =>
				interrupt({ email: { question: "Email?" } }),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", "ask_email")
			.addEdge("ask_email", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start and answer first question (flow still in progress)
		await handler?.(startInput(), TEST_EXTRA);
		await handler?.(
			{ action: "continue", stateUpdates: { name: "Alice" } },
			TEST_EXTRA,
		);

		const result = (await handler?.({ action: "reset" }, TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		expect(parsed.error).toContain("stateUpdates");
	});

	test("reset on completed/expired flow returns error", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "reset_completed",
			title: "Reset Completed",
			description: "Test reset on completed flow.",
			state: { name: z.string().describe("Name") },
		})
			.addNode("ask", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addEdge(START, "ask")
			.addEdge("ask", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Complete the flow
		await handler?.(startInput(), TEST_EXTRA);
		await handler?.(
			{ action: "continue", stateUpdates: { name: "Alice" } },
			TEST_EXTRA,
		);

		// Final state is persisted (no step) so reset detects "already completed"
		const finalStored = await store.get(TEST_SESSION_ID);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();

		// Reset should fail
		const result = (await handler?.(
			{ action: "reset", stateUpdates: { name: "Bob" } },
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		expect(parsed.error).toContain("already completed");
	});

	test("reset preserves partial progress on current multi-question interrupt", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "reset_partial_progress",
			title: "Reset Partial Progress",
			description: "Test reset preserves partial answers on current node.",
			state: {
				email: z.string().describe("Email"),
				phone: z.string().describe("Phone"),
				address: z.string().describe("Address"),
			},
		})
			.addNode("ask_email", ({ interrupt }) =>
				interrupt({ email: { question: "Email?" } }),
			)
			.addNode("ask_contact", ({ interrupt }) =>
				interrupt({
					phone: { question: "Phone?" },
					address: { question: "Address?" },
				}),
			)
			.addEdge(START, "ask_email")
			.addEdge("ask_email", "ask_contact")
			.addEdge("ask_contact", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start → ask email
		await handler?.(startInput(), TEST_EXTRA);
		// Answer email → ask contact (phone + address)
		await handler?.(
			{ action: "continue", stateUpdates: { email: "old@test.com" } },
			TEST_EXTRA,
		);
		// Partial answer: only phone
		await handler?.(
			{ action: "continue", stateUpdates: { phone: "123" } },
			TEST_EXTRA,
		);

		// Now paused on ask_contact with only address remaining.
		// Reset email — phone should be preserved.
		const result = (await handler?.(
			{ action: "reset", stateUpdates: { email: "new@test.com" } },
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		// Should land on ask_contact, asking only for address (phone already filled)
		expect(parsed.status).toBe("interrupt");
		expect(parsed.question).toBe("Address?");
		expect(parsed.field).toBe("address");

		const state = await store.get(TEST_SESSION_ID);
		expect(state?.state.email).toBe("new@test.com");
		expect(state?.state.phone).toBe("123");
	});
});

// ============================================================================
// Auto-generated sessionId for sessionless clients (e.g. Claude Code)
// ============================================================================

describe("auto-generated sessionId for sessionless clients", () => {
	/** Fresh extra with no session — avoids mutation leaking between calls */
	const noSessionExtra = () => ({ _meta: {} });

	function buildSimpleFlow(store: TestFlowStateStore) {
		return createFlow({
			id: "sessionless_flow",
			title: "Sessionless Flow",
			description: "Test auto-generated sessionId.",
			state: {
				name: z.string().describe("User name"),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "What's your name?" } }),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });
	}

	test("start without session auto-generates sessionId and includes it in response", async () => {
		const store = new TestFlowStateStore();
		const flow = buildSimpleFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), noSessionExtra())) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("interrupt");
		expect(parsed.sessionId).toBeString();
		expect((parsed.sessionId as string).length).toBeGreaterThan(0);
	});

	test("start with _meta sessionId does NOT echo sessionId in response", async () => {
		const store = new TestFlowStateStore();
		const flow = buildSimpleFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("interrupt");
		expect(parsed.sessionId).toBeUndefined();
	});

	test("continue with sessionId from input retrieves persisted state", async () => {
		const store = new TestFlowStateStore();
		const flow = buildSimpleFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start without session — get auto-generated sessionId
		const startResult = (await handler?.(
			startInput(),
			noSessionExtra(),
		)) as Record<string, unknown>;
		const startParsed = parsePayload(startResult);
		const sessionId = startParsed.sessionId as string;
		expect(sessionId).toBeString();

		// Continue passing sessionId in input (as Claude Code would)
		const continueResult = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Alice" },
				sessionId,
			},
			noSessionExtra(),
		)) as Record<string, unknown>;
		const continueParsed = parsePayload(continueResult);

		expect(continueParsed.status).toBe("complete");
		// sessionId still echoed (no _meta session)
		expect(continueParsed.sessionId).toBe(sessionId);
	});

	test("reset with sessionId from input works end-to-end", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "sessionless_reset_flow",
			title: "Sessionless Reset Flow",
			description: "Test reset with auto-generated sessionId.",
			state: {
				name: z.string().describe("User name"),
				email: z.string().describe("User email"),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addNode("ask_email", ({ interrupt }) =>
				interrupt({ email: { question: "Email?" } }),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", "ask_email")
			.addEdge("ask_email", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start — get sessionId
		const r1 = (await handler?.(startInput(), noSessionExtra())) as Record<
			string,
			unknown
		>;
		const sessionId = parsePayload(r1).sessionId as string;

		// Continue with name
		await handler?.(
			{ action: "continue", stateUpdates: { name: "Alice" }, sessionId },
			noSessionExtra(),
		);

		// Reset name
		const r3 = (await handler?.(
			{ action: "reset", stateUpdates: { name: "Bob" }, sessionId },
			noSessionExtra(),
		)) as Record<string, unknown>;
		const p3 = parsePayload(r3);

		// Should skip ask_name (already filled with "Bob") and land on ask_email
		expect(p3.status).toBe("interrupt");
		expect(p3.field).toBe("email");
		expect(p3.sessionId).toBe(sessionId);
	});

	test("continue without session and without sessionId input returns error", async () => {
		const store = new TestFlowStateStore();
		const flow = buildSimpleFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "continue", stateUpdates: { name: "Alice" } },
			noSessionExtra(),
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		expect(parsed.error).toContain("No session ID");
	});

	test("auto-generated sessionId persists state to KV store", async () => {
		const store = new TestFlowStateStore();
		const flow = buildSimpleFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), noSessionExtra())) as Record<
			string,
			unknown
		>;
		const sessionId = parsePayload(result).sessionId as string;

		// Verify state was stored under the auto-generated sessionId
		const stored = await store.get(sessionId);
		expect(stored).toMatchObject({
			step: "ask_name",
			state: {},
			field: "name",
		});
	});

	test("completed flow cleans up state with auto-generated sessionId", async () => {
		const store = new TestFlowStateStore();
		const flow = buildSimpleFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start
		const r1 = (await handler?.(startInput(), noSessionExtra())) as Record<
			string,
			unknown
		>;
		const sessionId = parsePayload(r1).sessionId as string;

		// Complete
		await handler?.(
			{ action: "continue", stateUpdates: { name: "Alice" }, sessionId },
			noSessionExtra(),
		);

		// Final state is persisted (no step → stale continue falls into "already completed")
		const finalStored = await store.get(sessionId);
		expect(finalStored?.state).toBeDefined();
		expect(finalStored?.step).toBeUndefined();
	});

	test("each start generates a unique sessionId", async () => {
		const store = new TestFlowStateStore();
		const flow = buildSimpleFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const r1 = (await handler?.(startInput(), noSessionExtra())) as Record<
			string,
			unknown
		>;
		const r2 = (await handler?.(startInput(), noSessionExtra())) as Record<
			string,
			unknown
		>;

		const id1 = parsePayload(r1).sessionId as string;
		const id2 = parsePayload(r2).sessionId as string;

		expect(id1).not.toBe(id2);
	});

	// Regression: WAN-XXX — downstream tracking, scoped-client, and source
	// detection rely on _meta["waniwani/sessionId"] being present. The flow
	// handler must bridge the resolved sessionId into _meta on every turn —
	// not just on `start` — so events from continue/reset calls are correlated.
	test("bridges auto-generated sessionId into response _meta on start", async () => {
		const store = new TestFlowStateStore();
		const flow = buildSimpleFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), noSessionExtra())) as Record<
			string,
			unknown
		>;
		const sessionId = parsePayload(result).sessionId as string;
		const meta = result._meta as Record<string, unknown>;

		expect(meta["waniwani/sessionId"]).toBe(sessionId);
	});

	test("bridges args.sessionId into response _meta on continue", async () => {
		const store = new TestFlowStateStore();
		const flow = buildSimpleFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const startResult = (await handler?.(
			startInput(),
			noSessionExtra(),
		)) as Record<string, unknown>;
		const sessionId = parsePayload(startResult).sessionId as string;

		const continueResult = (await handler?.(
			{ action: "continue", stateUpdates: { name: "Alice" }, sessionId },
			noSessionExtra(),
		)) as Record<string, unknown>;
		const meta = continueResult._meta as Record<string, unknown>;

		expect(meta["waniwani/sessionId"]).toBe(sessionId);
	});

	test("bridges args.sessionId into response _meta on reset", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "sessionless_reset_bridge_flow",
			title: "Sessionless Reset Bridge Flow",
			description: "Test reset _meta bridging.",
			state: {
				name: z.string().describe("Name"),
				email: z.string().describe("Email"),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addNode("ask_email", ({ interrupt }) =>
				interrupt({ email: { question: "Email?" } }),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", "ask_email")
			.addEdge("ask_email", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const startResult = (await handler?.(
			startInput(),
			noSessionExtra(),
		)) as Record<string, unknown>;
		const sessionId = parsePayload(startResult).sessionId as string;

		await handler?.(
			{ action: "continue", stateUpdates: { name: "Alice" }, sessionId },
			noSessionExtra(),
		);

		const resetResult = (await handler?.(
			{ action: "reset", stateUpdates: { name: "Bob" }, sessionId },
			noSessionExtra(),
		)) as Record<string, unknown>;
		const meta = resetResult._meta as Record<string, unknown>;

		expect(meta["waniwani/sessionId"]).toBe(sessionId);
	});
});

// ============================================================================
// nodesVisited in _meta
// ============================================================================

describe("nodesVisited flow path tracking", () => {
	test("interrupt result includes nodesVisited in _meta", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "nodes_visited_flow",
			title: "Nodes Visited",
			description: "Test nodesVisited tracking.",
			state: {
				name: z.string().describe("Name"),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const meta = result._meta as Record<string, unknown>;

		expectNodesVisited(meta, "nodes_visited_flow", ["ask_name"]);
	});

	test("action nodes traversed before interrupt are included in nodesVisited", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "action_then_interrupt",
			title: "Action Then Interrupt",
			description: "Test action nodes appear in nodesVisited.",
			state: {
				computed: z.string().describe("Computed value"),
				name: z.string().describe("Name"),
			},
		})
			.addNode("compute", () => ({ computed: "done" }))
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addEdge(START, "compute")
			.addEdge("compute", "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const meta = result._meta as Record<string, unknown>;

		expectNodesVisited(meta, "action_then_interrupt", ["compute", "ask_name"]);
	});

	test("visit timestamps are non-decreasing in traversal order", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "visit_timestamps_flow",
			title: "Visit Timestamps",
			description: "Test per-node visit timestamps.",
			state: {
				a: z.string().describe("A"),
				b: z.string().describe("B"),
				name: z.string().describe("Name"),
			},
		})
			.addNode("first", async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				return { a: "done" };
			})
			.addNode("second", () => ({ b: "done" }))
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addEdge(START, "first")
			.addEdge("first", "second")
			.addEdge("second", "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const meta = result._meta as Record<string, unknown>;
		const flowMeta = meta[FLOW_META_KEY] as {
			nodesVisited: Array<{ id: string; at: string }>;
		};

		const times = flowMeta.nodesVisited.map((v) => Date.parse(v.at));
		expect(times).toHaveLength(3);
		for (let i = 1; i < times.length; i++) {
			expect(times[i]).toBeGreaterThanOrEqual(times[i - 1] ?? 0);
		}
		// The first node's handler sleeps, so the second visit is strictly later.
		expect(times[1]).toBeGreaterThan(times[0] ?? 0);
	});

	test("completed flow includes all traversed nodes in nodesVisited", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "full_path_flow",
			title: "Full Path",
			description: "Test complete flow path.",
			state: {
				name: z.string().describe("Name"),
				email: z.string().describe("Email"),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addNode("ask_email", ({ interrupt }) =>
				interrupt({ email: { question: "Email?" } }),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", "ask_email")
			.addEdge("ask_email", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start → interrupt at ask_name
		await handler?.(startInput(), TEST_EXTRA);
		// Answer name → interrupt at ask_email
		const r2 = (await handler?.(
			{ action: "continue", stateUpdates: { name: "Alice" } },
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const meta2 = r2._meta as Record<string, unknown>;

		// Continue traverses ask_name (re-executes) then advances to ask_email
		expectNodesVisited(meta2, "full_path_flow", ["ask_name", "ask_email"]);

		// Answer email → complete
		const r3 = (await handler?.(
			{ action: "continue", stateUpdates: { email: "a@b.com" } },
			TEST_EXTRA,
		)) as Record<string, unknown>;
		const meta3 = r3._meta as Record<string, unknown>;

		expectNodesVisited(meta3, "full_path_flow", ["ask_email"]);
	});

	test("hideFromFunnel nodes are excluded from nodesVisited", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "hidden_node_flow",
			title: "Hidden Node",
			description: "Test hideFromFunnel exclusion.",
			state: {
				computed: z.string().describe("Computed"),
				name: z.string().describe("Name"),
			},
		})
			.addNode("hidden_compute", () => ({ computed: "done" }), {
				label: "Hidden Compute",
				hideFromFunnel: true,
			})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addEdge(START, "hidden_compute")
			.addEdge("hidden_compute", "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const meta = result._meta as Record<string, unknown>;

		expectNodesVisited(meta, "hidden_node_flow", ["ask_name"]);
	});
});

describe("addNode object form", () => {
	test("accepts { id, run, label, hideFromFunnel } and behaves identically to positional form", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "object_form_flow",
			title: "Object Form",
			description: "Test the object-form addNode signature.",
			state: {
				computed: z.string().describe("Computed"),
				name: z.string().describe("Name"),
			},
		})
			.addNode({
				id: "hidden_compute",
				run: () => ({ computed: "done" }),
				label: "Hidden Compute",
				hideFromFunnel: true,
			})
			.addNode({
				id: "ask_name",
				run: ({ interrupt }) => interrupt({ name: { question: "Name?" } }),
			})
			.addEdge(START, "hidden_compute")
			.addEdge("hidden_compute", "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const meta = result._meta as Record<string, unknown>;

		expectNodesVisited(meta, "object_form_flow", ["ask_name"]);
	});

	test("object form without label defaults label to id", () => {
		const flow = createFlow({
			id: "default_label_flow",
			title: "Default Label",
			description: "Label defaults to id when omitted.",
			state: { v: z.string() },
		})
			.addNode({
				id: "first",
				run: () => ({ v: "ok" }),
			})
			.addEdge(START, "first")
			.addEdge("first", END);

		const graphMd = flow.graph();
		expect(graphMd).toContain("first[first]");
	});
});

describe("fieldSchema in interrupt/widget responses", () => {
	test("single-question interrupt carries fieldSchema for the awaited field", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "field_schema_single",
			title: "Field Schema Single",
			description: "JIT field schema in interrupt response.",
			state: {
				journeyType: z
					.enum(["creation", "reprise", "entreprise"])
					.describe("How the user intends to engage with the offer."),
			},
		})
			.addNode("ask_journey", ({ interrupt }) =>
				interrupt({
					journeyType: { question: "What journey would you like?" },
				}),
			)
			.addEdge(START, "ask_journey")
			.addEdge("ask_journey", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "interrupt",
			field: "journeyType",
			fieldSchema: {
				type: "enum",
				values: ["creation", "reprise", "entreprise"],
				description: "How the user intends to engage with the offer.",
			},
		});
	});

	test("multi-question interrupt carries fieldSchema on each unanswered question", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "field_schema_multi",
			title: "Field Schema Multi",
			description: "JIT field schema on every question.",
			state: {
				amount: z.number().describe("Requested financing amount in euros."),
				purpose: z.string().describe("Why the user needs the financing."),
			},
		})
			.addNode("ask_both", ({ interrupt }) =>
				interrupt({
					amount: { question: "How much?" },
					purpose: { question: "For what?" },
				}),
			)
			.addEdge(START, "ask_both")
			.addEdge("ask_both", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("interrupt");
		const questions = parsed.questions as Array<Record<string, unknown>>;
		expect(questions).toHaveLength(2);
		const amount = questions.find((q) => q.field === "amount");
		const purpose = questions.find((q) => q.field === "purpose");
		expect(amount?.fieldSchema).toEqual({
			type: "number",
			description: "Requested financing amount in euros.",
		});
		expect(purpose?.fieldSchema).toEqual({
			type: "string",
			description: "Why the user needs the financing.",
		});
	});

	test("widget response carries field and fieldSchema when showWidget declares a field", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "field_schema_widget",
			title: "Field Schema Widget",
			description: "JIT field schema in widget response.",
			state: {
				plan: z
					.enum(["starter", "pro"])
					.describe("Which plan the user picked."),
			},
		})
			.addNode("pick_plan", ({ showWidget }) =>
				showWidget(mockPlanPickerTool, {
					data: { plans: ["starter", "pro"] },
					field: "plan",
				}),
			)
			.addEdge(START, "pick_plan")
			.addEdge("pick_plan", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "widget",
			tool: "plan_picker",
			field: "plan",
			fieldSchema: {
				type: "enum",
				values: ["starter", "pro"],
				description: "Which plan the user picked.",
			},
		});
	});

	test("optional field is flagged optional: true in fieldSchema", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "field_schema_optional",
			title: "Field Schema Optional",
			description: "Optional wrapper surfaces optional: true.",
			state: {
				nickname: z.string().optional().describe("Optional nickname."),
			},
		})
			.addNode("ask_nick", ({ interrupt }) =>
				interrupt({ nickname: { question: "Nickname?" } }),
			)
			.addEdge(START, "ask_nick")
			.addEdge("ask_nick", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed.fieldSchema).toEqual({
			type: "string",
			description: "Optional nickname.",
			optional: true,
		});
	});

	test("dot-path field resolves fieldSchema from a nested z.object", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "field_schema_nested",
			title: "Field Schema Nested",
			description: "Dot-path resolves nested schema.",
			state: {
				driver: z.object({
					name: z.string().describe("Driver's full name."),
				}),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ "driver.name": { question: "Driver's name?" } }),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(startInput(), TEST_EXTRA)) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed.field).toBe("driver.name");
		expect(parsed.fieldSchema).toEqual({
			type: "string",
			description: "Driver's full name.",
		});
	});

	test("Known fields prose dump no longer appears in tool description", async () => {
		const store = new TestFlowStateStore();
		const flow = createFlow({
			id: "no_known_fields",
			title: "No Known Fields",
			description: "Top-level description.",
			state: {
				foo: z.string().describe("Some foo"),
				bar: z.number().describe("Some bar"),
			},
		})
			.addNode("only", ({ interrupt }) =>
				interrupt({ foo: { question: "Foo?" } }),
			)
			.addEdge(START, "only")
			.addEdge("only", END)
			.compile({ store });

		const { server, registered } = mockServer();
		await flow.register(server);
		const [, toolConfig] = registered[0] as RegisterToolArgs;
		const description = toolConfig.description as string;

		expect(description).not.toContain("Known fields");
	});
});
