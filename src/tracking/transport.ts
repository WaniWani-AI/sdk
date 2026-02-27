import type {
	TrackingShutdownOptions,
	TrackingShutdownResult,
} from "./@types.js";
import type {
	V2BatchRejectedEvent,
	V2BatchRequest,
	V2BatchResponse,
	V2EventEnvelope,
} from "./v2-types.js";

const DEFAULT_ENDPOINT_PATH = "/api/mcp/events/v2/batch";
const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_MAX_BATCH_SIZE = 20;
const DEFAULT_MAX_BUFFER_SIZE = 1_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;
const DEFAULT_RETRY_MAX_DELAY_MS = 2_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const SDK_NAME = "@waniwani/sdk";

const AUTH_FAILURE_STATUS = new Set([401, 403]);
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

interface Logger {
	warn: (message: string, ...args: unknown[]) => void;
	error: (message: string, ...args: unknown[]) => void;
}

export interface V2TransportOptions {
	baseUrl: string;
	apiKey: string;
	endpointPath?: string;
	flushIntervalMs?: number;
	maxBatchSize?: number;
	maxBufferSize?: number;
	maxRetries?: number;
	retryBaseDelayMs?: number;
	retryMaxDelayMs?: number;
	shutdownTimeoutMs?: number;
	sdkVersion?: string;
	fetchFn?: typeof fetch;
	logger?: Logger;
	now?: () => Date;
	sleep?: (delayMs: number) => Promise<void>;
}

export interface V2BatchTransport {
	enqueue: (event: V2EventEnvelope) => void;
	flush: () => Promise<void>;
	shutdown: (
		options?: TrackingShutdownOptions,
	) => Promise<TrackingShutdownResult>;
	pendingEvents: () => number;
}

type SendBatchResult =
	| { kind: "success" }
	| { kind: "retryable"; reason: string }
	| { kind: "permanent"; reason: string }
	| { kind: "auth"; status: number }
	| {
			kind: "partial";
			retryable: V2EventEnvelope[];
			permanent: V2EventEnvelope[];
	  };

export function createV2BatchTransport(
	options: V2TransportOptions,
): V2BatchTransport {
	return new BatchingV2Transport(options);
}

class BatchingV2Transport implements V2BatchTransport {
	private readonly endpointUrl: string;
	private readonly flushIntervalMs: number;
	private readonly maxBatchSize: number;
	private readonly maxBufferSize: number;
	private readonly maxRetries: number;
	private readonly retryBaseDelayMs: number;
	private readonly retryMaxDelayMs: number;
	private readonly shutdownTimeoutMs: number;
	private readonly sdkVersion?: string;
	private readonly fetchFn: typeof fetch;
	private readonly logger: Logger;
	private readonly now: () => Date;
	private readonly sleep: (delayMs: number) => Promise<void>;
	private readonly apiKey: string;

	private readonly buffer: V2EventEnvelope[] = [];
	private flushTimer: ReturnType<typeof setInterval> | undefined;
	private flushScheduled = false;
	private flushScheduledTimer: ReturnType<typeof setTimeout> | undefined;
	private flushInFlight: Promise<void> | undefined;
	private inFlightCount = 0;
	private isStopped = false;
	private isShuttingDown = false;

