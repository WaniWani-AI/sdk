import type { KbClient } from "../../kb/types.js";
import type {
	CallableTrack,
	TrackFn,
	TrackInput,
	TrackingClient,
} from "../../tracking/@types.js";
import { createRevenueApi } from "../../tracking/revenue.js";
import { extractSessionId } from "./utils.js";

/**
 * Well-known key used to attach the scoped client to the MCP `extra` object.
 * Read by `createTool` and flow compilation to surface it in handler contexts.
 */
export const SCOPED_CLIENT_KEY = "waniwani/client";

/**
 * A request-scoped Waniwani client with meta pre-attached.
 *
 * Available as `context.waniwani` inside `createTool` handlers and flow nodes
 * when the server is wrapped with `withWaniwani()`.
 */
export interface ScopedWaniWaniClient {
	/**
	 * The session id this request's events correlate to, resolved from the
	 * request meta. Read it to link the session to your own records (store it
	 * on a lead, then send an off-platform `converted` with the same
	 * `sessionId` later). `undefined` when the host provided no session id.
	 */
	readonly sessionId?: string;
	/**
	 * Track an event — request meta is automatically merged. Also exposes the
	 * revenue helpers flat (`track.priceShown()`, `track.converted()`, …), which
	 * inherit the same scoped meta (so identity is carried from the request).
	 */
	track: TrackFn;
	/** Identify a user — request meta is automatically merged. */
	identify(
		userId: string,
		properties?: Record<string, unknown>,
	): Promise<{ eventId: string }>;
	/** Knowledge base client (no meta needed). */
	readonly kb: KbClient;
	/** @internal Resolved API config from withWaniwani(). */
	readonly _config?: { apiUrl?: string; apiKey?: string };
}

/**
 * Extract the scoped client from the MCP `extra` object.
 * Returns undefined if `withWaniwani()` is not wrapping the server.
 */
export function extractScopedClient(
	extra: unknown,
): ScopedWaniWaniClient | undefined {
	if (typeof extra === "object" && extra !== null) {
		return (extra as Record<string, unknown>)[SCOPED_CLIENT_KEY] as
			| ScopedWaniWaniClient
			| undefined;
	}
	return undefined;
}

export function createScopedClient(
	base: { track: CallableTrack; identify: TrackingClient["identify"] } & {
		readonly kb: KbClient;
	},
	meta: Record<string, unknown>,
	config?: { apiUrl?: string; apiKey?: string },
): ScopedWaniWaniClient {
	const trackOnce = (event: TrackInput): Promise<{ eventId: string }> =>
		base.track({ ...event, meta: { ...meta, ...event.meta } });

	return {
		sessionId: extractSessionId(meta),
		track: Object.assign(trackOnce, createRevenueApi(trackOnce)),
		identify(userId, properties) {
			return base.identify(userId, properties, meta);
		},
		kb: base.kb,
		_config: config,
	};
}
