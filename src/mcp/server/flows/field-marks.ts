import type { z } from "zod";
import { isRecord } from "./nested";

/**
 * Flags a flow attaches to a state field's schema, such as `redacted()` and
 * `neverPrefilled()`. They live under `waniwani` in Zod v4's `.meta()`
 * registry, so a flag survives schema clones (`.optional()`, `.default()`,
 * etc.) and several flags combine on one field.
 */

function readMeta(schema: z.ZodType): Record<string, unknown> {
	const metaFn = (schema as unknown as { meta?: () => unknown }).meta;
	if (typeof metaFn !== "function") {
		return {};
	}
	const value = metaFn.call(schema);
	return isRecord(value) ? value : {};
}

/** A copy of `schema` carrying `mark`, alongside any flag already set. */
export function markField<T extends z.ZodType>(schema: T, mark: string): T {
	const existing = readMeta(schema);
	const waniwani = isRecord(existing.waniwani) ? existing.waniwani : {};
	return (
		schema as unknown as { meta: (m: Record<string, unknown>) => T }
	).meta({ ...existing, waniwani: { ...waniwani, [mark]: true } });
}

export function hasFieldMark(schema: z.ZodType, mark: string): boolean {
	const waniwani = readMeta(schema).waniwani;
	return isRecord(waniwani) && waniwani[mark] === true;
}
