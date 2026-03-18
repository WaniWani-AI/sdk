/**
 * Server-side API route handler for widget tracking events.
 *
 * Receives batched events from the `useWaniwani` React hook and forwards them
 * to the WaniWani backend using the server-side SDK.
 *
 * @example Next.js App Router
 * ```typescript
 * // app/api/waniwani/track/route.ts
 * import { createTrackingRoute } from "@waniwani/sdk/mcp";
 *
 * const handler = createTrackingRoute({
 *   apiKey: process.env.WANIWANI_API_KEY,
 *   baseUrl: process.env.WANIWANI_BASE_URL,
 * });
 *
 * export { handler as POST };
 * ```
 */

import type { EventType, TrackInput } from "../../tracking/@types.js";
import type { WaniWaniConfig } from "../../types.js";
import { waniwani } from "../../waniwani.js";

export interface TrackingRouteOptions {
	/** API key for the WaniWani backend. Defaults to WANIWANI_API_KEY env var. */
	apiKey?: string;
	/** Base URL for the WaniWani backend. Defaults to https://app.waniwani.ai. */
	baseUrl?: string;
}

/** Shape of a single event from the WidgetTransport client. */
interface WidgetEventPayload {
	event_id?: string;
	event_type?: string;
	timestamp?: string;
	source?: string;
	session_id?: string;
	trace_id?: string;
	user_id?: string;
	event_name?: string;
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
}

/** Batch payload sent by WidgetTransport. */
interface BatchPayload {
	events: WidgetEventPayload[];
	sentAt?: string;
}

/**
 * Map a WidgetEvent from the client to the SDK's TrackInput format.
 */
function mapWidgetEvent(ev: WidgetEventPayload): TrackInput {
	const eventType = ev.event_type ?? "widget_click";

	// For manual tracking methods (track, identify, step, conversion),
	// use "widget_<type>" as the event name. Auto-capture events already
	// have the "widget_" prefix.
	const isAutoCapture = eventType.startsWith("widget_");
	const eventName: EventType = (
		isAutoCapture ? eventType : `widget_${eventType}`
	) as EventType;

	// Merge metadata + any extra properties from the event
	const properties: Record<string, unknown> = {
		...(ev.metadata ?? {}),
	};
	if (ev.event_name) {
		properties.event_name = ev.event_name;
	}

	return {
		event: eventName,
		properties,
		sessionId: ev.session_id,
		traceId: ev.trace_id,
		externalUserId: ev.user_id,
		eventId: ev.event_id,
		timestamp: ev.timestamp,
		source: ev.source ?? "widget",
	} as TrackInput;
}

/**
 * Creates a POST handler that receives tracking events from `useWaniwani`
 * and forwards them to the WaniWani backend.
 */
export function createTrackingRoute(options?: TrackingRouteOptions) {
	const config: WaniWaniConfig = {
		apiKey: options?.apiKey,
		baseUrl: options?.baseUrl,
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

			for (const ev of body.events) {
				const trackInput = mapWidgetEvent(ev);
				const result = await c.track(trackInput);
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
