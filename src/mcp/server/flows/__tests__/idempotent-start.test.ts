import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { RegisteredTool } from "../../../../legacy/mcp/tools/types";
import type { FlowTokenContent } from "../@types";
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
