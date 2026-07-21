import { describe, expect, test } from "bun:test";

import type { WidgetEvent } from "../widget-events";
import { emitWidgetEvent } from "../widget-events";

describe("emitWidgetEvent", () => {
	test("invokes the callback with the event", () => {
		const received: WidgetEvent[] = [];
		emitWidgetEvent((e) => received.push(e), {
			name: "chat.opened",
			sessionId: "sess_1",
			properties: { mode: "floating" },
		});

		expect(received).toHaveLength(1);
		expect(received[0]?.name).toBe("chat.opened");
		expect(received[0]?.sessionId).toBe("sess_1");
		expect(received[0]?.properties).toEqual({ mode: "floating" });
	});

	test("no-ops without a callback", () => {
		expect(() =>
			emitWidgetEvent(undefined, { name: "message.sent" }),
		).not.toThrow();
	});

	test("swallows callback exceptions", () => {
		expect(() =>
			emitWidgetEvent(
				() => {
					throw new Error("host page bug");
				},
				{ name: "message.received" },
			),
		).not.toThrow();
	});
});
