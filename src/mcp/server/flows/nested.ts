import type { z } from "zod";

// ============================================================================
// Zod object schema detection
// ============================================================================

/** Check whether a Zod schema is a `z.object(...)`. */
export function isObjectSchema(schema: z.ZodType): boolean {
	const def = (schema as unknown as { _zod?: { def?: { type?: string } } })._zod
		?.def;
	return def?.type === "object";
}

/** Extract the shape of a `z.object(...)` schema, or null if not an object. */
export function getObjectShape(
	schema: z.ZodType,
): Record<string, z.ZodType> | null {
	const def = (
		schema as unknown as {
			_zod?: { def?: { type?: string; shape?: Record<string, z.ZodType> } };
		}
	)._zod?.def;
	if (def?.type === "object" && def.shape) {
		return def.shape;
	}
	return null;
}

// ============================================================================
// Dot-path value access
// ============================================================================

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
 */
export function expandDotPaths(
	flat: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(flat)) {
		if (key.includes(".")) {
			setNestedValue(result, key, value);
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
