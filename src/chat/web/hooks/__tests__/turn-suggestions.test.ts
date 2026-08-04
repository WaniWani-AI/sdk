import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
	extractFlowSuggestions,
	extractFollowupSuggestions,
} from "../turn-suggestions";

/** Build an assistant message from raw parts. */
function assistantMessage(parts: unknown[]): UIMessage {
	return {
		id: "m1",
		role: "assistant",
		parts,
	} as unknown as UIMessage;
}

/** A tool-result part carrying the flow engine's suggestions meta. */
function flowToolPart(suggestions: string[], toolCallId = "call-1") {
	return {
		type: "tool-my_flow",
		toolCallId,
		state: "output-available",
		output: {
			content: [{ type: "text", text: "{}" }],
			structuredContent: { status: "interrupt", suggestions },
			_meta: {
				"waniwani/sessionId": "sess-1",
				"waniwani/suggestions": { suggestions },
			},
		},
	};
}

/** The legacy streamed data part a bring-your-own-backend host may emit. */
function dataSuggestionsPart(suggestions: string[]) {
	return { type: "data-suggestions", data: { suggestions } };
}

/** A non-flow tool result (e.g. a KB search) — no `waniwani/suggestions` key at all. */
function nonFlowToolPart(toolCallId = "call-kb") {
	return {
		type: "tool-kb_search",
		toolCallId,
		state: "output-available",
		output: {
			content: [{ type: "text", text: "{}" }],
			_meta: { "waniwani/sessionId": "sess-1" },
		},
	};
}

describe("extractFlowSuggestions", () => {
	test("returns the suggestions from a flow tool part", () => {
		const message = assistantMessage([
			{ type: "text", text: "Which plan fits you?" },
			flowToolPart(["Bronze", "Silver", "Gold"]),
		]);

		expect(extractFlowSuggestions(message)).toEqual([
			"Bronze",
			"Silver",
			"Gold",
		]);
	});

	test("returns null when no part carries the key", () => {
		const message = assistantMessage([
			{ type: "text", text: "Here is what I found." },
			{
				type: "tool-search",
				toolCallId: "call-9",
				state: "output-available",
				output: { content: [{ type: "text", text: "{}" }] },
			},
		]);

		expect(extractFlowSuggestions(message)).toBeNull();
	});

	test("returns null for a message with no parts", () => {
		expect(extractFlowSuggestions(assistantMessage([]))).toBeNull();
	});

	test("takes the last flow result when a turn calls the flow twice", () => {
		const message = assistantMessage([
			flowToolPart(["First", "Set"], "call-1"),
			{ type: "text", text: "Got it." },
			flowToolPart(["Second", "Set"], "call-2"),
		]);

		expect(extractFlowSuggestions(message)).toEqual(["Second", "Set"]);
	});

	test("ignores a tool part whose _meta entry is malformed", () => {
		const message = assistantMessage([
			{
				type: "tool-my_flow",
				toolCallId: "call-1",
				state: "output-available",
				output: {
					_meta: { "waniwani/suggestions": { suggestions: "not-an-array" } },
				},
			},
		]);

		expect(extractFlowSuggestions(message)).toBeNull();
	});

	test("ignores a suggestions array containing non-strings", () => {
		const message = assistantMessage([
			{
				type: "tool-my_flow",
				toolCallId: "call-1",
				state: "output-available",
				output: {
					_meta: { "waniwani/suggestions": { suggestions: ["ok", 42] } },
				},
			},
		]);

		expect(extractFlowSuggestions(message)).toBeNull();
	});

	test("preserves an explicit empty entry as []", () => {
		const message = assistantMessage([flowToolPart([])]);

		expect(extractFlowSuggestions(message)).toEqual([]);
	});

	// Regression test for the bug where a turn calling the flow twice — an
	// interrupt-with-suggestions call followed by a complete/widget/error call
	// carrying no `waniwani/suggestions` key — left the first call's pills on
	// screen after the flow had moved on or finished. The key is authoritative
	// on every flow result (an empty array meaning "no pills for this step"),
	// so the second call's empty entry wins and clears the row.
	test("clears pills when a later flow call in the same turn carries an empty array", () => {
		const message = assistantMessage([
			flowToolPart(["Bronze", "Silver", "Gold"], "call-1"),
			flowToolPart([], "call-2"),
		]);

		expect(extractFlowSuggestions(message)).toEqual([]);
	});

	test("does not let a non-flow tool part after a flow part clear the pills", () => {
		const message = assistantMessage([
			flowToolPart(["Bronze", "Silver", "Gold"], "call-1"),
			nonFlowToolPart("call-2"),
		]);

		expect(extractFlowSuggestions(message)).toEqual([
			"Bronze",
			"Silver",
			"Gold",
		]);
	});

	test("ignores a tool part that has not produced output yet", () => {
		const message = assistantMessage([
			{ type: "tool-my_flow", toolCallId: "call-1", state: "input-streaming" },
		]);

		expect(extractFlowSuggestions(message)).toBeNull();
	});
});

describe("extractFollowupSuggestions", () => {
	test("reads the data-suggestions part", () => {
		const message = assistantMessage([dataSuggestionsPart(["F1", "F2"])]);

		expect(extractFollowupSuggestions(message)).toEqual(["F1", "F2"]);
	});

	test("returns null for an absent or empty part", () => {
		expect(extractFollowupSuggestions(assistantMessage([]))).toBeNull();
		expect(
			extractFollowupSuggestions(assistantMessage([dataSuggestionsPart([])])),
		).toBeNull();
	});
});
