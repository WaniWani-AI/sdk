// Minimal zod shim for the embed IIFE bundle.
//
// The ai-sdk imports zod for schema validation, but in the browser embed
// context schemas are only used server-side. The client-side useChat() hook
// doesn't call zod at runtime for plain chat (no client-defined tool schemas).
//
// This shim provides the type surface ai-sdk expects without the ~200KB
// zod implementation. If a zod method IS called at runtime it returns
// passthrough behavior (parse returns input as-is, safeParse always succeeds).

// biome-ignore lint/suspicious/noExplicitAny: shim must match zod's loose types
const noop = (): any => schema;

// biome-ignore lint/suspicious/noExplicitAny: shim must match zod's loose types
const schema: any = new Proxy(noop, {
	get(_target, prop) {
		if (prop === "parse" || prop === "parseAsync") {
			return (v: unknown) => v;
		}
		if (prop === "safeParse" || prop === "safeParseAsync") {
			return (v: unknown) => ({ success: true as const, data: v });
		}
		if (prop === "_def") {
			return {};
		}
		if (prop === "jsonSchema") {
			return {};
		}
		// Return self for chaining: z.string().optional().default(...)
		return noop;
	},
	apply() {
		return schema;
	},
});

class ZodError extends Error {
	issues: unknown[] = [];
}

// biome-ignore lint/suspicious/noExplicitAny: shim must match zod's loose types
const z: any = new Proxy(noop, {
	get(_target, prop) {
		if (prop === "ZodError") {
			return ZodError;
		}
		if (prop === "NEVER") {
			return Symbol("NEVER");
		}
		return noop;
	},
	apply() {
		return schema;
	},
});

interface PassthroughResult {
	success: true;
	data: unknown;
}

// `ai` 7, its gateway and `@ai-sdk/provider-utils` 5 import zod's builders and
// parse functions by name, so each one is a named export here.
export const safeParse = (
	_schema: unknown,
	value: unknown,
): PassthroughResult => ({
	success: true,
	data: value,
});
export const safeParseAsync = async (
	_schema: unknown,
	value: unknown,
): Promise<PassthroughResult> => ({ success: true, data: value });
export const parse = (_schema: unknown, value: unknown): unknown => value;
export const parseAsync = async (
	_schema: unknown,
	value: unknown,
): Promise<unknown> => value;
export const toJSONSchema = (): Record<string, never> => ({});
export const any = noop;
export const array = noop;
export const boolean = noop;
export const custom = noop;
export const discriminatedUnion = noop;
export const json = noop;
export const lazy = noop;
export const literal = noop;
export const looseObject = noop;
export const never = noop;
export const number = noop;
export const object = noop;
export const record = noop;
export const string = noop;
export const union = noop;
export const unknown = noop;
export { noop as enum, noop as instanceof, noop as null };

export { z, ZodError };
export const ZodFirstPartyTypeKind = {};
export const ZodType = class {};
export const ZodSchema = class {};
export default z;
