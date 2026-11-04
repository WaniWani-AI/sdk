import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type {
	ChatTransportContext,
	ChatTransportFactory,
	ChatTransportLifecycle,
} from "../../@types";
import { historyMessages } from "./history";
import {
	EveSession,
	type OpenSession,
	type SavedSession,
	type SessionRequest,
	savedSession,
	saveSession,
	sessionKey,
} from "./session";

type Resolve<T> = () => T;

function stringField(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" && value ? value : undefined;
}

function visitorIdOf(body: Record<string, unknown>): string | undefined {
	const visitor = body.visitor;
	return typeof visitor === "object" &&
		visitor !== null &&
		"id" in visitor &&
		typeof visitor.id === "string"
		? visitor.id
		: undefined;
}

function userTexts(messages: UIMessage[]): string[] {
	return messages
		.filter((message) => message.role === "user")
		.map((message) =>
			message.parts
				.flatMap((part) => (part.type === "text" ? [part.text] : []))
				.join("\n"),
		);
}

type SuggestFollowups = (
	input: SavedSession & {
		answerText: string;
		recentUserMessages: string[];
		toolNames: string[];
	},
) => Promise<string[]>;

function appRoute(input: {
	sessionApi: string;
	path: string;
	headers: Resolve<Record<string, string> | undefined>;
	body: unknown;
	signal?: AbortSignal;
}): Promise<Response> {
	return fetch(new URL(input.path, new URL(input.sessionApi, location.href)), {
		method: "POST",
		headers: { ...input.headers(), "content-type": "application/json" },
		body: JSON.stringify(input.body),
		cache: "no-store",
		signal: input.signal,
	});
}

/** The app's pills for a direct turn's answer. */
export function followupsRoute(input: {
	sessionApi: string;
	headers: Resolve<Record<string, string> | undefined>;
}): SuggestFollowups {
	return async (body) => {
		const response = await appRoute({
			...input,
			path: "followups",
			body,
			signal: AbortSignal.timeout(8_000),
		});
		const envelope: unknown = response.ok ? await response.json() : null;
		const data =
			typeof envelope === "object" && envelope !== null && "data" in envelope
				? envelope.data
				: null;
		const suggestions =
			typeof data === "object" && data !== null && "suggestions" in data
				? data.suggestions
				: null;
		return Array.isArray(suggestions)
			? suggestions.filter((item): item is string => typeof item === "string")
			: [];
	};
}

function withFollowups(input: {
	suggest: (answerText: string, toolNames: string[]) => Promise<string[]>;
	signal?: AbortSignal;
}): TransformStream<UIMessageChunk, UIMessageChunk> {
	let answerText = "";
	let failed = false;
	const toolNames = new Set<string>();
	return new TransformStream({
		async transform(chunk, controller) {
			if (chunk.type === "text-delta") {
				answerText += chunk.delta;
			}
			if (chunk.type === "tool-input-available") {
				toolNames.add(chunk.toolName);
			}
			if (chunk.type === "error") {
				failed = true;
			}
			if (
				chunk.type === "finish" &&
				!failed &&
				!input.signal?.aborted &&
				answerText.trim()
			) {
				const suggestions = await input
					.suggest(answerText, [...toolNames])
					.catch(() => []);
				if (suggestions.length > 0) {
					controller.enqueue({
						type: "data-suggestions",
						data: { suggestions },
					});
				}
			}
			controller.enqueue(chunk);
		},
	});
}

