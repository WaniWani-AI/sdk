/**
 * `EveSession` with the real eve client, against a fake agent runtime that
 * speaks the wire format the deployed runtime serves. `transport.test.ts`
 * replaces the client with a stub, so only this file notices when the client
 * the chat bundles and the runtime stop understanding each other.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UIMessageChunk } from "ai";
import type { MessageStreamEvent } from "eve/client";
import { historyMessages } from "./history";
import { EveSession, type OpenSession } from "./session";

const RUNTIME_HOST = "https://runtime.eve.test";
const SESSION_ID = "sess_1";
/** The message stream version the deployed agent runtime (eve 0.83.3) serves. */
const DEPLOYED_STREAM_VERSION = "26";

type WireEvent = { type: string; data: object; meta: object };

function wire(
	deliveryId: string,
	entries: [type: string, data: object][],
	offset: number,
): WireEvent[] {
	return entries.map(([type, data], index) => ({
		type,
		data,
		meta: {
			at: new Date(1_800_000_000_000 + offset + index).toISOString(),
			id: `evt_${offset + index}`,
			deliveryIds: [deliveryId],
		},
	}));
}

/** One turn as the runtime streams it: a tool call, then a streamed answer. */
function turnEvents(input: {
	deliveryId: string;
	sequence: number;
	message: string;
	offset: number;
}): WireEvent[] {
	const turn = { sequence: input.sequence, turnId: `turn_${input.sequence}` };
	const callId = `call_${input.sequence}`;
	const opening: [string, object][] =
		input.sequence === 0
			? [
					[
						"session.started",
						{
							runtime: {
								agentId: "agent",
								agentName: "agent",
								eveVersion: "0.83.3",
							},
						},
					],
				]
			: [];
	return wire(
		input.deliveryId,
		[
			...opening,
			["turn.started", turn],
			[
				"message.received",
				{
					...turn,
					message: input.message,
					parts: [{ type: "text", text: input.message }],
				},
			],
			["step.started", { ...turn, stepIndex: 0, modelId: "gateway/model" }],
			[
				"action.input.appended",
				{
					...turn,
					stepIndex: 0,
					callId,
					toolName: "search_docs",
					inputTextDelta: '{"query": "opening hours"}',
				},
			],
			[
				"actions.requested",
				{
					...turn,
					stepIndex: 0,
					actions: [
						{
							callId,
							kind: "tool-call",
							toolName: "search_docs",
							input: { query: "opening hours" },
						},
					],
				},
			],
			[
				"action.result",
				{
					...turn,
					stepIndex: 0,
					status: "completed",
					result: {
						callId,
						kind: "tool-result",
						toolName: "search_docs",
						output: { content: [{ type: "text", text: "9 to 5" }] },
					},
				},
			],
			[
				"step.completed",
				{
					...turn,
					stepIndex: 0,
					finishReason: "tool-calls",
					usage: { inputTokens: 10, outputTokens: 2 },
				},
			],
			["step.started", { ...turn, stepIndex: 1, modelId: "gateway/model" }],
			["message.appended", { ...turn, stepIndex: 1, messageDelta: "We open " }],
			["message.appended", { ...turn, stepIndex: 1, messageDelta: "9 to 5." }],
			[
				"message.completed",
				{
					...turn,
					stepIndex: 1,
					finishReason: "stop",
					message: "We open 9 to 5.",
				},
			],
			[
				"step.completed",
				{
					...turn,
					stepIndex: 1,
					finishReason: "stop",
					usage: { inputTokens: 12, outputTokens: 6 },
				},
			],
			["turn.completed", turn],
			[
				"session.waiting",
				{ continuationToken: "eve:op:1", wait: "next-user-message" },
			],
		],
		input.offset,
	);
}

type FakeRuntime = {
	log: WireEvent[];
	posts: { message: string; headers: Record<string, string> }[];
	streamQueries: URLSearchParams[];
};

const realFetch = globalThis.fetch;
let opened: EveSession[] = [];

