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
let capturedOnFinish: ((payload: { message: unknown }) => void) | undefined;
let capturedOnError: ((error: Error) => void) | undefined;
const mockSendMessage = mock(() => {});
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
// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../lib/lenient-chat-transport", () => ({
	LenientChatTransport: class {
		constructor(opts: { body?: () => Record<string, unknown> }) {
			capturedTransportBody = opts.body;
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

// ---------------------------------------------------------------------------
// Test harness — a thin component that exposes the hook's return value via ref
// ---------------------------------------------------------------------------

type HookReturn = ReturnType<typeof useChatEngine>;

function Harness({ resultRef }: { resultRef: { current: HookReturn | null } }) {
	const engine = useChatEngine({ api: "/api/waniwani" });
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
