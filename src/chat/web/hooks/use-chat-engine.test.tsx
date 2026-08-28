import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).indexedDB = new IDBFactory();
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IDBKeyRange = IDBKeyRange;

// ---------------------------------------------------------------------------
// Set up DOM globals before importing React
// ---------------------------------------------------------------------------

const win = new Window({ url: "https://localhost" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"MutationObserver",
	"customElements",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// React checks for `window` specifically
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// Tell React this is a test environment so act() works without warnings
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Now safe to import React
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * Controllable mock for `useChat` from `@ai-sdk/react`.
 *
 * We capture the `onFinish` / `onError` callbacks so the test can invoke them
 * at precise moments, and expose a setter for `status` so we can simulate the
 * "submitted → streaming → ready" lifecycle.
 */
let useChatStatus = "ready";
let capturedOnFinish:
	| ((payload: {
			message: unknown;
			isAbort?: boolean;
			isDisconnect?: boolean;
			isError?: boolean;
	  }) => void)
	| undefined;
let capturedOnError: ((error: Error) => void) | undefined;
const mockSendMessage = mock((..._args: unknown[]) => {});
const mockSetMessages = mock(() => {});

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({
	useChat(opts: {
		onFinish?: (payload: { message: unknown }) => void;
		onError?: (error: Error) => void;
	}) {
		capturedOnFinish = opts.onFinish;
		capturedOnError = opts.onError;
		return {
			messages: [],
			sendMessage: mockSendMessage,
			setMessages: mockSetMessages,
			status: useChatStatus,
		};
	},
}));

// Capture transport body callback so we can inspect resolvedBody without
// actually firing a network request through the real DefaultChatTransport.
let capturedTransportBody: (() => Record<string, unknown>) | undefined;
// The engine clears its per-turn refs inside the transport's own `fetch`
// wrapper, so tests need a handle on it to model a completed request.
let capturedTransportFetch: typeof fetch | undefined;
// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../lib/lenient-chat-transport", () => ({
	LenientChatTransport: class {
		constructor(opts: {
			body?: () => Record<string, unknown>;
			fetch?: typeof fetch;
		}) {
			capturedTransportBody = opts.body;
			capturedTransportFetch = opts.fetch;
		}
	},
}));

// Stub fetch so the tools-list request and other fetches don't hit the network
const originalFetch = globalThis.fetch;
beforeEach(() => {
	globalThis.fetch = mock(async () =>
		Response.json({ tools: [] }),
	) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

// Now import the hook under test (after mocks are registered)
const { useChatEngine } = await import("./use-chat-engine");
const { WidgetEventsProvider } = await import("../embed/widget-events-context");
const { createWidgetEventEmitter } = await import("../embed/widget-events");
type WidgetEventType = import("../embed/widget-events").WidgetEvent;

// ---------------------------------------------------------------------------
// Test harness — a thin component that exposes the hook's return value via ref
// ---------------------------------------------------------------------------

type HookReturn = ReturnType<typeof useChatEngine>;

function Harness({
	resultRef,
	body,
}: {
	resultRef: { current: HookReturn | null };
	body?: Record<string, unknown>;
}) {
	const engine = useChatEngine({ api: "/api/waniwani", body });
	resultRef.current = engine;
	return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let root: Root;
let container: HTMLElement;
let hookRef: { current: HookReturn | null };

beforeEach(() => {
	useChatStatus = "ready";
	capturedOnFinish = undefined;
	capturedOnError = undefined;
	mockSendMessage.mockClear();

	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);

	hookRef = { current: null };

	act(() => {
		root.render(createElement(Harness, { resultRef: hookRef }));
	});
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useChatEngine – sendMessageAndWait deferred resolution", () => {
	test("resolves only after status transitions to 'ready'", async () => {
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		// Simulate the chat being in-flight so onFinish isn't immediately
		// followed by a "ready" status.
		useChatStatus = "streaming";
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});

		// Call sendMessageAndWait — this internally sets pendingWaitRef
		let resolved = false;
		let resolvedValue: unknown;
		const promise = engine.sendMessageAndWait("hello").then((msg) => {
			resolved = true;
			resolvedValue = msg;
		});

		expect(mockSendMessage).toHaveBeenCalledTimes(1);

		// Simulate onFinish firing while status is still "streaming"
		const fakeMessage = { id: "msg-1", role: "assistant", content: "hi" };
		act(() => {
			capturedOnFinish?.({ message: fakeMessage });
		});

		// Give microtasks a chance to flush — the promise should NOT resolve yet
		await new Promise((r) => setTimeout(r, 0));
		expect(resolved).toBe(false);

		// Now transition status to "ready" — the useEffect should fire and
		// resolve the promise
		useChatStatus = "ready";
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});

		await promise;
		expect(resolved).toBe(true);
		expect(resolvedValue).toEqual(fakeMessage);
	});

	test("rejects when onError fires", async () => {
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		useChatStatus = "streaming";
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});

		let rejected = false;
		let rejectedError: Error | undefined;
		const promise = engine.sendMessageAndWait("hello").catch((err) => {
			rejected = true;
			rejectedError = err;
		});

		// Simulate an error
		act(() => {
			capturedOnError?.(new Error("stream failed"));
		});

		await promise;
		expect(rejected).toBe(true);
		expect(rejectedError?.message).toBe("stream failed");
	});

	test("does not resolve when onFinish fires without a pending wait", () => {
		// Verify onFinish doesn't throw when there's no pending promise
		useChatStatus = "streaming";
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});

		act(() => {
			capturedOnFinish?.({
				message: { id: "msg-2", role: "assistant", content: "ignored" },
			});
		});

		// Transition to ready — no pending promise, should not throw
		useChatStatus = "ready";
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});

		expect(true).toBe(true);
	});
});

