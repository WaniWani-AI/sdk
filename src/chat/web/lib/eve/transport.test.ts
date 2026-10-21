import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { Window } from "happy-dom";
import type { AttachedDocument } from "../../../../documents/types";
import type { ChatTransportContext } from "../../@types";

type RecordedSend = {
	sessionId: string;
	message: string;
	headers: Record<string, string>;
};

type FakeStoreInit = {
	host: string;
	initialSession: { sessionId: string };
};

const runtime: {
	blockedHosts: Set<string>;
	stores: FakeEveAgentStore[];
	sends: RecordedSend[];
} = {
	blockedHosts: new Set(),
	stores: [],
	sends: [],
};

class FakeEveAgentStore {
	readonly host: string;
	readonly sessionId: string;
	resets = 0;
	snapshot: { error: Error | undefined; events: unknown[] } = {
		error: undefined,
		events: [],
	};

	constructor(init: FakeStoreInit) {
		this.host = init.host;
		this.sessionId = init.initialSession.sessionId;
		runtime.stores.push(this);
	}

	setCallbacks(): void {}

	resume(): Promise<void> {
		if (runtime.blockedHosts.has(this.host)) {
			this.snapshot = {
				...this.snapshot,
				error: new TypeError("Failed to fetch"),
			};
		}
		return Promise.resolve();
	}

	send(input: {
		message: string;
		headers?: Record<string, string>;
	}): Promise<void> {
		runtime.sends.push({
			sessionId: this.sessionId,
			message: input.message,
			headers: input.headers ?? {},
		});
		return Promise.resolve();
	}

	cancel(): Promise<{ status: string }> {
		return Promise.resolve({ status: "no_active_turn" });
	}

	reset(): void {
		this.resets += 1;
	}
}

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("eve/client", () => ({ EveAgentStore: FakeEveAgentStore }));

const { EveTransport, eveTransport } = await import("./transport");
type SessionRequest = import("./session").SessionRequest;
type OpenSession = import("./session").OpenSession;

const CHANNEL = "chan_1";
const RUNTIME_HOST = "https://runtime.eve.test";
const BLOCKED_HOST = "https://blocked.eve.test";

let win: Window;

