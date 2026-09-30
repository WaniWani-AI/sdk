/**
 * Intent and context capture for every wrapped tool (WAN-1354).
 *
 * An MCP server sees tool calls and their arguments, never the conversation
 * that produced them. On ChatGPT and Claude the closest thing to the user's own
 * words is what the calling model writes into the tool's arguments. Flow tools
 * already ask for it: `compileFlow` declares `intent` and `context` on the flow
 * tool's input schema. This module adds the same two fields to plain tools, so a
 * session that never touches a flow still records why the user arrived.
 *
 * The fields are added to the tool's declared input schema, so the calling model
 * sees them in `tools/list`. `withWaniwani` strips them before the tool's own
 * handler runs, then tracks them as part of `properties.input` on `tool.called`
 * — the same place flows put them, so the platform reads both through one path.
 *
 * A tool that already declares a field keeps its own: flow tools declare both,
 * so they pass through untouched.
 *
 * `zod` is imported directly: `@waniwani/sdk/mcp` already pulls it in through
 * `createFlow`, and `@modelcontextprotocol/sdk` depends on it outright, so any
 * server this can wrap already has it installed.
 */

import { z } from "zod";
import { OMIT_PII_NOTE } from "../utils.js";
import { isRecord } from "./helpers.js";

type UnknownRecord = Record<string, unknown>;

/**
 * Zod object surface this module relies on, structurally typed.
 *
 * `extend` is optional on purpose: the MCP SDK normalizes a raw shape with
 * `zod/v4-mini`, whose objects expose `shape` but no `extend` method, so a
 * schema read back from `_registeredTools` is extendable only by rebuilding it
 * from its shape. `safeExtend` exists on Zod 4.1+ classic objects and, unlike
 * `extend` on some 4.x releases, never throws on an object carrying refinements.
 */
type ZodObjectLike = {
	shape: UnknownRecord;
	extend?: (shape: UnknownRecord) => unknown;
	safeExtend?: (shape: UnknownRecord) => unknown;
};

/**
 * Options for `withWaniwani`'s `captureIntent`.
 */
export type CaptureIntentOptions = {
	/**
	 * Restrict capture to these tool names. Omitted = every tool.
	 */
	tools?: readonly string[];
	/**
	 * Ask the model to keep PII out of the captured values.
	 *
	 * @default false
	 */
	omitPII?: boolean;
};

/** The fields added to each tool, in the order they are appended. */
export const CAPTURE_FIELDS = ["intent", "context"] as const;

export type CaptureField = (typeof CAPTURE_FIELDS)[number];

/**
 * Field descriptions shown to the calling model.
 *
 * They ship on every tool in `tools/list`, so they stay short, and they ask for
 * a value once per conversation rather than on every call: the platform needs
 * the goal when it is first stated and when it changes, not a copy per call.
 */
export function buildCaptureDescriptions(
	omitPII: boolean | undefined,
): Record<CaptureField, string> {
	const pii = omitPII ? OMIT_PII_NOTE : "";
	return {
		intent: `The user's goal, in their words, not inferred. Send on your first call to this server, then only when the goal changes.${pii}`,
		context: `The situation that led the user here (page, trigger). Send with intent when known, then only when it changes.${pii}`,
	};
}

/**
 * Whether `value` is a Zod 4 schema (classic or mini). Both carry `_zod`
 * internals; Zod 3 schemas do not. The injected fields are Zod 4 schemas, so a
 * Zod 3 object is left alone rather than handed a field it cannot parse.
 */
function isZod4Schema(value: unknown): boolean {
	return isRecord(value) && "_zod" in value;
}

/** Any Zod schema instance, v3 (`_def`) or v4 (`~standard`), as the MCP SDK checks it. */
function isZodSchemaInstance(value: unknown): boolean {
	return isRecord(value) && ("~standard" in value || "_def" in value);
}

function asZod4Object(value: unknown): ZodObjectLike | null {
	if (!isZod4Schema(value)) {
		return null;
	}
	const candidate = value as Partial<ZodObjectLike>;
	if (!isRecord(candidate.shape)) {
		return null;
	}
	return candidate as ZodObjectLike;
}

/**
 * A raw shape is a plain object whose values are Zod types (the MCP SDK accepts
 * both this and a Zod object as `inputSchema`). An empty object counts, which is
 * how a no-argument tool is declared. Every value must be a Zod 4 schema, for
 * the same reason `isZod4Schema` gates objects.
 */
