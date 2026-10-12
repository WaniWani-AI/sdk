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
 * interrupt) is never held at all, so it behaves exactly as it does without
 * held answers: only a value sent while the flow is asking for it counts.
 *
 * Held values sit on the session record next to `state`, in whichever store
 * the flow uses, until their question comes up or the flow completes.
 */

import type { z } from "zod";
import { resolveFieldZodType } from "./field-schema";
import {
	deepMerge,
	deleteNestedValue,
	getNestedValue,
	getObjectShape,
} from "./nested";
import { readMeta } from "./redacted";

export type HeldAnswers = {
	/** Values waiting for their question, nested the way state is. */
	values: Record<string, unknown>;
	/** Fields filled from `values` during this call. */
	applied: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
	const existing = readMeta(schema);
	const waniwani = isRecord(existing.waniwani) ? existing.waniwani : {};
	return (
		schema as unknown as { meta: (m: Record<string, unknown>) => T }
	).meta({ ...existing, waniwani: { ...waniwani, neverPrefilled: true } });
}

function isNeverPrefilled(schema: z.ZodType): boolean {
	const waniwani = readMeta(schema).waniwani;
	return isRecord(waniwani) && waniwani.neverPrefilled === true;
}

/**
 * Keep only what the state schema declares: its own top-level keys, and
 * within a `z.object` group, the members of its shape. The record never stores
 * a key no question could ask, nor a field marked `neverPrefilled()`.
 */
function keepDeclared(
	values: Record<string, unknown>,
	stateSchema: Record<string, z.ZodType>,
): Record<string, unknown> {
	const kept: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values)) {
		const schema = Object.hasOwn(stateSchema, key)
			? stateSchema[key]
			: undefined;
		if (!schema || isNeverPrefilled(schema)) {
			continue;
		}
		const shape = getObjectShape(schema);
		if (!shape || !isRecord(value)) {
			kept[key] = value;
			continue;
		}
		const members = Object.entries(value).filter(
			([member]) =>
				Object.hasOwn(shape, member) &&
				!isNeverPrefilled(shape[member] as z.ZodType),
		);
		if (members.length > 0) {
			kept[key] = Object.fromEntries(members);
		}
	}
	return kept;
}

/**
 * The hold after one call: what was held before, plus this call's values for
 * fields not asked yet, minus whatever the call answered directly (a fresh
 * answer wins over a held one).
 */
export function holdAnswers(
	previous: Record<string, unknown> | undefined,
	unasked: Record<string, unknown>,
	accepted: Record<string, unknown>,
	stateSchema: Record<string, z.ZodType>,
): Record<string, unknown> {
	// A copy: a store may hand back the record it keeps, and taking an answer
	// off the hold must not change that record before the call persists.
	const held = deepMerge(
		structuredClone(previous ?? {}),
		keepDeclared(unasked, stateSchema),
	);
	for (const [key, value] of Object.entries(accepted)) {
		if (isRecord(value) && isRecord(held[key])) {
			const group = { ...held[key] };
			for (const member of Object.keys(value)) {
				delete group[member];
			}
			held[key] = group;
			if (Object.keys(group).length === 0) {
				delete held[key];
			}
		} else {
			delete held[key];
		}
	}
	return held;
}

/** Take `field` off the hold, dropping a group it leaves empty. */
function dropHeldAnswer(held: HeldAnswers, field: string): void {
	deleteNestedValue(held.values, field);
	const group = field.split(".")[0] as string;
	const rest = held.values[group];
	if (isRecord(rest) && Object.keys(rest).length === 0) {
		delete held.values[group];
	}
}

/**
 * Take the held value for `field`, if there is one, off the hold. It is
 * returned only when it fits the field's declared schema: the model sent it
 * without seeing that schema, so a value that does not fit, or a field the
 * schema does not resolve, is dropped and the question is asked as usual.
 */
export async function takeHeldAnswer(
	held: HeldAnswers,
	field: string,
	stateSchema: Record<string, z.ZodType> | undefined,
): Promise<unknown> {
	const value = getNestedValue(held.values, field);
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	dropHeldAnswer(held, field);
	const schema = resolveFieldZodType(stateSchema, field);
	if (!schema || !(await schema.safeParseAsync(value)).success) {
		return undefined;
	}
	held.applied.push(field);
	return value;
}