beforeEach(() => {
	win = new Window({ url: "https://shop.test/pricing" });
	Object.defineProperty(globalThis, "localStorage", {
		value: win.localStorage,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, "location", {
		value: new URL("https://shop.test/pricing"),
		configurable: true,
		writable: true,
	});
	runtime.blockedHosts.clear();
	runtime.stores = [];
	runtime.sends = [];
});

function storedAt(key: string): unknown {
	const raw = win.localStorage.getItem(key);
	return raw === null ? null : JSON.parse(raw);
}

function keyFor(threadId?: string): string {
	return threadId === undefined
		? `waniwani:eve-conversation:${CHANNEL}`
		: `waniwani:eve-conversation:${CHANNEL}:${threadId}`;
}

type Deferred = { resolve: () => void; promise: Promise<void> };

function deferred(): Deferred {
	let resolve = () => {};
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { resolve, promise };
}

type Route = {
	open: OpenSession;
	requests: SessionRequest[];
	host: string;
	hold: Deferred | undefined;
	decline: boolean;
};

function sessionRouteStub(): Route {
	let created = 0;
	const route: Route = {
		requests: [],
		host: RUNTIME_HOST,
		hold: undefined,
		decline: false,
		open: async (request) => {
			route.requests.push(request);
			if (route.hold) {
				await route.hold.promise;
			}
			if (route.decline) {
				return null;
			}
			const conversationId =
				request.operation === "create"
					? `conv_${++created}`
					: request.conversationId;
			return {
				conversationId,
				eveHost: route.host,
				sessionId: `sess_${conversationId}_${route.requests.length}`,
				accessToken: "runtime-token",
				expiresAt: Date.now() + 3_600_000,
				followups: false,
			};
		},
	};
	return route;
}

type Chat = {
	threadHistory: boolean;
	threadId: string | undefined;
	hasMessages: boolean;
	documents: AttachedDocument[] | undefined;
	extra: Record<string, unknown> | undefined;
	fallbackCalls: UIMessage[][];
	sessions: string[];
};

function chatStub(overrides?: Partial<Chat>): {
	chat: Chat;
	context: ChatTransportContext;
} {
	const chat: Chat = {
		threadHistory: false,
		threadId: undefined,
		hasMessages: false,
		documents: undefined,
		extra: undefined,
		fallbackCalls: [],
		sessions: [],
		...overrides,
	};
	const fallback: ChatTransport<UIMessage> = {
		sendMessages: async (options) => {
			chat.fallbackCalls.push(options.messages);
			return new ReadableStream<UIMessageChunk>({
				start(controller) {
					controller.close();
				},
			});
		},
		reconnectToStream: async () => null,
	};
	const context: ChatTransportContext = {
		fallback,
		headers: () => ({ Authorization: "Bearer wwp_test" }),
		body: () => ({
			channelId: CHANNEL,
			visitor: { id: "visitor_1" },
			...(chat.extra ? { extra: chat.extra } : {}),
		}),
		threadHistory: () => chat.threadHistory,
		threadId: () => (chat.threadHistory ? chat.threadId : undefined),
		hasMessages: () => chat.hasMessages,
		takeTurnInput: () => {
			const documents = chat.documents;
			chat.documents = undefined;
			return documents ? { documents } : {};
		},
		onSession: (sessionId) => {
			chat.sessions.push(sessionId);
		},
	};
	return { chat, context };
}

function userMessage(text: string, id = crypto.randomUUID()): UIMessage {
	return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantMessage(text: string): UIMessage {
	return {
		id: crypto.randomUUID(),
		role: "assistant",
		parts: [{ type: "text", text }],
	};
}

function conversationOf(count: number, last = `message ${count}`): UIMessage[] {
	const messages: UIMessage[] = [];
	for (let turn = 1; turn < count; turn += 1) {
		messages.push(userMessage(`message ${turn}`));
		messages.push(assistantMessage(`answer ${turn}`));
	}
	messages.push(userMessage(last));
	return messages;
}

async function drain(stream: ReadableStream<UIMessageChunk>): Promise<void> {
	const reader = stream.getReader();
	while (!(await reader.read()).done) {}
}

async function send(
	transport: { sendMessages: ChatTransport<UIMessage>["sendMessages"] },
	messages: UIMessage[],
): Promise<void> {
	await drain(
		await transport.sendMessages({
			trigger: "submit-message",
			chatId: "chat_1",
			messageId: undefined,
			messages,
			abortSignal: undefined,
		}),
	);
}

async function settle(): Promise<void> {
	for (let tick = 0; tick < 10; tick += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

function build(route: Route, context: ChatTransportContext) {
	return new EveTransport({ ...context, open: route.open, suggest: undefined });
}

function operations(route: Route): string[] {
	return route.requests.map((request) => request.operation);
}

function lastSend(): RecordedSend {
	const recorded = runtime.sends.at(-1);
	if (!recorded) {
		throw new Error("no turn reached the runtime");
	}
	return recorded;
}

describe("EveTransport – one direct conversation per saved thread", () => {
	test("a new saved thread's first message goes direct and is saved under the thread's key", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({
			threadHistory: true,
			threadId: "t1",
		});
		const transport = build(route, context);

		await send(transport, conversationOf(1, "hello"));

		expect(chat.fallbackCalls).toHaveLength(0);
		expect(operations(route)).toEqual(["create"]);
		expect(lastSend().message).toBe("hello");
		const create = route.requests[0];
		expect(storedAt(keyFor("t1"))).toEqual({
			conversationId: "conv_1",
			ownerSecret: create?.ownerSecret,
		});
		expect(storedAt(keyFor())).toBeNull();
	});

	test("without saved threads the conversation stays under the per-channel key", async () => {
		const route = sessionRouteStub();
		const { context } = chatStub();
		const transport = build(route, context);

		await send(transport, conversationOf(1, "hello"));

		expect(storedAt(keyFor())).toEqual({
			conversationId: "conv_1",
			ownerSecret: route.requests[0]?.ownerSecret,
		});
		const keys: string[] = [];
		for (let index = 0; index < win.localStorage.length; index += 1) {
			keys.push(win.localStorage.key(index) ?? "");
		}
		expect(keys).toEqual([keyFor()]);
	});

	test("starting a new thread closes the runtime session but keeps the outgoing thread's conversation", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({
			threadHistory: true,
			threadId: "t1",
		});
		const transport = build(route, context);
		await send(transport, conversationOf(1));
		const saved = storedAt(keyFor("t1"));
		const firstStore = runtime.stores[0];

		transport.dispose();
		chat.threadId = "t2";
		await settle();

		expect(firstStore?.resets).toBeGreaterThan(0);
		expect(storedAt(keyFor("t1"))).toEqual(saved);

		await send(transport, conversationOf(1, "fresh thread"));

		expect(operations(route)).toEqual(["create", "create"]);
		expect(storedAt(keyFor("t2"))).toEqual({
			conversationId: "conv_2",
			ownerSecret: route.requests[1]?.ownerSecret,
		});
		expect(storedAt(keyFor("t1"))).toEqual(saved);
		expect(chat.fallbackCalls).toHaveLength(0);
	});

	test("switching back to a thread resumes its conversation on the next keystroke", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({
			threadHistory: true,
			threadId: "t1",
		});
		const transport = build(route, context);
		await send(transport, conversationOf(1));
		const t1Secret = route.requests[0]?.ownerSecret;
		transport.dispose();
		chat.threadId = "t2";
		await send(transport, conversationOf(1));
		transport.dispose();

		chat.threadId = "t1";
		chat.hasMessages = true;
		transport.prepare();
		await settle();

		expect(route.requests.at(-1)).toEqual({
			operation: "resume",
			conversationId: "conv_1",
			ownerSecret: t1Secret,
		});
	});

	test("switching back to a thread resumes its conversation on the next send, and the turn goes there", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({
			threadHistory: true,
			threadId: "t1",
		});
		const transport = build(route, context);
		await send(transport, conversationOf(1));
		transport.dispose();
		chat.threadId = "t2";
		await send(transport, conversationOf(1));
		transport.dispose();

		chat.threadId = "t1";
		chat.hasMessages = true;
		await send(transport, conversationOf(2, "back on t1"));

		expect(operations(route)).toEqual(["create", "create", "resume"]);
		const resumed = runtime.stores.at(-1);
		expect(lastSend()).toMatchObject({
			message: "back on t1",
			sessionId: resumed?.sessionId,
		});
		expect(chat.fallbackCalls).toHaveLength(0);
	});

	test("deleting a thread removes only that thread's saved conversation", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({
			threadHistory: true,
			threadId: "t1",
		});
		const transport = build(route, context);
		await send(transport, conversationOf(1));
		transport.dispose();
		chat.threadId = "t2";
		await send(transport, conversationOf(1));
		const t2 = storedAt(keyFor("t2"));

		transport.forget("t1");

		expect(storedAt(keyFor("t1"))).toBeNull();
		expect(storedAt(keyFor("t2"))).toEqual(t2);
	});

	test("deleting the active thread while its conversation is still being created leaves nothing saved", async () => {
		const route = sessionRouteStub();
		const { context } = chatStub({ threadHistory: true, threadId: "t1" });
		const transport = build(route, context);
		route.hold = deferred();
		transport.prepare();

		transport.forget("t1");
		transport.dispose();
		route.hold.resolve();
		await settle();

		expect(storedAt(keyFor("t1"))).toBeNull();
	});

	test("a thread that began on the fallback stays there and never opens a runtime session", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({
			threadHistory: true,
			threadId: "t_old",
			hasMessages: true,
		});
		const transport = build(route, context);

		transport.prepare();
		await settle();
		await send(transport, conversationOf(2));
		await send(transport, conversationOf(3));

		expect(route.requests).toHaveLength(0);
		expect(runtime.stores).toHaveLength(0);
		expect(chat.fallbackCalls).toHaveLength(2);
		expect(storedAt(keyFor("t_old"))).toBeNull();
	});

	test("with saved threads on, restore() shows no messages even when the thread has a saved conversation", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({
			threadHistory: true,
			threadId: "t1",
		});
		await send(build(route, context), conversationOf(1));
		chat.hasMessages = true;

		const restored = await build(route, context).restore();

		expect(restored).toEqual([]);
	});

	test("New chat without saved threads forgets the per-channel conversation and closes its session", async () => {
		const route = sessionRouteStub();
		const { context } = chatStub();
		const transport = build(route, context);
		await send(transport, conversationOf(1));
		expect(storedAt(keyFor())).not.toBeNull();

		transport.reset();
		await settle();

		expect(storedAt(keyFor())).toBeNull();
		expect(runtime.stores[0]?.resets).toBeGreaterThan(0);
	});

	test("New chat pressed while the conversation is still being created leaves nothing saved", async () => {
		const route = sessionRouteStub();
		const { context } = chatStub();
		const transport = build(route, context);
		route.hold = deferred();
		transport.prepare();

		transport.reset();
		route.hold.resolve();
		await settle();

		expect(storedAt(keyFor())).toBeNull();
	});

	test("switching threads while the outgoing thread is still resuming still closes its session", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({
			threadHistory: true,
			threadId: "t1",
		});
		const transport = build(route, context);
		await send(transport, conversationOf(1));
		transport.dispose();
		chat.threadId = "t2";
		await send(transport, conversationOf(1));
		transport.dispose();
		await settle();
		const before = runtime.stores.length;

		chat.threadId = "t1";
		chat.hasMessages = true;
		route.hold = deferred();
		transport.prepare();
		transport.dispose();
		chat.threadId = "t3";
		chat.hasMessages = false;
		transport.prepare();
		route.hold.resolve();
		await settle();

		const resumedT1 = runtime.stores
			.slice(before)
			.find((store) => store.sessionId.startsWith("sess_conv_1_"));
		expect(resumedT1).toBeDefined();
		expect(resumedT1?.resets).toBeGreaterThan(0);
	});
});

