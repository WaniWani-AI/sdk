import { describe, expect, it } from "bun:test";
import type { WebMcpCallResult } from "../@types";
import { readWidgetStep, rewriteForAgent } from "../widget-step";

/** A flow tool result, shaped the way the engine actually emits one. */
function flowResult(payload: Record<string, unknown>): WebMcpCallResult {
	return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

const WIDGET_PAYLOAD = {
	status: "widget",
	tool: "show-book-call",
	data: { email: "a@b.c" },
	description:
		"IMPORTANT: You MUST now call the show-book-call tool to display the widget. Do NOT skip this step",
	interactive: true,
	sessionId: "flow-session-1",
};

describe("readWidgetStep", () => {
	it("reads a widget step", () => {
		const step = readWidgetStep(flowResult(WIDGET_PAYLOAD));
		expect(step).not.toBeNull();
		expect(step?.tool).toBe("show-book-call");
		expect(step?.data).toEqual({ email: "a@b.c" });
		expect(step?.interactive).toBe(true);
	});

	it("treats an unset interactive as display-only", () => {
		const step = readWidgetStep(
			flowResult({ status: "widget", tool: "show-card" }),
		);
		expect(step?.interactive).toBe(false);
		expect(step?.data).toEqual({});
	});

	it("treats a non-boolean interactive as display-only", () => {
		const step = readWidgetStep(
			flowResult({ status: "widget", tool: "show-card", interactive: "yes" }),
		);
		expect(step?.interactive).toBe(false);
	});

	it("ignores a data that is not an object", () => {
		expect(
			readWidgetStep(flowResult({ status: "widget", tool: "t", data: [1, 2] }))
				?.data,
		).toEqual({});
		expect(
			readWidgetStep(flowResult({ status: "widget", tool: "t", data: "x" }))
				?.data,
		).toEqual({});
	});

	it("passes every other flow status through", () => {
		for (const status of ["interrupt", "complete", "error"]) {
			expect(readWidgetStep(flowResult({ status }))).toBeNull();
		}
	});

	it("passes an ordinary tool result through", () => {
		expect(
			readWidgetStep({ content: [{ type: "text", text: "just some prose" }] }),
		).toBeNull();
		expect(
			readWidgetStep({ content: [{ type: "text", text: "[1,2,3]" }] }),
		).toBeNull();
		expect(
			readWidgetStep({ content: [{ type: "image", data: "…" }] }),
		).toBeNull();
		expect(readWidgetStep({ content: [] })).toBeNull();
		expect(readWidgetStep({})).toBeNull();
	});

	it("requires a tool to call", () => {
		expect(readWidgetStep(flowResult({ status: "widget" }))).toBeNull();
		expect(
			readWidgetStep(flowResult({ status: "widget", tool: 7 })),
		).toBeNull();
	});
});

describe("rewriteForAgent", () => {
	const step = readWidgetStep(flowResult(WIDGET_PAYLOAD));
	if (!step) {
		throw new Error("fixture should parse");
	}

	it("reports widget_shown and tells an interactive step to wait", () => {
		const out = rewriteForAgent(step, true);
		expect(out.status).toBe("widget_shown");
		expect(out.instructions).toContain("wait for the user");
	});

	it("tells a display-only step to continue", () => {
		const out = rewriteForAgent({ ...step, interactive: false }, true);
		expect(out.status).toBe("widget_shown");
		expect(out.instructions).toContain('action "continue"');
		expect(out.instructions).not.toContain("wait for the user");
	});

	it("falls back to carrying the step in words", () => {
		const out = rewriteForAgent(step, false);
		expect(out.status).toBe("widget_unavailable");
		expect(out.instructions).toContain("Carry the step in words");
	});

	// Both name a display tool that is not advertised on this surface. Leaving
	// either in place is an instruction to call something that cannot be called,
	// and the engine's `description` says exactly that in capitals.
	it("strips both references to the display tool", () => {
		for (const rendered of [true, false]) {
			const out = rewriteForAgent(step, rendered);
			expect(out.tool).toBeUndefined();
			expect(out.description).toBeUndefined();
			expect(JSON.stringify(out)).not.toContain("show-book-call");
		}
	});

	it("carries the rest of the payload through untouched", () => {
		const out = rewriteForAgent(step, true);
		expect(out.sessionId).toBe("flow-session-1");
		expect(out.data).toEqual({ email: "a@b.c" });
	});

	// The engine grows fields on the widget payload (`intro` arrived in 0.20.1).
	// Anything it adds has to reach the agent, because the protocol may require
	// the agent to echo it back.
	it("carries fields the engine adds later", () => {
		const withIntro = readWidgetStep(
			flowResult({ ...WIDGET_PAYLOAD, intro: { text: "hi" }, field: "slot" }),
		);
		const out = rewriteForAgent(
			withIntro as NonNullable<typeof withIntro>,
			true,
		);
		expect(out.intro).toEqual({ text: "hi" });
		expect(out.field).toBe("slot");
	});
});
