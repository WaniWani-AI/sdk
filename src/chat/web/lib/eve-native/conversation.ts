import type { UIMessageChunk } from "ai";
import { type EveEvent, uiMessageChunks } from "./ui-stream";

const REFRESH_AHEAD_MS = 30_000;
const NOT_READY_BUDGET_MS = 20_000;
const RECONNECT_DELAY_MS = 250;

/** Where a conversation's turns go, as the app's session route answers it. */
type NativeSession = {
	conversationId: string;
	eveHost: string;
	sessionId: string;
	accessToken: string;
	expiresAt: number;
};

export type SessionRequest =
	| {
			operation: "create";
			requestId: string;
			ownerSecret: string;
			channelId?: string;
			visitorId?: string;
	  }
	| { operation: "refresh"; conversationId: string; ownerSecret: string };

/** `null` when the app keeps serving this chat through its chat route. */
export type OpenSession = (
	request: SessionRequest,
) => Promise<NativeSession | null>;

function ownerSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
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
export class NativeConversation {
	private session: NativeSession;
	private position = 0;
	private refreshing: Promise<string> | null = null;
	private readonly listeners = new Set<(event: EveEvent) => void>();
	private readonly stopped = new AbortController();
	used = false;

	private constructor(
		private readonly open: OpenSession,
		private readonly secret: string,
		session: NativeSession,
	) {
		this.session = session;
		void this.follow();
	}

	static async create(input: {
		open: OpenSession;
		channelId?: string;
		visitorId?: string;
	}): Promise<NativeConversation | null> {
		const secret = ownerSecret();
		const session = await input.open({
			operation: "create",
			requestId: crypto.randomUUID(),
			ownerSecret: secret,
			channelId: input.channelId,
			visitorId: input.visitorId,
		});
		return session ? new NativeConversation(input.open, secret, session) : null;
	}

	get sessionId(): string {
		return this.session.sessionId;
	}

	private url(suffix = ""): string {
		return `${this.session.eveHost}/eve/v1/session/${encodeURIComponent(this.session.sessionId)}${suffix}`;
	}

	private async bearer(): Promise<string> {
		if (this.session.expiresAt - REFRESH_AHEAD_MS > Date.now()) {
			return this.session.accessToken;
		}
		this.refreshing ??= this.open({
			operation: "refresh",
			conversationId: this.session.conversationId,
			ownerSecret: this.secret,
		})
			.then((next) => {
				if (!next) {
					throw new Error("The conversation left the direct runtime");
				}
				this.session = next;
				return next.accessToken;
			})
			.finally(() => {
				this.refreshing = null;
			});
		return await this.refreshing;
	}

	private async follow(): Promise<void> {
		const signal = this.stopped.signal;
		while (!signal.aborted) {
			try {
				const url = new URL(this.url("/stream"));
				if (this.position > 0) {
					url.searchParams.set("startIndex", String(this.position));
				}
				const response = await fetch(url, {
					headers: { authorization: `Bearer ${await this.bearer()}` },
					cache: "no-store",
					signal,
				});
				if (!response.ok || !response.body) {
					throw new Error(`stream ${response.status}`);
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
						for (const listener of this.listeners) {
							listener(event);
						}
					}
				}
			} catch {
				if (signal.aborted) {
					return;
				}
			}
			await sleep(RECONNECT_DELAY_MS, signal);
		}
	}

	private async send(message: string): Promise<string> {
		const deadline = Date.now() + NOT_READY_BUDGET_MS;
		for (let delay = 250; ; delay = Math.min(delay * 2, 2_000)) {
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
			await sleep(delay);
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
		let forward: ((event: EveEvent) => void) | undefined;
		let finish: (() => void) | undefined;

		const listener = (event: EveEvent) => {
			if (!deliveryId) {
				early.push(event);
				return;
			}
			if (!event.meta?.deliveryIds?.includes(deliveryId)) {
				return;
			}
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
				this.listeners.add(listener);
				abortSignal?.addEventListener(
					"abort",
					() => {
						void this.cancel(turnId);
						this.listeners.delete(listener);
						try {
							controller.close();
						} catch {}
					},
					{ once: true },
				);
				this.send(message).then(
					(accepted) => {
						deliveryId = accepted;
						for (const event of early.splice(0)) {
							listener(event);
						}
					},
					(error: unknown) => {
						this.listeners.delete(listener);
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

	close(): void {
		this.stopped.abort();
		this.listeners.clear();
	}
}
