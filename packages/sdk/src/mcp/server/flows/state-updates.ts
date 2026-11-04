/**
 * Which `stateUpdates` values a call may write, and the fields a run has asked.
 *
 * The tool listing names no state field. The session's first question or
 * widget lists them in `fields` (see `listStateFields`), and each question
 * names its own field again with a `fieldSchema`. A call may write:
 *
 * - the answer to a field the run has asked, as sent;
 * - any other declared field, or member of a `z.object` group, whose value
 *   fits the field's schema. The flow then skips the question that would ask
 *   it, and a field no question asks (a classification the opener implies, a
 *   locale) can be set at all.
 *
 * A field marked `neverPrefilled()` takes a value only once the run has asked
 * it, and `fields` leaves it out: a consent, an attestation, a widget pick
 * that must happen on screen.
 *
 * Every other state field is listed and writable. A value the conversation
 * must never set (a lookup id, a price the user must not choose) stays out of
 * `state`: the node that needs it computes it, or keeps it in a server-side
 * store keyed by `ctx.sessionId`.
 */

import type { z } from "zod";
import type { FieldSchemaInfo, FlowContent } from "./@types";
import { hasFieldMark, markField } from "./field-marks";
import { introspectField } from "./field-schema";
import { expandDotPaths, getObjectShape, isRecord } from "./nested";

type StateSchema = Record<string, z.ZodType>;

/**
 * Mark a state field the conversation may only fill when the flow asks for
 * it, such as a consent, an attestation, or a widget pick that must happen on
 * screen. A value sent before that question came up is dropped, and the
 * session's `fields` listing leaves the field out.
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

function isPrefillable(schema: z.ZodType): boolean {
	return !hasFieldMark(schema, "neverPrefilled");
}

/** The fields one response asks the user, or a widget, to fill. */
export function fieldsAskedBy(content: FlowContent): string[] {
	if (content.status === "interrupt") {
		if (content.questions) {
			return content.questions.map((q) => q.field);
		}
		return content.field ? [content.field] : [];
	}
	if (content.status === "widget" && content.field) {
		return [content.field];
	}
	return [];
}

/** The run's asked fields once `content` has gone out. */
export function addAskedFields(
	asked: readonly string[],
	content: FlowContent,
): string[] {
	return [...new Set([...asked, ...fieldsAskedBy(content)])];
}

/**
 * Every field a call may fill before its question comes up, keyed the way
 * `stateUpdates` takes it: a top-level field by name, a member of a
 * `z.object` group as a dot-path. Returns `undefined` when there is none.
 */
export function listStateFields(
	stateSchema: StateSchema | undefined,
): Record<string, FieldSchemaInfo> | undefined {
	const listed: Record<string, FieldSchemaInfo> = {};
	for (const [key, schema] of Object.entries(stateSchema ?? {})) {
		if (!isPrefillable(schema)) {
			continue;
		}
		const shape = getObjectShape(schema);
		if (!shape) {
			listed[key] = introspectField(schema);
			continue;
		}
		for (const [member, memberSchema] of Object.entries(shape)) {
			if (isPrefillable(memberSchema)) {
				listed[`${key}.${member}`] = introspectField(memberSchema);
			}
		}
	}
	return Object.keys(listed).length > 0 ? listed : undefined;
}

async function prefills(
	schema: z.ZodType | undefined,
	value: unknown,
): Promise<boolean> {
	return (
		schema !== undefined &&
		isPrefillable(schema) &&
		(await schema.safeParseAsync(value)).success
	);
}

/**
 * The part of `updates` a call writes to state. Dot-paths are expanded first,
 * so `{ "driver.name": … }` and `{ driver: { name: … } }` are judged alike. A
 * question on a whole group (`driver`) accepts every key inside it, and a
 * question on one member (`driver.name`) accepts that member as sent.
 *
 * A record written before the engine tracked asked fields has no `asked`, so
 * that one call merges everything rather than drop the answer to a question
 * it has no record of.
 */
export async function acceptStateUpdates({
	updates,
	asked,
	stateSchema,
}: {
	updates: Record<string, unknown> | undefined;
	asked: readonly string[] | undefined;
	stateSchema: StateSchema | undefined;
}): Promise<Record<string, unknown>> {
	const expanded = expandDotPaths(updates ?? {});
	if (!asked) {
		return expanded;
	}
	const askedSet = new Set(asked);
	const declared = (key: string, schema: Record<string, z.ZodType>) =>
		Object.hasOwn(schema, key) ? schema[key] : undefined;

	const accepted: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(expanded)) {
		if (askedSet.has(key)) {
			accepted[key] = value;
			continue;
		}
		const schema = declared(key, stateSchema ?? {});
		const shape = schema ? getObjectShape(schema) : null;
		if (!schema || !shape || !isRecord(value)) {
			if (await prefills(schema, value)) {
				accepted[key] = value;
			}
			continue;
		}
		const members: Record<string, unknown> = {};
		for (const [member, memberValue] of Object.entries(value)) {
			if (
				askedSet.has(`${key}.${member}`) ||
				(isPrefillable(schema) &&
					(await prefills(declared(member, shape), memberValue)))
			) {
				members[member] = memberValue;
			}
		}
		if (Object.keys(members).length > 0) {
			accepted[key] = members;
		}
	}
	return accepted;
}
