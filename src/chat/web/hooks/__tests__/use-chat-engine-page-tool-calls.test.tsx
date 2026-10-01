import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { UIMessage, UIMessageChunk } from "ai";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";
import type { ChatTransportContext, ChatTransportFactory } from "../../@types";

// Real `useChat` and real transport; only `fetch` is faked, answering chat
// POSTs with scripted UI-message streams the way the server does.

// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).indexedDB = new IDBFactory();
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IDBKeyRange = IDBKeyRange;

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
	"screen",
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

// Other test files fake these modules for the whole run: a query-suffixed import
// fetches the real ones, spread because bun ignores a re-mock with the same object.
const realAiSdkReactPath = `${Bun.resolveSync("@ai-sdk/react", import.meta.dir)}?real`;
const realTransportPath = "../../lib/lenient-chat-transport.ts?real";
const realAiSdkReact: typeof import("@ai-sdk/react") = await import(
	realAiSdkReactPath
);
const realTransport: typeof import("../../lib/lenient-chat-transport") =
	await import(realTransportPath);
// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({ ...realAiSdkReact }));
// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../lib/lenient-chat-transport", () => ({ ...realTransport }));

// The thread store is real, but a test can hold a load or a delete to see the chat mid-switch.
const realThreadStorePath = "../../lib/thread-store.ts?real";
const threadStore: typeof import("../../lib/thread-store") = await import(
	realThreadStorePath
);
const storeHolds: {
	load?: (threadId: string) => Promise<void>;
	remove?: (threadId: string) => Promise<void>;
} = {};
// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../lib/thread-store", () => ({
	...threadStore,
	loadThread: async (threadId: string) => {
		await storeHolds.load?.(threadId);
		return threadStore.loadThread(threadId);
	},
	deleteThread: async (threadId: string) => {
		await storeHolds.remove?.(threadId);
		return threadStore.deleteThread(threadId);
	},
}));

const { useChatEngine } = await import("../use-chat-engine");
const { getOrCreateMemoryUserId } = await import("../../lib/memory-user-id");
type HookReturn = ReturnType<typeof useChatEngine>;
type EngineProps = Parameters<typeof useChatEngine>[0];
type ToolCallHandler = NonNullable<EngineProps["onToolCall"]>;
type PageCall = Parameters<ToolCallHandler>[0];

const API = "https://acme.example/api/waniwani";
const STOPPED_TEXT = "Stopped by the user before the page answered.";

// Network fake

type Chunk = Record<string, unknown>;

interface ChatPost {
	body: Record<string, unknown> & {
		messages: Array<{
			role: string;
			parts: Array<Record<string, unknown>>;
		}>;
	};
}

interface ControlledStream {
	push: (chunk: Chunk) => void;
	close: () => void;
	fail: (error: Error) => void;
}

type Reply =
	| { kind: "chunks"; chunks: Chunk[] }
	| { kind: "controlled"; onOpen: (stream: ControlledStream) => void }
	| { kind: "status"; status: number };

let replies: Reply[] = [];
let chatPosts: ChatPost[] = [];
let cancelPosts: string[] = [];
let onChatPost: (() => void) | undefined;
const originalFetch = globalThis.fetch;

const encoder = new TextEncoder();
function line(chunk: Chunk | "[DONE]"): Uint8Array {
	return encoder.encode(
		`data: ${chunk === "[DONE]" ? chunk : JSON.stringify(chunk)}\n\n`,
	);
}

function sseResponse(reply: Reply, signal?: AbortSignal | null): Response {
	const headers = {
		"content-type": "text/event-stream",
		"x-vercel-ai-ui-message-stream": "v1",
	};
	if (reply.kind === "status") {
		return new Response("boom", { status: reply.status });
	}
	if (reply.kind === "chunks") {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of reply.chunks) {
					controller.enqueue(line(chunk));
				}
				controller.enqueue(line("[DONE]"));
				controller.close();
			},
		});
		return new Response(stream, { headers });
	}
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			signal?.addEventListener("abort", () => {
				controller.error(new DOMException("aborted", "AbortError"));
			});
			reply.onOpen({
				push: (chunk) => controller.enqueue(line(chunk)),
				close: () => {
					controller.enqueue(line("[DONE]"));
					controller.close();
				},
				fail: (error) => controller.error(error),
			});
		},
	});
	return new Response(stream, { headers });
}

function installFetch() {
	globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
		const url = String(input);
		if (url.includes("/tools")) {
			return Response.json({ tools: [] });
		}
		if (url.includes("/cancel")) {
			cancelPosts.push(String(init.body));
			return Response.json({ ok: true });
		}
		onChatPost?.();
		onChatPost = undefined;
		chatPosts.push({ body: JSON.parse(String(init.body)) });
		const reply = replies.shift();
		if (!reply) {
			throw new Error(`unexpected chat POST #${chatPosts.length}`);
		}
		return sseResponse(reply, init.signal);
	}) as unknown as typeof fetch;
}

// Scripted answers

function toolCallChunks(
	calls: Array<{ id: string; name: string; input: unknown; dynamic?: boolean }>,
): Chunk[] {
	return calls.map((c) => ({
		type: "tool-input-available",
		toolCallId: c.id,
		toolName: c.name,
		input: c.input,
		...(c.dynamic ? { dynamic: true } : {}),
	}));
}

function answerWithCalls(
	calls: Array<{ id: string; name: string; input: unknown; dynamic?: boolean }>,
	extra: Chunk[] = [],
): Reply {
	return {
		kind: "chunks",
		chunks: [
			{ type: "start" },
			{ type: "start-step" },
			...toolCallChunks(calls),
			...extra,
			{ type: "finish-step" },
			{ type: "finish" },
		],
	};
}

function textAnswer(text: string): Reply {
	return {
		kind: "chunks",
		chunks: [
			{ type: "start" },
			{ type: "start-step" },
			{ type: "text-start", id: "t" },
			{ type: "text-delta", id: "t", delta: text },
			{ type: "text-end", id: "t" },
			{ type: "finish-step" },
			{ type: "finish" },
		],
	};
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// Harness

let root: Root;
let container: HTMLElement;
let hookRef: { current: HookReturn | null };

function Harness({
	resultRef,
	props,
}: {
	resultRef: { current: HookReturn | null };
	props: EngineProps;
}) {
	resultRef.current = useChatEngine(props);
	return null;
}

function mount(props: Partial<EngineProps> = {}) {
	act(() => {
		root.render(
			createElement(Harness, {
				resultRef: hookRef,
				props: { api: API, ...props },
			}),
		);
	});
}

function engine(): HookReturn {
	if (!hookRef.current) {
		throw new Error("engine not mounted");
	}
	return hookRef.current;
}

async function tick(ms = 5) {
	await act(async () => {
		await new Promise((r) => setTimeout(r, ms));
	});
}

async function until(label: string, cond: () => boolean, timeoutMs = 1500) {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`timed out waiting for: ${label}`);
		}
		await tick();
	}
}

async function settle() {
	await tick(40);
}

function send(text: string) {
	act(() => {
		engine().handleSubmit({ text, files: [] });
	});
}

function toolPart(
	messages: ChatPost["body"]["messages"],
	toolCallId: string,
): Record<string, unknown> | undefined {
	for (const m of messages) {
		for (const p of m.parts) {
			if (p.toolCallId === toolCallId) {
				return p;
			}
		}
	}
	return undefined;
}

function engineToolPart(toolCallId: string): Record<string, unknown> {
	const messages = engine().messages.map((m) => ({
		role: m.role,
		parts: m.parts.map((p) => ({ ...p }) as Record<string, unknown>),
	}));
	const part = toolPart(messages, toolCallId);
	if (!part) {
		throw new Error(`no tool part ${toolCallId} in the engine's messages`);
	}
	return part;
}

