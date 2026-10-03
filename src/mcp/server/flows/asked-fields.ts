/**
 * The fields a run has asked for, and the gate that keeps every other key out
 * of `stateUpdates`.
 *
 * A flow's tool listing carries no state schema. Each question names its
 * `field` (with a `fieldSchema`) in the response that asks it, and the same
 * rule decides what a call may write: a value is accepted only for a
 * field this run has asked for. Fields the flow computes for itself (a lookup
 * id, a quote) are never asked, so the conversation cannot set them.
 */

import type { FlowContent } from "./@types";
import { expandDotPaths } from "./nested";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
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
 * Keep only the values for fields in `asked`. Dot-paths are expanded first, so
 * `{ "driver.name": … }` and `{ driver: { name: … } }` are judged alike. A
 * question on a whole group (`driver`) accepts every key inside it; a question
 * on one member (`driver.name`) accepts that member alone.
 */
export function keepAskedFields(
	updates: Record<string, unknown> | undefined,
	asked: readonly string[],
): Record<string, unknown> {
	const askedSet = new Set(asked);
	const kept: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(expandDotPaths(updates ?? {}))) {
		if (askedSet.has(key)) {
			kept[key] = value;
			continue;
		}
		if (!isRecord(value)) {
			continue;
		}
		const members = Object.entries(value).filter(([member]) =>
			askedSet.has(`${key}.${member}`),
		);
		if (members.length > 0) {
			kept[key] = Object.fromEntries(members);
		}
	}
	return kept;
}
