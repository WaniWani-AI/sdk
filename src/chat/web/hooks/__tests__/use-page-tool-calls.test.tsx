import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { Window } from "happy-dom";

// A recording fake stands in for the two `useChat` functions the hook writes
// through; assertions read what the chat ends up holding.

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
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const { usePageToolCalls } = await import("../use-page-tool-calls");
type Hook = ReturnType<typeof usePageToolCalls>;
type Handler = NonNullable<Parameters<typeof usePageToolCalls>[0]>;
type WrittenOutput = Parameters<
	NonNullable<Hook["chatRef"]["current"]>["addToolOutput"]
>[0];

const STOPPED_TEXT = "Stopped by the user before the page answered.";

// Fake chat

interface FakeChat {
	written: WrittenOutput[];
	followUps: number;
	/** When set, each write resolves only when the test says so. */
	holdWrites: boolean;
	releaseWrites: () => Promise<void>;
}

function makeFakeChat(): FakeChat & {
	api: NonNullable<Hook["chatRef"]["current"]>;
} {
	const held: Array<() => void> = [];
	const chat: FakeChat = {
		written: [],
		followUps: 0,
		holdWrites: false,
		releaseWrites: async () => {
			while (held.length > 0) {
				held.shift()?.();
				await Promise.resolve();
			}
		},
	};
	return Object.assign(chat, {
		api: {
			addToolOutput: (params: WrittenOutput) => {
				if (!chat.holdWrites) {
					chat.written.push(params);
					return Promise.resolve();
				}
				return new Promise<void>((resolve) => {
					held.push(() => {
						chat.written.push(params);
						resolve();
					});
				});
			},
			sendMessage: async () => {
				chat.followUps += 1;
			},
		},
	});
}

function lastWrite(chat: FakeChat, toolCallId: string) {
	const mine = chat.written.filter((w) => w.toolCallId === toolCallId);
	return mine[mine.length - 1];
}

// Messages

function assistant(parts: UIMessage["parts"]): UIMessage {
	return { id: "a1", role: "assistant", parts };
}

function pageCall(id: string, name = "get_page_title", input: unknown = {}) {
	return {
		type: `tool-${name}` as const,
		toolCallId: id,
		state: "input-available" as const,
		input,
	};
}

// Harness

let root: Root;
let container: HTMLElement;
let hookRef: { current: Hook | null };

function Harness({
	resultRef,
	handler,
}: {
	resultRef: { current: Hook | null };
	handler: Handler | undefined;
}) {
	resultRef.current = usePageToolCalls(handler);
	return null;
}

function render(handler: Handler | undefined) {
	act(() => {
		root.render(createElement(Harness, { resultRef: hookRef, handler }));
	});
}

function hook(): Hook {
	if (!hookRef.current) {
		throw new Error("hook not mounted");
	}
	return hookRef.current;
}

function mountWith(handler: Handler | undefined) {
	render(handler);
	const chat = makeFakeChat();
	hook().chatRef.current = chat.api;
	return chat;
}

async function flush() {
	await act(async () => {
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 0));
		}
	});
}

