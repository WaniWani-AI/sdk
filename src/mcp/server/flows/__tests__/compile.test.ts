import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { RegisteredTool } from "../../tools/types";
import type { McpServer } from "../@types";
import { END, interrupt, START, showWidget } from "../@types";
import { createFlow } from "../create-flow";
import { decodeFlowToken } from "../flow-token";

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

/** Extract the flowToken from a parsed payload and return it as-is for passing back */
function extractFlowToken(parsed: Record<string, unknown>): string {
	return parsed.flowToken as string;
}

describe("compileFlow response contract", () => {
	test("returns interrupt JSON content with flowToken", async () => {
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
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "interrupt",
			question: "What's your primary use case?",
			field: "useCase",
		});

		// flowToken should be in the text content
		expect(parsed.flowToken).toBeDefined();
		expect(typeof parsed.flowToken).toBe("string");

		// Decode token to verify its contents
		const tokenData = decodeFlowToken(parsed.flowToken as string);
		expect(tokenData).toMatchObject({
			step: "ask_use_case",
			state: {},
			field: "useCase",
		});

		// Client-injected metadata is in the _meta field
		expect((result._meta as Record<string, unknown>)?.requestId).toBe("req-1");
	});

	test("accepts flowToken input for continue action", async () => {
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

		// Start to get a flowToken
		const r1 = (await handler?.({ action: "start" }, {})) as Record<
			string,
			unknown
		>;
		const p1 = parsePayload(r1);
		const flowToken = extractFlowToken(p1);

		// Continue using flowToken
		const result = (await handler?.(
			{
				action: "continue",
				stateUpdates: { useCase: "Lead qualification" },
				flowToken,
			},
			{},
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({ status: "complete" });
		// Verify final state is in the flowToken
		const tokenData = decodeFlowToken(parsed.flowToken as string);
		expect(tokenData?.state).toMatchObject({
			useCase: "Lead qualification",
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
		const p1 = parsePayload(r1);

		expect(p1.status).toBe("interrupt");
		expect(p1.questions).toHaveLength(3);

		// Step 2: User answers only name — should loop with 2 remaining questions
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Alice" },
				flowToken: extractFlowToken(p1),
			},
			{},
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
				flowToken: extractFlowToken(p2),
			},
			{},
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
				flowToken: extractFlowToken(p3),
			},
			{},
		)) as Record<string, unknown>;
		const p4 = parsePayload(r4);

		expect(p4.status).toBe("complete");
		// Verify final state is in the flowToken
		const tokenData = decodeFlowToken(p4.flowToken as string);
		expect(tokenData?.state).toMatchObject({
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
		const p1 = parsePayload(r1);

		// Answer both at once — should complete
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Bob", email: "bob@test.com" },
				flowToken: extractFlowToken(p1),
			},
			{},
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

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
		const p1 = parsePayload(r1);
		expect(handlerCallCount).toBe(1);

		// Partial answer — handler should NOT be called again (questions cached in flowToken)
		const r2 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { name: "Alice" },
				flowToken: extractFlowToken(p1),
			},
			{},
		)) as Record<string, unknown>;
		expect(handlerCallCount).toBe(1); // Still 1 — no replay

		const p2 = parsePayload(r2);
		expect(p2.status).toBe("interrupt");
		expect(p2.field).toBe("email");

		// Final answer — should complete without re-executing handler
		const r3 = (await handler?.(
			{
				action: "continue",
				stateUpdates: { email: "alice@test.com" },
				flowToken: extractFlowToken(p2),
			},
			{},
		)) as Record<string, unknown>;
		expect(handlerCallCount).toBe(1); // Still 1 — resolved from cache

		const p3 = parsePayload(r3);
		expect(p3.status).toBe("complete");
	});

	test("widget continue without field advances to next node (no stuck loop)", async () => {
		const flow = createFlow({
			id: "widget_no_field_flow",
			title: "Widget No Field Flow",
			description: "Widget without a field should advance on continue.",
			state: {
				result: z.string().describe("Final result"),
			},
		})
			.addNode("show_info", () =>
				showWidget(mockInfoPanelTool, {
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
		const p1 = parsePayload(r1);
		expect(p1.status).toBe("widget");
		expect(p1.flowToken).toBeDefined();

		// Continue from widget using flowToken — should advance to "done" and complete
		const r2 = (await handler?.(
			{
				action: "continue",
				flowToken: extractFlowToken(p1),
			},
			{},
		)) as Record<string, unknown>;
		const p2 = parsePayload(r2);

		// Must complete — NOT show the widget again
		expect(p2.status).toBe("complete");
	});

	test("returns widget JSON content with tool and data for widget steps", async () => {
		const flow = createFlow({
			id: "widget_flow",
			title: "Widget Flow",
			description: "Collect via widget",
			state: {
				plan: z.string().describe("Selected plan"),
			},
		})
			.addNode("pick_plan", () =>
				showWidget(mockPlanPickerTool, {
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
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "widget",
			tool: "plan_picker",
			data: { plans: ["starter", "pro"] },
			description: "Pick your plan",
		});
		expect(parsed.flowToken).toBeDefined();
		// Decode token to verify widget metadata
		const tokenData = decodeFlowToken(parsed.flowToken as string);
		expect(tokenData).toMatchObject({
			step: "pick_plan",
			state: {},
			field: "plan",
			widgetId: "plan_picker",
		});
	});

	test("marks display-only widget steps as non-interactive", async () => {
		const flow = createFlow({
			id: "display_only_widget_flow",
			title: "Display Only Widget Flow",
			description: "Show a display-only widget, then continue immediately.",
			state: {
				done: z.boolean().describe("Whether the flow is done"),
			},
		})
			.addNode("show_teaser", () =>
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
			.compile();

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.({ action: "start" }, {})) as Record<
			string,
			unknown
		>;
		const parsed = parsePayload(result);

		expect(parsed).toMatchObject({
			status: "widget",
			tool: "info_panel",
			interactive: false,
		});
		expect(parsed.flowToken).toBeDefined();
	});
});
