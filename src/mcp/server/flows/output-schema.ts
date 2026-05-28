import { z } from "zod";

// ============================================================================
// Output schema — the JSON shape returned in `structuredContent` for every
// flow tool call. Mirrors `FlowContent` plus the optional `sessionId` echo.
//
// Baked into the compiled tool config so MCP clients (Claude, ChatGPT, etc.)
// can present a typed, validated contract instead of an opaque string payload.
// ============================================================================

const flowFieldSchema = z
	.object({
		type: z.enum([
			"enum",
			"string",
			"number",
			"boolean",
			"object",
			"array",
			"unknown",
		]),
		values: z.array(z.string()).optional(),
		description: z.string().optional(),
		optional: z.boolean().optional(),
	})
	.describe(
		"JIT schema fragment for a state field — type, allowed values, and description.",
	);

const flowQuestionSchema = z
	.object({
		question: z.string(),
		field: z.string(),
		suggestions: z.array(z.string()).optional(),
		context: z.string().optional(),
		fieldSchema: flowFieldSchema.optional(),
	})
	.describe("One question within a multi-question interrupt.");

export const flowOutputSchema = {
	status: z
		.enum(["interrupt", "widget", "complete", "error"])
		.describe(
			"Current flow status and the next action the assistant should take.",
		),
	question: z
		.string()
		.optional()
		.describe("Single question to ask the user when status is interrupt."),
	field: z
		.string()
		.optional()
		.describe(
			"State field to fill with the user's answer on the next continue call.",
		),
	fieldSchema: flowFieldSchema
		.optional()
		.describe("JIT schema fragment for the single-question shorthand."),
	suggestions: z
		.array(z.string())
		.optional()
		.describe("Suggested answers for the single-question shorthand."),
	questions: z
		.array(flowQuestionSchema)
		.optional()
		.describe("Multiple questions to ask the user when status is interrupt."),
	context: z
		.string()
		.optional()
		.describe("Private instruction context for the assistant."),
	tool: z
		.string()
		.optional()
		.describe("Widget tool to call when status is widget."),
	data: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Input data to pass to the widget tool."),
	description: z
		.string()
		.optional()
		.describe("Instruction for rendering the requested widget."),
	interactive: z
		.boolean()
		.optional()
		.describe(
			"Whether the widget requires user interaction before continuing.",
		),
	sessionId: z
		.string()
		.optional()
		.describe("Session identifier to pass on future continue and reset calls."),
	error: z.string().optional().describe("Error message when status is error."),
};

export type FlowOutputSchema = typeof flowOutputSchema;
