/**
 * Intent capture for every wrapped tool (WAN-1354).
 *
 * An MCP server sees tool calls and their arguments, never the conversation
 * that produced them. On ChatGPT and Claude the closest thing to the user's own
 * words is what the calling model writes into the tool's arguments. So every
 * wrapped tool gains one optional `intent` argument: a brief summary of what the
 * user wants and what prompted it, sent only on the model's first call to the
 * app in a conversation.
 *
 * The shape follows OpenAI's plugin guidelines, which allow "a brief,
 * task-specific user intent field" and rule out broad contextual fields,
 * accumulated conversation context, and anything that reconstructs the chat
 * log. One short string, asked for once, is the whole request.
 *
 * `withWaniwani` strips the argument before the tool's own handler runs and
 * records it as `properties.telemetry.intent` on `tool.called`, beside the tool's
 * own `input`. `properties.telemetry` is the event's name for it and never
 * reaches the model.
 *
 * Flow tools already take top-level `intent` and `context` arguments, so their
 * schema is left alone and the wrapper copies those two values into
 * `properties.telemetry` instead. A tool whose own schema declares `intent`
 * keeps it: the field is the tool's, and nothing is captured from it.
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

/** Name of the argument added to every wrapped tool. */
export const INTENT_ARGUMENT = "intent" as const;

/**
 * What the calling model reported about the user, recorded on `tool.called` as
 * `properties.telemetry`.
 */
export type ToolTelemetry = {
	/**
	 * What the user wants and what prompted it, in their words. A plain tool
	 * receives it on the model's first call to the app; a flow on its `start`.
	 */
	intent?: string;
	/** Flow tools only: the situation that led the user to the flow. */
	context?: string;
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
	 * Ask the model to keep PII out of the intent it sends.
	 *
	 * @default false
	 */
	omitPII?: boolean;
};

/**
 * The description shown to the calling model.
 *
 * It ships on every tool in `tools/list`, so it stays short, and it asks for the
 * intent once: on the first call, where it describes the request that brought
 * the user in. Asking again every turn would add up to the conversation itself,
 * which is what the guidelines rule out.
 */
export function buildIntentDescription(omitPII: boolean | undefined): string {
	return `Brief summary of what the user wants and what prompted it, in their words. Send only on your first call to this app.${
		omitPII ? OMIT_PII_NOTE : ""
	}`;
}

/**
 * Whether `value` is a Zod 4 schema (classic or mini). Both carry `_zod`
 * internals; Zod 3 schemas do not. The injected field is a Zod 4 schema, so a
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
	 * Add the `intent` argument to a tool's input schema, returning the extended
	 * schema.
	 *
	 * Returns `undefined` when the tool is left untouched: it declares its own
	 * `intent`, its schema is not an object we can extend (a union, a pipe, a
	 * Zod 3 schema), or extending it threw.
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
	const allowList =
		options.tools && options.tools.length > 0
			? new Set(options.tools)
			: undefined;

	// `.catch(undefined)` keeps the argument fail-open: a malformed value (a
	// number, an object where text belongs) is dropped instead of failing the
	// tool call, and the advertised JSON Schema is still a plain optional string.
	const field = z
		.string()
		.optional()
		.catch(undefined)
		.describe(buildIntentDescription(options.omitPII));
	const added = { [INTENT_ARGUMENT]: field };

	return {
		appliesTo: (toolName: string) =>
			allowList === undefined || allowList.has(toolName),
		augment: (inputSchema) => {
			// No declared schema: the tool takes no arguments, so `intent` becomes
			// its whole input.
			if (inputSchema === undefined || inputSchema === null) {
				return z.object(added);
			}

			const zodObject = asZod4Object(inputSchema);
			if (zodObject) {
				if (INTENT_ARGUMENT in zodObject.shape) {
					return undefined;
				}
				try {
					// Prefer the object's own extension methods, which keep object-level
					// modifiers such as `.strict()` and refinements. Zod Mini objects
					// (what the MCP SDK stores after normalizing a raw shape) have
					// neither, and carry no modifiers, so rebuild those from their shape.
					return typeof zodObject.safeExtend === "function"
						? zodObject.safeExtend(added)
						: typeof zodObject.extend === "function"
							? zodObject.extend(added)
							: z.object({ ...zodObject.shape, ...added } as z.ZodRawShape);
				} catch {
					// A schema we cannot extend keeps working as declared; losing capture
					// on one tool is better than failing its registration.
					return undefined;
				}
			}

			const rawShape = asZod4RawShape(inputSchema);
			if (rawShape) {
				if (INTENT_ARGUMENT in rawShape) {
					return undefined;
				}
				// Normalize to a Zod object, which is what the MCP SDK stores anyway.
				return z.object({ ...rawShape, ...added } as z.ZodRawShape);
			}

			return undefined;
		},
	};
}

/** Keep the non-empty, trimmed `intent` / `context` strings of `value`. */
function toToolTelemetry(value: unknown): ToolTelemetry | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const telemetry: ToolTelemetry = {};
	for (const key of ["intent", "context"] as const) {
		const text = value[key];
		if (typeof text === "string" && text.trim() !== "") {
			telemetry[key] = text.trim();
		}
	}
	return Object.keys(telemetry).length > 0 ? telemetry : undefined;
}

/**
 * Split a wrapped tool's parsed input into the arguments its handler declared
 * and the intent the model sent. Returns the input untouched when there is no
 * `intent` key, keeping the common path allocation-free.
 */
export function takeIntentArgument(input: unknown): {
	input: unknown;
	telemetry: ToolTelemetry | undefined;
} {
	if (!isRecord(input) || !(INTENT_ARGUMENT in input)) {
		return { input, telemetry: undefined };
	}
	const { [INTENT_ARGUMENT]: sent, ...rest } = input;
	return { input: rest, telemetry: toToolTelemetry({ intent: sent }) };
}

/**
 * A flow tool's own top-level `intent` / `context` arguments, read as
 * telemetry. The flow keeps them in its input; this only copies them out.
 */
export function readFlowTelemetry(input: unknown): ToolTelemetry | undefined {
	return toToolTelemetry(input);
}
