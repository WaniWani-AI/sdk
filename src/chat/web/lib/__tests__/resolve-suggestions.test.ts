import { describe, expect, test } from "bun:test";
import type { SuggestionCandidates } from "../resolve-suggestions";
import { resolveSuggestions, toSuggestions } from "../resolve-suggestions";

const page = [{ id: "p1", text: "Page one" }];
const channel = toSuggestions(["Fixed one", "Fixed two"]);

/** Nothing anywhere; each test fills in the rungs it cares about. */
const NONE: SuggestionCandidates = {
	flow: null,
	followup: null,
	page: null,
	channel: null,
};

describe("resolveSuggestions — flow > followup > page > channel", () => {
	test("flow wins over followup", () => {
		expect(
			resolveSuggestions({
				...NONE,
				flow: toSuggestions(["From flow"]),
				followup: toSuggestions(["From followup"]),
			}),
		).toEqual({
			origin: "flow",
			suggestions: [{ id: null, text: "From flow" }],
		});
	});

	test("flow wins over the configured rungs", () => {
		expect(
			resolveSuggestions({
				...NONE,
				flow: toSuggestions(["From flow"]),
				page,
				channel,
			})?.origin,
		).toBe("flow");
	});

	test("an empty flow entry clears the row and suppresses every weaker rung", () => {
		expect(
			resolveSuggestions({
				flow: [],
				followup: toSuggestions(["From followup"]),
				page,
				channel,
			}),
		).toEqual({ origin: "flow", suggestions: [] });
	});

	test("followup fills the row when there is no flow entry", () => {
		expect(
			resolveSuggestions({
				...NONE,
				followup: toSuggestions(["From followup"]),
			}),
		).toEqual({
			origin: "followup",
			suggestions: [{ id: null, text: "From followup" }],
		});
	});

	test("page wins over channel", () => {
		expect(resolveSuggestions({ ...NONE, page, channel })).toEqual({
			origin: "page",
			suggestions: page,
		});
	});

	test("channel fills the row when no page matched", () => {
		expect(resolveSuggestions({ ...NONE, channel })).toEqual({
			origin: "channel",
			suggestions: channel,
		});
	});

	test("an empty page match falls through to channel", () => {
		expect(resolveSuggestions({ ...NONE, page: [], channel })?.origin).toBe(
			"channel",
		);
	});
});

describe("resolveSuggestions — empty is only authoritative for flow", () => {
	test("no candidates at all resolves to null", () => {
		expect(resolveSuggestions(NONE)).toBeNull();
	});

	test("every rung empty resolves to null", () => {
		expect(
			resolveSuggestions({ flow: null, followup: [], page: [], channel: [] }),
		).toBeNull();
	});

	test("an empty followup falls through instead of clearing", () => {
		expect(resolveSuggestions({ ...NONE, followup: [], channel })?.origin).toBe(
			"channel",
		);
	});
});

describe("toSuggestions", () => {
	test("raw texts carry no stored identity", () => {
		expect(toSuggestions(["a", "b"])).toEqual([
			{ id: null, text: "a" },
			{ id: null, text: "b" },
		]);
	});
});