	constructor(options: V2TransportOptions) {
		this.endpointUrl = joinUrl(
			options.baseUrl,
			options.endpointPath ?? DEFAULT_ENDPOINT_PATH,
		);
		this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
		this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
		this.maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
		this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
		this.retryBaseDelayMs =
			options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
		this.retryMaxDelayMs =
			options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
		this.shutdownTimeoutMs =
			options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
		this.fetchFn = options.fetchFn ?? fetch;
		this.logger = options.logger ?? console;
		this.now = options.now ?? (() => new Date());
		this.sleep =
			options.sleep ??
			((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
		this.apiKey = options.apiKey;
		this.sdkVersion = options.sdkVersion;

		if (this.flushIntervalMs > 0) {
			this.flushTimer = setInterval(() => {
				void this.flush();
			}, this.flushIntervalMs);
		}
	}

	enqueue(event: V2EventEnvelope): void {
		if (this.isStopped || this.isShuttingDown) {
			this.logger.warn(
				"[WaniWani] Tracking transport is stopped, dropping event %s",
				event.id,
			);
			return;
		}

		if (this.buffer.length >= this.maxBufferSize) {
			const dropCount = this.buffer.length - this.maxBufferSize + 1;
			this.buffer.splice(0, dropCount);
			this.logger.warn(
				"[WaniWani] Tracking buffer overflow, dropped %d oldest event(s)",
				dropCount,
			);
		}

		this.buffer.push(event);

		if (this.buffer.length >= this.maxBatchSize) {
			void this.flush();
			return;
		}

		this.scheduleMicroFlush();
	}

	pendingEvents(): number {
		return this.buffer.length + this.inFlightCount;
	}

	async flush(): Promise<void> {
		if (this.flushInFlight) return this.flushInFlight;
		this.flushInFlight = this.flushLoop().finally(() => {
			this.flushInFlight = undefined;
		});
		return this.flushInFlight;
	}

	async shutdown(
		options?: TrackingShutdownOptions,
	): Promise<TrackingShutdownResult> {
		this.isShuttingDown = true;
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = undefined;
		}
		if (this.flushScheduledTimer) {
			clearTimeout(this.flushScheduledTimer);
			this.flushScheduledTimer = undefined;
			this.flushScheduled = false;
		}

		const timeoutMs = options?.timeoutMs ?? this.shutdownTimeoutMs;
		const flushPromise = this.flush();

		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			await flushPromise;
			return { timedOut: false, pendingEvents: this.pendingEvents() };
		}

		const timeoutSignal = Symbol("shutdown-timeout");
		const result = await Promise.race([
			flushPromise.then(() => "flushed" as const),
			this.sleep(timeoutMs).then(() => timeoutSignal),
		]);

		if (result === timeoutSignal) {
			return { timedOut: true, pendingEvents: this.pendingEvents() };
		}

		return { timedOut: false, pendingEvents: this.pendingEvents() };
	}

	private scheduleMicroFlush(): void {
		if (this.flushScheduled) return;
		this.flushScheduled = true;
		this.flushScheduledTimer = setTimeout(() => {
			this.flushScheduledTimer = undefined;
			this.flushScheduled = false;
			void this.flush();
		}, 0);
	}

	private async flushLoop(): Promise<void> {
		while (this.buffer.length > 0 && !this.isStopped) {
			const batch = this.buffer.splice(0, this.maxBatchSize);
			await this.sendBatchWithRetry(batch);
		}
	}

	private async sendBatchWithRetry(batch: V2EventEnvelope[]): Promise<void> {
		let attempt = 0;
		let pendingBatch = batch;

		while (pendingBatch.length > 0 && !this.isStopped) {
			this.inFlightCount = pendingBatch.length;
			const result = await this.sendBatchOnce(pendingBatch);
			this.inFlightCount = 0;

			switch (result.kind) {
				case "success":
					return;
				case "auth":
					this.stopTransportForAuthFailure(result.status, pendingBatch.length);
					return;
				case "permanent":
					this.logger.error(
						"[WaniWani] Dropping %d event(s) after permanent failure: %s",
						pendingBatch.length,
						result.reason,
					);
					return;
				case "retryable":
					if (attempt >= this.maxRetries) {
						this.logger.error(
							"[WaniWani] Dropping %d event(s) after retry exhaustion: %s",
							pendingBatch.length,
							result.reason,
						);
						return;
					}
					await this.sleep(this.backoffDelayMs(attempt));
					attempt += 1;
					continue;
				case "partial":
					if (result.permanent.length > 0) {
						this.logger.error(
							"[WaniWani] Dropping %d event(s) rejected as permanent",
							result.permanent.length,
						);
					}
					if (result.retryable.length === 0) return;
					if (attempt >= this.maxRetries) {
						this.logger.error(
							"[WaniWani] Dropping %d retryable event(s) after retry exhaustion",
							result.retryable.length,
						);
						return;
					}
					pendingBatch = result.retryable;
					await this.sleep(this.backoffDelayMs(attempt));
					attempt += 1;
					continue;
			}
		}
	}

