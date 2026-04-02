import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { RegisteredTool } from "../../tools/types";
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
		expect(await store.get(TEST_SESSION_ID)).toEqual(null);
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
		expect(await store.get(TEST_SESSION_ID)).toEqual(null);
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
					description: "Show info panel",
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
					description: "Pick your plan",
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
			description: "Pick your plan",
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
					description: "Display a savings teaser, then continue immediately.",
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
		expect(await store.get(TEST_SESSION_ID)).toEqual(null);
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
		expect(await store.get(TEST_SESSION_ID)).toEqual(null);
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
			.compile();

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
			.compile();

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
		expect(await store.get(TEST_SESSION_ID)).toEqual(null);
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
		expect(await store.get(TEST_SESSION_ID)).toEqual(null);
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
		expect(await store.get(TEST_SESSION_ID)).toEqual(null);
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
		expect(await store.get(TEST_SESSION_ID)).toEqual(null);
	});
});
