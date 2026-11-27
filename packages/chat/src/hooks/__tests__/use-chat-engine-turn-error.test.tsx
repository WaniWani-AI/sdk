import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

// Real `useChat`, real transport and the real message list; only `fetch` is
// faked, answering chat POSTs the way the server does, failures included.

const win = new Window({ url: "https://localhost" });
Object.assign(win, { SyntaxError });
Object.assign(globalThis, {
	indexedDB: new IDBFactory(),
	IDBKeyRange,
	window: win,
	document: win.document,
	navigator: win.navigator,
	localStorage: win.localStorage,
	screen: win.screen,
	HTMLElement: win.HTMLElement,
	HTMLDivElement: win.HTMLDivElement,
	MutationObserver: win.MutationObserver,
	customElements: win.customElements,
	Element: win.Element,
	Node: win.Node,
	Text: win.Text,
	Comment: win.Comment,
	DocumentFragment: win.DocumentFragment,
	Event: win.Event,
	CustomEvent: win.CustomEvent,
	requestAnimationFrame: win.requestAnimationFrame.bind(win),
	cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
	getComputedStyle: win.getComputedStyle.bind(win),
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

// Other test files fake these modules for the whole run: a query-suffixed import
// fetches the real ones, spread because bun ignores a re-mock with the same object.
const realAiSdkReact: typeof import("@ai-sdk/react") = await import(
	`${Bun.resolveSync("@ai-sdk/react", import.meta.dir)}?real`
);
const realTransportPath = "../../lib/lenient-chat-transport.ts?real";
const realTransport: typeof import("../../lib/lenient-chat-transport") =
	await import(realTransportPath);
// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({ ...realAiSdkReact }));
// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../lib/lenient-chat-transport", () => ({ ...realTransport }));

const { useChatEngine } = await import("../use-chat-engine");
const { MessageList } = await import("../../components/message-list");
type HookReturn = ReturnType<typeof useChatEngine>;

const API = "https://acme.example/api/waniwani";

// Network fake

type Chunk = Record<string, unknown>;

type Reply =
	| { kind: "chunks"; chunks: Chunk[] }
	| { kind: "breaks"; chunks: Chunk[] }
	| { kind: "status"; status: number; headers?: Record<string, string> }
	| { kind: "offline" };

type ChatPost = {
	messages: Array<{ id: string; role: string; parts: unknown[] }>;
};

let replies: Reply[] = [];
let chatPosts: ChatPost[] = [];

const encoder = new TextEncoder();
function line(chunk: Chunk | "[DONE]"): Uint8Array {
	return encoder.encode(
		`data: ${chunk === "[DONE]" ? chunk : JSON.stringify(chunk)}\n\n`,
	);
}

function respond(reply: Reply): Response {
	if (reply.kind === "offline") {
		throw new TypeError("Failed to fetch");
	}
	if (reply.kind === "status") {
		return new Response("nope", {
			status: reply.status,
			headers: reply.headers,
		});
	}
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of reply.chunks) {
				controller.enqueue(line(chunk));
			}
			if (reply.kind === "breaks") {
				controller.error(new TypeError("network connection was lost"));
				return;
			}
			controller.enqueue(line("[DONE]"));
			controller.close();
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
			"x-vercel-ai-ui-message-stream": "v1",
		},
	});
}

function answer(text: string): Chunk[] {
	return [
		{ type: "start" },
		{ type: "start-step" },
		{ type: "text-start", id: "t" },
		{ type: "text-delta", id: "t", delta: text },
		{ type: "text-end", id: "t" },
		{ type: "finish-step" },
		{ type: "finish" },
	];
}

function halfAnswer(text: string): Chunk[] {
	return [
		{ type: "start" },
		{ type: "start-step" },
		{ type: "text-start", id: "t" },
		{ type: "text-delta", id: "t", delta: text },
	];
}

// Harness

let root: Root;
let container: HTMLElement;
let engineRef: { current: HookReturn | null };
let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;
const originalFetch = globalThis.fetch;

async function fakeFetch(
	_input: unknown,
	init?: RequestInit,
): Promise<Response> {
	chatPosts.push(JSON.parse(String(init?.body)));
	const reply = replies.shift();
	if (!reply) {
		throw new Error(`unexpected chat POST #${chatPosts.length}`);
	}
	return respond(reply);
}

function Chat() {
	const engine = useChatEngine({ api: API, skipRemoteConfig: true });
	engineRef.current = engine;
	return createElement(MessageList, {
		messages: engine.messages,
		status: engine.status,
		turnError: engine.turnError,
		onRetry: engine.retry,
	});
}

function engine(): HookReturn {
	if (!engineRef.current) {
		throw new Error("engine not mounted");
	}
	return engineRef.current;
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

function send(text: string) {
	act(() => {
		engine().handleSubmit({ text, files: [] });
	});
}

function retryButton(): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Retry",
	);
}

function errorText(): string {
	return container.querySelector(".ww-error")?.textContent ?? "";
}

