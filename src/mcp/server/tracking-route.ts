/**
 * Server-side API route handler for frontend tracking events.
 *
 * Receives V2 batch payloads from the SDK's frontend tracking client
 * (`createFrontendClient`, `useWaniwani`, `chat.track`) configured with your
 * own endpoint, and forwards them to the Waniwani backend with the secret
 * API key. Use this proxy when you do not want any Waniwani credential in
 * the browser; the direct path (public token or widget JWT) needs no route.
 *
 * @example Next.js App Router
 * ```typescript
 * // app/api/waniwani/track/route.ts
 * import { createTrackingRoute } from "@waniwani/sdk/mcp";
 *
 * const handler = createTrackingRoute({
 *   apiKey: process.env.WANIWANI_API_KEY,
 *   apiUrl: process.env.WANIWANI_API_URL,
 * });
 *
 * export { handler as POST };
 * ```
 */

import type { EventType, TrackInput } from "../../tracking/@types.js";
import type { V2EventEnvelope } from "../../tracking/v2-types.js";
import type { WaniWaniConfig } from "../../types.js";
import { waniwani } from "../../waniwani.js";

export interface TrackingRouteOptions {
	/** API key for the Waniwani backend. Defaults to WANIWANI_API_KEY env var. */
	apiKey?: string;
	/** Base URL for the Waniwani backend. Defaults to https://app.waniwani.ai. */
	apiUrl?: string;
}

/** Batch payload sent by the frontend tracking client (the V2 batch shape). */
interface BatchPayload {
	events: Partial<V2EventEnvelope>[];
	sentAt?: string;
}

/**
 * Map an incoming V2 envelope back to the SDK's TrackInput so the server
 * client re-validates, re-maps, and batches it like any other event.
 */
function mapEnvelope(envelope: Partial<V2EventEnvelope>): TrackInput {
	return {
		event: (envelope.name ?? "widget_render") as EventType,
		properties: envelope.properties,
		metadata: envelope.metadata,
		sessionId: envelope.correlation?.sessionId,
		traceId: envelope.correlation?.traceId,
		requestId: envelope.correlation?.requestId,
		correlationId: envelope.correlation?.correlationId,
		externalUserId: envelope.correlation?.externalUserId,
		visitorId: envelope.correlation?.visitorId,
		eventId: envelope.id,
		timestamp: envelope.timestamp,
		source: envelope.source,
	} as TrackInput;
}

/**
 * Creates a POST handler that receives frontend tracking batches and
 * forwards them to the Waniwani backend.
 */
export function createTrackingRoute(options?: TrackingRouteOptions) {
	const config: WaniWaniConfig = {
		apiKey: options?.apiKey,
		apiUrl: options?.apiUrl,
	};

	// Lazy singleton — created on first request
	let client: ReturnType<typeof waniwani> | undefined;

	function getClient() {
		if (!client) {
			client = waniwani(config);
		}
		return client;
	}

	return async function handler(request: Request): Promise<Response> {
		let body: BatchPayload;
		try {
			body = (await request.json()) as BatchPayload;
		} catch {
			return new Response(JSON.stringify({ error: "Invalid JSON" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		if (!Array.isArray(body.events) || body.events.length === 0) {
			return new Response(
				JSON.stringify({ error: "Missing or empty events array" }),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		try {
			const c = getClient();
			const results: string[] = [];

			for (const envelope of body.events) {
				const result = await c.track(mapEnvelope(envelope));
				results.push(result.eventId);
			}

			await c.flush();

			return new Response(
				JSON.stringify({ ok: true, accepted: results.length }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			return new Response(JSON.stringify({ error: message }), {
				status: 500,
				headers: { "Content-Type": "application/json" },
			});
		}
	};
}