/** Serves one session's stream and turn routes the way the runtime does. */
function runtimeServing(
	streamVersion: string,
	recorded: WireEvent[] = [],
): FakeRuntime {
	const runtime: FakeRuntime = {
		log: [...recorded],
		posts: [],
		streamQueries: [],
	};
	const listeners = new Set<() => void>();
	const encoder = new TextEncoder();

	const stream = (url: URL, signal: AbortSignal | undefined): Response => {
		runtime.streamQueries.push(url.searchParams);
		let sent = Number(url.searchParams.get("startIndex") ?? "0");
		const tailIndex = runtime.log.length - 1;
		let flush = () => {};
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode("\n"));
				flush = () => {
					while (sent < runtime.log.length) {
						controller.enqueue(
							encoder.encode(`${JSON.stringify(runtime.log[sent])}\n`),
						);
						sent += 1;
					}
				};
				flush();
				listeners.add(flush);
				signal?.addEventListener(
					"abort",
					() => {
						listeners.delete(flush);
						try {
							controller.close();
						} catch {
							// already closed by a cancelled reader
						}
					},
					{ once: true },
				);
			},
			cancel() {
				listeners.delete(flush);
			},
		});
		return new Response(body, {
			headers: {
				"content-type": "application/x-ndjson; charset=utf-8",
				"x-eve-session-id": SESSION_ID,
				"x-eve-stream-format": "ndjson",
				"x-eve-stream-tail-index": String(tailIndex),
				"x-eve-stream-version": streamVersion,
			},
		});
	};

	const accept = async (init: RequestInit | undefined): Promise<Response> => {
		const body: unknown = JSON.parse(String(init?.body ?? "{}"));
		const message =
			typeof body === "object" &&
			body !== null &&
			"message" in body &&
			typeof body.message === "string"
				? body.message
				: "";
		runtime.posts.push({
			message,
			headers: Object.fromEntries(new Headers(init?.headers).entries()),
		});
		const deliveryId = `del_${runtime.posts.length}`;
		setTimeout(() => {
			runtime.log.push(
				...turnEvents({
					deliveryId,
					sequence: runtime.posts.length - 1,
					message,
					offset: runtime.log.length,
				}),
			);
			for (const listener of listeners) {
				listener();
			}
		}, 0);
		return Response.json(
			{ ok: true, sessionId: SESSION_ID, status: "accepted", deliveryId },
			{ status: 202, headers: { "x-eve-session-id": SESSION_ID } },
		);
	};

	const answer = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const path = `/eve/v1/session/${SESSION_ID}`;
		if (url.origin === RUNTIME_HOST && url.pathname === `${path}/stream`) {
			return stream(url, init?.signal ?? undefined);
		}
		if (
			url.origin === RUNTIME_HOST &&
			url.pathname === path &&
			init?.method === "POST"
		) {
			return await accept(init);
		}
		return new Response("not found", { status: 404 });
	};
	globalThis.fetch = Object.assign(answer, { preconnect: () => {} });
	return runtime;
}

const open: OpenSession = async () => ({
	conversationId: "conv_1",
	eveHost: RUNTIME_HOST,
	sessionId: SESSION_ID,
	accessToken: "runtime-token",
	expiresAt: Date.now() + 3_600_000,
	followups: false,
});

function kept(session: EveSession | null): EveSession {
	if (!session) {
		throw new Error("the session was not reachable");
	}
	opened.push(session);
	return session;
}

async function create(): Promise<EveSession> {
	return kept(await EveSession.create({ open, channelId: "chan_1" }));
}

async function resume(): Promise<EveSession> {
	return kept(
		await EveSession.resume({
			open,
			saved: { conversationId: "conv_1", ownerSecret: "secret" },
		}),
	);
}

async function chunksOf(
	stream: ReadableStream<UIMessageChunk>,
): Promise<UIMessageChunk[]> {
	const chunks: UIMessageChunk[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			return chunks;
		}
		chunks.push(value);
	}
}

function textOf(chunks: UIMessageChunk[]): string {
	return chunks
		.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []))
		.join("");
}

beforeEach(() => {
	opened = [];
});

afterEach(() => {
	for (const session of opened) {
		session.close();
	}
	globalThis.fetch = realFetch;
});

