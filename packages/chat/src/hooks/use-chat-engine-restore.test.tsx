import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

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

const React = await import("react");
const { act, createElement } = React;
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;
type UIMessage = import("ai").UIMessage;

function textMessage(id: string, role: "user" | "assistant", text: string) {
	const message: UIMessage = { id, role, parts: [{ type: "text", text }] };
	return message;
}

// A `useChat` that holds its messages in React state, so what the engine shows
// is observable through `engine.messages`.
// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({
	useChat(opts: { messages?: UIMessage[] }) {
		const [messages, setMessages] = React.useState<UIMessage[]>(
			opts.messages ?? [],
		);
		const sendMessage = React.useCallback((input: { text?: string }) => {
			setMessages((current) => [
				...current,
				textMessage(
					`sent_${current.length}`,
					"user",
					typeof input?.text === "string" ? input.text : "",
				),
			]);
		}, []);
		return {
			messages,
			sendMessage,
			setMessages,
			status: "ready",
			stop: async () => {},
		};
	},
}));

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../lib/lenient-chat-transport", () => ({
	LenientChatTransport: class {},
}));

const originalFetch = globalThis.fetch;
beforeEach(() => {
	globalThis.fetch = mock(async () =>
		Response.json({ tools: [] }),
	) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const { useChatEngine } = await import("./use-chat-engine");
type HookReturn = ReturnType<typeof useChatEngine>;
type TransportFactory = import("../@types").ChatTransportFactory;

type Deferred = {
	promise: Promise<UIMessage[]>;
	resolve: (messages: UIMessage[]) => void;
	reject: (error: Error) => void;
};

function deferred(): Deferred {
	let resolve: (messages: UIMessage[]) => void = () => {};
	let reject: (error: Error) => void = () => {};
	const promise = new Promise<UIMessage[]>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

type FakeTransport = {
	keeps: boolean;
	restoreCalls: number;
	disposeCalls: number;
	built: number;
	answers: Deferred[];
	factory: TransportFactory;
};

function fakeTransport(keeps: boolean): FakeTransport {
	const fake: FakeTransport = {
		keeps,
		restoreCalls: 0,
		disposeCalls: 0,
		built: 0,
		answers: [],
		factory: (context) => {
			fake.built += 1;
			return {
				sendMessages: (request) => context.fallback.sendMessages(request),
				reconnectToStream: async () => null,
				keepsSession: () => fake.keeps,
				restore: () => {
					fake.restoreCalls += 1;
					const answer = deferred();
					fake.answers.push(answer);
					return answer.promise;
				},
				dispose: () => {
					fake.disposeCalls += 1;
				},
			};
		},
	};
	return fake;
}

function Harness({
	resultRef,
	transport,
	initialMessages,
}: {
	resultRef: { current: HookReturn | null };
	transport: TransportFactory;
	tick: number;
	initialMessages?: UIMessage[];
}) {
	resultRef.current = useChatEngine({
		api: "/api/waniwani",
		transport,
		skipRemoteConfig: true,
		initialMessages,
	});
	return null;
}

let root: Root;
let container: HTMLElement;
let hookRef: { current: HookReturn | null };
let tick = 0;
let mounted = false;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	hookRef = { current: null };
	tick = 0;
	mounted = false;
});

afterEach(() => {
	if (mounted) {
		act(() => {
			root.unmount();
		});
	}
	container.remove();
});

async function flushAsync() {
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
}

/** Renders the harness again, the way the embed re-renders when its remote config answers. */
async function render(fake: FakeTransport, initialMessages?: UIMessage[]) {
	tick += 1;
	mounted = true;
	act(() => {
		root.render(
			createElement(Harness, {
				resultRef: hookRef,
				transport: fake.factory,
				tick,
				initialMessages,
			}),
		);
	});
	await flushAsync();
}

function engine(): HookReturn {
	if (!hookRef.current) {
		throw new Error("engine not mounted");
	}
	return hookRef.current;
}

async function answer(
	fake: FakeTransport,
	index: number,
	messages: UIMessage[],
) {
	const pending = fake.answers[index];
	if (!pending) {
		throw new Error(`restore #${index} was never asked`);
	}
	await act(async () => {
		pending.resolve(messages);
		await pending.promise;
	});
	await flushAsync();
}

function texts(messages: UIMessage[]): string[] {
	return messages.map((m) =>
		m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""),
	);
}

const SAVED = [
	textMessage("saved_1", "user", "my old question"),
	textMessage("saved_2", "assistant", "my old answer"),
];

