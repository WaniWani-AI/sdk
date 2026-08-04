import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { RegisteredTool } from "../../../../legacy/mcp/tools/types";
import type { FlowTokenContent, McpServer } from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";
import type { FlowTestResult } from "../test-utils";
import { createFlowTestHarness } from "../test-utils";

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

/**
 * Fails the first read (the redirect probe made by a "start" call) and
 * succeeds afterward. The later, successful reads let the test harness's own
 * `decodedState` bookkeeping fetch (see `toResult` in `test-utils.ts`) resolve
 * normally, so only the redirect probe's catch-and-fall-through is under test.
 */
class ThrowingReadStore extends TestFlowStateStore {
	private reads = 0;
	override async get(key: string): Promise<FlowTokenContent | null> {
		this.reads += 1;
		if (this.reads === 1) {
			throw new Error("kv unavailable");
		}
		return super.get(key);
	}
}

/**
 * `FlowTestResult` is a union of the four flow content shapes plus a decoded
 * state. These narrow to the member under test so assertions can read
 * `field`/`context`/`tool`, properties the other members don't declare.
 */
function assertInterruptResult(
	result: FlowTestResult,
): asserts result is Extract<FlowTestResult, { status: "interrupt" }> {
	if (result.status !== "interrupt") {
		throw new Error(`expected interrupt result, got status "${result.status}"`);
	}
}

function assertWidgetResult(
	result: FlowTestResult,
): asserts result is Extract<FlowTestResult, { status: "widget" }> {
	if (result.status !== "widget") {
		throw new Error(`expected widget result, got status "${result.status}"`);
	}
}

function buildTwoStepFlow(store: TestFlowStateStore) {
	return createFlow({
		id: "idempotent_probe",
		title: "p",
		description: "d",
		state: { color: z.string().optional(), size: z.string().optional() },
	})
		.addNode("ask_color", ({ interrupt }) =>
			interrupt({
				color: { question: "Favorite color?", suggestions: ["Red", "Blue"] },
			}),
		)
		.addNode("ask_size", ({ interrupt }) =>
			interrupt({ size: { question: "Which size?", suggestions: ["S", "M"] } }),
		)
		.addEdge(START, "ask_color")
		.addEdge("ask_color", "ask_size")
		.addEdge("ask_size", END)
		.compile({ store });
}

describe("idempotent start on a live session", () => {
	test("a second start resumes the parked step instead of restarting", async () => {
		const store = new TestFlowStateStore();
		const h = await createFlowTestHarness(buildTwoStepFlow(store), {
			stateStore: store,
		});
		await h.start("first start");
		await h.continueWith({ color: "Red" });
		const r = await h.start("spurious second start");
		expect(r.status).toBe("interrupt");
		assertInterruptResult(r);
		expect(r.field).toBe("size");
		expect(r.decodedState?.state).toMatchObject({ color: "Red" });
	});

	test("the redirected result explains itself and points at reset", async () => {
		const store = new TestFlowStateStore();
		const h = await createFlowTestHarness(buildTwoStepFlow(store), {
			stateStore: store,
		});
		await h.start("first start");
		const r = await h.start("spurious second start");
		assertInterruptResult(r);
		expect(r.context).toContain(
			"already in progress; resumed at the current step",
		);
		expect(r.context).toContain('Use action "reset"');
		expect(r.context ?? "").not.toContain("BEFORE asking");
	});

	test("a redirected start merges its stateUpdates like a continue", async () => {
		const store = new TestFlowStateStore();
		const h = await createFlowTestHarness(buildTwoStepFlow(store), {
			stateStore: store,
		});
		await h.start("first start");
		const r = await h.start("second start carrying the answer", {
			color: "Blue",
		});
		expect(r.status).toBe("interrupt");
		assertInterruptResult(r);
		expect(r.field).toBe("size");
		expect(r.decodedState?.state).toMatchObject({ color: "Blue" });
	});

	test("a start after completion runs fresh (restart path preserved)", async () => {
		const store = new TestFlowStateStore();
		const h = await createFlowTestHarness(buildTwoStepFlow(store), {
			stateStore: store,
		});
		await h.start("first start");
		await h.continueWith({ color: "Red" });
		await h.continueWith({ size: "M" });
		const r = await h.start("brand new run");
		expect(r.status).toBe("interrupt");
		assertInterruptResult(r);
		expect(r.field).toBe("color");
	});

	test("an unreadable store falls through to a fresh start", async () => {
		const store = new ThrowingReadStore();
		const h = await createFlowTestHarness(buildTwoStepFlow(store), {
			stateStore: store,
		});
		const r = await h.start("first start on a flaky store");
		expect(r.status).toBe("interrupt");
		assertInterruptResult(r);
		expect(r.field).toBe("color");
	});
});

const mockPlanPickerTool: RegisteredTool = {
	id: "plan_picker",
	title: "Plan Picker",
	description: "Show plan picker widget",
	register: async () => {},
};

function buildWidgetFlow(store: TestFlowStateStore) {
	return createFlow({
		id: "idempotent_widget_probe",
		title: "p",
		description: "d",
		state: { color: z.string().optional(), plan: z.string().optional() },
	})
		.addNode("ask_color", ({ interrupt }) =>
			interrupt({
				color: { question: "Favorite color?", suggestions: ["Red", "Blue"] },
			}),
		)
		.addNode("show_plan", ({ showWidget }) =>
			showWidget({ tool: mockPlanPickerTool, field: "plan" }),
		)
		.addEdge(START, "ask_color")
		.addEdge("ask_color", "show_plan")
		.addEdge("show_plan", END)
		.compile({ store });
}

