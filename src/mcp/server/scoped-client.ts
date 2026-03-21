import type { KbClient } from "../../kb/types.js";
import type { TrackInput, TrackingClient } from "../../tracking/@types.js";

/**
 * Well-known key used to attach the scoped client to the MCP `extra` object.
 * Read by `createTool` and flow compilation to surface it in handler contexts.
 */
export const SCOPED_CLIENT_KEY = "waniwani/client";

/**
 * A request-scoped WaniWani client with meta pre-attached.
 *
 * Available as `context.waniwani` inside `createTool` handlers and flow nodes
 * when the server is wrapped with `withWaniwani()`.
 */
export interface ScopedWaniWaniClient {
	/** Track an event — request meta is automatically merged. */
	track(event: TrackInput): Promise<{ eventId: string }>;
	/** Identify a user — request meta is automatically merged. */
	identify(
		userId: string,
		properties?: Record<string, unknown>,
	): Promise<{ eventId: string }>;
	/** Knowledge base client (no meta needed). */
	readonly kb: KbClient;
}

/**
 * Creates a request-scoped client that delegates to the base client
 * with request meta pre-attached to every tracking call.
 */
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
	base: Pick<TrackingClient, "track" | "identify"> & { readonly kb: KbClient },
	meta: Record<string, unknown>,
): ScopedWaniWaniClient {
	return {
		track(event) {
			return base.track({
				...event,
				meta: { ...meta, ...event.meta },
			});
		},
		identify(userId, properties) {
			return base.identify(userId, properties, meta);
		},
		kb: base.kb,
	};
}
