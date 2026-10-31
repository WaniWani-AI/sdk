import type { z } from "zod";
import { getObjectShape, readZodDef, unwrapOptional } from "./nested";

/**
 * Compact, JSON-serializable schema fragment for a single state field.
 * Emitted inside interrupt/widget responses so the LLM gets focused, just-in-time
 * guidance for the field it is being asked to write — without needing to consult
 * a global schema dump.
 */
export type FieldSchemaInfo = {
	type:
		| "enum"
		| "string"
		| "number"
		| "boolean"
		| "object"
		| "array"
		| "unknown";
	/** Allowed values for enum fields. */
	values?: string[];
	/** Field description from `.describe()` (or the parent group description if applicable). */
	description?: string;
	/** True when the underlying schema is optional/nullable/has a default. */
	optional?: boolean;
};

export function introspectField(schema: z.ZodType): FieldSchemaInfo {
	const { inner, optional } = unwrapOptional(schema);
	const description = inner.description ?? schema.description ?? undefined;
	const def = readZodDef(inner);
	const t = def?.type;

	const base: FieldSchemaInfo = {
		type: "unknown",
		...(description ? { description } : {}),
		...(optional ? { optional: true } : {}),
	};

	if (t === "enum" && def?.entries) {
		return { ...base, type: "enum", values: Object.keys(def.entries) };
	}
	if (
		t === "string" ||
		t === "number" ||
		t === "boolean" ||
		t === "object" ||
		t === "array"
	) {
		return { ...base, type: t };
	}
	return base;
}

/**
 * Resolve a field path (flat key or `parent.child` dot-path) to its schema info,
 * using the flow's declared state schema. Returns `undefined` when the path is
 * not declared — the engine then simply omits `fieldSchema` from the response.
 */
export function resolveFieldSchema(
	state: Record<string, z.ZodType> | undefined,
	fieldPath: string,
): FieldSchemaInfo | undefined {
	const schema = resolveFieldZodType(state, fieldPath);
	return schema ? introspectField(schema) : undefined;
}

/**
 * Resolve a field path (flat key or `parent.child` dot-path) to the Zod schema
 * the flow declared for it, or `undefined` when the path is not declared.
 */
export function resolveFieldZodType(
	state: Record<string, z.ZodType> | undefined,
	fieldPath: string,
): z.ZodType | undefined {
	if (!state || !fieldPath) {
		return undefined;
	}
	if (fieldPath.includes(".")) {
		const dot = fieldPath.indexOf(".");
		const parentSchema = state[fieldPath.slice(0, dot)];
		if (!parentSchema) {
			return undefined;
		}
		return getObjectShape(parentSchema)?.[fieldPath.slice(dot + 1)];
	}
	return state[fieldPath];
}
