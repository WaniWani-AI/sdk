import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";
import { initAutoCapture } from "../auto-capture";
import type { WidgetEvent } from "../widget-transport";

let win: InstanceType<typeof GlobalWindow>;

beforeEach(() => {
	win = new GlobalWindow();
	globalThis.window = win as unknown as typeof globalThis.window;
	globalThis.document = win.document as unknown as typeof globalThis.document;
	globalThis.navigator =
		win.navigator as unknown as typeof globalThis.navigator;
});

afterEach(() => {
	win.close();
});

function byType(enqueued: WidgetEvent[][], type: string) {
	return enqueued.filter((batch) => batch[0]?.event_type === type);
}

describe("data-ww-conversion", () => {
	let enqueued: WidgetEvent[][];
	let cleanup: () => void;

	beforeEach(() => {
		enqueued = [];
	});

	test("parses name and properties from single attribute", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ww-conversion", "purchase value:49.99 currency:EUR");
		document.body.appendChild(btn);

		cleanup = initAutoCapture(
			{ sessionId: "sess-1", traceId: "trace-1" },
			(events) => enqueued.push(events),
		);
		btn.click();

		const events = byType(enqueued, "conversion");
		expect(events).toHaveLength(1);

		const event = events[0][0];
		expect(event.event_type).toBe("conversion");
		expect(event.event_name).toBe("purchase");
		expect((event.metadata as Record<string, unknown>)?.value).toBe(49.99);
		expect((event.metadata as Record<string, unknown>)?.currency).toBe("EUR");
		expect(event.session_id).toBe("sess-1");
		expect(event.trace_id).toBe("trace-1");

		cleanup();
	});

	test("sends no metadata when only name given", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ww-conversion", "signup");
		document.body.appendChild(btn);

		cleanup = initAutoCapture(
			{ sessionId: "sess-1", traceId: "trace-1" },
			(events) => enqueued.push(events),
		);
		btn.click();

		const events = byType(enqueued, "conversion");
		expect(events).toHaveLength(1);

		const event = events[0][0];
		expect(event.event_name).toBe("signup");
		expect(event.metadata).toBe(undefined);

		cleanup();
	});

	test("click on child bubbles up to find data attribute", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ww-conversion", "upgrade value:9.99");
		const span = document.createElement("span");
		span.textContent = "Upgrade";
		btn.appendChild(span);
		document.body.appendChild(btn);

		cleanup = initAutoCapture(
			{ sessionId: "sess-1", traceId: "trace-1" },
			(events) => enqueued.push(events),
		);
		span.click();

		const events = byType(enqueued, "conversion");
		expect(events).toHaveLength(1);
		expect(events[0][0].event_name).toBe("upgrade");
		expect((events[0][0].metadata as Record<string, unknown>)?.value).toBe(
			9.99,
		);

		cleanup();
	});

	test("does not fire without the attribute", () => {
		const btn = document.createElement("button");
		btn.textContent = "No tracking";
		document.body.appendChild(btn);

		cleanup = initAutoCapture(
			{ sessionId: "sess-1", traceId: "trace-1" },
			(events) => enqueued.push(events),
		);
		btn.click();

		expect(byType(enqueued, "conversion")).toHaveLength(0);

		cleanup();
	});
});

describe("data-ww-step", () => {
	let enqueued: WidgetEvent[][];
	let cleanup: () => void;

	beforeEach(() => {
		enqueued = [];
	});

	test("fires step event with name and auto-incrementing sequence", () => {
		const btn1 = document.createElement("button");
		btn1.setAttribute("data-ww-step", "pricing");
		const btn2 = document.createElement("button");
		btn2.setAttribute("data-ww-step", "checkout");
		document.body.appendChild(btn1);
		document.body.appendChild(btn2);

		cleanup = initAutoCapture(
			{ sessionId: "sess-1", traceId: "trace-1" },
			(events) => enqueued.push(events),
		);
		btn1.click();
		btn2.click();

		const events = byType(enqueued, "step");
		expect(events).toHaveLength(2);

		expect(events[0][0].event_name).toBe("pricing");
		expect(events[0][0].step_sequence).toBe(1);

		expect(events[1][0].event_name).toBe("checkout");
		expect(events[1][0].step_sequence).toBe(2);

		cleanup();
	});

	test("includes extra properties as metadata", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ww-step", "select-plan plan:premium tier:3");
		document.body.appendChild(btn);

		cleanup = initAutoCapture(
			{ sessionId: "sess-1", traceId: "trace-1" },
			(events) => enqueued.push(events),
		);
		btn.click();

		const events = byType(enqueued, "step");
		expect(events).toHaveLength(1);

		const event = events[0][0];
		expect(event.event_name).toBe("select-plan");
		expect(event.step_sequence).toBe(1);
		expect((event.metadata as Record<string, unknown>)?.plan).toBe("premium");
		expect((event.metadata as Record<string, unknown>)?.tier).toBe(3);

		cleanup();
	});

	test("click on child bubbles up to find data attribute", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ww-step", "confirm");
		const span = document.createElement("span");
		span.textContent = "Confirm";
		btn.appendChild(span);
		document.body.appendChild(btn);

		cleanup = initAutoCapture(
			{ sessionId: "sess-1", traceId: "trace-1" },
			(events) => enqueued.push(events),
		);
		span.click();

		const events = byType(enqueued, "step");
		expect(events).toHaveLength(1);
		expect(events[0][0].event_name).toBe("confirm");

		cleanup();
	});

	test("does not fire without the attribute", () => {
		const btn = document.createElement("button");
		btn.textContent = "No tracking";
		document.body.appendChild(btn);

		cleanup = initAutoCapture(
			{ sessionId: "sess-1", traceId: "trace-1" },
			(events) => enqueued.push(events),
		);
		btn.click();

		expect(byType(enqueued, "step")).toHaveLength(0);

		cleanup();
	});
});
