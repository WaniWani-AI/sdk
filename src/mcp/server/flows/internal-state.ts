/**
 * The session's internal state: what the engine carries for a session, as
 * opposed to the state the flow collects.
 *
 * A field is seeded when the session starts, read where the engine needs it,
 * and taken off once used. Everything that seeds, loads, takes from, or
 * persists internal state lives here, so the rest of the engine just reads
 * `internal.<field>`.
 */

import type { FlowConfig, FlowInternalState, FlowTokenContent } from "./@types";
import type { FlowStore } from "./flow-store";
import { normalizeIntro } from "./intro";

/**
 * How each internal field starts life. One entry per field: it reads the flow
 * config and returns the value a fresh session begins with, or `undefined`
 * when the flow does not use that feature.
 *
 * Adding an engine feature that remembers something at init means adding a
 * field to `FlowInternalState` and its seed here. Nothing else changes.
 */
const SEEDS: {
	[K in keyof FlowInternalState]-?: (
		config: FlowConfig,
	) => FlowInternalState[K];
} = {
	intro: (config) => normalizeIntro(config.intro, config.id),
};

/**
 * Build the internal state a fresh session begins with.
 *
 * Called once at compile time, so a malformed config fails at startup rather
 * than on a live conversation, and every new session copies the same seed.
 */
export function initInternalState(config: FlowConfig): FlowInternalState {
	const seeded = Object.entries(SEEDS)
		.map(([field, seed]) => [field, seed(config)] as const)
		.filter(([, value]) => value !== undefined);
	return Object.fromEntries(seeded) as FlowInternalState;
}

/**
 * Resolve the internal state a `start` call should run with: what the session
 * has left if it is already underway, the seed if it is not.
 *
 * The store read is skipped when the seed is empty (a flow using none of these
 * features has nothing to look up) and when the session id was minted by this
 * very call (there is no record behind it yet). A failed read falls back to the
 * seed: repeating at worst an introduction beats refusing the call.
 */
export async function loadInternalState(args: {
	store: FlowStore;
	sessionId: string | undefined;
	/** False when the engine minted the session id in this call. */
	sessionIsPreexisting: boolean;
	/** What a session that has not started yet begins with. */
	seed: FlowInternalState;
}): Promise<FlowInternalState> {
	const { store, sessionId, sessionIsPreexisting, seed } = args;

	if (Object.keys(seed).length === 0) {
		return {};
	}
	if (!sessionId || !sessionIsPreexisting) {
		return seed;
	}
	try {
		const record = await store.get(sessionId);
		return record ? (record.internal ?? {}) : seed;
	} catch {
		return seed;
	}
}

/**
 * Take one field off the session's internal state: the value to use on this
 * response, plus the state to persist without it. Absence then means the field
 * has been used, so a later call in the same conversation leaves it out.
 *
 * Fields this version does not recognize are carried through untouched, so a
 * record written by a newer engine survives a call served by an older one.
 */
export function takeInternalField<K extends keyof FlowInternalState>(
	internal: FlowInternalState | undefined,
	field: K,
): { value: FlowInternalState[K]; internal: FlowInternalState } {
	const { [field]: value, ...rest } = internal ?? {};
	return { value, internal: rest };
}

/**
 * Combine the record the engine wants to persist with the session's internal
 * state. An empty bag is left off entirely, so a flow using none of this
 * writes the same record it always did.
 */
export function withInternalState(
	tokenContent: FlowTokenContent,
	internal: FlowInternalState,
): FlowTokenContent {
	if (Object.keys(internal).length === 0) {
		return tokenContent;
	}
	return { ...tokenContent, internal };
}
