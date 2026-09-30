import type { UIMessageChunk } from "ai";
import { EveAgentStore, type MessageStreamEvent } from "eve/client";
import type { AttachedDocument } from "../../../../documents/types";
import { installEveShims } from "./shims";
import { type EveEvent, uiMessageChunks } from "./ui-stream";

const REFRESH_AHEAD_MS = 30_000;

/** Where a session's turns go, as the app's session route answers it. */
type SessionGrant = {
	conversationId: string;
	eveHost: string;
	sessionId: string;
	accessToken: string;
	expiresAt: number;
	followups: boolean;
};

/** What reopens a conversation after a page load. */
export type SavedSession = { conversationId: string; ownerSecret: string };

export type SessionRequest =
	| {
			operation: "create";
			requestId: string;
			ownerSecret: string;
			channelId?: string;
			visitorId?: string;
	  }
	| {
			operation: "resume" | "refresh";
			conversationId: string;
			ownerSecret: string;
	  };

/** `null` when the app keeps serving this chat through its chat route. */
export type OpenSession = (
	request: SessionRequest,
) => Promise<SessionGrant | null>;

function ownerSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

/** One session per channel, or per saved thread when the chat keeps threads. */
export function sessionKey(input: {
	channelId: string | undefined;
	threadId: string | undefined;
}): string {
	const channel = input.channelId ?? "";
	return input.threadId === undefined
		? channel
		: `${channel}:${input.threadId}`;
}

function storageKey(key: string): string {
	return `waniwani:eve-conversation:${key}`;
}

export function savedSession(key: string): SavedSession | null {
	try {
		const parsed: unknown = JSON.parse(
			localStorage.getItem(storageKey(key)) ?? "null",
		);
		return typeof parsed === "object" &&
			parsed !== null &&
			"conversationId" in parsed &&
			typeof parsed.conversationId === "string" &&
			"ownerSecret" in parsed &&
			typeof parsed.ownerSecret === "string"
			? {
					conversationId: parsed.conversationId,
					ownerSecret: parsed.ownerSecret,
				}
			: null;
	} catch {
		return null;
	}
}

export function saveSession(key: string, saved: SavedSession | null): void {
	try {
		if (saved) {
			localStorage.setItem(storageKey(key), JSON.stringify(saved));
		} else {
			localStorage.removeItem(storageKey(key));
		}
	} catch {}
}

/** What a turn carries besides its text, into the MCP server's `_meta`. */
export type TurnInput = {
	documents?: readonly AttachedDocument[];
	extra?: Record<string, unknown>;
};

