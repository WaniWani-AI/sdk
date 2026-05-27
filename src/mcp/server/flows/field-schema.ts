import type { z } from "zod";
import { getObjectShape } from "./nested";

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

type ZodDef = {
	type?: string;
	entries?: Record<string, string>;
	innerType?: z.ZodType;
};

type ZodInternals = {
	_zod?: {
		def?: ZodDef;
	};
};

function readDef(schema: z.ZodType): ZodDef | undefined {
	return (schema as unknown as ZodInternals)._zod?.def;
}

/**
 * Unwrap optional/nullable/default wrappers to reach the underlying schema.
 * Returns whether at least one wrapper marked the field as optional from the
 * caller's perspective (optional/nullable/default all mean the LLM may omit it).
 */
function unwrapOptional(schema: z.ZodType): {
	inner: z.ZodType;
	optional: boolean;
} {
	let current = schema;
	let optional = false;
	for (let i = 0; i < 8; i++) {
		const def = readDef(current);
		if (!def?.innerType) {
			break;
		}
		if (
			def.type === "optional" ||
			def.type === "nullable" ||
			def.type === "default"
		) {
			optional = true;
			current = def.innerType;
			continue;
		}
		break;
	}
	return { inner: current, optional };
}

export function introspectField(schema: z.ZodType): FieldSchemaInfo {
	const { inner, optional } = unwrapOptional(schema);
	const description = inner.description ?? schema.description ?? undefined;
	const def = readDef(inner);
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
	if (!state || !fieldPath) {
		return undefined;
	}
	if (fieldPath.includes(".")) {
		const dot = fieldPath.indexOf(".");
		const parent = fieldPath.slice(0, dot);
		const child = fieldPath.slice(dot + 1);
		const parentSchema = state[parent];
		if (!parentSchema) {
			return undefined;
		}
		const shape = getObjectShape(parentSchema);
		const childSchema = shape?.[child];
		if (!childSchema) {
			return undefined;
		}
		return introspectField(childSchema);
	}
	const schema = state[fieldPath];
	if (!schema) {
		return undefined;
	}
	return introspectField(schema);
}
