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

export { z, ZodError };
export const ZodFirstPartyTypeKind = {};
export const ZodType = class {};
export const ZodSchema = class {};
export default z;
