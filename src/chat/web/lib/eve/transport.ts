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
	type SavedConversation,
	type SessionRequest,
	saveConversation,
	savedConversation,
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
	input: SavedConversation & {
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

/**
 * Sends turns straight to the agent runtime when the app's session route
 * admits the chat, and through `fallback` when it answers that the chat route
 * keeps serving it. The conversation is kept per channel across page loads and
 * resumed from the runtime's own event log. A thread that needs what the
 * runtime path does not carry (attachments, model context, saved thread
 * history) stays on `fallback` for its whole length.
 */
export class EveTransport
	implements ChatTransport<UIMessage>, ChatTransportLifecycle
{
	private session: Promise<EveSession | null> | undefined;
	private threadOnFallback = false;
	private disposed = false;

	constructor(
		private readonly options: ChatTransportContext & {
			open: OpenSession;
			suggest: SuggestFollowups;
		},
	) {}

	private get channelId(): string | undefined {
		return stringField(this.options.body(), "channelId");
	}

	/** Opens the runtime session ahead of the first message, so that message pays no bootstrap. */
	prepare(): void {
		this.disposed = false;
		this.session ??= this.start();
	}

	async restore(): Promise<UIMessage[]> {
		if (
			this.options.needsFallback() ||
			!("withResolvers" in Promise) ||
			!savedConversation(this.channelId)
		) {
			return [];
		}
		this.prepare();
		const conversation = await this.session?.catch(() => null);
		return conversation
			? await historyMessages(await conversation.history())
			: [];
	}

	reset(): void {
		saveConversation(this.channelId, null);
		this.dispose();
	}

	dispose(): void {
		this.disposed = true;
		void this.session
			?.then((conversation) => conversation?.close())
			.catch(() => {});
		this.session = undefined;
	}

	private async start(): Promise<EveSession | null> {
		const body = this.options.body();
		const channelId = stringField(body, "channelId");
		const saved = savedConversation(channelId);
		let conversation = saved
			? await EveSession.resume({ open: this.options.open, saved }).catch(
					() => null,
				)
			: null;
		if (!conversation) {
			conversation = await EveSession.create({
				open: this.options.open,
				channelId,
				visitorId: visitorIdOf(body),
			});
			saveConversation(channelId, conversation?.saved ?? null);
		}
		if (conversation && this.disposed) {
			conversation.close();
			return null;
		}
		return conversation;
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
		if (
			this.threadOnFallback ||
			carriesFiles ||
			this.options.needsFallback() ||
			!("withResolvers" in Promise)
		) {
			this.threadOnFallback = true;
			return await this.options.fallback.sendMessages(options);
		}
		this.prepare();
		let conversation = await this.session?.catch(() => null);
		if (conversation?.used && opensThread) {
			this.reset();
			this.prepare();
			conversation = await this.session?.catch(() => null);
		}
		if (!conversation) {
			this.threadOnFallback = true;
			return await this.options.fallback.sendMessages(options);
		}
		this.options.onSession(conversation.sessionId);
		const texts = userTexts(options.messages);
		const turn = conversation.turn(texts.at(-1) ?? "", options.abortSignal);
		if (!conversation.followups) {
			return turn;
		}
		const { saved } = conversation;
		return turn.pipeThrough(
			withFollowups({
				suggest: (answerText, toolNames) =>
					this.options.suggest({
						...saved,
						answerText: answerText.slice(-8_000),
						recentUserMessages: texts
							.slice(-3)
							.map((text) => text.slice(-2_000)),
						toolNames: toolNames.slice(0, 20),
					}),
				signal: options.abortSignal,
			}),
		);
	}

	async reconnectToStream(
		options: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0],
	): Promise<ReadableStream<UIMessageChunk> | null> {
		const conversation = await this.session?.catch(() => null);
		return conversation
			? null
			: await this.options.fallback.reconnectToStream(options);
	}
}

/** A transport factory for `useChatEngine` that talks to the agent runtime through `sessionApi`. */
export function eveTransport(sessionApi: string): ChatTransportFactory {
	return (context) =>
		new EveTransport({
			...context,
			open: sessionRoute({ sessionApi, headers: context.headers }),
			suggest: followupsRoute({ sessionApi, headers: context.headers }),
		});
}