describe("EveTransport – documents attached to a direct turn", () => {
	const POLICY: AttachedDocument = {
		documentId: "doc_1",
		filename: "policy.pdf",
		mediaType: "application/pdf",
	};
	const PHOTO: AttachedDocument = {
		documentId: "doc_2",
		filename: "photo.png",
		mediaType: "image/png",
	};

	test("the documents ride that turn as x-waniwani-documents", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({ documents: [POLICY] });
		const transport = build(route, context);

		await send(transport, conversationOf(1, "read this"));

		expect(chat.fallbackCalls).toHaveLength(0);
		const turn = lastSend();
		expect(turn.message).toBe("read this");
		expect(JSON.parse(turn.headers["x-waniwani-documents"] ?? "null")).toEqual([
			POLICY,
		]);
	});

	test("the next turn carries no documents header", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({ documents: [POLICY] });
		const transport = build(route, context);
		await send(transport, conversationOf(1, "read this"));

		chat.hasMessages = true;
		await send(transport, conversationOf(2, "and now?"));

		expect(runtime.sends).toHaveLength(2);
		expect(lastSend().headers).not.toHaveProperty("x-waniwani-documents");
	});

	test("an attachment-only message sends the file names, comma separated, as its text", async () => {
		const route = sessionRouteStub();
		const { context } = chatStub({ documents: [POLICY, PHOTO] });
		const transport = build(route, context);

		await send(transport, conversationOf(1, ""));

		expect(lastSend().message).toBe("policy.pdf, photo.png");
	});

	test("non-ASCII filenames and extra travel as pure ASCII and parse back exactly", async () => {
		const unicode: AttachedDocument = {
			documentId: "doc_3",
			filename: "Résumé 履歴書 📄 naïve\u007f.pdf",
			mediaType: "application/pdf",
		};
		const extra = {
			locale: "fr-FR",
			note: "Zoë – 東京 🚗",
			nested: { ü: "ß" },
		};
		const route = sessionRouteStub();
		const { context } = chatStub({ documents: [unicode], extra });
		const transport = build(route, context);

		await send(transport, conversationOf(1, "voilà"));

		const headers = lastSend().headers;
		const documents = headers["x-waniwani-documents"] ?? "";
		const extraHeader = headers["x-waniwani-extra"] ?? "";
		for (const value of [documents, extraHeader]) {
			expect(value.length).toBeGreaterThan(0);
			expect([...value].every((char) => char.charCodeAt(0) < 0x80)).toBe(true);
			expect(() => new Headers({ probe: value })).not.toThrow();
		}
		expect(JSON.parse(documents)).toEqual([unicode]);
		expect(JSON.parse(extraHeader)).toEqual(extra);
	});

	test("a message with an inline file part goes through the fallback", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub();
		const transport = build(route, context);
		const withFile: UIMessage = {
			id: "m1",
			role: "user",
			parts: [
				{ type: "text", text: "look" },
				{
					type: "file",
					mediaType: "image/png",
					url: "data:image/png;base64,AAAA",
				},
			],
		};

		await send(transport, [withFile]);

		expect(chat.fallbackCalls).toHaveLength(1);
		expect(runtime.sends).toHaveLength(0);
	});
});

