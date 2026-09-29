import type { UIMessageChunk } from "ai";
import { type EveEvent, uiMessageChunks } from "./ui-stream";

const REFRESH_AHEAD_MS = 30_000;
const NOT_READY_BUDGET_MS = 20_000;
const RECONNECT_DELAY_MS = 250;
const MAX_STREAM_FAILURES = 8;

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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

function isTurnBoundary(event: EveEvent): boolean {
	return (
		event.type === "session.waiting" ||
		event.type === "session.failed" ||
		event.type === "session.completed"
	);
}

/**
 * One eve session held from the browser: a single session stream followed
 * across turns and lease renewals, and one POST per message.
 */
export class EveSession {
	private grant: SessionGrant;
	private position = 0;
	private refreshing: Promise<string> | null = null;
	private readonly listeners = new Set<(event: EveEvent) => void>();
	private readonly stopped = new AbortController();
	private readonly replayed: EveEvent[] = [];
	private settleHistory: ((events: EveEvent[]) => void) | undefined;
	private tail: number | undefined;
	/** Every event the session held when it was resumed; empty for a new session. */
	readonly history: Promise<EveEvent[]>;
	used = false;

	private constructor(
		private readonly open: OpenSession,
		private readonly secret: string,
		grant: SessionGrant,
		resumed: boolean,
	) {
		this.grant = grant;
		this.history = new Promise((resolve) => {
			this.settleHistory = resolve;
		});
		if (!resumed) {
			this.settle();
		}
		void this.follow();
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
		return session ? new EveSession(input.open, secret, session, false) : null;
	}

