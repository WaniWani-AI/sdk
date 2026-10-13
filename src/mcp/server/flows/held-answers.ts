/**
 * Answers the user gave before the flow asked for them.
 *
 * `continue` and `reset` merge only fields the run has asked (see
 * `asked-fields.ts`), so a field the flow computes can never be written from
 * the conversation. A user who opens with six answers still means all six, so
 * the values for fields not asked yet are held on the session record instead
 * of dropped. When an interrupt question comes up for one of them, the engine
 * fills it from the hold and runs its validator, exactly as if the user had
 * answered it there, and the model never has to resend it.
 *
 * The gate is unchanged: a held value only reaches state through a question
 * the flow itself asks. A field no question asks (a lookup id, a price) stays
 * held and is never applied, and a widget's field is never filled this way,
 * since a widget step is an explicit pick or agreement on screen. A field
 * marked with `neverPrefilled()` (a consent or attestation asked as an
 * interrupt) is never held at all, so only a value sent while the flow is
 * asking for it counts.
 *
 * Held values sit on the session record next to `state`, in whichever store
 * the flow uses, until their question comes up or the flow completes.
 */

import type { z } from "zod";
import type { InterruptQuestion } from "./@types";
import { hasFieldMark, markField } from "./field-marks";
import { resolveFieldZodType } from "./field-schema";
import {
	deepMerge,
	deleteNestedValue,
	expandDotPaths,
	getNestedValue,
	getObjectShape,
	isFilled,
	isRecord,
} from "./nested";

export type HeldAnswers = {
	/** Values waiting for their question, nested the way state is. */
	values: Record<string, unknown>;
	/** Fields filled from `values` during this call. */
	applied: string[];
};

/**
 * Mark a state field the user has to answer when the flow asks for it, such as
 * a consent or an attestation asked through `interrupt`. An answer given
 * before that question came up is never held for it, so it is never filled
 * without the question going out.
 *
 * ```ts
 * shareConsent: neverPrefilled(z.boolean().describe("Agrees to share data with partners")),
 * ```
 *
 * Like `redacted()`, apply it at the end of the schema chain. The two combine.
 */
export function neverPrefilled<T extends z.ZodType>(schema: T): T {
	return markField(schema, "neverPrefilled");
}

function isHoldable(schema: z.ZodType | undefined): schema is z.ZodType {
	return schema !== undefined && !hasFieldMark(schema, "neverPrefilled");
}

/**
 * The part of `values` the hold may keep: the state schema's own fields and,
 * within a `z.object` group, the members of its shape, minus any field marked
 * `neverPrefilled()`. The record never stores a key no question could ask.
 */
export function holdableAnswers(
	values: Record<string, unknown>,
	stateSchema: Record<string, z.ZodType>,
): Record<string, unknown> {
	const holdable: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values)) {
		const schema = Object.hasOwn(stateSchema, key)
			? stateSchema[key]
			: undefined;
		if (!isHoldable(schema)) {
			continue;
		}
		const shape = getObjectShape(schema);
		if (!shape || !isRecord(value)) {
			holdable[key] = value;
			continue;
		}
		const members = Object.entries(value).filter(
			([member]) => Object.hasOwn(shape, member) && isHoldable(shape[member]),
		);
		if (members.length > 0) {
			holdable[key] = Object.fromEntries(members);
		}
	}
	return holdable;
}

/** Remove `path` from `values`, and the group it leaves empty. */
function release(values: Record<string, unknown>, path: string): void {
	deleteNestedValue(values, path);
	const [group = path] = path.split(".");
	const rest = values[group];
	if (isRecord(rest) && Object.keys(rest).length === 0) {
		delete values[group];
	}
}

/**
 * The hold for one call: what was held before, plus this call's `holdable`
 * values, minus whatever it `answered` directly (a fresh answer wins over a
 * held one).
 */
export function holdAnswers({
	previous = {},
	holdable = {},
	answered = {},
}: {
	previous?: Record<string, unknown>;
	holdable?: Record<string, unknown>;
	answered?: Record<string, unknown>;
}): HeldAnswers {
	// A copy: a store may hand back the record it keeps, and taking an answer
	// off the hold must not change that record before the call persists.
	const values = deepMerge(structuredClone(previous), holdable);
	for (const [key, value] of Object.entries(answered)) {
		const paths =
			isRecord(value) && isRecord(values[key])
				? Object.keys(value).map((member) => `${key}.${member}`)
				: [key];
		for (const path of paths) {
			release(values, path);
		}
	}
	return { values, applied: [] };
}

/**
 * Fill each open question that has a held answer, and return the new state.
 * A held value is used only when it fits the field's declared schema: the
 * model sent it without seeing that schema, so a value that does not fit, or
 * a field the schema does not resolve, is dropped and the question is asked
 * as usual. Either way it leaves the hold.
 */
export async function fillFromHold<TState extends Record<string, unknown>>({
	questions,
	state,
	held,
	stateSchema,
}: {
	questions: InterruptQuestion[];
	state: TState;
	held: HeldAnswers;
	stateSchema: Record<string, z.ZodType> | undefined;
}): Promise<TState> {
	let filled: Record<string, unknown> = state;
	for (const { field } of questions) {
		const value = getNestedValue(held.values, field);
		if (!isFilled(value)) {
			continue;
		}
		// Taken either way: a field already filled keeps its value, and a held
		// one left behind would refill it if a node later cleared it to ask again.
		release(held.values, field);
		if (isFilled(getNestedValue(filled, field))) {
			continue;
		}
		const schema = resolveFieldZodType(stateSchema, field);
		if (!schema || !(await schema.safeParseAsync(value)).success) {
			continue;
		}
		filled = deepMerge(filled, expandDotPaths({ [field]: value }));
		held.applied.push(field);
	}
	return filled as TState;
}