describe("EveTransport – MCP extra on a direct turn", () => {
	test("the chat's extra rides every direct turn as x-waniwani-extra", async () => {
		const extra = { memoryUserId: "mem_1", locale: "en-US", plan: "gold" };
		const route = sessionRouteStub();
		const { chat, context } = chatStub({ extra });
		const transport = build(route, context);

		await send(transport, conversationOf(1));
		chat.hasMessages = true;
		await send(transport, conversationOf(2));

		expect(runtime.sends).toHaveLength(2);
		for (const turn of runtime.sends) {
			expect(JSON.parse(turn.headers["x-waniwani-extra"] ?? "null")).toEqual(
				extra,
			);
		}
	});

	test("no extra means no extra header", async () => {
		const route = sessionRouteStub();
		const { context } = chatStub();
		await send(build(route, context), conversationOf(1));

		expect(lastSend().headers).not.toHaveProperty("x-waniwani-extra");
	});

	test("an empty extra means no extra header", async () => {
		const route = sessionRouteStub();
		const { context } = chatStub({ extra: {} });
		await send(build(route, context), conversationOf(1));

		expect(lastSend().headers).not.toHaveProperty("x-waniwani-extra");
	});
});

describe("EveTransport – a runtime the page cannot reach", () => {
	test("a created session whose stream cannot open counts as declined and the message goes through the fallback", async () => {
		runtime.blockedHosts.add(BLOCKED_HOST);
		const route = sessionRouteStub();
		route.host = BLOCKED_HOST;
		const { chat, context } = chatStub();
		const transport = build(route, context);

		await send(transport, conversationOf(1, "hello"));

		expect(operations(route)).toEqual(["create"]);
		expect(chat.fallbackCalls).toHaveLength(1);
		expect(runtime.sends).toHaveLength(0);
		expect(storedAt(keyFor())).toBeNull();
	});

	test("a resumed session whose stream cannot open sends the message through the fallback", async () => {
		const route = sessionRouteStub();
		const { chat, context } = chatStub({
			threadHistory: true,
			threadId: "t1",
		});
		const transport = build(route, context);
		await send(transport, conversationOf(1));
		transport.dispose();
		runtime.blockedHosts.add(BLOCKED_HOST);
		route.host = BLOCKED_HOST;
		const sentBefore = runtime.sends.length;

		chat.hasMessages = true;
		await send(transport, conversationOf(2, "still there?"));

		expect(operations(route)).toEqual(["create", "resume"]);
		expect(chat.fallbackCalls).toHaveLength(1);
		expect(runtime.sends).toHaveLength(sentBefore);
	});

	test("restoring a saved conversation whose stream cannot open shows nothing and does not throw", async () => {
		const route = sessionRouteStub();
		const { context } = chatStub();
		await send(build(route, context), conversationOf(1));
		runtime.blockedHosts.add(BLOCKED_HOST);
		route.host = BLOCKED_HOST;

		expect(await build(route, context).restore()).toEqual([]);
	});
});

