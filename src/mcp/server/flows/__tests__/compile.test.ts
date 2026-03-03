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
		});
		expect((parsed as Record<string, unknown>).field).toBe(undefined);
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
				answer: "Lead qualification",
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
			.addNode("pick_plan", { resource, field: "plan" }, () =>
				showWidget(resource, {
					data: { plans: ["starter", "pro"] },
					description: "Pick your plan",
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
