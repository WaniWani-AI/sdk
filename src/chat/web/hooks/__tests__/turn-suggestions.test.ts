import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
	extractFlowSuggestions,
	resolveTurnSuggestions,
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

	test("ignores an empty suggestions array", () => {
		const message = assistantMessage([flowToolPart([])]);

		expect(extractFlowSuggestions(message)).toBeNull();
	});

	// Regression test for the bug where a turn calling the flow twice — an
	// interrupt-with-suggestions call followed by a complete/widget/error call
	// carrying no `waniwani/suggestions` key — left the first call's pills on
	// screen after the flow had moved on or finished. With the key made
	// authoritative on every flow result (an empty array meaning "no pills for
	// this step"), the second call's empty entry must win.
	test("clears pills when a later flow call in the same turn carries an empty array", () => {
		const message = assistantMessage([
			flowToolPart(["Bronze", "Silver", "Gold"], "call-1"),
			flowToolPart([], "call-2"),
		]);

		expect(extractFlowSuggestions(message)).toBeNull();
		expect(resolveTurnSuggestions(message)).toBeNull();
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

describe("resolveTurnSuggestions", () => {
	test("reports flow suggestions with source flow", () => {
		const message = assistantMessage([flowToolPart(["Oui", "Non"])]);

		expect(resolveTurnSuggestions(message)).toEqual({
			suggestions: ["Oui", "Non"],
			source: "flow",
		});
	});

	test("flow suggestions win over a streamed data part", () => {
		const message = assistantMessage([
			dataSuggestionsPart(["From", "Stream"]),
			flowToolPart(["From", "Flow"]),
		]);

		expect(resolveTurnSuggestions(message)).toEqual({
			suggestions: ["From", "Flow"],
			source: "flow",
		});
	});

	test("falls back to a streamed data part when no flow result carries the key", () => {
		const message = assistantMessage([
			{ type: "text", text: "Here you go." },
			dataSuggestionsPart(["From", "Stream"]),
		]);

		expect(resolveTurnSuggestions(message)).toEqual({
			suggestions: ["From", "Stream"],
			source: "streamed",
		});
	});

	test("returns null when the turn carries neither", () => {
		const message = assistantMessage([{ type: "text", text: "All done." }]);

		expect(resolveTurnSuggestions(message)).toBeNull();
	});
});