function finish(message: UIMessage) {
	act(() => {
		hook().handleFinish(message);
	});
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	hookRef = { current: null };
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

// Tests

describe("usePageToolCalls without a handler", () => {
	test("a finished answer with an unanswered call writes nothing, stays idle, and Stop reports nothing to stop", async () => {
		const chat = mountWith(undefined);

		finish(assistant([pageCall("c1")]));
		await flush();

		expect(hook().pending).toBe(false);
		expect(chat.written).toEqual([]);
		expect(chat.followUps).toBe(0);
		let stopped = true;
		await act(async () => {
			stopped = await hook().stop();
		});
		expect(stopped).toBe(false);
	});
});

describe("usePageToolCalls with a handler", () => {
	test("an answer with no tool parts at all leaves the chat idle and never calls the handler", async () => {
		let called = 0;
		const chat = mountWith(() => {
			called += 1;
		});

		finish(assistant([{ type: "text", text: "hello" }]));
		await flush();

		expect(called).toBe(0);
		expect(hook().pending).toBe(false);
		expect(chat.followUps).toBe(0);
	});

	test("an empty assistant message leaves the chat idle", async () => {
		const chat = mountWith(() => "x");

		finish(assistant([]));
		await flush();

		expect(hook().pending).toBe(false);
		expect(chat.followUps).toBe(0);
	});

	test("the same finished message delivered twice hands each call over once and carries on once", async () => {
		let called = 0;
		let release: (v: unknown) => void = () => {};
		const chat = mountWith(() => {
			called += 1;
			return new Promise((r) => {
				release = r;
			});
		});
		const message = assistant([pageCall("c1")]);

		finish(message);
		finish(message);
		await flush();
		expect(called).toBe(1);

		await act(async () => {
			release("done");
		});
		await flush();

		expect(chat.followUps).toBe(1);
		expect(chat.written.filter((w) => w.toolCallId === "c1")).toHaveLength(1);
	});

	test("a provider-executed call is the server's, not the page's", async () => {
		let called = 0;
		const chat = mountWith(() => {
			called += 1;
			return "x";
		});

		finish(assistant([{ ...pageCall("c1"), providerExecuted: true }]));
		await flush();

		expect(called).toBe(0);
		expect(hook().pending).toBe(false);
		expect(chat.followUps).toBe(0);
	});

	test("the handler current when the answer finishes is the one called, not the one from first render", async () => {
		const seen: string[] = [];
		const chat = mountWith(() => {
			seen.push("old");
			return "old";
		});
		render(() => {
			seen.push("new");
			return "new";
		});
		await flush();

		finish(assistant([pageCall("c1")]));
		await flush();

		expect(seen).toEqual(["new"]);
		expect(lastWrite(chat, "c1")).toMatchObject({
			state: "output-available",
			output: "new",
		});
	});

	test("the write names the tool by its name, for a static tool part", async () => {
		const chat = mountWith(() => 5);

		finish(assistant([pageCall("c1", "read_cart")]));
		await flush();

		expect(lastWrite(chat, "c1")).toMatchObject({
			tool: "read_cart",
			toolCallId: "c1",
			state: "output-available",
			output: 5,
		});
	});

	test("an Error with an empty message still answers a non-empty error text", async () => {
		const chat = mountWith(() => {
			throw new Error("");
		});

		finish(assistant([pageCall("c1")]));
		await flush();

		const write = lastWrite(chat, "c1");
		expect(write?.state).toBe("output-error");
		const errorText =
			write && write.state === "output-error" ? write.errorText : "";
		expect(errorText.length).toBeGreaterThan(0);
		expect(chat.followUps).toBe(1);
	});

	test("a thrown string answers that string as the error text", async () => {
		const chat = mountWith(() => {
			throw "page is offline";
		});

		finish(assistant([pageCall("c1")]));
		await flush();

		expect(lastWrite(chat, "c1")).toMatchObject({
			state: "output-error",
			errorText: "page is offline",
		});
	});
});

describe("usePageToolCalls Stop", () => {
	test("Stop answers every waiting call with the stopped error, reports true, and never carries on", async () => {
		const chat = mountWith(() => new Promise(() => {}));

		finish(assistant([pageCall("a"), pageCall("b")]));
		await flush();
		expect(hook().pending).toBe(true);

		let stopped = false;
		await act(async () => {
			stopped = await hook().stop();
		});
		await flush();

		expect(stopped).toBe(true);
		expect(hook().pending).toBe(false);
		expect(lastWrite(chat, "a")).toMatchObject({
			state: "output-error",
			errorText: STOPPED_TEXT,
		});
		expect(lastWrite(chat, "b")).toMatchObject({
			state: "output-error",
			errorText: STOPPED_TEXT,
		});
		expect(chat.followUps).toBe(0);
	});

	test("a second Stop after the first finds nothing waiting", async () => {
		mountWith(() => new Promise(() => {}));

		finish(assistant([pageCall("a")]));
		await flush();
		await act(async () => {
			await hook().stop();
		});

		let again = true;
		await act(async () => {
			again = await hook().stop();
		});
		expect(again).toBe(false);
	});

	test("Stop keeps an answer the page already gave that is still being written, and stops only the unanswered call", async () => {
		let answerB: (v: unknown) => void = () => {};
		const chat = mountWith((call) =>
			call.toolCallId === "a"
				? "page answer for a"
				: new Promise((r) => {
						answerB = r;
					}),
		);
		chat.holdWrites = true;

		finish(assistant([pageCall("a"), pageCall("b")]));
		await flush();

		let stopping: Promise<boolean> = Promise.resolve(false);
		act(() => {
			stopping = hook().stop();
		});
		chat.holdWrites = false;
		await act(async () => {
			await chat.releaseWrites();
		});
		await act(async () => {
			answerB("late b");
		});
		await flush();

		expect(await stopping).toBe(true);
		expect(lastWrite(chat, "a")).toMatchObject({
			state: "output-available",
			output: "page answer for a",
		});
		expect(chat.written.filter((w) => w.toolCallId === "a")).toHaveLength(1);
		expect(lastWrite(chat, "b")).toMatchObject({
			state: "output-error",
			errorText: STOPPED_TEXT,
		});
		expect(chat.written.filter((w) => w.toolCallId === "b")).toHaveLength(1);
		expect(chat.followUps).toBe(0);
		expect(hook().pending).toBe(false);
	});

	test("the chat stays busy after Stop until the stopped answers are written", async () => {
		const chat = mountWith(() => new Promise(() => {}));

		finish(assistant([pageCall("a"), pageCall("b")]));
		await flush();
		chat.holdWrites = true;

		let settled = false;
		act(() => {
			void hook()
				.stop()
				.then(() => {
					settled = true;
				});
		});
		await flush();

		expect(hook().pending).toBe(true);
		expect(settled).toBe(false);

		chat.holdWrites = false;
		await act(async () => {
			await chat.releaseWrites();
		});
		await flush();

		expect(settled).toBe(true);
		expect(hook().pending).toBe(false);
		expect(lastWrite(chat, "a")).toMatchObject({ errorText: STOPPED_TEXT });
		expect(lastWrite(chat, "b")).toMatchObject({ errorText: STOPPED_TEXT });
		expect(chat.followUps).toBe(0);
	});

	test("an answer the page gives while Stop is still writing is ignored", async () => {
		let answerA: (v: unknown) => void = () => {};
		const chat = mountWith(
			() =>
				new Promise((r) => {
					answerA = r;
				}),
		);

		finish(assistant([pageCall("a")]));
		await flush();
		chat.holdWrites = true;
		act(() => {
			void hook().stop();
		});
		await act(async () => {
			answerA("arrived during stop");
		});
		chat.holdWrites = false;
		await act(async () => {
			await chat.releaseWrites();
		});
		await flush();

		expect(chat.written.filter((w) => w.toolCallId === "a")).toHaveLength(1);
		expect(lastWrite(chat, "a")).toMatchObject({ errorText: STOPPED_TEXT });
		expect(chat.followUps).toBe(0);
	});
});

describe("usePageToolCalls drop", () => {
	test("closing the chat while the page works: the late answer writes nothing", async () => {
		let release: (v: unknown) => void = () => {};
		const chat = mountWith(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);

		finish(assistant([pageCall("c1")]));
		await flush();
		act(() => {
			root.render(null);
		});

		await act(async () => {
			release("late");
		});
		await flush();

		expect(chat.written).toEqual([]);
		expect(chat.followUps).toBe(0);
	});

	test("after drop, a late answer writes nothing and carries on nowhere", async () => {
		let release: (v: unknown) => void = () => {};
		const chat = mountWith(
			() =>
				new Promise((r) => {
					release = r;
				}),
		);

		finish(assistant([pageCall("c1")]));
		await flush();
		act(() => {
			hook().drop();
		});
		expect(hook().pending).toBe(false);

		await act(async () => {
			release("late");
		});
		await flush();

		expect(chat.written).toEqual([]);
		expect(chat.followUps).toBe(0);
	});

	test("a call from the new conversation is still handed over after a drop", async () => {
		const seen: string[] = [];
		const chat = mountWith((call) => {
			seen.push(call.toolCallId);
			return call.toolCallId === "old" ? new Promise(() => {}) : "fresh";
		});

		finish(assistant([pageCall("old")]));
		await flush();
		act(() => {
			hook().drop();
		});

		finish(assistant([pageCall("new")]));
		await flush();

		expect(seen).toEqual(["old", "new"]);
		expect(lastWrite(chat, "new")).toMatchObject({
			state: "output-available",
			output: "fresh",
		});
		expect(chat.followUps).toBe(1);
		expect(hook().pending).toBe(false);
	});

	test("the same call id reappearing after a drop is handed over again", async () => {
		let calls = 0;
		const chat = mountWith(() => {
			calls += 1;
			return calls === 1 ? new Promise(() => {}) : "second time";
		});

		finish(assistant([pageCall("same")]));
		await flush();
		act(() => {
			hook().drop();
		});
		finish(assistant([pageCall("same")]));
		await flush();

		expect(calls).toBe(2);
		expect(lastWrite(chat, "same")).toMatchObject({ output: "second time" });
		expect(chat.followUps).toBe(1);
	});
});
