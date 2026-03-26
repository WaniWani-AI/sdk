import type { ChatResult } from "./types";

/**
 * Parse the JSON-stringified ChatResult from a Braintrust task output.
 */
export function parseTaskOutput(output: unknown): ChatResult {
	try {
		return JSON.parse(output as string);
	} catch {
		return { output: "", toolsCalled: [], toolCallTraces: [] };
	}
}

/**
 * Checks whether the expected tool was called.
 * Looks for the tool name in `metadata.expectedTool` first (for cases where `expected` is a
 * reference answer), then falls back to `expected` directly.
 */
export function calledExpectedTool({
	output,
	expected,
	metadata,
}: {
	output: unknown;
	expected?: unknown;
	metadata?: Record<string, unknown>;
}) {
	const parsed = parseTaskOutput(output);
	const expectedTool =
		(metadata?.expectedTool as string) ?? (expected as string);
	const found = parsed.toolsCalled.includes(expectedTool);
	return {
		name: "called_expected_tool",
		score: found ? 1 : 0,
		metadata: { expected: expectedTool, actual: parsed.toolsCalled },
	};
}

/**
 * Checks whether the assistant produced any text output.
 */
export function hasOutput({ output }: { output: unknown }) {
	const parsed = parseTaskOutput(output);
	return {
		name: "has_output",
		score: parsed.output.length > 0 ? 1 : 0,
	};
}

/**
 * Checks specific fields in the first tool call's `stateUpdates` against expected values.
 * Supports nested fields via dot notation (e.g. "mixedBreed.knowsBreeds").
 * Returns partial credit (fraction of matching fields).
 */
export function toolInputFieldsMatch({
	output,
	metadata,
}: {
	output: unknown;
	metadata?: Record<string, unknown>;
}) {
	const parsed = parseTaskOutput(output);
	const expectedFields = (metadata?.expectedFields ?? {}) as Record<
		string,
		unknown
	>;
	const fieldNames = Object.keys(expectedFields);

	if (fieldNames.length === 0) {
		return { name: "field_extraction", score: 1 };
	}

	const trace = parsed.toolCallTraces[0];
	const stateUpdates = (trace?.input?.stateUpdates ?? {}) as Record<
		string,
		unknown
	>;

	let matches = 0;
	const details: Record<
		string,
		{ expected: unknown; actual: unknown; match: boolean }
	> = {};

	for (const field of fieldNames) {
		const expected = expectedFields[field];
		let actual: unknown;

		if (field.includes(".")) {
			const [parent, child] = field.split(".");
			actual = (stateUpdates[parent] as Record<string, unknown>)?.[child];
		} else {
			actual = stateUpdates[field];
		}

		const match = JSON.stringify(actual) === JSON.stringify(expected);
		if (match) {
			matches++;
		}
		details[field] = { expected, actual, match };
	}

	return {
		name: "field_extraction",
		score: matches / fieldNames.length,
		metadata: details,
	};
}

/**
 * Wraps an autoevals scorer to extract the text output from the JSON-stringified ChatResult.
 * Requires the `autoevals` package: bun add -d autoevals
 */
function wrapAutoeval(
	scorer: (args: {
		input: unknown;
		output: string;
		expected?: unknown;
	}) => unknown,
) {
	return async (args: {
		input: unknown;
		output: unknown;
		expected?: unknown;
	}) => {
		const parsed = parseTaskOutput(args.output);
		return scorer({
			input: args.input,
			output: parsed.output,
			expected: args.expected,
		});
	};
}

// LLM-based scorers — require `autoevals` as a dev dependency.
// These are dynamically imported so the module loads even if autoevals is not installed.
// Using LLM scorers without autoevals installed will throw at call time.

async function getAutoeval(name: string) {
	const mod = await import("autoevals").catch(() => {
		throw new Error(
			`LLM scorer "${name}" requires the "autoevals" package: bun add -d autoevals`,
		);
	});
	return (mod as Record<string, unknown>)[name] as (args: {
		input: unknown;
		output: string;
		expected?: unknown;
	}) => unknown;
}

/** ClosedQA — checks if the answer correctly addresses the question given a reference answer. */
export const FaqAccuracy = async (args: {
	input: unknown;
	output: unknown;
	expected?: unknown;
}): Promise<unknown> => wrapAutoeval(await getAutoeval("ClosedQA"))(args);

/** Factuality — checks if the output is factually consistent with the expected output. */
export const OutputFactuality = async (args: {
	input: unknown;
	output: unknown;
	expected?: unknown;
}): Promise<unknown> => wrapAutoeval(await getAutoeval("Factuality"))(args);

/** Moderation — flags unsafe or inappropriate content. */
export const SafetyCheck = async (args: {
	input: unknown;
	output: unknown;
	expected?: unknown;
}): Promise<unknown> => wrapAutoeval(await getAutoeval("Moderation"))(args);