describe("eveTransport – a sessionApi resolved after mount", () => {
	type FetchCall = { url: string; body: unknown };
	let fetchCalls: FetchCall[];
	const realFetch = globalThis.fetch;

	beforeEach(() => {
		fetchCalls = [];
		globalThis.fetch = Object.assign(
			async (input: string | URL | Request, init?: RequestInit) => {
				const url =
					input instanceof Request ? input.url : new URL(input).toString();
				const body: unknown = JSON.parse(String(init?.body ?? "null"));
				fetchCalls.push({ url, body });
				const request =
					typeof body === "object" && body !== null ? body : undefined;
				const conversationId =
					request && "conversationId" in request
						? String(request.conversationId)
						: `conv_${fetchCalls.length}`;
				return Response.json({
					success: true,
					data: {
						transport: "eve-native",
						conversationId,
						eveHost: RUNTIME_HOST,
						session: { sessionId: `sess_${fetchCalls.length}` },
						accessToken: "runtime-token",
						expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
						followups: false,
					},
				});
			},
			{ preconnect: realFetch.preconnect },
		);
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	test("while the resolver answers undefined, turns go through the fallback and the session route is never called", async () => {
		const { chat, context } = chatStub();
		const transport = eveTransport(() => undefined)(context);

		transport.prepare?.();
		await send(transport, conversationOf(1));
		await send(transport, conversationOf(2));

		expect(chat.fallbackCalls).toHaveLength(2);
		expect(fetchCalls).toHaveLength(0);
		expect(runtime.sends).toHaveLength(0);
	});

	test("while the resolver answers undefined, restore() shows nothing and keepsSession() is false", async () => {
		win.localStorage.setItem(
			keyFor(),
			JSON.stringify({ conversationId: "conv_old", ownerSecret: "secret" }),
		);
		const { context } = chatStub();
		const transport = eveTransport(() => undefined)(context);

		expect(await transport.restore?.()).toEqual([]);
		expect(transport.keepsSession?.()).toBe(false);
		expect(fetchCalls).toHaveLength(0);
	});

	test("once the resolver answers, a new conversation goes direct through that session route", async () => {
		let sessionApi: string | undefined;
		const { chat, context } = chatStub();
		const transport = eveTransport(() => sessionApi)(context);
		expect(transport.keepsSession?.()).toBe(false);

		sessionApi = "https://app.test/api/mcp/agent/session";
		expect(transport.keepsSession?.()).toBe(true);
		await send(transport, conversationOf(1, "hi"));

		expect(fetchCalls[0]?.url).toBe(sessionApi);
		expect(chat.fallbackCalls).toHaveLength(0);
		expect(lastSend().message).toBe("hi");
	});

	test("a plain string sessionApi keeps the conversation", () => {
		const { context } = chatStub();
		const transport = eveTransport("https://app.test/api/session")(context);

		expect(transport.keepsSession?.()).toBe(true);
	});
});