	private async sendBatchOnce(
		events: V2EventEnvelope[],
	): Promise<SendBatchResult> {
		let response: Response;

		try {
			response = await this.fetchFn(this.endpointUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
					"X-WaniWani-SDK": SDK_NAME,
				},
				body: JSON.stringify(this.makeBatchRequest(events)),
			});
		} catch (error) {
			return {
				kind: "retryable",
				reason: getErrorMessage(error),
			};
		}

		if (AUTH_FAILURE_STATUS.has(response.status)) {
			return { kind: "auth", status: response.status };
		}

		if (RETRYABLE_STATUS.has(response.status)) {
			return {
				kind: "retryable",
				reason: `HTTP ${response.status}`,
			};
		}

		if (!response.ok) {
			return {
				kind: "permanent",
				reason: `HTTP ${response.status}`,
			};
		}

		const data = await parseJsonResponse<V2BatchResponse>(response);
		if (!data?.rejected || data.rejected.length === 0) {
			return { kind: "success" };
		}

		const partial = this.classifyRejectedEvents(events, data.rejected);
		if (partial.retryable.length === 0 && partial.permanent.length === 0) {
			return { kind: "success" };
		}

		return {
			kind: "partial",
			retryable: partial.retryable,
			permanent: partial.permanent,
		};
	}

	private makeBatchRequest(events: V2EventEnvelope[]): V2BatchRequest {
		return {
			sentAt: this.now().toISOString(),
			source: {
				sdk: SDK_NAME,
				version: this.sdkVersion ?? "0.0.0",
			},
			events,
		};
	}

	private classifyRejectedEvents(
		events: V2EventEnvelope[],
		rejected: V2BatchRejectedEvent[],
	): {
		retryable: V2EventEnvelope[];
		permanent: V2EventEnvelope[];
	} {
		const byId = new Map(events.map((event) => [event.id, event]));
		const retryable: V2EventEnvelope[] = [];
		const permanent: V2EventEnvelope[] = [];

		for (const rejectedEvent of rejected) {
			const event = byId.get(rejectedEvent.eventId);
			if (!event) continue;
			if (isRetryableRejectedEvent(rejectedEvent)) {
				retryable.push(event);
				continue;
			}
			permanent.push(event);
		}

		return { retryable, permanent };
	}

	private backoffDelayMs(attempt: number): number {
		const rawDelay = this.retryBaseDelayMs * 2 ** attempt;
		return Math.min(rawDelay, this.retryMaxDelayMs);
	}

	private stopTransportForAuthFailure(
		status: number,
		rejectedCount: number,
	): void {
		this.isStopped = true;
		const buffered = this.buffer.length;
		this.buffer.splice(0, buffered);
		this.logger.error(
			"[WaniWani] Auth failure (HTTP %d). Stopping tracking transport and dropping %d queued event(s)",
			status,
			rejectedCount + buffered,
		);
	}
}

function isRetryableRejectedEvent(
	rejectedEvent: V2BatchRejectedEvent,
): boolean {
	if (rejectedEvent.retryable === true) return true;
	const code = rejectedEvent.code.toLowerCase();
	return (
		code.includes("timeout") ||
		code.includes("temporary") ||
		code.includes("unavailable") ||
		code.includes("rate_limit") ||
		code.includes("transient") ||
		code.includes("server")
	);
}

async function parseJsonResponse<T>(
	response: Response,
): Promise<T | undefined> {
	const body = await response.text();
	if (!body) return undefined;
	try {
		return JSON.parse(body) as T;
	} catch {
		return undefined;
	}
}

function joinUrl(baseUrl: string, endpointPath: string): string {
	const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	const normalizedPath = endpointPath.startsWith("/")
		? endpointPath.slice(1)
		: endpointPath;
	return `${normalizedBase}${normalizedPath}`;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
