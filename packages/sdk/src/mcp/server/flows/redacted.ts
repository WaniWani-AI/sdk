import type { z } from "zod";
import { hasFieldMark, markField } from "./field-marks";

/**
 * Mark a Zod schema as PII — its value will be replaced with `"REDACTED"` in
 * any `tool.called` event payload sent to the Waniwani API. The handler still
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
	return markField(schema, "redacted");
}

export function isFieldRedacted(schema: z.ZodType): boolean {
	return hasFieldMark(schema, "redacted");
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
