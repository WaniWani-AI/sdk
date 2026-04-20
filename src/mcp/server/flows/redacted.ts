import type { z } from "zod";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Mark a Zod schema as PII — its value will be replaced with `"REDACTED"` in
 * any `tool.called` event payload sent to the WaniWani API. The handler still
 * receives the original value; only the tracked copy is scrubbed.
 *
 * Apply at the end of the schema chain so the marker is attached to the final
 * schema:
 *
 * ```ts
 * ages: redacted(z.string().describe("Comma-separated ages")),
 * zipcode: redacted(z.string().describe("Spanish postal code")),
 * ```
 *
 * Uses Zod v4's `.meta()` registry, so the marker is preserved across schema
 * clones (`.optional()`, `.default()`, etc.).
 */
export function redacted<T extends z.ZodType>(schema: T): T {
	const existing = readMeta(schema);
	const waniwani = isRecord(existing.waniwani) ? existing.waniwani : {};
	return (schema as unknown as { meta: (m: UnknownRecord) => T }).meta({
		...existing,
		waniwani: { ...waniwani, redacted: true },
	});
}

export function isFieldRedacted(schema: z.ZodType): boolean {
	const meta = readMeta(schema);
	const waniwani = meta.waniwani;
	return isRecord(waniwani) && waniwani.redacted === true;
}

function readMeta(schema: z.ZodType): UnknownRecord {
	const metaFn = (schema as unknown as { meta?: () => unknown }).meta;
	if (typeof metaFn !== "function") {
		return {};
	}
	const value = metaFn.call(schema);
	return isRecord(value) ? value : {};
}

/**
 * Walk a flow state schema and return the field names marked via `redacted()`.
 */
export function collectRedactedStateFields(
	state: Record<string, z.ZodType> | undefined,
): string[] {
	if (!state) {
		return [];
	}
	const out: string[] = [];
	for (const [name, schema] of Object.entries(state)) {
		if (isFieldRedacted(schema)) {
			out.push(name);
		}
	}
	return out;
}

export const REDACTED_STATE_UPDATE_FIELDS_META_KEY =
	"waniwani/redactedStateUpdateFields";