	static async resume(input: {
		open: OpenSession;
		saved: SavedConversation;
	}): Promise<EveSession | null> {
		const session = await input.open({
			operation: "resume",
			...input.saved,
		});
		return session
			? new EveSession(input.open, input.saved.ownerSecret, session, true)
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

	private settle(): void {
		this.settleHistory?.(this.replayed);
		this.settleHistory = undefined;
	}

	private record(event: EveEvent): void {
		if (!this.settleHistory) {
			return;
		}
		this.replayed.push(event);
		if (event.type === "message.received") {
			this.used = true;
		}
		if (this.tail !== undefined && this.position > this.tail) {
			this.settle();
		}
	}

	private url(suffix = ""): string {
		return `${this.grant.eveHost}/eve/v1/session/${encodeURIComponent(this.grant.sessionId)}${suffix}`;
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

	private async follow(): Promise<void> {
		const signal = this.stopped.signal;
		let failures = 0;
		while (!signal.aborted) {
			try {
				const url = new URL(this.url("/stream"));
				if (this.position > 0) {
					url.searchParams.set("startIndex", String(this.position));
				}
				if (this.settleHistory && this.tail === undefined) {
					url.searchParams.set("includeTailIndex", "1");
				}
				const response = await fetch(url, {
					headers: { authorization: `Bearer ${await this.bearer()}` },
					cache: "no-store",
					signal,
				});
				if (response.status === 401 || response.status === 403) {
					this.fail(`The chat lost access to the agent (${response.status})`);
					return;
				}
				if (!response.ok || !response.body) {
					throw new Error(`stream ${response.status}`);
				}
				if (this.settleHistory && this.tail === undefined) {
					this.tail = Number(
						response.headers.get("x-eve-stream-tail-index") ?? "-1",
					);
					if (!(this.position <= this.tail)) {
						this.settle();
					}
				}
				const reader = response.body
					.pipeThrough(new TextDecoderStream())
					.getReader();
				let buffer = "";
				for (;;) {
					const { value, done } = await reader.read();
					if (done) {
						break;
					}
					buffer += value;
					for (
						let newline = buffer.indexOf("\n");
						newline !== -1;
						newline = buffer.indexOf("\n")
					) {
						const line = buffer.slice(0, newline).trim();
						buffer = buffer.slice(newline + 1);
						if (!line) {
							continue;
						}
						const parsed: unknown = JSON.parse(line);
						// Lease-renewal control records are transport, not session events.
						if (
							typeof parsed !== "object" ||
							parsed === null ||
							"$eve" in parsed
						) {
							continue;
						}
						this.position += 1;
						const event = parsed as EveEvent;
						this.record(event);
						for (const listener of this.listeners) {
							listener(event);
						}
					}
				}
				failures = 0;
			} catch (error) {
				if (signal.aborted) {
					return;
				}
				failures += 1;
				if (failures >= MAX_STREAM_FAILURES) {
					this.fail(
						error instanceof Error ? error.message : "The agent stream failed",
					);
					return;
				}
			}
			await sleep(RECONNECT_DELAY_MS * Math.min(failures + 1, 8), signal);
		}
	}

	private async send(message: string, signal?: AbortSignal): Promise<string> {
		const deadline = Date.now() + NOT_READY_BUDGET_MS;
		for (let delay = 250; ; delay = Math.min(delay * 2, 2_000)) {
			signal?.throwIfAborted();
			const response = await fetch(this.url(), {
				method: "POST",
				headers: {
					authorization: `Bearer ${await this.bearer()}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ message }),
			});
			const body: unknown = await response.json().catch(() => null);
			const record = typeof body === "object" && body !== null ? body : {};
			if (
				response.status === 202 &&
				"deliveryId" in record &&
				typeof record.deliveryId === "string"
			) {
				return record.deliveryId;
			}
			const notReady =
				response.status === 409 &&
				"code" in record &&
				record.code === "session_not_ready";
			if (!notReady || Date.now() > deadline) {
				throw new Error(`The agent refused the message (${response.status})`);
			}
			await sleep(delay, signal);
		}
	}

	/** The turn this message starts, from its acceptance to its boundary, as UI message chunks. */
	turn(
		message: string,
		abortSignal?: AbortSignal,
	): ReadableStream<UIMessageChunk> {
		this.used = true;
		const early: EveEvent[] = [];
		let deliveryId: string | undefined;
		let turnId: string | undefined;
		let started = false;
		let forward: ((event: EveEvent) => void) | undefined;
		let finish: (() => void) | undefined;

		const listener = (event: EveEvent) => {
			if (!deliveryId) {
				early.push(event);
				return;
			}
			const ours = event.meta?.deliveryIds?.includes(deliveryId) === true;
			// A session-wide terminal event names no delivery, and ends whichever turn is running.
			const sessionWide =
				isTurnBoundary(event) && event.meta?.deliveryIds === undefined;
			if (
				!ours &&
				!(sessionWide && (started || event.type !== "session.waiting"))
			) {
				return;
			}
			started = true;
			const data = event.data;
			if (
				!turnId &&
				typeof data === "object" &&
				data !== null &&
				"turnId" in data &&
				typeof data.turnId === "string"
			) {
				turnId = data.turnId;
			}
			forward?.(event);
			if (isTurnBoundary(event)) {
				finish?.();
			}
		};

		const events = new ReadableStream<EveEvent>({
			start: (controller) => {
				forward = (event) => controller.enqueue(event);
				finish = () => {
					this.listeners.delete(listener);
					controller.close();
				};
				const stop = () => {
					if (deliveryId) {
						void this.cancel(turnId);
					}
					this.listeners.delete(listener);
					try {
						controller.close();
					} catch {}
				};
				if (abortSignal?.aborted) {
					controller.close();
					return;
				}
				this.listeners.add(listener);
				abortSignal?.addEventListener("abort", stop, { once: true });
				this.send(message, abortSignal).then(
					(accepted) => {
						deliveryId = accepted;
						if (abortSignal?.aborted) {
							stop();
							return;
						}
						for (const event of early.splice(0)) {
							listener(event);
						}
					},
					(error: unknown) => {
						this.listeners.delete(listener);
						if (abortSignal?.aborted) {
							try {
								controller.close();
							} catch {}
							return;
						}
						controller.error(error);
					},
				);
			},
		});
		return events.pipeThrough(uiMessageChunks());
	}

	private async cancel(turnId: string | undefined): Promise<void> {
		await fetch(this.url("/cancel"), {
			method: "POST",
			headers: {
				authorization: `Bearer ${await this.bearer()}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(turnId ? { turnId } : {}),
		}).catch(() => {});
	}

	/** Ends every waiting turn with a failure the chat can show, instead of streaming forever. */
	private fail(message: string): void {
		const event: EveEvent = { type: "session.failed", data: { message } };
		for (const listener of this.listeners) {
			listener(event);
		}
		this.close();
	}

	close(): void {
		this.stopped.abort();
		this.listeners.clear();
		this.settle();
	}
}