describe("idempotent start while parked on a widget", () => {
	test("a start while parked on a widget re-emits the widget instead of skipping it", async () => {
		const store = new TestFlowStateStore();
		const h = await createFlowTestHarness(buildWidgetFlow(store), {
			stateStore: store,
		});
		await h.start("first start");
		const first = await h.continueWith({ color: "Red" });
		assertWidgetResult(first);

		const r = await h.start("spurious second start");
		assertWidgetResult(r);
		expect(r.tool).toBe(first.tool);
	});
});

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

function parsePayload(
	result: Record<string, unknown>,
): Record<string, unknown> {
	const content = result.content as Array<{ type: string; text?: string }>;
	return JSON.parse(content[0]?.text ?? "") as Record<string, unknown>;
}

describe("idempotent start across flows sharing a session id", () => {
	test("a start with a session id parked by another flow runs fresh instead of redirecting into it", async () => {
		const store = new TestFlowStateStore();
		const extra = { _meta: { sessionId: "shared-session-cross-flow" } };

		const flowA = buildTwoStepFlow(store);
		const mockA = mockServer();
		await flowA.register(mockA.server);
		const handlerA = mockA.registered[0]?.[2];
		if (!handlerA) {
			throw new Error('flow "idempotent_probe" did not register a handler');
		}

		// Park flow A mid-flow under the shared session id.
		await handlerA({ action: "start", intent: "park flow A" }, extra);
		await handlerA(
			{ action: "continue", stateUpdates: { color: "Red" } },
			extra,
		);

		// Flow B has its own id and its own node names, but shares the store and,
		// via the shared session id, sees flow A's parked step on a start.
		const flowB = createFlow({
			id: "idempotent_other_flow",
			title: "p",
			description: "d",
			state: { nickname: z.string().optional() },
		})
			.addNode("ask_nickname", ({ interrupt }) =>
				interrupt({ nickname: { question: "What should we call you?" } }),
			)
			.addEdge(START, "ask_nickname")
			.addEdge("ask_nickname", END)
			.compile({ store });

		const mockB = mockServer();
		await flowB.register(mockB.server);
		const handlerB = mockB.registered[0]?.[2];
		if (!handlerB) {
			throw new Error(
				'flow "idempotent_other_flow" did not register a handler',
			);
		}

		const resultB = (await handlerB(
			{ action: "start", intent: "start flow B" },
			extra,
		)) as Record<string, unknown>;
		const parsedB = parsePayload(resultB);

		expect(parsedB.status).toBe("interrupt");
		expect(parsedB.field).toBe("nickname");
		expect((parsedB.context as string | undefined) ?? "").not.toContain(
			"already in progress",
		);
		expect(resultB.isError).toBeUndefined();
	});

	test("a start with a session id parked by another flow's same-named step still runs fresh with no state bleed", async () => {
		const store = new TestFlowStateStore();
		const extra = { _meta: { sessionId: "shared-session-same-node-name" } };

		// Both flows name their first (and only) node "confirm", so a guard
		// keyed on node-name presence alone would treat flow A's record as
		// belonging to flow B too.
		const flowA = createFlow({
			id: "idempotent_same_name_a",
			title: "p",
			description: "d",
			state: { topic: z.string().optional(), note: z.string().optional() },
		})
			.addNode("confirm", ({ interrupt }) =>
				interrupt({ topic: { question: "What's the topic?" } }),
			)
			.addEdge(START, "confirm")
			.addEdge("confirm", END)
			.compile({ store });

		const mockA = mockServer();
		await flowA.register(mockA.server);
		const handlerA = mockA.registered[0]?.[2];
		if (!handlerA) {
			throw new Error(
				'flow "idempotent_same_name_a" did not register a handler',
			);
		}

		// Park flow A on "confirm" carrying a field ("note") flow B never
		// declares, without answering "topic" (so the flow stays parked there).
		await handlerA(
			{
				action: "start",
				intent: "park flow A",
				stateUpdates: { note: "A's private note" },
			},
			extra,
		);

		const flowB = createFlow({
			id: "idempotent_same_name_b",
			title: "p",
			description: "d",
			state: { nickname: z.string().optional() },
		})
			.addNode("confirm", ({ interrupt }) =>
				interrupt({ nickname: { question: "What should we call you?" } }),
			)
			.addEdge(START, "confirm")
			.addEdge("confirm", END)
			.compile({ store });

		const mockB = mockServer();
		await flowB.register(mockB.server);
		const handlerB = mockB.registered[0]?.[2];
		if (!handlerB) {
			throw new Error(
				'flow "idempotent_same_name_b" did not register a handler',
			);
		}

		const resultB = (await handlerB(
			{ action: "start", intent: "start flow B" },
			extra,
		)) as Record<string, unknown>;
		const parsedB = parsePayload(resultB);

		expect(parsedB.status).toBe("interrupt");
		expect(parsedB.field).toBe("nickname");
		expect((parsedB.context as string | undefined) ?? "").not.toContain(
			"already in progress",
		);
		expect(resultB.isError).toBeUndefined();

		const decoded = await store.get("shared-session-same-node-name");
		expect(decoded?.state).not.toHaveProperty("note");
	});
});
