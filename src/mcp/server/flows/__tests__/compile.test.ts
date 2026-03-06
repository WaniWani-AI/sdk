import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { McpServer } from "../@types";
import { END, interrupt, START, showWidget } from "../@types";
import { createFlow } from "../create-flow";

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
type RegisterToolArgs = [string, Record<string, unknown>, Handler];

function mockServer() {
	const registered: RegisterToolArgs[] = [];
	const server = {
		registerTool: (...args: unknown[]) => {
			registered.push(args as RegisterToolArgs);
		},
	};
	return { server: server as unknown as McpServer, registered };
}

describe("compileFlow response contract", () => {
	test("returns interrupt JSON content and stores flow routing in _meta.flow", async () => {
		const flow = createFlow({
			id: "lead_flow",
			title: "Lead Flow",
			description: "Collect lead details.",
			state: {
				useCase: z.string().describe("Primary use case"),
			},
		})
			.addNode("ask_use_case", () =>
				interrupt({
					question: "What's your primary use case?",
					field: "useCase",
				}),
			)
			.addEdge(START, "ask_use_case")
			.addEdge("ask_use_case", END)
			.compile();

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "start" },
			{ _meta: { requestId: "req-1" } },
		)) as Record<string, unknown>;
		const content = result.content as Array<{ type: string; text?: string }>;
		const parsed = JSON.parse(content[0]?.text ?? "") as Record<
			string,
			unknown
		>;

		expect(parsed).toMatchObject({
			status: "interrupt",
			question: "What's your primary use case?",
			field: "useCase",
		});
		expect(result._meta).toMatchObject({
			requestId: "req-1",
			flow: {
				flowId: "lead_flow",
				step: "ask_use_case",
				state: {},
				field: "useCase",
			},
		});

		expect(content).toHaveLength(1);
		expect(content[0]?.type).toBe("text");
		expect(parsed.status).toBe("interrupt");
	});

	test("accepts _meta.flow as input for continue action", async () => {
		const flow = createFlow({
			id: "lead_flow_continue",
			title: "Lead Flow Continue",
			description: "Collect lead details.",
			state: {
				useCase: z.string().describe("Primary use case"),
			},
		})
			.addNode("ask_use_case", () =>
				interrupt({
					question: "What's your primary use case?",
					field: "useCase",
				}),
			)
			.addEdge(START, "ask_use_case")
			.addEdge("ask_use_case", END)
			.compile();

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{
				action: "continue",
				stateUpdates: { useCase: "Lead qualification" },
				_meta: {
					flow: {
						step: "ask_use_case",
						state: {},
						field: "useCase",
					},
				},
			},
			{},
		)) as Record<string, unknown>;
		const content = result.content as Array<{ type: string; text?: string }>;
		const parsed = JSON.parse(content[0]?.text ?? "") as Record<
			string,
			unknown
		>;

		expect(parsed).toMatchObject({ status: "complete" });
		expect(result._meta).toMatchObject({
			flow: {
				flowId: "lead_flow_continue",
				state: { useCase: "Lead qualification" },
			},
		});
	});

	test("multi-question interrupt loops with unanswered questions when user answers partially", async () => {
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
			.addNode("ask_details", () =>
				interrupt({
					questions: [
						{ question: "What's your name?", field: "name" },
						{ question: "What's your email?", field: "email" },
						{ question: "What's your company?", field: "company" },
					],
					context: "Ask all questions together.",
				}),
			)
			.addEdge(START, "ask_details")
			.addEdge("ask_details", END)
			.compile();

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Step 1: Start — should get all 3 questions
		const r1 = (await handler?.({ action: "start" }, {})) as Record<
			string,
			unknown
		>;
		const p1 = JSON.parse(
			(r1.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		expect(p1.status).toBe("interrupt");
		expect(p1.questions).toHaveLength(3);

		// Step 2: User answers only name — should loop with 2 remaining questions
		const meta1 = (r1._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Alice" },
				_meta: { flow: meta1 },
			},
			{},
		)) as Record<string, unknown>;
		const p2 = JSON.parse(
			(r2.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		expect(p2.status).toBe("interrupt");
		expect(p2.questions).toHaveLength(2);
		const fields2 = (p2.questions as Array<{ field: string }>).map(
			(q) => q.field,
		);
		expect(fields2).toContain("email");
		expect(fields2).toContain("company");
		expect(fields2.includes("name")).toBe(false);

		// Step 3: User answers email only — should loop with 1 remaining question (single-question shorthand)
		const meta2 = (r2._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { email: "alice@example.com" },
				_meta: { flow: meta2 },
			},
			{},
		)) as Record<string, unknown>;
		const p3 = JSON.parse(
			(r3.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		expect(p3.status).toBe("interrupt");
		// Should be single-question shorthand (unwrapped)
		expect(p3.question).toBe("What's your company?");
		expect(p3.field).toBe("company");
		expect(p3.questions).toBe(undefined);

		// Step 4: User answers company — should complete
		const meta3 = (r3._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		const r4 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { company: "Acme Inc" },
				_meta: { flow: meta3 },
			},
			{},
		)) as Record<string, unknown>;
		const p4 = JSON.parse(
			(r4.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		expect(p4.status).toBe("complete");
		// Verify final state has all answers
		const meta4 = (r4._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		expect(meta4?.state).toMatchObject({
			name: "Alice",
			email: "alice@example.com",
			company: "Acme Inc",
		});
	});

	test("multi-question interrupt completes when all questions answered at once", async () => {
		const flow = createFlow({
			id: "multi_q_all_at_once",
			title: "Multi Q All At Once",
			description: "Collect multiple details.",
			state: {
				name: z.string().describe("User name"),
				email: z.string().describe("User email"),
			},
		})
			.addNode("ask_details", () =>
				interrupt({
					questions: [
						{ question: "What's your name?", field: "name" },
						{ question: "What's your email?", field: "email" },
					],
				}),
			)
			.addEdge(START, "ask_details")
			.addEdge("ask_details", END)
			.compile();

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start
		const r1 = (await handler?.({ action: "start" }, {})) as Record<
			string,
			unknown
		>;
		const meta1 = (r1._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;

		// Answer both at once — should complete
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Bob", email: "bob@test.com" },
				_meta: { flow: meta1 },
			},
			{},
		)) as Record<string, unknown>;
		const p2 = JSON.parse(
			(r2.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		expect(p2.status).toBe("complete");
	});

	test("partial-answer continue does not re-execute the node handler (no side-effect replay)", async () => {
		let handlerCallCount = 0;

		const flow = createFlow({
			id: "side_effect_flow",
			title: "Side Effect Flow",
			description: "Test handler is not re-called on partial answers.",
			state: {
				name: z.string().describe("User name"),
				email: z.string().describe("User email"),
			},
		})
			.addNode("ask_details", () => {
				handlerCallCount++;
				return interrupt({
					questions: [
						{ question: "Name?", field: "name" },
						{ question: "Email?", field: "email" },
					],
				});
			})
			.addEdge(START, "ask_details")
			.addEdge("ask_details", END)
			.compile();

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start — handler called once
		const r1 = (await handler?.({ action: "start" }, {})) as Record<
			string,
			unknown
		>;
		expect(handlerCallCount).toBe(1);

		// Partial answer — handler should NOT be called again
		const meta1 = (r1._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Alice" },
				_meta: { flow: meta1 },
			},
			{},
		)) as Record<string, unknown>;
		expect(handlerCallCount).toBe(1); // Still 1 — no replay

		const p2 = JSON.parse(
			(r2.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;
		expect(p2.status).toBe("interrupt");
		expect(p2.field).toBe("email");

		// Final answer — handler called once more when advancing past the node
		const meta2 = (r2._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { email: "alice@test.com" },
				_meta: { flow: meta2 },
			},
			{},
		)) as Record<string, unknown>;
		// Handler is called once more because we advance to next node (END)
		// via executeFrom, which doesn't re-execute ask_details since questions
		// are resolved in handleToolCall before advancing
		expect(handlerCallCount).toBe(1); // Still 1 — resolved from cache

		const p3 = JSON.parse(
			(r3.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;
		expect(p3.status).toBe("complete");
	});

	test("interrupt loops when AI drops _meta.flow.questions (no cached questions)", async () => {
		const flow = createFlow({
			id: "no_cache_flow",
			title: "No Cache Flow",
			description: "Test fallback when AI drops questions cache.",
			state: {
				name: z.string().describe("User name"),
				email: z.string().describe("User email"),
				company: z.string().describe("Company name"),
				role: z.string().describe("User role"),
			},
		})
			.addNode("ask_details", () =>
				interrupt({
					questions: [
						{ question: "Name?", field: "name" },
						{ question: "Email?", field: "email" },
						{ question: "Company?", field: "company" },
						{ question: "Role?", field: "role" },
					],
					context: "Ask all together.",
				}),
			)
			.addEdge(START, "ask_details")
			.addEdge("ask_details", END)
			.compile();

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Step 1: Start — get all 4 questions
		const r1 = (await handler?.({ action: "start" }, {})) as Record<
			string,
			unknown
		>;
		const p1 = JSON.parse(
			(r1.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		expect(p1.status).toBe("interrupt");
		expect(p1.questions).toHaveLength(4);

		// Step 2: Continue with NO answers and WITHOUT passing back questions
		// (simulates AI dropping _meta.flow.questions)
		const meta1 = (r1._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: {},
				_meta: {
					flow: {
						step: meta1.step,
						state: meta1.state,
						// intentionally omitting: questions, interruptContext
					},
				},
			},
			{},
		)) as Record<string, unknown>;
		const p2 = JSON.parse(
			(r2.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		// Should still interrupt with all 4 questions — NOT advance to next node
		expect(p2.status).toBe("interrupt");
		expect(p2.questions).toHaveLength(4);

		// Step 3: Answer 2 of 4 without questions cache
		const meta2 = (r2._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Alice", email: "alice@test.com" },
				_meta: {
					flow: {
						step: meta2.step,
						state: meta2.state,
						// intentionally omitting questions again
					},
				},
			},
			{},
		)) as Record<string, unknown>;
		const p3 = JSON.parse(
			(r3.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		// Should loop with 2 remaining questions
		expect(p3.status).toBe("interrupt");
		expect(p3.questions).toHaveLength(2);
		const fields3 = (p3.questions as Array<{ field: string }>).map(
			(q) => q.field,
		);
		expect(fields3).toContain("company");
		expect(fields3).toContain("role");

		// Step 4: Answer all remaining — should complete
		const meta3 = (r3._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		const r4 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { company: "Acme", role: "Engineer" },
				_meta: {
					flow: {
						step: meta3.step,
						state: meta3.state,
						// omitting questions — still works
					},
				},
			},
			{},
		)) as Record<string, unknown>;
		const p4 = JSON.parse(
			(r4.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		expect(p4.status).toBe("complete");
	});

	test("widget continue without field advances to next node (no stuck loop)", async () => {
		const resource = {
			id: "info_panel",
			title: "Info Panel",
			description: "Display info",
			openaiUri: "ui://widgets/apps-sdk/info_panel.html",
			mcpUri: "ui://widgets/ext-apps/info_panel.html",
			autoHeight: true,
			register: async () => {},
		};

		const flow = createFlow({
			id: "widget_no_field_flow",
			title: "Widget No Field Flow",
			description: "Widget without a field should advance on continue.",
			state: {
				result: z.string().describe("Final result"),
			},
		})
			.addNode("show_info", () =>
				showWidget(resource, {
					data: { message: "Hello" },
					description: "Show info panel",
				}),
			)
			.addNode("done", () => ({ result: "finished" }))
			.addEdge(START, "show_info")
			.addEdge("show_info", "done")
			.addEdge("done", END)
			.compile();

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		// Start — should show widget
		const r1 = (await handler?.({ action: "start" }, {})) as Record<
			string,
			unknown
		>;
		const p1 = JSON.parse(
			(r1.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;
		expect(p1.status).toBe("widget");

		const meta1 = (r1._meta as Record<string, unknown>)?.flow as Record<
			string,
			unknown
		>;
		expect(meta1.widgetId).toBe("info_panel");

		// Continue from widget — should advance to "done" and complete
		const r2 = (await handler?.(
			{
				action: "continue",
				_meta: {
					flow: {
						step: meta1.step,
						state: meta1.state,
						widgetId: meta1.widgetId,
					},
				},
			},
			{},
		)) as Record<string, unknown>;
		const p2 = JSON.parse(
			(r2.content as Array<{ text: string }>)[0]?.text ?? "",
		) as Record<string, unknown>;

		// Must complete — NOT show the widget again
		expect(p2.status).toBe("complete");
	});

	test("returns widget JSON content and _meta.flow for widget steps", async () => {
		const resource = {
			id: "plan_picker",
			title: "Plan Picker",
			description: "Pick a plan",
			openaiUri: "ui://widgets/apps-sdk/plan_picker.html",
			mcpUri: "ui://widgets/ext-apps/plan_picker.html",
			autoHeight: true,
			register: async () => {},
		};

		const flow = createFlow({
			id: "widget_flow",
			title: "Widget Flow",
			description: "Collect via widget",
			state: {
				plan: z.string().describe("Selected plan"),
			},
		})
			.addNode("pick_plan", () =>
				showWidget(resource, {
					data: { plans: ["starter", "pro"] },
					description: "Pick your plan",
					field: "plan",
				}),
			)
			.addEdge(START, "pick_plan")
			.addEdge("pick_plan", END)
			.compile();

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.({ action: "start" }, {})) as Record<
			string,
			unknown
		>;
		const content = result.content as Array<{ type: string; text?: string }>;
		const parsed = JSON.parse(content[0]?.text ?? "") as Record<
			string,
			unknown
		>;

		expect(parsed).toMatchObject({
			status: "widget",
			description: "Pick your plan",
		});
		expect((parsed as Record<string, unknown>).field).toBe(undefined);
		expect((parsed as Record<string, unknown>).widgetId).toBe(undefined);
		expect(result.structuredContent).toEqual({ plans: ["starter", "pro"] });
		expect(result._meta).toMatchObject({
			flow: {
				flowId: "widget_flow",
				step: "pick_plan",
				state: {},
				field: "plan",
				widgetId: "plan_picker",
			},
		});
	});
});
