import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

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

const { useChatEngine } = await import("../use-chat-engine");
type HookReturn = ReturnType<typeof useChatEngine>;
type EngineProps = Parameters<typeof useChatEngine>[0];
type ToolCallHandler = NonNullable<EngineProps["onToolCall"]>;
type PageCall = Parameters<ToolCallHandler>[0];

const API = "https://acme.example/api/waniwani";
const STOPPED_TEXT = "Stopped by the user before the page answered.";

// Network fake

type Chunk = Record<string, unknown>;

interface ChatPost {
	body: {
		messages: Array<{
			role: string;
			parts: Array<Record<string, unknown>>;
		}>;
	};
}

interface ControlledStream {
	push: (chunk: Chunk) => void;
	close: () => void;
}

type Reply =
	| { kind: "chunks"; chunks: Chunk[] }
	| { kind: "controlled"; onOpen: (stream: ControlledStream) => void }
	| { kind: "status"; status: number };

let replies: Reply[] = [];
let chatPosts: ChatPost[] = [];
let cancelPosts: string[] = [];
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
	replies = [];
	chatPosts = [];
	cancelPosts = [];
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