function postPart(postIndex: number, toolCallId: string) {
	const post = chatPosts[postIndex];
	if (!post) {
		throw new Error(`chat POST #${postIndex + 1} never happened`);
	}
	const part = toolPart(post.body.messages, toolCallId);
	if (!part) {
		throw new Error(
			`POST #${postIndex + 1} carries no tool part ${toolCallId}`,
		);
	}
	return part;
}

beforeEach(async () => {
	win.history.replaceState(null, "", "/");
	storeHolds.load = undefined;
	storeHolds.remove = undefined;
	replies = [];
	chatPosts = [];
	cancelPosts = [];
	onChatPost = undefined;
	installFetch();
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
	globalThis.fetch = originalFetch;
});

// Tests

describe("onToolCall unset: today's behaviour", () => {
	test("an answer ending on an unanswered tool call stops there: no follow-up request, chat idle", async () => {
		mount();
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "get_page_title", input: {} }]),
		);

		send("what page am I on?");
		await until("answer finished", () => engine().status === "ready");
		await settle();

		expect(chatPosts).toHaveLength(1);
		expect(engine().isLoading).toBe(false);
		expect(engineToolPart("c1").state).toBe("input-available");
	});

	test("a message typed right after such an answer is sent at once, not queued", async () => {
		mount();
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "get_page_title", input: {} }]),
			textAnswer("ok"),
		);

		send("first");
		await until("answer finished", () => engine().status === "ready");
		await settle();
		send("second");
		await until("second POST", () => chatPosts.length === 2);

		expect(engine().queuedMessages).toHaveLength(0);
	});
});

describe("onToolCall set: the page answers and the chat carries on", () => {
	test("the handler gets the call's id, name and input exactly", async () => {
		const seen: PageCall[] = [];
		mount({
			onToolCall: (call) => {
				seen.push(call);
				return { title: "Pricing" };
			},
		});
		await settle();
		replies.push(
			answerWithCalls([
				{
					id: "call_42",
					name: "get_page_title",
					input: { selector: "h1", nested: { deep: [1, 2] } },
				},
			]),
			textAnswer("You are on Pricing."),
		);

		send("what page am I on?");
		await until("follow-up POST", () => chatPosts.length === 2);

		expect(seen).toEqual([
			{
				toolCallId: "call_42",
				toolName: "get_page_title",
				input: { selector: "h1", nested: { deep: [1, 2] } },
			},
		]);
	});

	test("the returned value goes back to the AI as the tool's result, with no typing", async () => {
		mount({ onToolCall: () => ({ title: "Pricing", count: 0 }) });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "get_page_title", input: {} }]),
			textAnswer("You are on Pricing."),
		);

		send("what page am I on?");
		await until("follow-up POST", () => chatPosts.length === 2);
		await until("chat idle", () => engine().status === "ready");
		await settle();

		const part = postPart(1, "c1");
		expect(part.state).toBe("output-available");
		expect(part.output).toEqual({ title: "Pricing", count: 0 });
		expect(chatPosts).toHaveLength(2);
		expect(engine().isLoading).toBe(false);
	});

	test("an async handler's resolved value is what goes back", async () => {
		mount({
			onToolCall: async () => {
				await new Promise((r) => setTimeout(r, 10));
				return "resolved later";
			},
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "read_cart", input: {} }]),
			textAnswer("ok"),
		);

		send("cart?");
		await until("follow-up POST", () => chatPosts.length === 2);

		expect(postPart(1, "c1").output).toBe("resolved later");
	});

	test("a handler that returns nothing answers null", async () => {
		mount({ onToolCall: () => undefined });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "scroll_to", input: { y: 0 } }]),
			textAnswer("done"),
		);

		send("scroll up");
		await until("follow-up POST", () => chatPosts.length === 2);

		const part = postPart(1, "c1");
		expect(part.state).toBe("output-available");
		expect(part).toHaveProperty("output");
		expect(part.output).toBeNull();
	});

	test("falsy results (0, false, empty string) go back as themselves, not null", async () => {
		const results: unknown[] = [0, false, ""];
		mount({ onToolCall: () => results.shift() });
		await settle();
		replies.push(
			answerWithCalls([
				{ id: "c0", name: "a", input: {} },
				{ id: "c1", name: "b", input: {} },
				{ id: "c2", name: "c", input: {} },
			]),
			textAnswer("ok"),
		);

		send("go");
		await until("follow-up POST", () => chatPosts.length === 2);

		expect(postPart(1, "c0").output).toBe(0);
		expect(postPart(1, "c1").output).toBe(false);
		expect(postPart(1, "c2").output).toBe("");
	});

	test("the handler is not called while the answer is still streaming, only once it ends", async () => {
		const calls: PageCall[] = [];
		let stream: ControlledStream | undefined;
		mount({
			onToolCall: (call) => {
				calls.push(call);
				return "ok";
			},
		});
		await settle();
		replies.push(
			{
				kind: "controlled",
				onOpen: (s) => {
					stream = s;
				},
			},
			textAnswer("ok"),
		);

		send("go");
		await until("stream open", () => stream !== undefined);
		stream?.push({ type: "start" });
		stream?.push({ type: "start-step" });
		stream?.push({
			type: "tool-input-available",
			toolCallId: "c1",
			toolName: "get_page_title",
			input: {},
		});
		await until("tool part streamed", () =>
			engine().messages.some((m) =>
				m.parts.some((p) => "toolCallId" in p && p.toolCallId === "c1"),
			),
		);
		await settle();
		expect(calls).toHaveLength(0);

		stream?.push({ type: "finish-step" });
		stream?.push({ type: "finish" });
		stream?.close();
		await until("follow-up POST", () => chatPosts.length === 2);

		expect(calls).toHaveLength(1);
	});

	test("a dynamic tool call is handed over under its own tool name", async () => {
		const names: string[] = [];
		mount({
			onToolCall: (call) => {
				names.push(call.toolName);
				return 1;
			},
		});
		await settle();
		replies.push(
			answerWithCalls([
				{ id: "c1", name: "mcp_page_tool", input: {}, dynamic: true },
			]),
			textAnswer("ok"),
		);

		send("go");
		await until("follow-up POST", () => chatPosts.length === 2);

		expect(names).toEqual(["mcp_page_tool"]);
		expect(postPart(1, "c1").output).toBe(1);
	});

	test("an answer the server finished itself makes no follow-up request", async () => {
		let handled = 0;
		mount({
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();
		replies.push(
			answerWithCalls(
				[{ id: "s1", name: "search_kb", input: { q: "price" } }],
				[{ type: "tool-output-available", toolCallId: "s1", output: "42€" }],
			),
		);

		send("price?");
		await until("answer finished", () => engine().status === "ready");
		await settle();

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
		expect(engine().isLoading).toBe(false);
	});

	test("a server error result is not handed to the page", async () => {
		let handled = 0;
		mount({
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();
		replies.push(
			answerWithCalls(
				[{ id: "s1", name: "search_kb", input: {} }],
				[{ type: "tool-output-error", toolCallId: "s1", errorText: "kb down" }],
			),
		);

		send("go");
		await until("answer finished", () => engine().status === "ready");
		await settle();

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
	});

	test("with a server-answered call beside a page call, only the page call is handed over", async () => {
		const names: string[] = [];
		mount({
			onToolCall: (call) => {
				names.push(call.toolCallId);
				return "page-result";
			},
		});
		await settle();
		replies.push(
			answerWithCalls(
				[
					{ id: "s1", name: "search_kb", input: {} },
					{ id: "p1", name: "get_page_title", input: {} },
				],
				[{ type: "tool-output-available", toolCallId: "s1", output: "kb" }],
			),
			textAnswer("ok"),
		);

		send("go");
		await until("follow-up POST", () => chatPosts.length === 2);

		expect(names).toEqual(["p1"]);
		expect(postPart(1, "s1").output).toBe("kb");
		expect(postPart(1, "p1").output).toBe("page-result");
	});

	test("with two page calls, the chat waits for both and then sends exactly one follow-up carrying both", async () => {
		const pending = new Map<string, ReturnType<typeof deferred<unknown>>>();
		mount({
			onToolCall: (call) => {
				const d = deferred<unknown>();
				pending.set(call.toolCallId, d);
				return d.promise;
			},
		});
		await settle();
		replies.push(
			answerWithCalls([
				{ id: "a", name: "t1", input: {} },
				{ id: "b", name: "t2", input: {} },
			]),
			textAnswer("ok"),
		);

		send("go");
		await until("both handed over", () => pending.size === 2);

		await act(async () => {
			pending.get("b")?.resolve("B");
		});
		await settle();
		expect(chatPosts).toHaveLength(1);
		expect(engine().isLoading).toBe(true);

		await act(async () => {
			pending.get("a")?.resolve("A");
		});
		await until("follow-up POST", () => chatPosts.length === 2);
		await until("chat idle", () => engine().status === "ready");
		await settle();

		expect(chatPosts).toHaveLength(2);
		expect(postPart(1, "a").output).toBe("A");
		expect(postPart(1, "b").output).toBe("B");
	});

	test("a follow-up answer asking for another page call is handed over too, without re-handing the first", async () => {
		const ids: string[] = [];
		mount({
			onToolCall: (call) => {
				ids.push(call.toolCallId);
				return call.toolCallId.toUpperCase();
			},
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "first", name: "t", input: {} }]),
			answerWithCalls([{ id: "second", name: "t", input: {} }]),
			textAnswer("done"),
		);

		send("go");
		await until("third POST", () => chatPosts.length === 3);
		await until("chat idle", () => engine().status === "ready");
		await settle();

		expect(ids).toEqual(["first", "second"]);
		expect(postPart(2, "first").output).toBe("FIRST");
		expect(postPart(2, "second").output).toBe("SECOND");
		expect(chatPosts).toHaveLength(3);
	});
});