/** The app's session route, with the embed's own public key. */
export function sessionRoute(input: {
	sessionApi: string;
	headers: Resolve<Record<string, string> | undefined>;
}): OpenSession {
	return async (request: SessionRequest) => {
		const response = await appRoute({
			...input,
			path: input.sessionApi,
			body: request,
		});
		if (!response.ok) {
			throw new Error(`Opening the chat failed (${response.status})`);
		}
		const envelope: unknown = await response.json();
		const data =
			typeof envelope === "object" && envelope !== null && "data" in envelope
				? envelope.data
				: null;
		if (typeof data !== "object" || data === null || !("transport" in data)) {
			throw new Error("The session route answered no transport");
		}
		if (data.transport !== "eve-native") {
			return null;
		}
		const record: Record<string, unknown> = { ...data };
		const session = record.session;
		const sessionId =
			typeof session === "object" && session !== null && "sessionId" in session
				? session.sessionId
				: undefined;
		const conversationId = stringField(record, "conversationId");
		const eveHost = stringField(record, "eveHost");
		const accessToken = stringField(record, "accessToken");
		const expiresAt = Date.parse(stringField(record, "expiresAt") ?? "");
		if (
			!conversationId ||
			!eveHost ||
			!accessToken ||
			typeof sessionId !== "string" ||
			Number.isNaN(expiresAt)
		) {
			throw new Error("The session route answered an incomplete session");
		}
		return {
			conversationId,
			eveHost,
			sessionId,
			accessToken,
			expiresAt,
			followups: record.followups === true,
		};
	};
}

function extraOf(
	body: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const extra = body.extra;
	return typeof extra === "object" && extra !== null && !Array.isArray(extra)
		? Object.fromEntries(Object.entries(extra))
		: undefined;
}

/**
 * Sends turns straight to the agent runtime when the app's session route
 * admits the chat, and through `fallback` when it answers that the chat route
 * keeps serving it. The session is kept per channel, or per saved thread,
 * across page loads and resumed from the runtime. A thread whose history only
 * the browser holds, or whose message carries inline files, stays on
 * `fallback` for its whole length.
 */
