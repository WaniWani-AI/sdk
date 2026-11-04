import type { z } from "zod";

// ============================================================================
// Values
// ============================================================================

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Check whether a state value counts as "filled" (not empty/missing). */
export function isFilled(v: unknown): boolean {
	return v !== undefined && v !== null && v !== "";
}

// ============================================================================
// Zod schema introspection
// ============================================================================

type ZodDef = {
	type?: string;
	entries?: Record<string, string>;
	innerType?: z.ZodType;
	shape?: Record<string, z.ZodType>;
};

export function readZodDef(schema: z.ZodType): ZodDef | undefined {
	return (schema as unknown as { _zod?: { def?: ZodDef } })._zod?.def;
}

/**
 * Unwrap optional/nullable/default wrappers to reach the underlying schema.
 * Returns whether at least one wrapper marked the field as optional from the
 * caller's perspective (optional/nullable/default all mean the LLM may omit it).
 */
export function unwrapOptional(schema: z.ZodType): {
	inner: z.ZodType;
	optional: boolean;
} {
	let current = schema;
	let optional = false;
	for (let i = 0; i < 8; i++) {
		const def = readZodDef(current);
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

/**
 * Extract the shape of a `z.object(...)` schema, or null if not an object. A
 * group declared `.optional()`, `.nullable()` or `.default()` still has its
 * members, so those wrappers are looked through.
 */
export function getObjectShape(
	schema: z.ZodType,
): Record<string, z.ZodType> | null {
	const def = readZodDef(unwrapOptional(schema).inner);
	if (def?.type === "object" && def.shape) {
		return def.shape;
	}
	return null;
}

/** Check whether a Zod schema is a `z.object(...)`, wrapped or not. */
export function isObjectSchema(schema: z.ZodType): boolean {
	return getObjectShape(schema) !== null;
}

// ============================================================================
// Dot-path value access
// ============================================================================

/**
 * Keys that reach an object's prototype rather than the object itself. Paths
 * come from `stateUpdates`, so a path through one of these would write to
 * every object in the process (`"__proto__.postcode"` sets
 * `Object.prototype.postcode`, and every session then reads that field as
 * filled). The helpers below never read, write or merge through them.
 */
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPrototypeKey(key: string): boolean {
	return PROTOTYPE_KEYS.has(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * A copy of `value` with every prototype key removed at any depth. A nested
 * object from `stateUpdates` can carry an own `__proto__` key (`JSON.parse`
 * makes one), and stored as is it would set the prototype of whatever object
 * a node later copies it into. Only plain objects and arrays are copied, so a
 * `Date` or a class instance comes through as it is.
 */
function withoutPrototypeKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(withoutPrototypeKeys);
	}
	if (!isPlainObject(value)) {
		return value;
	}
	const copy: Record<string, unknown> = {};
	for (const [key, member] of Object.entries(value)) {
		if (!isPrototypeKey(key)) {
			copy[key] = withoutPrototypeKeys(member);
		}
	}
	return copy;
}

/** Resolve a dot-path like `"driver.name"` to its value in a nested object. */
export function getNestedValue(
	obj: Record<string, unknown>,
	path: string,
): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") {
			return undefined;
		}
		// Own keys only: an inherited value is never a field the flow holds.
		if (isPrototypeKey(part) || !Object.hasOwn(current, part)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

/** Set a value at a dot-path, creating intermediate objects as needed. */
export function setNestedValue(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const parts = path.split(".");
	if (parts.some(isPrototypeKey)) {
		return;
	}
	const lastKey = parts.pop();
	if (!lastKey) {
		return;
	}
	let current = obj;
	for (const part of parts) {
		if (
			current[part] == null ||
			typeof current[part] !== "object" ||
			Array.isArray(current[part])
		) {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	current[lastKey] = value;
}

/** Delete a value at a dot-path. Only removes the leaf key. */
export function deleteNestedValue(
	obj: Record<string, unknown>,
	path: string,
): void {
	const parts = path.split(".");
	if (parts.some(isPrototypeKey)) {
		return;
	}
	const lastKey = parts.pop();
	if (!lastKey) {
		return;
	}
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") {
			return;
		}
		current = (current as Record<string, unknown>)[part];
	}
	if (current != null && typeof current === "object") {
		delete (current as Record<string, unknown>)[lastKey];
	}
}

// ============================================================================
// State merging
// ============================================================================

/**
 * Expand dot-path keys into nested objects.
 * `{ "driver.name": "John", "email": "a@b.com" }` → `{ driver: { name: "John" }, email: "a@b.com" }`
 *
 * Mixed input where a dot-key and its nested sibling share a parent
 * (e.g. `{ "driver.name": "John", driver: { license: "ABC" } }`) is deep-merged
 * regardless of key order, so neither side clobbers the other.
 */
export function expandDotPaths(
	flat: Record<string, unknown>,
): Record<string, unknown> {
	let result: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(flat)) {
		if (isPrototypeKey(key)) {
			continue;
		}
		const value = withoutPrototypeKeys(raw);
		if (key.includes(".")) {
			setNestedValue(result, key, value);
		} else if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value)
		) {
			result = deepMerge(result, { [key]: value as Record<string, unknown> });
		} else {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Deep-merge source into target. Preserves existing nested keys.
 * Only merges plain objects — arrays and primitives are overwritten.
 */
export function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...target };
	for (const [key, value] of Object.entries(source)) {
		if (isPrototypeKey(key)) {
			continue;
		}
		if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			result[key] !== null &&
			typeof result[key] === "object" &&
			!Array.isArray(result[key])
		) {
			result[key] = deepMerge(
				result[key] as Record<string, unknown>,
				value as Record<string, unknown>,
			);
		} else {
			result[key] = value;
		}
	}
	return result;
}