describe("onToolCall set: a failing handler never leaves the chat hanging", () => {
	test("a result the chat can't store (a function) is sent as an error result", async () => {
		mount({ onToolCall: () => () => "not data" });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "get_callback", input: {} }]),
			textAnswer("sorry"),
		);

		send("go");
		await until("follow-up POST", () => chatPosts.length === 2);
		await until("chat idle", () => engine().status === "ready");

		const part = postPart(1, "c1");
		expect(part.state).toBe("output-error");
		expect(typeof part.errorText).toBe("string");
		expect(String(part.errorText).length).toBeGreaterThan(0);
		expect(engine().isLoading).toBe(false);
	});

	test("a synchronous throw answers an error result with the error's message", async () => {
		mount({
			onToolCall: () => {
				throw new Error("location permission denied");
			},
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "get_location", input: {} }]),
			textAnswer("sorry"),
		);

		send("where am I?");
		await until("follow-up POST", () => chatPosts.length === 2);
		await until("chat idle", () => engine().status === "ready");

		const part = postPart(1, "c1");
		expect(part.state).toBe("output-error");
		expect(part.errorText).toBe("location permission denied");
		expect(engine().isLoading).toBe(false);
	});

	test("a rejected promise answers an error result with the rejection's message", async () => {
		mount({
			onToolCall: async () => {
				throw new Error("timeout reading DOM");
			},
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "read_dom", input: {} }]),
			textAnswer("sorry"),
		);

		send("go");
		await until("follow-up POST", () => chatPosts.length === 2);

		const part = postPart(1, "c1");
		expect(part.state).toBe("output-error");
		expect(part.errorText).toBe("timeout reading DOM");
	});

	test("throwing something that is not an Error still answers an error result with text", async () => {
		mount({
			onToolCall: () => {
				throw { code: 7 };
			},
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("sorry"),
		);

		send("go");
		await until("follow-up POST", () => chatPosts.length === 2);
		await until("chat idle", () => engine().status === "ready");

		const part = postPart(1, "c1");
		expect(part.state).toBe("output-error");
		expect(typeof part.errorText).toBe("string");
		expect(String(part.errorText).length).toBeGreaterThan(0);
	});

	test("one call throwing and one succeeding still sends one follow-up with both results", async () => {
		mount({
			onToolCall: (call) => {
				if (call.toolCallId === "bad") {
					throw new Error("nope");
				}
				return "fine";
			},
		});
		await settle();
		replies.push(
			answerWithCalls([
				{ id: "bad", name: "t", input: {} },
				{ id: "good", name: "t", input: {} },
			]),
			textAnswer("ok"),
		);

		send("go");
		await until("follow-up POST", () => chatPosts.length === 2);
		await until("chat idle", () => engine().status === "ready");
		await settle();

		expect(chatPosts).toHaveLength(2);
		expect(postPart(1, "bad").state).toBe("output-error");
		expect(postPart(1, "bad").errorText).toBe("nope");
		expect(postPart(1, "good").state).toBe("output-available");
		expect(postPart(1, "good").output).toBe("fine");
	});
});

describe("onToolCall set: the chat is busy while the page works", () => {
	test("status reads streaming and isLoading is true until the page answers", async () => {
		const d = deferred<unknown>();
		mount({ onToolCall: () => d.promise });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("ok"),
		);

		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();

		expect(engine().status).toBe("streaming");
		expect(engine().isLoading).toBe(true);

		await act(async () => {
			d.resolve("answer");
		});
		await until("follow-up POST", () => chatPosts.length === 2);
		await until("chat idle", () => engine().status === "ready");
		expect(engine().isLoading).toBe(false);
	});

	test("a message typed while the page works waits in the queue and goes after the carried-on answer", async () => {
		const d = deferred<unknown>();
		mount({ onToolCall: () => d.promise });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("carried on"),
			textAnswer("second answer"),
		);

		send("go");
		await until("page working", () => engine().status === "streaming");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();

		send("and also this");
		await settle();
		expect(engine().queuedMessages).toHaveLength(1);
		expect(chatPosts).toHaveLength(1);

		await act(async () => {
			d.resolve("answer");
		});
		await until("third POST", () => chatPosts.length === 3);

		const second = chatPosts[1]?.body.messages ?? [];
		expect(second[second.length - 1]?.role).toBe("assistant");
		expect(postPart(1, "c1").output).toBe("answer");
		const third = chatPosts[2]?.body.messages ?? [];
		const lastUser = third[third.length - 1];
		expect(lastUser?.role).toBe("user");
		expect(JSON.stringify(lastUser?.parts)).toContain("and also this");
	});
});

