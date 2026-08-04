import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type {
	FlowContent,
	FlowInterruptContent,
	FlowTokenContent,
} from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";
import { withStartSelfHeal } from "../start-self-heal";
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
 * `withStartSelfHeal` returns the `FlowContent` union, and `createFlowTestHarness`
 * results carry the same union shape. These narrow to the interrupt member so
 * the assertions below can read `context`/`field`/`suggestions`, properties
 * the other members (widget/complete/error) don't declare.
 */
function assertInterruptContent(
	content: FlowContent,
): asserts content is FlowInterruptContent {
	if (content.status !== "interrupt") {
		throw new Error(
			`expected interrupt content, got status "${content.status}"`,
		);
	}
}

function assertInterruptResult(
	result: FlowTestResult,
): asserts result is Extract<FlowTestResult, { status: "interrupt" }> {
	if (result.status !== "interrupt") {
		throw new Error(`expected interrupt result, got status "${result.status}"`);
	}
}

const single = {
	status: "interrupt" as const,
	question: "Favorite color?",
	field: "color",
};

const multi = {
	status: "interrupt" as const,
	questions: [
		{ question: "Name?", field: "name" },
		{ question: "Email?", field: "email" },
	],
};

describe("withStartSelfHeal", () => {
	test("appends the single-question check with the field name", () => {
		const out = withStartSelfHeal(single, { sessionIdEchoed: false });
		assertInterruptContent(out);
		expect(out.context).toContain(
			"BEFORE asking, re-read the user's opening message",
		);
		expect(out.context).toContain('stateUpdates: { "color":');
		expect(out.context).not.toContain("the same sessionId");
	});

	test("mentions the sessionId only when the response echoes one", () => {
		const out = withStartSelfHeal(single, { sessionIdEchoed: true });
		assertInterruptContent(out);
		expect(out.context).toContain('action "continue", the same sessionId');
	});

	test("uses the multi-question form when several questions are open", () => {
		const out = withStartSelfHeal(multi, { sessionIdEchoed: false });
		assertInterruptContent(out);
		expect(out.context).toContain("If it answers any of the questions below");
		expect(out.context).toContain("the engine re-asks the rest");
	});

	test("appends after author context instead of replacing it", () => {
		const out = withStartSelfHeal(
			{ ...single, context: "Only accept a color word." },
			{ sessionIdEchoed: false },
		);
		assertInterruptContent(out);
		expect(out.context?.startsWith("Only accept a color word.")).toBe(true);
		expect(out.context).toContain("BEFORE asking");
	});

	test("leaves validation-error re-parks untouched", () => {
		const errored = {
			...single,
			context: "ERROR: not a color\n\nOnly accept a color word.",
		};
		expect(withStartSelfHeal(errored, { sessionIdEchoed: false })).toBe(
			errored,
		);
	});

	test("leaves non-interrupt content untouched", () => {
		const complete = { status: "complete" as const, state: {} };
		expect(withStartSelfHeal(complete, { sessionIdEchoed: false })).toBe(
			complete,
		);
	});
});

function buildTwoStepFlow() {
	return createFlow({
		id: "self_heal_probe",
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
		.compile({ store: new TestFlowStateStore() });
}

describe("start-interrupt self-heal wiring", () => {
	test("a start that parks on an interrupt carries the check in its context", async () => {
		const h = await createFlowTestHarness(buildTwoStepFlow());
		const r = await h.start("visitor wants a recommendation");
		expect(r.status).toBe("interrupt");
		assertInterruptResult(r);
		expect(r.context).toContain(
			"BEFORE asking, re-read the user's opening message",
		);
	});

	test("a continue that advances carries no check", async () => {
		const h = await createFlowTestHarness(buildTwoStepFlow());
		await h.start("visitor wants a recommendation");
		const r = await h.continueWith({ color: "Red" });
		expect(r.status).toBe("interrupt");
		assertInterruptResult(r);
		expect(r.field).toBe("size");
		expect(r.context ?? "").not.toContain("BEFORE asking");
	});

	test("an empty bounce re-parks without the check (no loop)", async () => {
		const h = await createFlowTestHarness(buildTwoStepFlow());
		await h.start("visitor wants a recommendation");
		const r = await h.continueWith({});
		expect(r.status).toBe("interrupt");
		assertInterruptResult(r);
		expect(r.field).toBe("color");
		expect(r.context ?? "").not.toContain("BEFORE asking");
	});

	test("a start that auto-skips to a later step still gets the check on that step", async () => {
		const h = await createFlowTestHarness(buildTwoStepFlow());
		const r = await h.start("visitor wants a recommendation", { color: "Red" });
		expect(r.status).toBe("interrupt");
		assertInterruptResult(r);
		expect(r.field).toBe("size");
		expect(r.context).toContain("BEFORE asking");
	});

	test("suggestions meta is unaffected by the injection", async () => {
		const h = await createFlowTestHarness(buildTwoStepFlow());
		const r = await h.start("visitor wants a recommendation");
		assertInterruptResult(r);
		expect(r.suggestions).toEqual(["Red", "Blue"]);
	});
});
