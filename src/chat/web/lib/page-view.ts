// ============================================================================
// Page-view event — fired once when the chat widget initializes on a host page.
//
// This is the top of the conversion funnel: "X people landed where the widget
// is" vs "Y started a conversation". It is attributed to the anonymous
// `visitorId` (sent as `correlation.visitorId`), and deliberately carries NO
// session — a page view must not create a session, otherwise sessions would
// equal page views and the funnel collapses.
//
// It goes to the SAME canonical ingest every other event uses
// (`POST /api/mcp/events/v2/batch`, the V2 batch envelope), authenticated with
// the public `wwp_` token the widget already holds for `/chat` and `/config`.
// No widget JWT is involved: that only exists for MCP-App widgets which have no
// public token. The chat widget has one, and it identifies the channel.
// ============================================================================

import { collectVisitorContext } from "./visitor-context";

export interface FirePageViewOptions {
	/** Chat API base, e.g. `https://app.waniwani.ai/api/mcp/chat`. */
	api: string;
	/** Public token (`wwp_...`). */
	token: string;
	/** Agent channel ID, when known. */
	channelId?: string;
	/** Embed mode the widget initialized in. */
	mode?: "inline" | "floating";
	/**
	 * Channel-specific event source from the resolved `/config`, used as the
	 * event's `source` tag so events can be sliced by channel. Optional: the
	 * event attributes to its channel via `properties.channelId` regardless, so
	 * a channel with no configured source still records page views. Omitted from
	 * the event entirely when blank.
	 */
	source?: string;
}

// Fire-at-most-once per (api|token|channelId) for the lifetime of the page.
// Guards against React StrictMode's double-mount, repeat mounts, and an inline
// + floating widget sharing the same channel from double-counting a landing.
const fired = new Set<string>();

function dedupeKey(api: string, token: string, channelId?: string): string {
	return `${api}|${token}|${channelId ?? ""}`;
}

/**
 * Derive the canonical V2 batch ingest URL from the chat `api` base. The chat
 * api is a full path (`.../api/mcp/chat`); events live as a sibling at
 * `.../api/mcp/events/v2/batch`, same as `injectWidgetConfig` builds it
 * server-side. Falls back to a suffix swap for non-standard bases.
 */
function eventsEndpoint(api: string): string {
	try {
		return `${new URL(api).origin}/api/mcp/events/v2/batch`;
	} catch {
		return api.replace(/\/$/, "").replace(/\/chat$/, "/events/v2/batch");
	}
}

/**
 * Emit a `page.viewed` event for the current widget load. Fire-and-forget:
 * resolves once the request is dispatched (or skipped) and never throws —
 * tracking must never break the host page or the widget.
 */
export async function firePageView(opts: FirePageViewOptions): Promise<void> {
	const { api, token, channelId, mode, source } = opts;
	if (typeof window === "undefined" || !api || !token) {
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

		// V2 batch envelope — identical shape to WidgetTransport's `buildV2Batch`,
		// so this lands in the same ingest pipeline as every other event. The
		// anonymous device id is the identity (`correlation` carries no sessionId);
		// the server stores it in its own `visitor_id` column, never PII-hashed,
		// separate from the identified-user `externalUserId`.
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

		await fetch(eventsEndpoint(api), {
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