describe("onToolCall set: Stop while the page works", () => {
	test("answers the waiting call with the stopped error, does not carry on, and ignores the late answer", async () => {
		const d = deferred<unknown>();
		mount({ onToolCall: () => d.promise });
		await settle();
		replies.push(answerWithCalls([{ id: "c1", name: "t", input: {} }]));

		send("go");
		await until("page working", () => engine().isLoading);
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();

		await act(async () => {
			await engine().stop();
		});
		await settle();

		expect(engine().status).toBe("ready");
		expect(engine().isLoading).toBe(false);
		expect(engineToolPart("c1").state).toBe("output-error");
		expect(engineToolPart("c1").errorText).toBe(STOPPED_TEXT);

		await act(async () => {
			d.resolve("too late");
		});
		await settle();

		expect(chatPosts).toHaveLength(1);
		expect(engineToolPart("c1").state).toBe("output-error");
		expect(engineToolPart("c1").errorText).toBe(STOPPED_TEXT);
	});

	test("the next message after Stop carries every waiting call answered with the stopped error", async () => {
		mount({ onToolCall: () => new Promise(() => {}) });
		await settle();
		replies.push(
			answerWithCalls([
				{ id: "a", name: "t", input: {} },
				{ id: "b", name: "t", input: {} },
			]),
			textAnswer("ok"),
		);

		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();

		await act(async () => {
			await engine().stop();
		});
		await settle();
		send("next question");
		await until("second POST", () => chatPosts.length === 2);

		expect(postPart(1, "a").state).toBe("output-error");
		expect(postPart(1, "a").errorText).toBe(STOPPED_TEXT);
		expect(postPart(1, "b").state).toBe("output-error");
		expect(postPart(1, "b").errorText).toBe(STOPPED_TEXT);
	});

	test("a message queued while the page worked, sent after Stop, carries both stopped calls answered", async () => {
		mount({ onToolCall: () => new Promise(() => {}) });
		await settle();
		replies.push(
			answerWithCalls([
				{ id: "a", name: "t", input: {} },
				{ id: "b", name: "t", input: {} },
			]),
			textAnswer("ok"),
		);

		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();
		send("queued meanwhile");
		expect(engine().queuedMessages).toHaveLength(1);

		act(() => {
			void engine().stop();
		});
		await until("second POST", () => chatPosts.length === 2);

		expect(postPart(1, "a").state).toBe("output-error");
		expect(postPart(1, "b").state).toBe("output-error");
	});

	test("Stop while the answer is still streaming aborts it and never hands the call to the page", async () => {
		let handled = 0;
		let stream: ControlledStream | undefined;
		mount({
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();
		replies.push({
			kind: "controlled",
			onOpen: (s) => {
				stream = s;
			},
		});

		send("go");
		await until("stream open", () => stream !== undefined);
		stream?.push({ type: "start" });
		stream?.push({ type: "start-step" });
		stream?.push({
			type: "tool-input-available",
			toolCallId: "c1",
			toolName: "t",
			input: {},
		});
		await until("tool part streamed", () =>
			engine().messages.some((m) =>
				m.parts.some((p) => "toolCallId" in p && p.toolCallId === "c1"),
			),
		);

		await act(async () => {
			await engine().stop();
		});
		await settle();

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
		expect(engine().isLoading).toBe(false);
	});

	test("with onToolCall set but nothing waiting, Stop still cancels the turn on the server", async () => {
		let stream: ControlledStream | undefined;
		mount({
			onToolCall: () => "x",
			body: { sessionId: "sess_7" },
		});
		await settle();
		replies.push({
			kind: "controlled",
			onOpen: (s) => {
				stream = s;
			},
		});

		send("go");
		await until("stream open", () => stream !== undefined);
		stream?.push({ type: "start" });
		stream?.push({ type: "start-step" });
		stream?.push({ type: "text-start", id: "t" });
		stream?.push({ type: "text-delta", id: "t", delta: "partial" });
		await until("streaming", () => engine().status === "streaming");

		await act(async () => {
			await engine().stop();
		});
		await settle();

		expect(cancelPosts).toHaveLength(1);
		expect(JSON.parse(cancelPosts[0] ?? "{}")).toEqual({ sessionId: "sess_7" });
	});
});

describe("onToolCall set: a replaced conversation drops late answers", () => {
	test("reset while the page works: the late answer sends nothing and the chat is idle", async () => {
		const d = deferred<unknown>();
		mount({ onToolCall: () => d.promise });
		await settle();
		replies.push(answerWithCalls([{ id: "c1", name: "t", input: {} }]));

		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();

		act(() => {
			engine().reset();
		});
		await settle();
		expect(engine().isLoading).toBe(false);
		expect(engine().status).toBe("ready");

		await act(async () => {
			d.resolve("late");
		});
		await settle();

		expect(chatPosts).toHaveLength(1);
		expect(engine().messages).toHaveLength(0);
		expect(engine().isLoading).toBe(false);
	});

	test("a new thread while the page works: the late answer sends nothing", async () => {
		const d = deferred<unknown>();
		mount({ onToolCall: () => d.promise });
		await settle();
		replies.push(answerWithCalls([{ id: "c1", name: "t", input: {} }]));

		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();

		act(() => {
			engine().startNewThread();
		});
		await act(async () => {
			d.reject(new Error("late failure"));
		});
		await settle();

		expect(chatPosts).toHaveLength(1);
		expect(engine().messages).toHaveLength(0);
		expect(engine().isLoading).toBe(false);
	});

	test("switching thread while the page works: an answer landing during the switch sends nothing for the old thread", async () => {
		const { upsertThread } = await import("../../lib/thread-store");
		const now = new Date().toISOString();
		await upsertThread({
			threadId: "thread_other",
			memoryUserId: "user_other",
			title: "Other thread",
			messages: [
				{
					id: "u_old",
					role: "user",
					parts: [{ type: "text", text: "an older question" }],
				},
			],
			createdAt: now,
			updatedAt: now,
		});
		const d = deferred<unknown>();
		mount({ onToolCall: () => d.promise, enableThreadHistory: true });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("should never be requested"),
		);

		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();

		await act(async () => {
			const switching = engine().switchThread("thread_other");
			d.resolve("answer after the visitor clicked away");
			await switching;
		});
		await settle();

		expect(chatPosts).toHaveLength(1);
		expect(engine().activeThreadId).toBe("thread_other");
		expect(engine().messages.map((m) => m.id)).toEqual(["u_old"]);
		expect(engine().isLoading).toBe(false);
	});

	test("deleting the active thread while the page works: the late answer sends nothing", async () => {
		const d = deferred<unknown>();
		mount({ onToolCall: () => d.promise, enableThreadHistory: true });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("should never be requested"),
		);

		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();
		const active = engine().activeThreadId;
		if (!active) {
			throw new Error("no active thread after the first send");
		}

		await act(async () => {
			const deleting = engine().deleteThread(active);
			d.resolve("answer after the thread was deleted");
			await deleting;
		});
		await settle();

		expect(chatPosts).toHaveLength(1);
		expect(engine().messages).toHaveLength(0);
		expect(engine().isLoading).toBe(false);
	});

	test("closing the chat while the page works: the late answer sends nothing", async () => {
		const d = deferred<unknown>();
		mount({ onToolCall: () => d.promise });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("should never be requested"),
		);

		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();

		act(() => {
			root.render(null);
		});
		await act(async () => {
			d.resolve("answer after the chat closed");
		});
		await settle();

		expect(chatPosts).toHaveLength(1);
	});

	test("after a reset the next message is sent at once, not queued behind the dropped calls", async () => {
		mount({ onToolCall: () => new Promise(() => {}) });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("fresh"),
		);

		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();
		act(() => {
			engine().reset();
		});
		await settle();

		send("fresh start");
		await until("second POST", () => chatPosts.length === 2);

		expect(engine().queuedMessages).toHaveLength(0);
		const msgs = chatPosts[1]?.body.messages ?? [];
		expect(msgs).toHaveLength(1);
		expect(msgs[0]?.role).toBe("user");
	});
});