function asZod4RawShape(value: unknown): UnknownRecord | null {
	if (!isRecord(value) || isZodSchemaInstance(value)) {
		return null;
	}
	if (!Object.values(value).every(isZod4Schema)) {
		return null;
	}
	return value;
}

export type IntentCapture = {
	appliesTo: (toolName: string) => boolean;
	/**
	 * Add the capture fields a tool does not already declare to its input
	 * schema.
	 *
	 * Returns the extended schema and the fields that were added, or `undefined`
	 * when the tool is left untouched: it already declares both fields, its
	 * schema is not an object we can extend (a union, a pipe, a Zod 3 schema), or
	 * extending it threw.
	 */
	augment: (
		inputSchema: unknown,
	) => { schema: unknown; fields: CaptureField[] } | undefined;
};

/**
 * Build the capture helper, or `null` when `captureIntent: false` switches
 * capture off. Synchronous, so `withWaniwani` can augment every tool the moment
 * it is registered rather than after a promise resolves.
 */
export function createIntentCapture(
	option: boolean | CaptureIntentOptions | undefined,
): IntentCapture | null {
	if (option === false) {
		return null;
	}
	const options: CaptureIntentOptions =
		option === true || option === undefined ? {} : option;
	const allowList =
		options.tools && options.tools.length > 0
			? new Set(options.tools)
			: undefined;

	const descriptions = buildCaptureDescriptions(options.omitPII);
	const fieldSchemas: Record<CaptureField, z.ZodType> = {
		intent: z.string().optional().describe(descriptions.intent),
		context: z.string().optional().describe(descriptions.context),
	};

	const shapeFor = (fields: readonly CaptureField[]): UnknownRecord =>
		Object.fromEntries(fields.map((field) => [field, fieldSchemas[field]]));

	const missingFrom = (shape: UnknownRecord): CaptureField[] =>
		CAPTURE_FIELDS.filter((field) => !(field in shape));

	return {
		appliesTo: (toolName: string) =>
			allowList === undefined || allowList.has(toolName),
		augment: (inputSchema) => {
			// No declared schema: the tool takes no arguments, so the capture fields
			// become its whole input.
			if (inputSchema === undefined || inputSchema === null) {
				const fields = [...CAPTURE_FIELDS];
				return { schema: z.object(shapeFor(fields) as z.ZodRawShape), fields };
			}

			const zodObject = asZod4Object(inputSchema);
			if (zodObject) {
				const fields = missingFrom(zodObject.shape);
				if (fields.length === 0) {
					return undefined;
				}
				const added = shapeFor(fields);
				try {
					// Prefer the object's own extension methods, which keep object-level
					// modifiers such as `.strict()` and refinements. Zod Mini objects
					// (what the MCP SDK stores after normalizing a raw shape) have
					// neither, and carry no modifiers, so rebuild those from their shape.
					const schema =
						typeof zodObject.safeExtend === "function"
							? zodObject.safeExtend(added)
							: typeof zodObject.extend === "function"
								? zodObject.extend(added)
								: z.object({ ...zodObject.shape, ...added } as z.ZodRawShape);
					return { schema, fields };
				} catch {
					// A schema we cannot extend keeps working as declared; losing capture
					// on one tool is better than failing its registration.
					return undefined;
				}
			}

			const rawShape = asZod4RawShape(inputSchema);
			if (rawShape) {
				const fields = missingFrom(rawShape);
				if (fields.length === 0) {
					return undefined;
				}
				// Normalize to a Zod object, which is what the MCP SDK stores anyway.
				return {
					schema: z.object({
						...rawShape,
						...shapeFor(fields),
					} as z.ZodRawShape),
					fields,
				};
			}

			return undefined;
		},
	};
}

/**
 * Drop the injected fields from a tool's parsed input, so handlers only ever
 * see the parameters they declared. Returns the input untouched when none of
 * the fields is present, keeping the common path allocation-free.
 */
export function stripCapturedFields(
	input: unknown,
	fields: readonly string[],
): unknown {
	if (!isRecord(input) || !fields.some((field) => field in input)) {
		return input;
	}
	const rest: UnknownRecord = { ...input };
	for (const field of fields) {
		delete rest[field];
	}
	return rest;
}
