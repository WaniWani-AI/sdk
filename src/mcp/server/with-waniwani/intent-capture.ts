/**
 * Intent capture (WAN-790).
 *
 * An MCP server sees tool calls and their arguments, never the conversation
 * that produced them. Flow tools already close that gap: `compileFlow` puts an
 * `intent` field on the flow tool's input schema and the protocol text tells
 * the model to fill it in. This module does the same for plain tools, so a
 * server that never calls `createFlow` still records why each tool ran.
 *
 * The field is added to the tool's declared input schema, so the calling model
 * sees it in `tools/list` and writes the user's goal into it. `withWaniwani`
 * strips the value before the tool's own handler runs, then tracks it as part
 * of `properties.input` on `tool.called` — the same place flows put it, which
 * is what lets the platform read both without a second code path.
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
 * from its shape.
 */
type ZodObjectLike = {
	shape: UnknownRecord;
	extend?: (shape: UnknownRecord) => unknown;
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
	 * Name of the injected argument.
	 *
	 * Point this at a field a tool already collects to reuse it as the intent
	 * rather than adding one. A tool that already declares the name is left
	 * untouched, and the value reaches its handler as usual.
	 *
	 * @default "intent"
	 */
	argumentName?: string;
	/**
	 * Ask the model to keep PII out of the captured value.
	 *
	 * @default false
	 */
	omitPII?: boolean;
};

export const DEFAULT_INTENT_ARGUMENT = "intent";

export function buildIntentDescription(omitPII: boolean | undefined): string {
	return `Brief summary of the user's goal behind this call — what they are trying to achieve, in their words. Do not invent missing intent; leave this out when the conversation does not say.${
		omitPII ? OMIT_PII_NOTE : ""
	}`;
}

/**
 * Whether `value` is a Zod schema instance rather than a raw shape. Mirrors the
 * MCP SDK's own check: v4 schemas carry `~standard`, v3 schemas carry `_def`.
 */
function isZodSchemaInstance(value: unknown): boolean {
	return isRecord(value) && ("~standard" in value || "_def" in value);
}

function asZodObject(value: unknown): ZodObjectLike | null {
	if (!isZodSchemaInstance(value)) {
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
 * both this and a Zod object as `inputSchema`). An empty object counts, which
 * is how a no-argument tool is declared.
 */
function asRawShape(value: unknown): UnknownRecord | null {
	if (!isRecord(value) || isZodSchemaInstance(value)) {
		return null;
	}
	const values = Object.values(value);
	if (values.length > 0 && !values.some(isZodSchemaInstance)) {
		return null;
	}
	return value;
}

export type IntentCapture = {
	argumentName: string;
	appliesTo: (toolName: string) => boolean;
	/**
	 * Add the intent argument to a tool's input schema, returning the extended
	 * schema.
	 *
	 * Returns `undefined` when the tool is left untouched: it already declares
	 * the argument, or its schema is a shape we cannot extend (a union or
	 * intersection rather than an object).
	 */
	augment: (inputSchema: unknown) => unknown | undefined;
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
	const argumentName = options.argumentName ?? DEFAULT_INTENT_ARGUMENT;
	const allowList =
		options.tools && options.tools.length > 0
			? new Set(options.tools)
			: undefined;

	const field = z
		.string()
		.optional()
		.describe(buildIntentDescription(options.omitPII));

	/** Build an object schema carrying `shape` plus the intent field. */
	const objectWithIntent = (shape: UnknownRecord): unknown =>
		z.object({ ...shape, [argumentName]: field } as z.ZodRawShape);

	return {
		argumentName,
		appliesTo: (toolName: string) =>
			allowList === undefined || allowList.has(toolName),
		augment: (inputSchema: unknown): unknown | undefined => {
			// No declared schema: the tool takes no arguments, so the intent field
			// becomes its whole input.
			if (inputSchema === undefined || inputSchema === null) {
				return objectWithIntent({});
			}

			const zodObject = asZodObject(inputSchema);
			if (zodObject) {
				if (argumentName in zodObject.shape) {
					return undefined;
				}
				// Prefer `extend`, which preserves object-level modifiers such as
				// `.strict()`. Zod Mini objects — what the MCP SDK stores after
				// normalizing a raw shape — have no `extend`, so rebuild from shape.
				return typeof zodObject.extend === "function"
					? zodObject.extend({ [argumentName]: field })
					: objectWithIntent(zodObject.shape);
			}

			const rawShape = asRawShape(inputSchema);
			if (rawShape) {
				if (argumentName in rawShape) {
					return undefined;
				}
				// Normalize to a Zod object, which is what the MCP SDK stores anyway.
				return objectWithIntent(rawShape);
			}

			return undefined;
		},
	};
}

/**
 * Drop the injected argument from a tool's parsed input, so handlers only ever
 * see the parameters they declared. Returns the input untouched when the key is
 * absent, keeping the common path allocation-free.
 */
export function stripIntentArgument(
	input: unknown,
	argumentName: string,
): unknown {
	if (!isRecord(input) || !(argumentName in input)) {
		return input;
	}
	const { [argumentName]: _dropped, ...rest } = input;
	return rest;
}
