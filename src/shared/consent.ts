/**
 * The visitor's storage and measurement consent, as the host site's consent
 * banner (CMP) reports it.
 *
 * - `"granted"` (default): the widget persists its visitor ids on the device
 *   and fires `page.viewed` on load.
 * - `"pending"`: the banner has not been answered. Ids live in memory for this
 *   page only, nothing is read from or written to device storage for them, and
 *   `page.viewed` is held until the answer arrives.
 * - `"denied"`: same as pending, the held `page.viewed` is dropped, and ids a
 *   previous grant persisted are deleted.
 *
 * The chat itself works in every state: a conversation the visitor starts is a
 * service they asked for, so it runs on the in-memory ids.
 *
 * Module state, shared by every surface in the bundle, so the embed, the React
 * chat and the WebMCP bridge all read one answer.
 */

export type Consent = "granted" | "pending" | "denied";

const CONSENT_VALUES: readonly Consent[] = ["granted", "pending", "denied"];

let current: Consent = "granted";
const listeners = new Set<(consent: Consent) => void>();

export function isConsent(value: unknown): value is Consent {
	return CONSENT_VALUES.some((consent) => consent === value);
}

export function getConsent(): Consent {
	return current;
}

/** Whether the widget may keep identifiers on the device. */
export function hasStorageConsent(): boolean {
	return current === "granted";
}

/**
 * Apply the visitor's answer. An unknown value is ignored and keeps the current
 * state, so a typo in a CMP callback never widens what the widget stores.
 * Returns the effective state.
 */
export function setConsent(next: Consent): Consent {
	if (!isConsent(next) || next === current) {
		return current;
	}
	current = next;
	for (const listener of listeners) {
		try {
			listener(next);
		} catch {
			// One failing listener must not stop the others.
		}
	}
	return current;
}

/** Subscribe to consent changes. Returns the unsubscribe function. */
export function onConsentChange(
	listener: (consent: Consent) => void,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
