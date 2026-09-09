import type { WidgetMode } from "../embed/widget-events";
import { platformEndpoint } from "./api-url";
import { debugLog } from "./debug";
import { collectVisitorContext } from "./visitor-context";

const EVENTS_PATH = "/api/mcp/events/v2/batch";

export interface FirePageViewOptions {
	api: string;
	/** Public token (`wwp_...`). */
	token: string;
	channelId?: string;
	mode?: WidgetMode;
	/** Channel-specific event source from the resolved `/config`, sent as the event's `source` tag. Omitted entirely when the channel has none; attribution then rides on `properties.channelId`. */
	source?: string;
}

// One landing per (api|token|channelId) per page: StrictMode double-mounts, and an inline plus a floating widget share a channel.
const fired = new Set<string>();

function dedupeKey(api: string, token: string, channelId?: string): string {
	return `${api}|${token}|${channelId ?? ""}`;
}

/** The canonical V2 batch ingest, resolved against the platform origin `api` sits on. `null` off the platform, where no such route exists. */
export function eventsEndpoint(api: string): string | null {
	return platformEndpoint(api, EVENTS_PATH);
}

/** Fire-and-forget: resolves once the request is dispatched (or skipped) and never throws, so a tracking failure stays away from the host page. */
export async function firePageView(opts: FirePageViewOptions): Promise<void> {
	const { api, token, channelId, mode, source } = opts;
	if (typeof window === "undefined" || !api || !token) {
		return;
	}

	const endpoint = eventsEndpoint(api);
	if (!endpoint) {
		debugLog("page.viewed skipped: the chat api is not a Waniwani endpoint");
		return;
	}

	// Ingest attributes to a channel via `properties.channelId` or the `source` tag, and this event carries no session, so with neither in hand it is dropped server-side.
	// Skipping precedes the once-per-page guard, so a later call that resolves a channel still fires.
	if (!channelId && !source) {
		debugLog("page.viewed skipped: no channelId or source to attribute it");
		return;
	}

	const key = dedupeKey(api, token, channelId);
	if (fired.has(key)) {
		return;
	}
	fired.add(key);

	try {
		const ctx = await collectVisitorContext();
		const now = new Date().toISOString();

		// The anonymous device id is the whole identity: a landing mints no session, which keeps "landed" and "started a conversation" separate in the funnel.
		const body = JSON.stringify({
			sentAt: now,
			source: { sdk: "@waniwani/sdk", version: "0.1.0" },
			events: [
				{
					id: crypto.randomUUID(),
					type: "mcp.event",
					name: "page.viewed",
					source,
					timestamp: now,
					correlation: { visitorId: ctx.visitorId },
					properties: {
						channelId,
						mode,
						url: window.location.href,
						referrer: ctx.referrer,
						deviceType: ctx.deviceType,
						language: ctx.language,
						timezone: ctx.timezone,
					},
					metadata: {},
				},
			],
		});

		await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body,
			// Survive the request even if the user navigates away right after load.
			keepalive: true,
		});
	} catch {
		// Roll back the guard so a transient failure can retry on the next mount.
		fired.delete(key);
	}
}

/** Test-only: reset the once-per-page guard. */
export function __resetPageViewGuard(): void {
	fired.clear();
}
