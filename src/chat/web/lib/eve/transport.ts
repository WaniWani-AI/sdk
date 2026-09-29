import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type {
	ChatTransportContext,
	ChatTransportFactory,
	ChatTransportLifecycle,
} from "../../@types";
import { EveSession, type OpenSession, type SessionRequest } from "./session";

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

function lastUserText(messages: UIMessage[]): string {
	const last = [...messages]
		.reverse()
		.find((message) => message.role === "user");
	return (last?.parts ?? [])
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n");
}

/** The app's session route, with the embed's own public key. */
export function sessionRoute(input: {
	sessionApi: string;
	headers: Resolve<Record<string, string> | undefined>;
}): OpenSession {
	return async (request: SessionRequest) => {
		const response = await fetch(input.sessionApi, {
			method: "POST",
			headers: { ...input.headers(), "content-type": "application/json" },
			body: JSON.stringify(request),
			cache: "no-store",
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
		return { conversationId, eveHost, sessionId, accessToken, expiresAt };
	};
}

/**
 * Sends turns straight to the agent runtime when the app's session route
 * admits the chat, and through `fallback` when it answers that the chat route
 * keeps serving it. A thread's first message opens a fresh runtime session, and
 * a thread that needs what the runtime path does not carry (attachments, model
 * context, saved thread history) stays on `fallback` for its whole length.
 */
export class EveTransport
	implements ChatTransport<UIMessage>, ChatTransportLifecycle
{
	private session: Promise<EveSession | null> | undefined;
	private threadOnFallback = false;
	private disposed = false;

	constructor(
		private readonly options: ChatTransportContext & { open: OpenSession },
	) {}

	/** Opens the runtime session ahead of the first message, so that message pays no bootstrap. */
	prepare(): void {
		this.disposed = false;
		this.session ??= this.start();
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
		const conversation = await EveSession.create({
			open: this.options.open,
			channelId: stringField(body, "channelId"),
			visitorId: visitorIdOf(body),
		});
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
		if (this.threadOnFallback || carriesFiles || this.options.needsFallback()) {
			this.threadOnFallback = true;
			return await this.options.fallback.sendMessages(options);
		}
		this.disposed = false;
		this.session ??= this.start();
		let conversation = await this.session.catch(() => null);
		if (conversation?.used && opensThread) {
			conversation.close();
			this.session = this.start();
			conversation = await this.session.catch(() => null);
		}
		if (!conversation) {
			this.threadOnFallback = true;
			return await this.options.fallback.sendMessages(options);
		}
		this.options.onSession(conversation.sessionId);
		return conversation.turn(
			lastUserText(options.messages),
			options.abortSignal,
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
		});
}