async function flushAsync() {
	await act(async () => {
		await new Promise((r) => setTimeout(r, 30));
	});
}

describe("useChatEngine – thread history", () => {
	test("resolvedBody.threadId is set after the first send", async () => {
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}
		// Wait for visitor context + thread history load to settle
		await flushAsync();
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});

		expect(capturedTransportBody).toBeDefined();
		const body = capturedTransportBody?.();
		expect(typeof body?.threadId).toBe("string");
		expect((body?.threadId as string).length).toBeGreaterThan(5);
	});

	test("startNewThread clears messages and creates a new threadId", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		// Force-create the first thread by invoking the body builder.
		const firstBody = capturedTransportBody?.();
		const firstThreadId = firstBody?.threadId as string;
		expect(typeof firstThreadId).toBe("string");

		mockSetMessages.mockClear();
		let nextId: string | undefined;
		act(() => {
			nextId = engine.startNewThread();
		});

		expect(typeof nextId).toBe("string");
		expect(nextId).not.toBe(firstThreadId);
		expect(mockSetMessages).toHaveBeenCalled();

		// Body builder now uses the new threadId
		const secondBody = capturedTransportBody?.();
		expect(secondBody?.threadId).toBe(nextId);
	});
});

// Re-renders the shared root with Harness wrapped in a WidgetEventsProvider,
// so the captured useChat/transport mocks belong to the provider-wrapped
// engine (a second concurrent mount would race over them). Returns a
// `rerender` bound to the same emitter for prop/status changes, and awaits
// the mount-effect continuations so they settle inside act.
async function mountWithEvents(options?: {
	body?: Record<string, unknown>;
	getSessionId?: () => string | undefined;
}) {
	const events: WidgetEventType[] = [];
	const emitter = createWidgetEventEmitter({
		mode: "inline",
		getSessionId: options?.getSessionId,
	});
	emitter.subscribe((event) => {
		events.push(event);
	});
	const rerender = (next?: { body?: Record<string, unknown> }) => {
		act(() => {
			root.render(
				createElement(
					WidgetEventsProvider,
					{ value: emitter },
					createElement(Harness, {
						resultRef: hookRef,
						body: next?.body ?? options?.body,
					}),
				),
			);
		});
	};
	rerender();
	await flushAsync();
	return { events, rerender };
}

