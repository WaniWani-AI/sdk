// ============================================================================
// Widget events: host-page callback for chat lifecycle events.
//
// The embed mounts in the host page's DOM (the shadow root isolates styles
// only), so an `onEvent` callback runs in the page's own JS context. That is
// the whole point: the host can forward events straight into its analytics
// (`window.analytics.track(...)` for Segment, gtag, etc.) and the page's own
// identity (e.g. Segment's anonymousId) is attached automatically, with no
// server-side identity plumbing needed.
//
// Message events deliberately carry no message content: the host learns THAT
// a message was exchanged, never what was said.
// ============================================================================

/** Names of the lifecycle events the widget reports to `onEvent`. */
export type WidgetEventName =
	| "chat.opened"
	| "chat.closed"
	| "message.sent"
	| "message.received";

/** Payload handed to the host page's `onEvent` callback. */
export interface WidgetEvent {
	name: WidgetEventName;
	/**
	 * Conversation session id, when one exists. Assigned by the server on the
	 * first exchange, so it is `undefined` for events that precede it (e.g. the
	 * first `message.sent` and any `chat.opened` before a conversation starts).
	 */
	sessionId?: string;
	/** Extra event data (e.g. the embed `mode`). Never includes message text. */
	properties?: Record<string, unknown>;
}

/**
 * Invoke the host page's `onEvent` callback, if configured. Exceptions are
 * swallowed (with a console warning): a broken host callback must never
 * break the widget.
 */
export function emitWidgetEvent(
	onEvent: ((event: WidgetEvent) => void) | undefined,
	event: WidgetEvent,
): void {
	if (!onEvent) {
		return;
	}
	try {
		onEvent(event);
	} catch (err) {
		console.warn("[Waniwani] onEvent callback threw:", err);
	}
}
