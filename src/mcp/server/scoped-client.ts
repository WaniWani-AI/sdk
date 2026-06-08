import type { KbClient } from "../../kb/types.js";
import type {
	CallableTrack,
	TrackFn,
	TrackInput,
	TrackingClient,
} from "../../tracking/@types.js";
import { createRevenueApi } from "../../tracking/revenue.js";
import { createEmailModule } from "./modules/email/index.js";
import type { ModulesContext } from "./modules/index.js";

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
	/**
	 * Pre-built integrations for MCP flows.
	 * Requires `projectId` in `waniwani.json` to be set.
	 */
	readonly modules: ModulesContext;
	/** @internal Resolved API config from withWaniwani(). */
	readonly _config?: { apiUrl?: string; apiKey?: string; projectId?: string };
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
	config?: { apiUrl?: string; apiKey?: string; projectId?: string },
): ScopedWaniWaniClient {
	const trackOnce = (event: TrackInput): Promise<{ eventId: string }> =>
		base.track({ ...event, meta: { ...meta, ...event.meta } });

	const modules: ModulesContext = {
		email:
			config?.apiUrl && config?.apiKey && config?.projectId
				? createEmailModule({
						apiUrl: config.apiUrl,
						apiKey: config.apiKey,
						projectId: config.projectId,
					})
				: {
						send: () =>
							Promise.reject(
								new Error(
									"Email module unavailable: missing apiUrl, apiKey, or projectId in config. " +
										"Set projectId in waniwani.json to enable modules.",
								),
							),
					},
	};

	return {
		track: Object.assign(trackOnce, createRevenueApi(trackOnce)),
		identify(userId, properties) {
			return base.identify(userId, properties, meta);
		},
		kb: base.kb,
		modules,
		_config: config,
	};
}