describe("useChatEngine – widget events", () => {
	test("message.sent fires on submit and never carries the text", async () => {
		const { events } = await mountWithEvents();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		act(() => {
			engine.handleSubmit({ text: "my secret question", files: [] });
		});

		const sent = events.filter((e) => e.name === "message.sent");
		expect(sent.length).toBe(1);
		expect(JSON.stringify(events)).not.toContain("my secret question");
	});

	test("message.sent fires exactly once for a queued message", async () => {
		const { events, rerender } = await mountWithEvents();
		useChatStatus = "streaming";
		rerender();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		act(() => {
			engine.handleSubmit({ text: "queued while streaming", files: [] });
		});
		expect(events.filter((e) => e.name === "message.sent").length).toBe(0);

		useChatStatus = "ready";
		rerender();

		expect(events.filter((e) => e.name === "message.sent").length).toBe(1);
	});

	test("message.received fires on finish", async () => {
		const { events } = await mountWithEvents();

		act(() => {
			capturedOnFinish?.({ message: { role: "assistant" } });
		});

		expect(events.some((e) => e.name === "message.received")).toBe(true);
	});

	test("message.received does not fire when the request errored", async () => {
		const { events } = await mountWithEvents();

		act(() => {
			capturedOnError?.(new Error("boom"));
			capturedOnFinish?.({ message: { role: "assistant" }, isError: true });
		});

		expect(events.filter((e) => e.name === "chat.error").length).toBe(1);
		expect(events.filter((e) => e.name === "message.received").length).toBe(0);

		act(() => {
			capturedOnFinish?.({ message: { role: "assistant" } });
		});
		expect(events.filter((e) => e.name === "message.received").length).toBe(1);
	});

	test("chat.error fires with a truncated technical message", async () => {
		const { events } = await mountWithEvents();

		act(() => {
			capturedOnError?.(new Error("x".repeat(500)));
		});

		const errors = events.filter((e) => e.name === "chat.error");
		expect(errors.length).toBe(1);
		for (const e of errors) {
			if (e.name === "chat.error") {
				expect(e.properties.message.length).toBe(200);
			}
		}
	});

	test("session.started fires once when the id is first assigned", async () => {
		const { events, rerender } = await mountWithEvents({
			body: { sessionId: "sess_1" },
		});

		act(() => {
			capturedTransportBody?.();
			capturedTransportBody?.();
		});

		// A rotated session id must not re-fire session.started.
		rerender({ body: { sessionId: "sess_2" } });
		act(() => {
			capturedTransportBody?.();
		});

		const started = events.filter((e) => e.name === "session.started");
		expect(started.length).toBe(1);
		expect(started[0]?.sessionId).toBe("sess_1");
	});

	test("thread.changed fires when a thread becomes active", async () => {
		const { events } = await mountWithEvents();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		let nextId = "";
		act(() => {
			nextId = engine.startNewThread();
		});
		expect(nextId.length).toBeGreaterThan(5);

		const changed = events.filter((e) => e.name === "thread.changed");
		expect(changed.length).toBe(1);
		for (const e of changed) {
			if (e.name === "thread.changed") {
				expect(e.properties.threadId).toBe(nextId);
			}
		}
	});

	test("thread.changed on switchThread carries the target thread's session id", async () => {
		const { upsertThread } = await import("../lib/thread-store");
		const now = new Date().toISOString();
		await upsertThread({
			threadId: "thread_stored",
			memoryUserId: "user_test",
			title: "Stored thread",
			messages: [],
			sessionId: "sess_stored",
			createdAt: now,
			updatedAt: now,
		});

		const { events } = await mountWithEvents({
			getSessionId: () => "sess_outgoing",
		});
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		await act(async () => {
			await engine.switchThread("thread_stored");
		});

		const changed = events.filter(
			(e) =>
				e.name === "thread.changed" &&
				e.properties.threadId === "thread_stored",
		);
		expect(changed).toHaveLength(1);
		expect(changed[0]?.sessionId).toBe("sess_stored");
	});

	test("thread.changed on startNewThread does not report the outgoing session", async () => {
		const { events } = await mountWithEvents({
			getSessionId: () => "sess_stale",
		});
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		let nextId = "";
		act(() => {
			nextId = engine.startNewThread();
		});

		const changed = events.filter(
			(e) => e.name === "thread.changed" && e.properties.threadId === nextId,
		);
		expect(changed).toHaveLength(1);
		expect(changed[0]?.sessionId).toBeUndefined();
	});

	test("emits are inert without a provider", () => {
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		expect(() => {
			act(() => {
				engine.handleSubmit({ text: "hello", files: [] });
			});
		}).not.toThrow();
	});
});

const DOC = {
	documentId: "doc_1",
	filename: "policy.pdf",
	mediaType: "application/pdf",
};

async function completeRequest() {
	await act(async () => {
		await capturedTransportFetch?.("https://localhost/api/waniwani", {});
	});
}