beforeEach(() => {
	replies = [];
	chatPosts = [];
	globalThis.fetch = Object.assign(fakeFetch, {
		preconnect: originalFetch.preconnect,
	});
	warnSpy = spyOn(console, "warn").mockImplementation(() => {});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	engineRef = { current: null };
	act(() => {
		root.render(createElement(Chat));
	});
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
	globalThis.fetch = originalFetch;
	warnSpy.mockRestore();
});

describe("a 429 tells the visitor when they can try again", () => {
	test("Retry-After in seconds shows the wait and holds Retry", async () => {
		replies.push({
			kind: "status",
			status: 429,
			headers: { "Retry-After": "30" },
		});
		send("hello");
		await until("the error bubble", () => errorText() !== "");

		expect(errorText()).toContain("Too many messages in a short time.");
		expect(errorText()).toContain("You can try again in 30 seconds.");
		expect(retryButton()?.disabled).toBe(true);
	});

	test("Retry-After as an HTTP date shows the wait in minutes", async () => {
		const inTwoMinutes = new Date(Date.now() + 120_000).toUTCString();
		replies.push({
			kind: "status",
			status: 429,
			headers: { "Retry-After": inTwoMinutes },
		});
		send("hello");
		await until("the error bubble", () => errorText() !== "");

		expect(errorText()).toContain("You can try again in 2 minutes.");
		expect(retryButton()?.disabled).toBe(true);
	});

	test("a Retry-After already past leaves Retry enabled", async () => {
		replies.push({
			kind: "status",
			status: 429,
			headers: { "Retry-After": "0" },
		});
		send("hello");
		await until("the error bubble", () => errorText() !== "");

		expect(errorText()).toContain("Too many messages in a short time.");
		expect(errorText()).not.toContain("You can try again in");
		expect(retryButton()?.disabled).toBe(false);
	});

	test("a 429 without Retry-After asks for a moment and leaves Retry enabled", async () => {
		replies.push({ kind: "status", status: 429 });
		send("hello");
		await until("the error bubble", () => errorText() !== "");

		expect(errorText()).toContain("Wait a moment, then try again.");
		expect(retryButton()?.disabled).toBe(false);
	});
});

describe("a failed turn shows an error bubble with Retry", () => {
	for (const [label, reply] of [
		["a 500", { kind: "status", status: 500 }],
		["a request that never reached the server", { kind: "offline" }],
		[
			"a stream that breaks midway",
			{ kind: "breaks", chunks: halfAnswer("Half an ans") },
		],
	] satisfies Array<[string, Reply]>) {
		test(`${label} shows the failure and Retry`, async () => {
			replies.push(reply);
			send("hello");
			await until("the error bubble", () => errorText() !== "");

			expect(errorText()).toContain("The reply didn't come through.");
			expect(errorText()).not.toContain("Too many messages");
			expect(retryButton()?.disabled).toBe(false);
		});
	}

	test("Retry resends the last user message once and the answer replaces the bubble", async () => {
		replies.push({ kind: "status", status: 500 });
		send("what does my policy cover?");
		await until("the error bubble", () => retryButton() !== undefined);
		const failedUserId = engine().messages[0]?.id;

		replies.push({ kind: "chunks", chunks: answer("Fire and theft.") });
		act(() => {
			retryButton()?.click();
		});
		await until("the answer", () =>
			(container.textContent ?? "").includes("Fire and theft."),
		);

		expect(chatPosts).toHaveLength(2);
		const resent = chatPosts[1]?.messages ?? [];
		expect(resent.map((m) => m.role)).toEqual(["user"]);
		expect(resent[0]?.id).toBe(failedUserId);
		expect(resent[0]?.parts).toEqual([
			{ type: "text", text: "what does my policy cover?" },
		]);
		expect(engine().messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(errorText()).toBe("");
	});

	test("Retry after a broken stream drops the partial answer", async () => {
		replies.push({ kind: "breaks", chunks: halfAnswer("Half an ans") });
		send("hello");
		await until("the error bubble", () => retryButton() !== undefined);

		replies.push({ kind: "chunks", chunks: answer("A whole answer.") });
		act(() => {
			retryButton()?.click();
		});
		await until("the answer", () =>
			(container.textContent ?? "").includes("A whole answer."),
		);

		expect(chatPosts[1]?.messages.map((m) => m.role)).toEqual(["user"]);
		expect(container.textContent).not.toContain("Half an ans");
		expect(engine().messages.map((m) => m.role)).toEqual(["user", "assistant"]);
	});

	test("sending a new message clears the bubble", async () => {
		replies.push({ kind: "status", status: 500 });
		send("hello");
		await until("the error bubble", () => errorText() !== "");

		replies.push({ kind: "chunks", chunks: answer("Hi there.") });
		send("hello again");
		await until("the answer", () =>
			(container.textContent ?? "").includes("Hi there."),
		);

		expect(errorText()).toBe("");
	});

	test("reset clears the bubble", async () => {
		replies.push({ kind: "status", status: 500 });
		send("hello");
		await until("the error bubble", () => errorText() !== "");

		act(() => {
			engine().reset();
		});
		await tick();

		expect(errorText()).toBe("");
	});
});