export class EveTransport
	implements ChatTransport<UIMessage>, ChatTransportLifecycle
{
	private pending: Promise<EveSession | null> | undefined;
	private threadOnFallback = false;
	/** Bumped by `dispose`, so a session that opens afterwards is closed and never saved. */
	private generation = 0;

	constructor(
		private readonly options: ChatTransportContext & {
			open: OpenSession | undefined;
			suggest: SuggestFollowups | undefined;
		},
	) {}

	private get channelId(): string | undefined {
		return stringField(this.options.body(), "channelId");
	}

	private key(): string {
		return sessionKey({
			channelId: this.channelId,
			threadId: this.options.threadId(),
		});
	}

	keepsSession(): boolean {
		return this.options.open !== undefined;
	}

	/** Opens the runtime session ahead of the first message, so that message pays no bootstrap. */
	prepare(): void {
		this.open(this.options.hasMessages());
	}

	private open(continuing: boolean): void {
		if (!this.options.open) {
			return;
		}
		this.pending ??= this.start(this.options.open, continuing);
	}

	async restore(): Promise<UIMessage[]> {
		const { open } = this.options;
		if (!open || this.options.threadHistory()) {
			return [];
		}
		const key = this.key();
		const saved = savedSession(key);
		if (!saved) {
			return [];
		}
		const generation = this.generation;
		const resuming = EveSession.resume({ open, saved })
			.catch(() => null)
			.then((session) => this.kept(session, generation));
		this.pending = resuming;
		const session = await resuming;
		if (!session) {
			saveSession(key, null);
			if (this.pending === resuming) {
				this.pending = undefined;
			}
			return [];
		}
		return await historyMessages(await session.history());
	}

	reset(): void {
		saveSession(this.key(), null);
		this.dispose();
	}

	forget(threadId: string): void {
		saveSession(sessionKey({ channelId: this.channelId, threadId }), null);
	}

	dispose(): void {
		this.generation += 1;
		this.threadOnFallback = false;
		void this.pending?.then((session) => session?.close()).catch(() => {});
		this.pending = undefined;
	}

	/** A thread that already has messages and no saved session began on `fallback`, which holds its history. */
	private async start(
		open: OpenSession,
		continuing: boolean,
	): Promise<EveSession | null> {
		const generation = this.generation;
		const key = this.key();
		const saved = savedSession(key);
		if (saved) {
			const resumed = await EveSession.resume({ open, saved }).catch(
				() => null,
			);
			if (!resumed && generation === this.generation) {
				saveSession(key, null);
			}
			return this.kept(resumed, generation);
		}
		if (continuing) {
			return null;
		}
		const body = this.options.body();
		const created = await EveSession.create({
			open,
			channelId: stringField(body, "channelId"),
			visitorId: visitorIdOf(body),
		});
		const session = this.kept(created, generation);
		if (generation === this.generation) {
			saveSession(key, session?.saved ?? null);
		}
		return session;
	}

	private kept(
		session: EveSession | null,
		generation: number,
	): EveSession | null {
		if (session && generation !== this.generation) {
			session.close();
			return null;
		}
		return session;
	}

	async sendMessages(
		options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
	): Promise<ReadableStream<UIMessageChunk>> {
		const opensThread =
			options.messages.filter((message) => message.role === "user").length <= 1;
		if (opensThread) {
			this.threadOnFallback = false;
		}
		const last = [...options.messages]
			.reverse()
			.find((message) => message.role === "user");
		const carriesFiles =
			last?.parts.some((part) => part.type === "file") ?? false;
		if (this.threadOnFallback || carriesFiles || !this.options.open) {
			this.threadOnFallback = true;
			return await this.options.fallback.sendMessages(options);
		}
		this.open(!opensThread);
		let session = await this.pending?.catch(() => null);
		if (session?.used && opensThread) {
			this.reset();
			this.open(false);
			session = await this.pending?.catch(() => null);
		}
		if (!session) {
			this.threadOnFallback = true;
			return await this.options.fallback.sendMessages(options);
		}
		this.options.onSession(session.sessionId);
		const { documents } = this.options.takeTurnInput();
		const texts = userTexts(options.messages);
		// eve refuses an empty message, and an attachment-only one has no text.
		const typed = texts.at(-1) ?? "";
		const text = typed.trim()
			? typed
			: (documents?.map((document) => document.filename).join(", ") ?? typed);
		const turn = session.turn(
			text,
			{ documents, extra: extraOf(this.options.body()) },
			options.abortSignal,
		);
		const { suggest } = this.options;
		if (!session.followups || !suggest) {
			return turn;
		}
		const { saved } = session;
		return turn.pipeThrough(
			withFollowups({
				suggest: (answerText, toolNames) =>
					suggest({
						...saved,
						answerText: answerText.slice(-8_000),
						recentUserMessages: texts
							.slice(-3)
							.map((entry) => entry.slice(-2_000)),
						toolNames: toolNames.slice(0, 20),
					}),
				signal: options.abortSignal,
			}),
		);
	}

	async reconnectToStream(
		options: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0],
	): Promise<ReadableStream<UIMessageChunk> | null> {
		const session = await this.pending?.catch(() => null);
		return session
			? null
			: await this.options.fallback.reconnectToStream(options);
	}
}

/**
 * A transport factory for `useChatEngine` that talks to the agent runtime
 * through `sessionApi`. A resolver lets an embed pass the URL its remote config
 * answers after mount; until it answers, turns go through `fallback`.
 */
export function eveTransport(
	sessionApi: string | (() => string | undefined),
): ChatTransportFactory {
	const resolve =
		typeof sessionApi === "string" ? () => sessionApi : sessionApi;
	return (context) => {
		const route = <T>(build: (api: string) => T): T | undefined => {
			const api = resolve();
			return api ? build(api) : undefined;
		};
		return new EveTransport({
			...context,
			get open() {
				return route((api) =>
					sessionRoute({ sessionApi: api, headers: context.headers }),
				);
			},
			get suggest() {
				return route((api) =>
					followupsRoute({ sessionApi: api, headers: context.headers }),
				);
			},
		});
	};
}