describe("useChatEngine – documents on the turn that carries them", () => {
	test("the request body carries the ids the composer uploaded", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		act(() => {
			engine.handleSubmit({ text: "read this", files: [], documents: [DOC] });
		});

		expect(capturedTransportBody?.().documents).toEqual([DOC]);
	});

	test("a message with no attachments leaves documents off the body entirely", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		act(() => {
			engine.handleSubmit({ text: "hello", files: [], documents: [] });
		});

		expect(capturedTransportBody?.()).not.toHaveProperty("documents");
	});

	test("the next turn does not repeat the previous turn's documents", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		act(() => {
			engine.handleSubmit({ text: "read this", files: [], documents: [DOC] });
		});
		expect(capturedTransportBody?.().documents).toEqual([DOC]);

		await completeRequest();

		act(() => {
			engine.handleSubmit({ text: "and now?", files: [], documents: [] });
		});
		expect(capturedTransportBody?.()).not.toHaveProperty("documents");
	});

	test("an attachment with no text still sends", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}
		mockSendMessage.mockClear();

		act(() => {
			engine.handleSubmit({ text: "", files: [], documents: [DOC] });
		});

		expect(mockSendMessage).toHaveBeenCalledTimes(1);
		expect(capturedTransportBody?.().documents).toEqual([DOC]);
	});

	test("an empty message is still refused", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}
		mockSendMessage.mockClear();

		act(() => {
			engine.handleSubmit({ text: "   ", files: [], documents: [] });
		});

		expect(mockSendMessage).toHaveBeenCalledTimes(0);
	});

	test("a message queued behind a streaming reply keeps its documents", async () => {
		await flushAsync();
		useChatStatus = "streaming";
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		mockSendMessage.mockClear();
		act(() => {
			engine.handleSubmit({ text: "read this", files: [], documents: [DOC] });
		});
		expect(mockSendMessage).toHaveBeenCalledTimes(0);
		expect(capturedTransportBody?.()).not.toHaveProperty("documents");

		useChatStatus = "ready";
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});

		expect(mockSendMessage).toHaveBeenCalledTimes(1);
		expect(capturedTransportBody?.().documents).toEqual([DOC]);
	});
});

describe("useChatEngine – documents do not outlive their turn", () => {
	test("a request that never reached the server does not re-attach its documents to the next send", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		act(() => {
			engine.handleSubmit({ text: "read this", files: [], documents: [DOC] });
		});
		expect(capturedTransportBody?.().documents).toEqual([DOC]);

		globalThis.fetch = mock(async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;
		await act(async () => {
			await capturedTransportFetch?.(
				"https://localhost/api/waniwani",
				{},
			).catch(() => {});
		});

		act(() => {
			void engine.sendMessageAndWait("are you there?");
		});

		expect(capturedTransportBody?.()).not.toHaveProperty("documents");
	});
});

function lastSentMessage(): Record<string, unknown> {
	const calls = mockSendMessage.mock.calls;
	const sent = calls[calls.length - 1]?.[0];
	if (!sent || typeof sent !== "object") {
		throw new Error("sendMessage was never called with a message");
	}
	return sent as Record<string, unknown>;
}

describe("useChatEngine – the sent turn carries its documents as message metadata", () => {
	test("the direct path hands sendMessage the documents the composer uploaded", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}
		mockSendMessage.mockClear();

		act(() => {
			engine.handleSubmit({ text: "read this", files: [], documents: [DOC] });
		});

		expect(lastSentMessage().metadata).toEqual({ documents: [DOC] });
	});

	test("the queued path hands sendMessage the same metadata when it drains", async () => {
		await flushAsync();
		useChatStatus = "streaming";
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		mockSendMessage.mockClear();
		act(() => {
			engine.handleSubmit({ text: "read this", files: [], documents: [DOC] });
		});
		expect(mockSendMessage).toHaveBeenCalledTimes(0);

		useChatStatus = "ready";
		act(() => {
			root.render(createElement(Harness, { resultRef: hookRef }));
		});

		expect(lastSentMessage().metadata).toEqual({ documents: [DOC] });
	});

	test("a turn with no documents carries no metadata at all", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}
		mockSendMessage.mockClear();

		act(() => {
			engine.handleSubmit({ text: "hello", files: [], documents: [] });
		});

		expect(lastSentMessage()).not.toHaveProperty("metadata");
	});

	test("the bytes stay out of the turn: metadata carries ids, files stays empty", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}
		mockSendMessage.mockClear();

		act(() => {
			engine.handleSubmit({ text: "read this", files: [], documents: [DOC] });
		});

		const sent = lastSentMessage();
		expect(sent.files).toEqual([]);
		expect(JSON.stringify(sent)).not.toContain("base64");
		expect(JSON.stringify(sent)).not.toContain("blob:");
	});

	test("the metadata addition leaves the wire body's documents untouched", async () => {
		await flushAsync();
		const engine = hookRef.current;
		if (!engine) {
			throw new Error("Engine not mounted");
		}

		act(() => {
			engine.handleSubmit({ text: "read this", files: [], documents: [DOC] });
		});

		if (!capturedTransportBody) {
			throw new Error("transport not constructed");
		}
		const body = capturedTransportBody();
		expect(body.documents).toEqual([DOC]);
		expect(body).not.toHaveProperty("metadata");
	});
});