/** Header values must be Latin-1, and a filename or an `extra` value may not be. */
function asciiJson(value: unknown): string {
	return JSON.stringify(value).replace(
		/[\u007f-\uffff]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}

function turnHeaders(input: TurnInput): Record<string, string> {
	return {
		...(input.documents?.length
			? { "x-waniwani-documents": asciiJson(input.documents) }
			: {}),
		...(input.extra && Object.keys(input.extra).length > 0
			? { "x-waniwani-extra": asciiJson(input.extra) }
			: {}),
	};
}

const noProjection = { initial: () => undefined, reduce: () => undefined };

/**
 * One eve session held from the browser through eve's own frontend store, which
 * keeps one session stream open across turns, reconnects it, and matches each
 * turn to the message the runtime accepted.
 */
export class EveSession {
	private grant: SessionGrant;
	private refreshing: Promise<string> | null = null;
	private readonly store: EveAgentStore<undefined>;
	private forward: ((event: EveEvent) => void) | undefined;
	private readonly caughtUp: Promise<void>;
	used = false;

	private constructor(
		private readonly open: OpenSession,
		private readonly secret: string,
		grant: SessionGrant,
	) {
		this.grant = grant;
		installEveShims();
		this.store = new EveAgentStore({
			host: grant.eveHost,
			auth: { bearer: () => this.bearer() },
			initialSession: { sessionId: grant.sessionId, streamIndex: 0 },
			optimistic: false,
			reducer: noProjection,
		});
		this.store.setCallbacks({ onEvent: (event) => this.forward?.(event) });
		this.caughtUp = this.store.resume().catch(() => {});
	}

	static async create(input: {
		open: OpenSession;
		channelId?: string;
		visitorId?: string;
	}): Promise<EveSession | null> {
		const secret = ownerSecret();
		const session = await input.open({
			operation: "create",
			requestId: crypto.randomUUID(),
			ownerSecret: secret,
			channelId: input.channelId,
			visitorId: input.visitorId,
		});
		return session
			? await new EveSession(input.open, secret, session).reachable()
			: null;
	}

	static async resume(input: {
		open: OpenSession;
		saved: SavedSession;
	}): Promise<EveSession | null> {
		const session = await input.open({ operation: "resume", ...input.saved });
		return session
			? await new EveSession(
					input.open,
					input.saved.ownerSecret,
					session,
				).reachable()
			: null;
	}

	/**
	 * A page whose CSP or network blocks the runtime host fails here, on the
	 * stream the first send waits for anyway, so the chat can fall back first.
	 */
	private async reachable(): Promise<EveSession | null> {
		await this.caughtUp;
		if (this.store.snapshot.error === undefined) {
			return this;
		}
		this.close();
		return null;
	}

	get sessionId(): string {
		return this.grant.sessionId;
	}

	get saved(): SavedSession {
		return {
			conversationId: this.grant.conversationId,
			ownerSecret: this.secret,
		};
	}

	get followups(): boolean {
		return this.grant.followups;
	}

	/** Every event the session held when it was opened. */
	async history(): Promise<readonly MessageStreamEvent[]> {
		await this.caughtUp;
		const { events } = this.store.snapshot;
		this.used ||= events.some((event) => event.type === "message.received");
		return events;
	}

	private async bearer(): Promise<string> {
		if (this.grant.expiresAt - REFRESH_AHEAD_MS > Date.now()) {
			return this.grant.accessToken;
		}
		this.refreshing ??= this.open({
			operation: "refresh",
			conversationId: this.grant.conversationId,
			ownerSecret: this.secret,
		})
			.then((next) => {
				if (!next) {
					throw new Error("The conversation left the direct runtime");
				}
				this.grant = next;
				return next.accessToken;
			})
			.finally(() => {
				this.refreshing = null;
			});
		return await this.refreshing;
	}

	/** The turn this message starts, from its acceptance to its boundary, as UI message chunks. */
	turn(
		message: string,
		input: TurnInput,
		abortSignal?: AbortSignal,
	): ReadableStream<UIMessageChunk> {
		this.used = true;
		const cancel = () => void this.store.cancel();
		abortSignal?.addEventListener("abort", cancel, { once: true });
		const events = new ReadableStream<EveEvent>({
			start: async (controller) => {
				let failed = false;
				this.forward = (event) => {
					failed ||=
						event.type === "turn.failed" || event.type === "session.failed";
					controller.enqueue(event);
				};
				await this.caughtUp;
				const error = await this.store
					.send({ message, signal: abortSignal, headers: turnHeaders(input) })
					.then(
						() => this.store.snapshot.error,
						(reason: unknown) =>
							reason instanceof Error ? reason : new Error(String(reason)),
					);
				this.forward = undefined;
				abortSignal?.removeEventListener("abort", cancel);
				if (error && !failed && !abortSignal?.aborted) {
					controller.enqueue({
						type: "session.failed",
						data: {
							code: "transport_failed",
							message: error.message,
							sessionId: this.sessionId,
						},
					});
				}
				controller.close();
			},
		});
		return events.pipeThrough(uiMessageChunks());
	}

	close(): void {
		this.forward = undefined;
		this.store.reset();
	}
}
