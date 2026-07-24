// ============================================================================
// Widget events: host-page subscription channel for chat lifecycle events.
//
// The embed mounts in the host page's DOM (the shadow root isolates styles
// only), so subscribers run in the page's own JS context. The host forwards
// events straight into its analytics (window.amplitude, window.analytics,
// gtag, ...) and the page's own identity is attached automatically, with no
// server-side identity plumbing. Event names are fixed and neutral; hosts
// map them to their own schema inside the callback.
//
// Message events deliberately carry no message content: the host learns THAT
// a message was exchanged, never what was said.
// ============================================================================

/** Surface the widget is mounted on. */
export type WidgetMode = "inline" | "floating";

interface WidgetEventBase {
	/** Surface the widget is mounted on. */
	mode: WidgetMode;
	/**
	 * Conversation session id, when one exists. Assigned on the first
	 * exchange, so it is `undefined` for events that precede it.
	 */
	sessionId?: string;
	/** Epoch milliseconds at emit time. */
	timestamp: number;
}

/**
 * Per-event discriminant and extra properties. Events in the first branch
 * carry no `properties` object.
 */
export type WidgetEventDetail =
	| {
			name:
				| "chat.ready"
				| "chat.opened"
				| "chat.closed"
				| "message.sent"
				| "message.received";
	  }
	| { name: "session.started"; properties: { sessionId: string } }
	| { name: "thread.changed"; properties: { threadId: string } }
	| { name: "chat.error"; properties: { message: string } }
	| { name: "suggestion.clicked"; properties: { text: string; index: number } }
	| { name: "link.clicked"; properties: { url: string } };

/** Payload handed to `onEvent` subscribers. Discriminated on `name`. */
export type WidgetEvent = WidgetEventBase & WidgetEventDetail;

export type WidgetEventName = WidgetEventDetail["name"];

/**
 * `emit()` input: the event detail, plus an optional explicit session id for
 * call sites that hold a fresher value than the live getter (e.g. the engine
 * emitting in the same tick a session id is assigned, restored, or cleared).
 * A present `sessionId` key is authoritative even when its value is
 * `undefined` — the live getter reads React state and lags same-tick
 * mutations. `session.started` derives its top-level `sessionId` from
 * `properties.sessionId` when no explicit override is given.
 */
export type WidgetEventInput = WidgetEventDetail & { sessionId?: string };

export interface WidgetEventEmitter {
	/** Register a listener. Returns its unsubscribe function. */
	subscribe: (listener: (event: WidgetEvent) => void) => () => void;
	/** Build the full event (mode, timestamp, session id) and fan it out. */
	emit: (input: WidgetEventInput) => void;
}

export interface CreateWidgetEventEmitterOptions {
	mode: WidgetMode;
	/** Live session id, read at emit time. */
	getSessionId?: () => string | undefined;
}

/**
 * Per-mount emitter. Every listener is isolated: an exception in one
 * subscriber is swallowed with a console warning and never breaks the widget
 * nor the other subscribers.
 */
export function createWidgetEventEmitter(
	options: CreateWidgetEventEmitterOptions,
): WidgetEventEmitter {
	const listeners = new Set<(event: WidgetEvent) => void>();
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		emit(input) {
			const { sessionId: explicitSessionId, ...detail } = input;
			const derivedSessionId =
				input.name === "session.started"
					? input.properties.sessionId
					: undefined;
			const event: WidgetEvent = {
				...detail,
				mode: options.mode,
				sessionId: Object.hasOwn(input, "sessionId")
					? explicitSessionId
					: (derivedSessionId ?? options.getSessionId?.()),
				timestamp: Date.now(),
			};
			// Snapshot so listener-triggered subscribe/unsubscribe during emit
			// cannot skip peers or receive the in-flight event; mutations apply
			// from the next emit.
			for (const listener of [...listeners]) {
				try {
					listener(event);
				} catch (err) {
					console.warn("[Waniwani] onEvent subscriber threw:", err);
				}
			}
		},
	};
}

/** Inert emitter — the context default when no provider is mounted. */
export function createNoopWidgetEventEmitter(): WidgetEventEmitter {
	return {
		subscribe() {
			return () => {};
		},
		emit() {},
	};
}
