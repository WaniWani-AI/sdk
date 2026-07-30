import { describe, expect, test } from "bun:test";
import {
	DEFAULT_SUGGESTION_ORIGINS,
	isOriginEnabled,
	resolveSuggestionOrigins,
	toSuggestionsConfig,
} from "../use-suggestions";

describe("resolveSuggestionOrigins", () => {
	test("rule 1: `false` disables every origin", () => {
		expect(resolveSuggestionOrigins(false)).toEqual([]);
	});

	test("rule 2: `true` enables every origin", () => {
		expect(resolveSuggestionOrigins(true)).toEqual([
			"channel",
			"page",
			"flow",
			"followup",
		]);
	});

	test("rule 3: an object's `origins` is used exactly as given", () => {
		expect(resolveSuggestionOrigins({ origins: ["flow"] })).toEqual(["flow"]);
		expect(resolveSuggestionOrigins({ origins: ["channel", "page"] })).toEqual([
			"channel",
			"page",
		]);
	});

	test("rule 3: an empty `origins` array means nothing renders", () => {
		expect(resolveSuggestionOrigins({ origins: [] })).toEqual([]);
	});

	test("rule 3 beats rule 4: `origins` wins even when legacy `dynamic` is also set", () => {
		expect(
			resolveSuggestionOrigins({ origins: ["flow"], dynamic: false }),
		).toEqual(["flow"]);
		expect(resolveSuggestionOrigins({ origins: [], dynamic: true })).toEqual(
			[],
		);
	});

	test("rule 4: legacy `dynamic: true` enables every origin", () => {
		expect(resolveSuggestionOrigins({ dynamic: true })).toEqual([
			"channel",
			"page",
			"flow",
			"followup",
		]);
	});

	test("rule 5: legacy `dynamic: false` disables every origin", () => {
		expect(resolveSuggestionOrigins({ dynamic: false })).toEqual([]);
	});

	test("rule 6: `undefined` falls back to the default origins", () => {
		expect(resolveSuggestionOrigins(undefined)).toEqual([
			...DEFAULT_SUGGESTION_ORIGINS,
		]);
	});

	test("rule 6: an object with neither `origins` nor `dynamic` falls back to the default origins", () => {
		expect(resolveSuggestionOrigins({ initial: ["Hi"] })).toEqual([
			...DEFAULT_SUGGESTION_ORIGINS,
		]);
		expect(resolveSuggestionOrigins({})).toEqual([
			...DEFAULT_SUGGESTION_ORIGINS,
		]);
	});

	test("default origins are channel, page, and followup — flow stays opt-in", () => {
		expect(DEFAULT_SUGGESTION_ORIGINS).toEqual(["channel", "page", "followup"]);
	});
});

describe("isOriginEnabled", () => {
	test("reflects the resolved origin list", () => {
		expect(isOriginEnabled(undefined, "channel")).toBe(true);
		expect(isOriginEnabled(undefined, "flow")).toBe(false);
		expect(isOriginEnabled(true, "flow")).toBe(true);
		expect(isOriginEnabled(false, "channel")).toBe(false);
		expect(isOriginEnabled({ origins: ["flow"] }, "flow")).toBe(true);
		expect(isOriginEnabled({ origins: ["flow"] }, "channel")).toBe(false);
	});
});

describe("toSuggestionsConfig", () => {
	test("returns undefined when neither field is set", () => {
		expect(toSuggestionsConfig({})).toBeUndefined();
	});

	test("maps starter prompts to initial", () => {
		expect(toSuggestionsConfig({ suggestions: ["Hi"] })).toEqual({
			initial: ["Hi"],
			origins: undefined,
		});
	});

	test("forwards suggestionOrigins even without starter prompts", () => {
		expect(toSuggestionsConfig({ suggestionOrigins: ["flow"] })).toEqual({
			initial: undefined,
			origins: ["flow"],
		});
	});

	test("forwards both fields together", () => {
		expect(
			toSuggestionsConfig({
				suggestions: ["Hi"],
				suggestionOrigins: ["channel", "flow"],
			}),
		).toEqual({ initial: ["Hi"], origins: ["channel", "flow"] });
	});

	test("composes with the gate: an empty suggestionOrigins disables per-turn suggestions", () => {
		expect(
			resolveSuggestionOrigins(toSuggestionsConfig({ suggestionOrigins: [] })),
		).toEqual([]);
	});

	test("composes with the gate: `flow` in suggestionOrigins enables flow pills", () => {
		expect(
			isOriginEnabled(
				toSuggestionsConfig({ suggestionOrigins: ["flow"] }),
				"flow",
			),
		).toBe(true);
	});

	test("composes with the gate: starter prompts alone leave flow pills off (falls back to defaults)", () => {
		expect(
			isOriginEnabled(toSuggestionsConfig({ suggestions: ["Hi"] }), "flow"),
		).toBe(false);
	});
});
