import { describe, expect, test } from "bun:test";

import type { WidgetEvent } from "../widget-events";
import {
	createNoopWidgetEventEmitter,
	createWidgetEventEmitter,
} from "../widget-events";

describe("createWidgetEventEmitter", () => {
	test("enriches events with mode, timestamp and live sessionId", () => {
		let sessionId: string | undefined;
		const emitter = createWidgetEventEmitter({
			mode: "floating",
			getSessionId: () => sessionId,
		});
		const received: WidgetEvent[] = [];
		emitter.subscribe((e) => received.push(e));

		emitter.emit({ name: "chat.opened" });
		sessionId = "sess_1";
		emitter.emit({ name: "message.received" });

		expect(received).toHaveLength(2);
		expect(received[0]?.name).toBe("chat.opened");
		expect(received[0]?.mode).toBe("floating");
		expect(received[0]?.sessionId).toBeUndefined();
		expect(typeof received[0]?.timestamp).toBe("number");
		expect(received[1]?.sessionId).toBe("sess_1");
	});

	test("explicit sessionId on emit wins over the getter", () => {
		const emitter = createWidgetEventEmitter({
			mode: "inline",
			getSessionId: () => "sess_old",
		});
		const received: WidgetEvent[] = [];
		emitter.subscribe((e) => received.push(e));

		emitter.emit({
			name: "session.started",
			sessionId: "sess_new",
			properties: { sessionId: "sess_new" },
		});

		expect(received[0]?.sessionId).toBe("sess_new");
		expect(received[0]?.name).toBe("session.started");
		if (received[0]?.name === "session.started") {
			expect(received[0].properties.sessionId).toBe("sess_new");
		}
	});

	test("supports multiple subscribers and unsubscribe", () => {
		const emitter = createWidgetEventEmitter({ mode: "floating" });
		const a: string[] = [];
		const b: string[] = [];
		const unsubA = emitter.subscribe((e) => a.push(e.name));
		emitter.subscribe((e) => b.push(e.name));

		emitter.emit({ name: "chat.ready" });
		unsubA();
		emitter.emit({ name: "message.sent" });

		expect(a).toEqual(["chat.ready"]);
		expect(b).toEqual(["chat.ready", "message.sent"]);
	});

	test("unsubscribing a peer during emit keeps the in-flight snapshot intact", () => {
		const emitter = createWidgetEventEmitter({ mode: "inline" });
		const received: string[] = [];
		let unsubPeer = () => {};
		emitter.subscribe(() => {
			unsubPeer();
		});
		unsubPeer = emitter.subscribe((e) => received.push(e.name));

		emitter.emit({ name: "chat.ready" });
		emitter.emit({ name: "message.sent" });

		expect(received).toEqual(["chat.ready"]);
	});

	test("subscribing during emit defers the new listener to the next emit", () => {
		const emitter = createWidgetEventEmitter({ mode: "inline" });
		const received: string[] = [];
		let lateAttached = false;
		emitter.subscribe(() => {
			if (!lateAttached) {
				lateAttached = true;
				emitter.subscribe((e) => received.push(e.name));
			}
		});

		emitter.emit({ name: "chat.ready" });
		emitter.emit({ name: "message.sent" });

		expect(received).toEqual(["message.sent"]);
	});

	test("double-calling an unsubscribe function is a safe no-op", () => {
		const emitter = createWidgetEventEmitter({ mode: "inline" });
		const received: string[] = [];
		const unsub = emitter.subscribe(() => {});
		emitter.subscribe((e) => received.push(e.name));

		unsub();
		expect(() => unsub()).not.toThrow();
		emitter.emit({ name: "chat.ready" });

		expect(received).toEqual(["chat.ready"]);
	});

	test("session.started derives its top-level id from properties", () => {
		const emitter = createWidgetEventEmitter({
			mode: "inline",
			getSessionId: () => "sess_stale",
		});
		const received: WidgetEvent[] = [];
		emitter.subscribe((e) => received.push(e));

		emitter.emit({
			name: "session.started",
			properties: { sessionId: "sess_fresh" },
		});

		expect(received[0]?.sessionId).toBe("sess_fresh");
	});

	test("a throwing subscriber never breaks the emit nor other subscribers", () => {
		const emitter = createWidgetEventEmitter({ mode: "inline" });
		const received: string[] = [];
		emitter.subscribe(() => {
			throw new Error("host page bug");
		});
		emitter.subscribe((e) => received.push(e.name));

		expect(() => emitter.emit({ name: "message.received" })).not.toThrow();
		expect(received).toEqual(["message.received"]);
	});

	test("detail events carry their typed properties", () => {
		const emitter = createWidgetEventEmitter({ mode: "inline" });
		const received: WidgetEvent[] = [];
		emitter.subscribe((e) => received.push(e));

		emitter.emit({
			name: "suggestion.clicked",
			properties: { text: "What are your prices?", index: 2 },
		});
		emitter.emit({
			name: "link.clicked",
			properties: { url: "https://x.dev" },
		});
		emitter.emit({ name: "chat.error", properties: { message: "boom" } });
		emitter.emit({ name: "thread.changed", properties: { threadId: "t1" } });

		expect(received.map((e) => e.name)).toEqual([
			"suggestion.clicked",
			"link.clicked",
			"chat.error",
			"thread.changed",
		]);
		if (received[0]?.name === "suggestion.clicked") {
			expect(received[0].properties).toEqual({
				text: "What are your prices?",
				index: 2,
			});
		}
	});
});

describe("createNoopWidgetEventEmitter", () => {
	test("emit and subscribe are inert and safe", () => {
		const emitter = createNoopWidgetEventEmitter();
		const unsub = emitter.subscribe(() => {
			throw new Error("never called");
		});
		expect(() => emitter.emit({ name: "chat.ready" })).not.toThrow();
		expect(() => unsub()).not.toThrow();
	});
});
