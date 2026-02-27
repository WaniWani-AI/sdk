"use client";

/**
 * Lightweight client-side transport for widget event tracking.
 *
 * Sends events directly to the WaniWani backend V2 batch endpoint
 * using a short-lived JWT for authentication.
 * Falls back to `navigator.sendBeacon()` on page teardown.
 */

export interface WidgetEvent {
	event_id: string;
	event_type: string;
	timestamp: string;
	source: string;
	session_id?: string;
	trace_id?: string;
	user_id?: string;
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface WidgetTransportConfig {
	/** The V2 batch endpoint URL (e.g. https://app.waniwani.ai/api/mcp/events/v2/batch) */
	endpoint: string;
	/** JWT widget token for authentication */
	token?: string;
	/** Additional metadata to include with events */
	metadata?: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 20;
const MAX_BUFFER_SIZE = 200;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1_000;
const BEACON_MAX_BYTES = 60_000;
const SDK_NAME = "@waniwani/sdk";

/**
 * Map a WidgetEvent to V2EventEnvelope shape for the backend.
 */
function toV2Envelope(ev: WidgetEvent): Record<string, unknown> {
	const isAutoCapture = ev.event_type.startsWith("widget_");
	const eventName = isAutoCapture ? ev.event_type : `widget_${ev.event_type}`;

	const correlation: Record<string, string> = {};
	if (ev.session_id) correlation.sessionId = ev.session_id;
	if (ev.trace_id) correlation.traceId = ev.trace_id;
	if (ev.user_id) correlation.externalUserId = ev.user_id;

	// Build properties from metadata + any extra fields
	const properties: Record<string, unknown> = {
		...(ev.metadata ?? {}),
	};
	if (ev.event_name) properties.event_name = ev.event_name as string;

	return {
		id: ev.event_id,
		type: "mcp.event",
		name: eventName,
		source: ev.source || "widget",
		timestamp: ev.timestamp,
		correlation,
		properties,
		metadata: {},
	};
}

function buildV2Batch(events: WidgetEvent[]): string {
	return JSON.stringify({
		sentAt: new Date().toISOString(),
		source: { sdk: SDK_NAME, version: "0.1.0" },
		events: events.map(toV2Envelope),
	});
}

export class WidgetTransport {
	private buffer: WidgetEvent[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private flushing = false;
	private pendingFlush = false;
	private stopped = false;
	private readonly config: WidgetTransportConfig;
	private teardownVisibility: (() => void) | null = null;
	private teardownPagehide: (() => void) | null = null;

	constructor(config: WidgetTransportConfig) {
		this.config = config;
		this.start();
		this.registerTeardown();
	}

	send(events: WidgetEvent[]): void {
		if (this.stopped) return;

		this.buffer.push(...events);

		if (this.buffer.length > MAX_BUFFER_SIZE) {
			const dropped = this.buffer.length - MAX_BUFFER_SIZE;
			this.buffer.splice(0, dropped);
		}

		if (this.buffer.length >= MAX_BATCH_SIZE) {
			this.flush().catch(() => {});
		}
	}

	async flush(): Promise<void> {
		if (this.stopped || this.buffer.length === 0) return;

		if (this.flushing) {
			this.pendingFlush = true;
			return;
		}

		this.flushing = true;
		try {
			const batch = this.buffer.splice(0, MAX_BATCH_SIZE);
			await this.sendBatch(batch);
		} finally {
			this.flushing = false;
			if (this.pendingFlush && this.buffer.length > 0 && !this.stopped) {
				this.pendingFlush = false;
				this.flush().catch(() => {});
			}
		}
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (typeof document !== "undefined" && this.teardownVisibility) {
			document.removeEventListener("visibilitychange", this.teardownVisibility);
			this.teardownVisibility = null;
		}
		if (typeof window !== "undefined" && this.teardownPagehide) {
			window.removeEventListener("pagehide", this.teardownPagehide);
			this.teardownPagehide = null;
		}
	}

	beaconFlush(): void {
		if (this.buffer.length === 0) return;

		const events = [...this.buffer];
		this.buffer.length = 0;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.config.token) {
			headers.Authorization = `Bearer ${this.config.token}`;
		}

		// Use fetch with keepalive instead of sendBeacon so we can set auth headers
		if (typeof fetch !== "undefined") {
			this.sendKeepAliveChunked(this.config.endpoint, events, headers);
			return;
		}

		// Final fallback: sendBeacon without auth (best-effort)
		if (
			typeof navigator !== "undefined" &&
			typeof navigator.sendBeacon === "function"
		) {
			this.sendBeaconChunked(this.config.endpoint, events);
		}
	}

	private sendKeepAliveChunked(
		url: string,
		events: WidgetEvent[],
		headers: Record<string, string>,
	): void {
		const body = buildV2Batch(events);

		if (body.length <= BEACON_MAX_BYTES) {
			fetch(url, {
				method: "POST",
				headers,
				body,
				keepalive: true,
			}).catch(() => {});
			return;
		}

		if (events.length <= 1) return;

		const mid = Math.ceil(events.length / 2);
		this.sendKeepAliveChunked(url, events.slice(0, mid), headers);
		this.sendKeepAliveChunked(url, events.slice(mid), headers);
	}

	private sendBeaconChunked(url: string, events: WidgetEvent[]): void {
		const body = buildV2Batch(events);

		if (body.length <= BEACON_MAX_BYTES) {
			navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
			return;
		}

		if (events.length <= 1) return;

		const mid = Math.ceil(events.length / 2);
		this.sendBeaconChunked(url, events.slice(0, mid));
		this.sendBeaconChunked(url, events.slice(mid));
	}

	private start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.flush().catch(() => {});
		}, FLUSH_INTERVAL_MS);
	}

	private registerTeardown(): void {
		if (typeof document === "undefined") return;

		this.teardownVisibility = () => {
			if (document.visibilityState === "hidden") {
				this.beaconFlush();
			}
		};
		this.teardownPagehide = () => {
			this.beaconFlush();
		};

		document.addEventListener("visibilitychange", this.teardownVisibility);
		window.addEventListener("pagehide", this.teardownPagehide);
	}

	private async sendBatch(batch: WidgetEvent[]): Promise<void> {
		const body = buildV2Batch(batch);
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.config.token) {
			headers.Authorization = `Bearer ${this.config.token}`;
		}

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				const response = await fetch(this.config.endpoint, {
					method: "POST",
					headers,
					body,
				});

				if (response.status === 200 || response.status === 207) return;

				if (response.status === 401) {
					this.stopped = true;
					return;
				}

				if (response.status >= 500 && attempt < MAX_RETRIES) {
					await this.delay(BASE_RETRY_DELAY_MS * 2 ** attempt);
					continue;
				}

				if (response.status === 429 && attempt < MAX_RETRIES) {
					const retryAfter = response.headers.get("Retry-After");
					const parsed = retryAfter ? Number(retryAfter) : NaN;
					const delayMs = Number.isFinite(parsed)
						? parsed * 1000
						: BASE_RETRY_DELAY_MS * 2 ** attempt;
					await this.delay(delayMs);
					continue;
				}

				return;
			} catch {
				if (attempt < MAX_RETRIES) {
					await this.delay(BASE_RETRY_DELAY_MS * 2 ** attempt);
					continue;
				}
				return;
			}
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
