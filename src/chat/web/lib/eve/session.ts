import type { UIMessageChunk } from "ai";
import { EveAgentStore } from "eve/client";
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
export type SavedConversation = { conversationId: string; ownerSecret: string };

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

function storageKey(channelId: string | undefined): string {
	return `waniwani:eve-conversation:${channelId ?? ""}`;
}

export function savedConversation(
	channelId: string | undefined,
): SavedConversation | null {
	try {
		const parsed: unknown = JSON.parse(
			localStorage.getItem(storageKey(channelId)) ?? "null",
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

export function saveConversation(
	channelId: string | undefined,
	saved: SavedConversation | null,
): void {
	try {
		if (saved) {
			localStorage.setItem(storageKey(channelId), JSON.stringify(saved));
		} else {
			localStorage.removeItem(storageKey(channelId));
		}
	} catch {}
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
		return session ? new EveSession(input.open, secret, session) : null;
	}

	static async resume(input: {
		open: OpenSession;
		saved: SavedConversation;
	}): Promise<EveSession | null> {
		const session = await input.open({ operation: "resume", ...input.saved });
		return session
			? new EveSession(input.open, input.saved.ownerSecret, session)
			: null;
	}

	get sessionId(): string {
		return this.grant.sessionId;
	}

	get saved(): SavedConversation {
		return {
			conversationId: this.grant.conversationId,
			ownerSecret: this.secret,
		};
	}

	get followups(): boolean {
		return this.grant.followups;
	}

	/** Every event the session held when it was opened. */
	async history(): Promise<readonly EveEvent[]> {
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
		abortSignal?: AbortSignal,
	): ReadableStream<UIMessageChunk> {
		this.used = true;
		abortSignal?.addEventListener("abort", () => void this.store.cancel(), {
			once: true,
		});
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
					.send({ message, signal: abortSignal })
					.then(
						() => this.store.snapshot.error,
						(reason: unknown) =>
							reason instanceof Error ? reason : new Error(String(reason)),
					);
				this.forward = undefined;
				if (error && !failed && !abortSignal?.aborted) {
					controller.enqueue({
						type: "session.failed",
						data: { message: error.message },
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