describe("onToolCall set: failed answers are not handed over", () => {
	test("a request the server rejects with 500 never reaches the handler", async () => {
		let handled = 0;
		mount({
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();
		replies.push({ kind: "status", status: 500 });

		send("go");
		await until("errored", () => engine().status === "error");
		await settle();

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
	});

	test("a stream that errors after a tool call never hands the call over", async () => {
		let handled = 0;
		mount({
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();
		replies.push({
			kind: "chunks",
			chunks: [
				{ type: "start" },
				{ type: "start-step" },
				...toolCallChunks([{ id: "c1", name: "t", input: {} }]),
				{ type: "error", errorText: "model crashed" },
			],
		});

		send("go");
		await until("errored", () => engine().status === "error");
		await settle();

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
	});
});

// Round 3 helpers: open a controlled answer, and a clean thread store per test.
function controlledReply(): {
	reply: Reply;
	opened: () => ControlledStream | undefined;
} {
	let stream: ControlledStream | undefined;
	return {
		reply: {
			kind: "controlled",
			onOpen: (s) => {
				stream = s;
			},
		},
		opened: () => stream,
	};
}

async function streamToolCall(
	opened: () => ControlledStream | undefined,
	toolCallId: string,
) {
	await until("stream open", () => opened() !== undefined);
	const stream = opened();
	stream?.push({ type: "start" });
	stream?.push({ type: "start-step" });
	stream?.push({
		type: "tool-input-available",
		toolCallId,
		toolName: "get_page_title",
		input: {},
	});
	await until("tool part streamed", () =>
		engine().messages.some((m) =>
			m.parts.some((p) => "toolCallId" in p && p.toolCallId === toolCallId),
		),
	);
	return stream;
}

function endStream(stream: ControlledStream | undefined) {
	stream?.push({ type: "finish-step" });
	stream?.push({ type: "finish" });
	stream?.close();
}

async function clearThreads(): Promise<string> {
	const memoryUserId = await getOrCreateMemoryUserId();
	for (const t of await threadStore.listThreads(memoryUserId)) {
		await threadStore.deleteThread(t.threadId);
	}
	return memoryUserId;
}

async function storeThread(threadId: string, messages: UIMessage[]) {
	const now = new Date().toISOString();
	await threadStore.upsertThread({
		threadId,
		memoryUserId: await getOrCreateMemoryUserId(),
		title: threadId,
		messages,
		createdAt: now,
		updatedAt: now,
	});
}

function storedPart(thread: { messages: UIMessage[] } | null, id: string) {
	for (const m of thread?.messages ?? []) {
		for (const p of m.parts) {
			if ("toolCallId" in p && p.toolCallId === id) {
				return p;
			}
		}
	}
	return undefined;
}

const OLDER_QUESTION: UIMessage = {
	id: "u_old",
	role: "user",
	parts: [{ type: "text", text: "an older question" }],
};

const UNANSWERED_HISTORY: UIMessage[] = [
	{
		id: "u_hist",
		role: "user",
		parts: [{ type: "text", text: "what page?" }],
	},
	{
		id: "a_hist",
		role: "assistant",
		parts: [
			{
				type: "tool-get_page_title",
				toolCallId: "historical",
				state: "input-available",
				input: {},
			},
		],
	},
];

function fakeTransport(options: {
	chunks?: UIMessageChunk[];
	restored?: UIMessage[];
}) {
	const record: { sends: number; context: ChatTransportContext | undefined } = {
		sends: 0,
		context: undefined,
	};
	const factory: ChatTransportFactory = (context) => {
		record.context = context;
		return {
			sendMessages: async () => {
				record.sends += 1;
				return new ReadableStream<UIMessageChunk>({
					start(controller) {
						for (const chunk of options.chunks ?? []) {
							controller.enqueue(chunk);
						}
						controller.close();
					},
				});
			},
			reconnectToStream: async () => null,
			...(options.restored
				? {
						keepsSession: () => true,
						restore: async () => options.restored ?? [],
					}
				: {}),
		};
	};
	return { factory, record };
}

const CUSTOM_ANSWER: UIMessageChunk[] = [
	{ type: "start" },
	{ type: "start-step" },
	{
		type: "tool-input-available",
		toolCallId: "direct_1",
		toolName: "get_page_title",
		input: {},
	},
	{ type: "finish-step" },
	{ type: "finish" },
];

describe("pageUrl on every ordinary HTTP chat request", () => {
	test("a chat request carries the current page address as its own top-level field", async () => {
		mount();
		await settle();
		replies.push(textAnswer("hi"));

		send("hello");
		await until("POST", () => chatPosts.length === 1);

		expect(chatPosts[0]?.body.pageUrl).toBe("https://localhost/");
	});

	test("after a pushState route change the next request carries the new address", async () => {
		mount();
		await settle();
		replies.push(textAnswer("one"), textAnswer("two"));

		send("first");
		await until("first answer", () => engine().status === "ready");
		await until("first POST", () => chatPosts.length === 1);
		await settle();
		win.history.pushState({}, "", "/pricing?plan=pro#faq");
		send("second");
		await until("second POST", () => chatPosts.length === 2);

		expect(chatPosts[0]?.body.pageUrl).toBe("https://localhost/");
		expect(chatPosts[1]?.body.pageUrl).toBe(
			"https://localhost/pricing?plan=pro#faq",
		);
	});

	test("the carry-on request after the page answers reads the address again", async () => {
		mount({
			onToolCall: () => {
				win.history.pushState({}, "", "/checkout");
				return "navigated";
			},
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "go_to_checkout", input: {} }]),
			textAnswer("done"),
		);

		send("take me to checkout");
		await until("follow-up POST", () => chatPosts.length === 2);

		expect(chatPosts[0]?.body.pageUrl).toBe("https://localhost/");
		expect(chatPosts[1]?.body.pageUrl).toBe("https://localhost/checkout");
	});

	test("a pageUrl the caller put in body wins", async () => {
		mount({ body: { pageUrl: "https://caller.example/landing" } });
		await settle();
		replies.push(textAnswer("hi"));

		send("hello");
		await until("POST", () => chatPosts.length === 1);

		expect(chatPosts[0]?.body.pageUrl).toBe("https://caller.example/landing");
	});

	test("a page object the caller passed is left exactly as it was, with pageUrl beside it", async () => {
		const page = { url: "https://caller.example/p", title: "Caller page" };
		mount({ body: { page } });
		await settle();
		replies.push(textAnswer("hi"));

		send("hello");
		await until("POST", () => chatPosts.length === 1);

		expect(chatPosts[0]?.body.page).toEqual({
			url: "https://caller.example/p",
			title: "Caller page",
		});
		expect(page).toEqual({
			url: "https://caller.example/p",
			title: "Caller page",
		});
		expect(chatPosts[0]?.body.pageUrl).toBe("https://localhost/");
	});

	test("with no window the HTTP connection still sends the request, without pageUrl", async () => {
		const { factory, record } = fakeTransport({ chunks: [] });
		mount({ transport: factory });
		await settle();
		const fallback = record.context?.fallback;
		if (!fallback) {
			throw new Error("transport factory never called");
		}
		replies.push(textAnswer("hi"));

		const saved = globalThis.window;
		Reflect.deleteProperty(globalThis, "window");
		onChatPost = () => {
			Object.assign(globalThis, { window: saved });
		};
		try {
			await fallback.sendMessages({
				chatId: "c",
				messages: [],
				abortSignal: undefined,
				trigger: "submit-message",
				messageId: undefined,
			});
		} finally {
			Object.assign(globalThis, { window: saved });
		}

		expect(chatPosts).toHaveLength(1);
		expect(chatPosts[0]?.body).not.toHaveProperty("pageUrl");
	});
});

describe("a custom transport: onToolCall is ignored and pageUrl is not sent", () => {
	test("a tool call over a custom transport never reaches the handler and the chat ends idle", async () => {
		let handled = 0;
		const { factory, record } = fakeTransport({ chunks: CUSTOM_ANSWER });
		mount({
			transport: factory,
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();

		send("go");
		await until("answer finished", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();

		expect(handled).toBe(0);
		expect(record.sends).toBe(1);
		expect(engine().status).toBe("ready");
		expect(engine().isLoading).toBe(false);
	});

	test("the body the chat hands a custom transport carries no pageUrl", async () => {
		const { factory, record } = fakeTransport({ chunks: [] });
		mount({ transport: factory });
		await settle();

		const body = record.context?.body();

		expect(body).toBeDefined();
		expect(body).not.toHaveProperty("pageUrl");
	});

	test("a turn a custom transport sends through its HTTP fallback carries pageUrl", async () => {
		const { factory, record } = fakeTransport({ chunks: [] });
		mount({ transport: factory });
		await settle();
		const fallback = record.context?.fallback;
		if (!fallback) {
			throw new Error("transport factory never called");
		}
		replies.push(textAnswer("hi"));

		await fallback.sendMessages({
			chatId: "c",
			messages: [],
			abortSignal: undefined,
			trigger: "submit-message",
			messageId: undefined,
		});

		expect(chatPosts[0]?.body.pageUrl).toBe("https://localhost/");
	});

	test("unanswered calls a custom transport restores on mount are not handed to the page", async () => {
		let handled = 0;
		const { factory, record } = fakeTransport({
			restored: UNANSWERED_HISTORY,
		});
		mount({
			transport: factory,
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await until("restored", () => engine().messages.length === 2);
		await settle();

		expect(handled).toBe(0);
		expect(record.sends).toBe(0);
		expect(engine().isLoading).toBe(false);
	});
});

describe("restored history is never handed to the page", () => {
	test("initial messages ending on an unanswered call: handler not called, chat idle, next message sent at once", async () => {
		let handled = 0;
		mount({
			initialMessages: UNANSWERED_HISTORY,
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();
		expect(handled).toBe(0);
		expect(engine().isLoading).toBe(false);

		replies.push(textAnswer("ok"));
		send("new question");
		await until("POST", () => chatPosts.length === 1);
		await until("answered", () => engine().status === "ready");
		await settle();

		expect(handled).toBe(0);
		expect(engine().queuedMessages).toHaveLength(0);
	});

	test("a saved thread loaded on mount with an unanswered call is not handed to the page", async () => {
		await clearThreads();
		await storeThread("t_restored", UNANSWERED_HISTORY);
		let handled = 0;
		mount({
			enableThreadHistory: true,
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await until("thread loaded", () => engine().messages.length === 2);
		await settle();

		expect(engine().activeThreadId).toBe("t_restored");
		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(0);
		expect(engine().isLoading).toBe(false);
	});
});

describe("no thread persistence while the page works", () => {
	test("the thread is not saved with an unanswered call, and is saved answered once the chat carries on", async () => {
		await clearThreads();
		const d = deferred<unknown>();
		mount({ enableThreadHistory: true, onToolCall: () => d.promise });
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("done"),
		);

		send("go");
		await until("page working", () => engine().isLoading);
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await tick(500);
		const threadId = engine().activeThreadId;
		if (!threadId) {
			throw new Error("no active thread");
		}

		const during = await threadStore.loadThread(threadId);
		expect(storedPart(during, "c1")).toBeUndefined();

		await act(async () => {
			d.resolve("answer");
		});
		await until("chat idle", () => engine().status === "ready");
		await tick(500);

		const after = await threadStore.loadThread(threadId);
		expect(storedPart(after, "c1")).toMatchObject({
			state: "output-available",
			output: "answer",
		});
	});
});

describe("a finished answer that no longer belongs to the conversation hands nothing over", () => {
	test("reset() called inside onResponseReceived: nothing handed to the page, no follow-up, chat idle", async () => {
		let handled = 0;
		mount({
			onToolCall: () => {
				handled += 1;
				return "x";
			},
			onResponseReceived: () => {
				hookRef.current?.reset();
			},
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("should never be requested"),
		);

		send("go");
		await until("POST", () => chatPosts.length === 1);
		await until("finished", () => engine().status === "ready");
		await settle();

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
		expect(engine().isLoading).toBe(false);
		expect(engine().messages).toHaveLength(0);
	});

	test("a network disconnect after the tool input arrived hands nothing over", async () => {
		let handled = 0;
		mount({
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();
		const { reply, opened } = controlledReply();
		replies.push(reply);

		send("go");
		const stream = await streamToolCall(opened, "c1");
		stream?.fail(new TypeError("network error"));
		await until("errored", () => engine().status === "error");
		await settle();

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
		expect(engine().isLoading).toBe(false);
	});

	test("a stream that finishes after a reset hands nothing to the page", async () => {
		let handled = 0;
		mount({
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();
		const { reply, opened } = controlledReply();
		replies.push(reply, textAnswer("should never be requested"));

		send("go");
		const stream = await streamToolCall(opened, "c1");
		act(() => {
			engine().reset();
		});
		endStream(stream);
		await until("stream over", () => engine().status === "ready");
		await settle();

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
		expect(engine().isLoading).toBe(false);
	});

	test("a stream that finishes after a thread switch hands nothing to the page", async () => {
		await clearThreads();
		await storeThread("t_target", [OLDER_QUESTION]);
		let handled = 0;
		mount({
			enableThreadHistory: true,
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await until("history loaded", () => engine().isThreadHistoryReady);
		act(() => {
			engine().startNewThread();
		});
		await settle();
		const { reply, opened } = controlledReply();
		replies.push(reply, textAnswer("should never be requested"));

		send("go");
		const stream = await streamToolCall(opened, "c1");
		await act(async () => {
			await engine().switchThread("t_target");
		});
		endStream(stream);
		await until("stream over", () => engine().status === "ready");
		await settle();

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
		expect(engine().isLoading).toBe(false);
	});

	test("a stream that finishes after the chat closed hands nothing to the page", async () => {
		let handled = 0;
		mount({
			onToolCall: () => {
				handled += 1;
				return "x";
			},
		});
		await settle();
		const { reply, opened } = controlledReply();
		replies.push(reply, textAnswer("should never be requested"));

		send("go");
		const stream = await streamToolCall(opened, "c1");
		act(() => {
			root.render(null);
		});
		endStream(stream);
		await tick(100);

		expect(handled).toBe(0);
		expect(chatPosts).toHaveLength(1);
	});

	test("after a reset, the next answer's page call is handed over and the chat carries on", async () => {
		const seen: string[] = [];
		mount({
			onToolCall: (call) => {
				seen.push(call.toolCallId);
				return call.toolCallId === "before" ? new Promise(() => {}) : "fresh";
			},
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "before", name: "t", input: {} }]),
			answerWithCalls([{ id: "after", name: "t", input: {} }]),
			textAnswer("done"),
		);

		send("go");
		await until("first handed", () => seen.length === 1);
		act(() => {
			engine().reset();
		});
		await settle();
		send("again");
		await until("carry-on POST", () => chatPosts.length === 3);

		expect(seen).toEqual(["before", "after"]);
		expect(postPart(2, "after").output).toBe("fresh");
	});

	test("after Stop, the next answer's page call is handed over", async () => {
		const seen: string[] = [];
		mount({
			onToolCall: (call) => {
				seen.push(call.toolCallId);
				return call.toolCallId === "before" ? new Promise(() => {}) : "fresh";
			},
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "before", name: "t", input: {} }]),
			answerWithCalls([{ id: "after", name: "t", input: {} }]),
			textAnswer("done"),
		);

		send("go");
		await until("first handed", () => seen.length === 1);
		await act(async () => {
			await engine().stop();
		});
		await settle();
		send("again");
		await until("carry-on POST", () => chatPosts.length === 3);

		expect(seen).toEqual(["before", "after"]);
		expect(postPart(2, "after").output).toBe("fresh");
	});
});

describe("a queued message and a thread change while the page works", () => {
	test("switching thread with a message queued: the message is not sent to the old thread", async () => {
		await clearThreads();
		await storeThread("t_target", [OLDER_QUESTION]);
		mount({
			enableThreadHistory: true,
			onToolCall: () => new Promise(() => {}),
		});
		await until("history loaded", () => engine().isThreadHistoryReady);
		act(() => {
			engine().startNewThread();
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("should never be requested"),
		);

		send("go");
		await until("page working", () => engine().isLoading);
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();
		send("queued meanwhile");
		expect(engine().queuedMessages).toHaveLength(1);

		act(() => {
			void engine().switchThread("t_target");
		});
		await until("switched", () => engine().activeThreadId === "t_target");
		await tick(400);

		expect(chatPosts).toHaveLength(1);
		expect(engine().queuedMessages).toHaveLength(0);
		expect(engine().messages.map((m) => m.id)).toEqual(["u_old"]);
		expect(engine().isLoading).toBe(false);
	});

	test("switching thread while the page works saves the outgoing thread with its calls answered", async () => {
		await clearThreads();
		await storeThread("t_target", [OLDER_QUESTION]);
		mount({
			enableThreadHistory: true,
			onToolCall: () => new Promise(() => {}),
		});
		await until("history loaded", () => engine().isThreadHistoryReady);
		act(() => {
			engine().startNewThread();
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("should never be requested"),
		);

		send("go");
		await until("page working", () => engine().isLoading);
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();
		const outgoing = engine().activeThreadId;

		act(() => {
			void engine().switchThread("t_target");
		});
		await until("switched", () => engine().activeThreadId === "t_target");
		await tick(400);

		const saved = await threadStore.loadThread(outgoing ?? "");
		expect(storedPart(saved, "c1")).toMatchObject({
			state: "output-error",
			errorText: STOPPED_TEXT,
		});
	});

	test("deleting the active thread with a message queued: the message is never sent", async () => {
		await clearThreads();
		mount({
			enableThreadHistory: true,
			onToolCall: () => new Promise(() => {}),
		});
		await until("history loaded", () => engine().isThreadHistoryReady);
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			textAnswer("should never be requested"),
		);

		send("go");
		await until("page working", () => engine().isLoading);
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();
		const active = engine().activeThreadId;
		if (!active) {
			throw new Error("no active thread");
		}
		send("queued meanwhile");
		expect(engine().queuedMessages).toHaveLength(1);

		act(() => {
			void engine().deleteThread(active);
		});
		await until("deleted", () => engine().activeThreadId === undefined);
		await tick(400);

		expect(chatPosts).toHaveLength(1);
		expect(engine().queuedMessages).toHaveLength(0);
		expect(engine().messages).toHaveLength(0);
		expect(engine().isLoading).toBe(false);
	});
});

const UNSTORED_TEXT = "The page's result could not be stored.";

function selfReferencing(): Record<string, unknown> {
	const node: Record<string, unknown> = { name: "loop" };
	node.self = node;
	return node;
}

describe("a result JSON can't carry is sent as an error and later requests still work", () => {
	for (const [label, make] of [
		["a BigInt", () => 10n],
		["an object holding a BigInt", () => ({ total: 10n })],
		["a self-referencing object", selfReferencing],
	] as const) {
		test(`${label}: the follow-up carries the stored-error text, and the next message still sends`, async () => {
			mount({ onToolCall: () => make() });
			await settle();
			replies.push(
				answerWithCalls([{ id: "c1", name: "read_cart", input: {} }]),
				textAnswer("sorry"),
				textAnswer("next answer"),
			);

			send("cart?");
			await until("follow-up POST", () => chatPosts.length === 2);
			await until("chat idle", () => engine().status === "ready");
			await settle();

			expect(postPart(1, "c1")).toMatchObject({
				state: "output-error",
				errorText: UNSTORED_TEXT,
			});

			send("and now?");
			await until("third POST", () => chatPosts.length === 3);
			await until("answered", () => engine().status === "ready");

			expect(postPart(2, "c1").state).toBe("output-error");
			expect(engine().status).toBe("ready");
		});
	}

	test("one unstorable result beside a good one: one follow-up, each call with its own outcome", async () => {
		mount({
			onToolCall: (call) => (call.toolCallId === "bad" ? 1n : { ok: true }),
		});
		await settle();
		replies.push(
			answerWithCalls([
				{ id: "bad", name: "t", input: {} },
				{ id: "good", name: "t", input: {} },
			]),
			textAnswer("ok"),
		);

		send("go");
		await until("follow-up POST", () => chatPosts.length === 2);
		await until("chat idle", () => engine().status === "ready");
		await settle();

		expect(chatPosts).toHaveLength(2);
		expect(postPart(1, "bad")).toMatchObject({
			state: "output-error",
			errorText: UNSTORED_TEXT,
		});
		expect(postPart(1, "good")).toMatchObject({
			state: "output-available",
			output: { ok: true },
		});
	});
});

// Puts the page to work in a fresh saved thread, beside a stored thread to switch to.
async function pageWorkingInNewThread(): Promise<string> {
	await clearThreads();
	await storeThread("t_target", [OLDER_QUESTION]);
	await storeThread("t_second", [
		{ id: "u_second", role: "user", parts: [{ type: "text", text: "second" }] },
	]);
	mount({ enableThreadHistory: true, onToolCall: () => new Promise(() => {}) });
	await until("history loaded", () => engine().isThreadHistoryReady);
	act(() => {
		engine().startNewThread();
	});
	await settle();
	replies.push(
		answerWithCalls([{ id: "c1", name: "t", input: {} }]),
		textAnswer("only if a queued message goes out"),
	);
	send("go");
	await until("page working", () => engine().isLoading);
	await until("stream ended", () =>
		engine().messages.some((m) => m.role === "assistant"),
	);
	await settle();
	const outgoing = engine().activeThreadId;
	if (!outgoing) {
		throw new Error("no active thread");
	}
	return outgoing;
}

function holdLoad(threadId: string) {
	const gate = deferred<void>();
	storeHolds.load = (id) =>
		id === threadId ? gate.promise : Promise.resolve();
	return () => gate.resolve();
}

function stoppedInEngine(id: string) {
	return () => {
		const part = engineToolPart(id);
		return part.state === "output-error" && part.errorText === STOPPED_TEXT;
	};
}

describe("a thread switch or delete keeps the chat busy until it ends", () => {
	test("while the target thread is still loading the chat stays busy and the queued message waits", async () => {
		await pageWorkingInNewThread();
		const release = holdLoad("t_target");
		send("queued meanwhile");

		act(() => {
			void engine().switchThread("t_target");
		});
		await until("stopped answers written", stoppedInEngine("c1"));
		await tick(100);

		expect(engine().isLoading).toBe(true);
		expect(engine().status).toBe("streaming");
		expect(engine().queuedMessages).toHaveLength(1);
		expect(chatPosts).toHaveLength(1);

		release();
		await until("switched", () => engine().activeThreadId === "t_target");
		await tick(100);

		expect(engine().isLoading).toBe(false);
		expect(engine().queuedMessages).toHaveLength(0);
		expect(chatPosts).toHaveLength(1);
	});

	test("the outgoing thread is saved with its stopped calls before the target thread loads", async () => {
		const outgoing = await pageWorkingInNewThread();
		const release = holdLoad("t_target");

		act(() => {
			void engine().switchThread("t_target");
		});
		await until("stopped answers written", stoppedInEngine("c1"));
		await tick(100);
		const savedMidSwitch = await threadStore.loadThread(outgoing);

		release();
		await until("switched", () => engine().activeThreadId === "t_target");

		expect(storedPart(savedMidSwitch, "c1")).toMatchObject({
			state: "output-error",
			errorText: STOPPED_TEXT,
		});
	});

	test("a switch to a thread that no longer exists ends idle on the outgoing thread, its calls answered", async () => {
		const outgoing = await pageWorkingInNewThread();
		send("queued meanwhile");

		await act(async () => {
			await engine().switchThread("t_missing");
		});
		await until("queued message sent", () => chatPosts.length === 2);
		await until("idle", () => engine().status === "ready");

		expect(engine().activeThreadId).toBe(outgoing);
		expect(engine().isLoading).toBe(false);
		expect(postPart(1, "c1")).toMatchObject({
			state: "output-error",
			errorText: STOPPED_TEXT,
		});
	});

	test("a switch superseded part-way by a second switch: no queued message is sent and the chat ends idle on the second thread", async () => {
		await pageWorkingInNewThread();
		const release = holdLoad("t_target");
		send("queued meanwhile");

		act(() => {
			void engine().switchThread("t_target");
		});
		await until("stopped answers written", stoppedInEngine("c1"));
		act(() => {
			void engine().switchThread("t_second");
		});
		await until("second switch", () => engine().activeThreadId === "t_second");
		release();
		await tick(300);

		expect(chatPosts).toHaveLength(1);
		expect(engine().activeThreadId).toBe("t_second");
		expect(engine().messages.map((m) => m.id)).toEqual(["u_second"]);
		expect(engine().queuedMessages).toHaveLength(0);
		expect(engine().isLoading).toBe(false);
	});

	test("deleting the active thread keeps the chat busy until the store delete finishes", async () => {
		const outgoing = await pageWorkingInNewThread();
		const gate = deferred<void>();
		storeHolds.remove = (id) =>
			id === outgoing ? gate.promise : Promise.resolve();
		send("queued meanwhile");

		act(() => {
			void engine().deleteThread(outgoing);
		});
		await until("stopped answers written", stoppedInEngine("c1"));
		await tick(100);

		expect(engine().isLoading).toBe(true);
		expect(engine().queuedMessages).toHaveLength(1);
		expect(chatPosts).toHaveLength(1);

		gate.resolve();
		await until("deleted", () => engine().activeThreadId === undefined);
		await tick(100);

		expect(engine().isLoading).toBe(false);
		expect(engine().queuedMessages).toHaveLength(0);
		expect(chatPosts).toHaveLength(1);
	});

	test("a delete superseded part-way by a switch: no queued message is sent and the chat ends idle on the target", async () => {
		const outgoing = await pageWorkingInNewThread();
		const gate = deferred<void>();
		storeHolds.remove = (id) =>
			id === outgoing ? gate.promise : Promise.resolve();
		send("queued meanwhile");

		act(() => {
			void engine().deleteThread(outgoing);
		});
		await until("stopped answers written", stoppedInEngine("c1"));
		act(() => {
			void engine().switchThread("t_target");
		});
		await until("switched", () => engine().activeThreadId === "t_target");
		gate.resolve();
		await tick(300);

		expect(chatPosts).toHaveLength(1);
		expect(engine().activeThreadId).toBe("t_target");
		expect(engine().messages.map((m) => m.id)).toEqual(["u_old"]);
		expect(engine().queuedMessages).toHaveLength(0);
		expect(engine().isLoading).toBe(false);
	});

	test("Stop pressed during a held switch does not end the busy state early", async () => {
		await pageWorkingInNewThread();
		const release = holdLoad("t_target");
		send("queued meanwhile");

		act(() => {
			void engine().switchThread("t_target");
		});
		await until("stopped answers written", stoppedInEngine("c1"));
		await act(async () => {
			await engine().stop();
		});
		await tick(100);

		expect(engine().isLoading).toBe(true);
		expect(chatPosts).toHaveLength(1);
		expect(cancelPosts).toHaveLength(0);

		release();
		await until("switched", () => engine().activeThreadId === "t_target");
		await tick(100);
		expect(engine().isLoading).toBe(false);
		expect(chatPosts).toHaveLength(1);
	});
});

describe("overlapping thread actions never clear a newer conversation's busy state", () => {
	test("an old switch finishing late keeps a new thread's page call: its answer and the queued message go out in order", async () => {
		await clearThreads();
		await storeThread("t_target", [OLDER_QUESTION]);
		const answerNew = deferred<unknown>();
		mount({
			enableThreadHistory: true,
			onToolCall: (call) =>
				call.toolCallId === "c1" ? new Promise(() => {}) : answerNew.promise,
		});
		await until("history loaded", () => engine().isThreadHistoryReady);
		act(() => {
			engine().startNewThread();
		});
		await settle();
		replies.push(
			answerWithCalls([{ id: "c1", name: "t", input: {} }]),
			answerWithCalls([{ id: "n1", name: "t", input: {} }]),
			textAnswer("carried on"),
			textAnswer("queued answer"),
		);
		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();
		const gate = deferred<void>();
		let loading = false;
		storeHolds.load = (id) => {
			if (id !== "t_target") {
				return Promise.resolve();
			}
			loading = true;
			return gate.promise;
		};

		act(() => {
			void engine().switchThread("t_target");
		});
		await until("switch parked on the target load", () => loading);
		act(() => {
			engine().startNewThread();
		});
		await settle();
		send("new thread question");
		await until("new answer", () => chatPosts.length === 2);
		await until("new call streamed", () =>
			engine().messages.some((m) =>
				m.parts.some((p) => "toolCallId" in p && p.toolCallId === "n1"),
			),
		);
		await settle();
		send("queued in the new thread");
		expect(engine().queuedMessages).toHaveLength(1);

		gate.resolve();
		await tick(300);
		expect(engine().isLoading).toBe(true);
		expect(chatPosts).toHaveLength(2);

		await act(async () => {
			answerNew.resolve("page answer");
		});
		await until("queued POST", () => chatPosts.length === 4);

		expect(postPart(2, "n1")).toMatchObject({
			state: "output-available",
			output: "page answer",
		});
		expect(postPart(3, "n1")).toMatchObject({
			state: "output-available",
			output: "page answer",
		});
		const last = chatPosts[3]?.body.messages ?? [];
		expect(last[last.length - 1]?.role).toBe("user");
		expect(JSON.stringify(last[last.length - 1]?.parts)).toContain(
			"queued in the new thread",
		);
	});

	test("two overlapping switches, both loads held: busy until the second ends, then idle on it with nothing sent", async () => {
		await pageWorkingInNewThread();
		const gateTarget = deferred<void>();
		const gateSecond = deferred<void>();
		storeHolds.load = (id) =>
			id === "t_target"
				? gateTarget.promise
				: id === "t_second"
					? gateSecond.promise
					: Promise.resolve();
		send("queued meanwhile");

		act(() => {
			void engine().switchThread("t_target");
		});
		await until("stopped answers written", stoppedInEngine("c1"));
		act(() => {
			void engine().switchThread("t_second");
		});
		await tick(100);
		gateTarget.resolve();
		await tick(300);

		expect(engine().isLoading).toBe(true);
		expect(engine().queuedMessages).toHaveLength(1);
		expect(chatPosts).toHaveLength(1);

		gateSecond.resolve();
		await until("second switch", () => engine().activeThreadId === "t_second");
		await tick(300);

		expect(engine().isLoading).toBe(false);
		expect(engine().queuedMessages).toHaveLength(0);
		expect(engine().messages.map((m) => m.id)).toEqual(["u_second"]);
		expect(chatPosts).toHaveLength(1);
	});

	test("a plain Stop then a switch while the Stop is still writing: busy until the switch ends", async () => {
		await clearThreads();
		await storeThread("t_target", [OLDER_QUESTION]);
		mount({
			enableThreadHistory: true,
			onToolCall: () => new Promise(() => {}),
		});
		await until("history loaded", () => engine().isThreadHistoryReady);
		act(() => {
			engine().startNewThread();
		});
		await settle();
		replies.push(
			answerWithCalls([
				{ id: "a", name: "t", input: {} },
				{ id: "b", name: "t", input: {} },
			]),
			textAnswer("only if a queued message goes out"),
		);
		send("go");
		await until("stream ended", () =>
			engine().messages.some((m) => m.role === "assistant"),
		);
		await settle();
		send("queued meanwhile");
		const release = holdLoad("t_target");

		act(() => {
			void engine().stop();
			void engine().switchThread("t_target");
		});
		await until("stopped answers written", stoppedInEngine("b"));
		await tick(300);

		expect(engine().isLoading).toBe(true);
		expect(engine().queuedMessages).toHaveLength(1);
		expect(chatPosts).toHaveLength(1);

		release();
		await until("switched", () => engine().activeThreadId === "t_target");
		await tick(300);

		expect(engine().isLoading).toBe(false);
		expect(engine().queuedMessages).toHaveLength(0);
		expect(chatPosts).toHaveLength(1);
	});
});