describe("useChatEngine – restore when the remote config answers after mount", () => {
	test("no restore while the transport keeps no session", async () => {
		const fake = fakeTransport(false);
		await render(fake);
		await render(fake);

		expect(fake.restoreCalls).toBe(0);
		expect(engine().messages).toEqual([]);
		expect(engine().keepsSession).toBe(false);
	});

	test("the saved conversation appears once the transport starts keeping a session", async () => {
		const fake = fakeTransport(false);
		await render(fake);

		fake.keeps = true;
		await render(fake);
		expect(fake.restoreCalls).toBe(1);
		await answer(fake, 0, SAVED);

		expect(texts(engine().messages)).toEqual([
			"my old question",
			"my old answer",
		]);
		expect(engine().keepsSession).toBe(true);
	});

	test("restore runs once across many later renders", async () => {
		const fake = fakeTransport(false);
		await render(fake);
		fake.keeps = true;
		await render(fake);
		await render(fake);
		await render(fake);
		await answer(fake, 0, []);
		await render(fake);
		await render(fake);

		expect(fake.restoreCalls).toBe(1);
		expect(engine().messages).toEqual([]);
	});

	test("an empty restore leaves the chat empty", async () => {
		const fake = fakeTransport(false);
		await render(fake);
		fake.keeps = true;
		await render(fake);
		await answer(fake, 0, []);

		expect(engine().messages).toEqual([]);
		expect(engine().hasMessages).toBe(false);
	});

	test("a failed restore leaves the chat empty and usable", async () => {
		const fake = fakeTransport(false);
		await render(fake);
		fake.keeps = true;
		await render(fake);
		const pending = fake.answers[0];
		if (!pending) {
			throw new Error("restore never asked");
		}
		await act(async () => {
			pending.reject(new Error("runtime down"));
			await pending.promise.catch(() => {});
		});
		await flushAsync();

		expect(engine().messages).toEqual([]);
		act(() => {
			engine().handleSubmit({ text: "still here", files: [] });
		});
		await flushAsync();
		expect(texts(engine().messages)).toEqual(["still here"]);
	});

	test("a visitor who sent before the config arrived never gets the old conversation mixed in", async () => {
		const fake = fakeTransport(false);
		await render(fake);
		act(() => {
			engine().handleSubmit({ text: "fresh question", files: [] });
		});
		await flushAsync();
		expect(texts(engine().messages)).toEqual(["fresh question"]);

		fake.keeps = true;
		await render(fake);
		for (let i = 0; i < fake.answers.length; i++) {
			await answer(fake, i, SAVED);
		}

		expect(fake.restoreCalls).toBe(0);
		expect(texts(engine().messages)).toEqual(["fresh question"]);
	});

	test("a message sent while restore is in flight is never overwritten by the restored ones", async () => {
		const fake = fakeTransport(false);
		await render(fake);
		fake.keeps = true;
		await render(fake);
		expect(fake.restoreCalls).toBe(1);

		act(() => {
			engine().handleSubmit({ text: "typed during restore", files: [] });
		});
		await flushAsync();
		await answer(fake, 0, SAVED);

		expect(texts(engine().messages)).toEqual(["typed during restore"]);
	});

	test("the session dropping and coming back with the chat still empty restores at most once", async () => {
		const fake = fakeTransport(false);
		await render(fake);
		fake.keeps = true;
		await render(fake);
		fake.keeps = false;
		await render(fake);
		fake.keeps = true;
		await render(fake);

		expect(fake.restoreCalls).toBe(1);
	});

	test("the returned keepsSession follows the transport across renders", async () => {
		const fake = fakeTransport(false);
		await render(fake);
		expect(engine().keepsSession).toBe(false);

		fake.keeps = true;
		await render(fake);
		expect(engine().keepsSession).toBe(true);

		fake.keeps = false;
		await render(fake);
		expect(engine().keepsSession).toBe(false);
	});
});

describe("useChatEngine – a transport that keeps a session from the start", () => {
	test("restores once on mount and shows the saved conversation", async () => {
		const fake = fakeTransport(true);
		await render(fake);
		expect(fake.restoreCalls).toBe(1);
		expect(engine().keepsSession).toBe(true);

		await answer(fake, 0, SAVED);
		await render(fake);

		expect(fake.restoreCalls).toBe(1);
		expect(texts(engine().messages)).toEqual([
			"my old question",
			"my old answer",
		]);
	});

	test("a message sent while the mount restore is in flight survives it", async () => {
		const fake = fakeTransport(true);
		await render(fake);

		act(() => {
			engine().handleSubmit({ text: "impatient", files: [] });
		});
		await flushAsync();
		await answer(fake, 0, SAVED);

		expect(texts(engine().messages)).toEqual(["impatient"]);
	});

	test("initial messages are not replaced by a restored conversation", async () => {
		const fake = fakeTransport(true);
		const initial = [textMessage("init_1", "assistant", "welcome")];
		await render(fake, initial);
		for (let i = 0; i < fake.answers.length; i++) {
			await answer(fake, i, SAVED);
		}

		expect(texts(engine().messages)).toEqual(["welcome"]);
	});
});

describe("useChatEngine – transport disposal", () => {
	test("unmount disposes the transport exactly once", async () => {
		const fake = fakeTransport(true);
		await render(fake);
		await answer(fake, 0, []);
		expect(fake.disposeCalls).toBe(0);

		act(() => {
			root.unmount();
		});
		mounted = false;

		expect(fake.disposeCalls).toBe(1);
	});

	test("keepsSession turning true and back does not dispose; unmount disposes once", async () => {
		const fake = fakeTransport(false);
		await render(fake);
		fake.keeps = true;
		await render(fake);
		await answer(fake, 0, SAVED);
		fake.keeps = false;
		await render(fake);
		expect(fake.disposeCalls).toBe(0);

		act(() => {
			root.unmount();
		});
		mounted = false;

		expect(fake.disposeCalls).toBe(1);
	});
});