describe("EveSession against the runtime's wire format", () => {
	test("a new session is reachable on the stream version the deployed runtime serves", async () => {
		runtimeServing(DEPLOYED_STREAM_VERSION);

		const session = await create();

		expect(session.sessionId).toBe(SESSION_ID);
	});

	test("a session is not reachable when the runtime serves a stream version the client does not know", async () => {
		runtimeServing("9999");

		expect(await EveSession.create({ open, channelId: "chan_1" })).toBeNull();
	});

	test("a turn reaches the runtime with the visitor's message, the session token and the turn's extra", async () => {
		const runtime = runtimeServing(DEPLOYED_STREAM_VERSION);
		const session = await create();

		await chunksOf(
			session.turn("When do you open?", { extra: { plan: "pro" } }),
		);

		expect(runtime.posts).toHaveLength(1);
		expect(runtime.posts[0]?.message).toBe("When do you open?");
		expect(runtime.posts[0]?.headers.authorization).toBe(
			"Bearer runtime-token",
		);
		expect(runtime.posts[0]?.headers["x-waniwani-extra"]).toBe(
			'{"plan":"pro"}',
		);
	});

	test("a turn's answer streams back as its text", async () => {
		runtimeServing(DEPLOYED_STREAM_VERSION);
		const session = await create();

		const chunks = await chunksOf(session.turn("When do you open?", {}));

		expect(textOf(chunks)).toBe("We open 9 to 5.");
		expect(chunks.at(-1)).toEqual({ type: "finish", finishReason: "stop" });
		expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
	});

	test("a turn's tool call streams back with its input and its output", async () => {
		runtimeServing(DEPLOYED_STREAM_VERSION);
		const session = await create();

		const chunks = await chunksOf(session.turn("When do you open?", {}));

		expect(chunks).toContainEqual({
			type: "tool-input-available",
			toolCallId: "call_0",
			toolName: "search_docs",
			input: { query: "opening hours" },
			dynamic: true,
		});
		expect(chunks).toContainEqual({
			type: "tool-output-available",
			toolCallId: "call_0",
			output: { content: [{ type: "text", text: "9 to 5" }] },
			dynamic: true,
		});
	});

	test("a second turn on the same session streams only its own answer", async () => {
		const runtime = runtimeServing(DEPLOYED_STREAM_VERSION);
		const session = await create();
		await chunksOf(session.turn("When do you open?", {}));

		const chunks = await chunksOf(session.turn("And on Sundays?", {}));

		expect(runtime.posts.map((post) => post.message)).toEqual([
			"When do you open?",
			"And on Sundays?",
		]);
		expect(textOf(chunks)).toBe("We open 9 to 5.");
		expect(
			chunks.filter((chunk) => chunk.type === "tool-input-available"),
		).toHaveLength(1);
	});

	test("a resumed session shows the conversation the runtime recorded", async () => {
		runtimeServing(
			DEPLOYED_STREAM_VERSION,
			turnEvents({
				deliveryId: "del_1",
				sequence: 0,
				message: "When do you open?",
				offset: 0,
			}),
		);
		const session = await resume();

		const messages = await historyMessages(await session.history());

		expect(messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(messages[0]?.parts).toEqual([
			{ type: "text", text: "When do you open?" },
		]);
		expect(
			messages[1]?.parts.flatMap((part) =>
				part.type === "text" ? [part.text] : [],
			),
		).toEqual(["We open 9 to 5."]);
		expect(session.used).toBe(true);
	});

	test("a turn sent after a resume reaches the runtime", async () => {
		const runtime = runtimeServing(
			DEPLOYED_STREAM_VERSION,
			turnEvents({
				deliveryId: "del_0",
				sequence: 0,
				message: "Hello",
				offset: 0,
			}),
		);
		const session = await resume();
		await session.history();

		const chunks = await chunksOf(session.turn("And on Sundays?", {}));

		expect(runtime.posts.map((post) => post.message)).toEqual([
			"And on Sundays?",
		]);
		expect(textOf(chunks)).toBe("We open 9 to 5.");
	});
});

describe("historyMessages", () => {
	test("a task message the runtime wrote itself before eve 0.83 is not shown as the visitor's", async () => {
		const legacy: unknown[] = [
			{
				type: "message.received",
				data: { message: "Hello", sequence: 0, turnId: "turn_0" },
			},
			{
				type: "message.received",
				data: {
					kind: "execution.background_task",
					message: "task finished",
					sequence: 0,
					turnId: "turn_0",
				},
			},
		];

		const messages = await historyMessages(legacy as MessageStreamEvent[]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.parts).toEqual([{ type: "text", text: "Hello" }]);
	});
});
