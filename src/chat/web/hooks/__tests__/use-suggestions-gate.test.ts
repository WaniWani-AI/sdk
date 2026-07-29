import { describe, expect, test } from "bun:test";
import {
	isDynamicSuggestionsEnabled,
	toSuggestionsConfig,
} from "../use-suggestions";

describe("isDynamicSuggestionsEnabled", () => {
	test("enabled when the host passes no suggestions config at all", () => {
		// A channel with no starter prompts configured must still show the pills
		// a flow drives. These two settings are unrelated.
		expect(isDynamicSuggestionsEnabled(undefined)).toBe(true);
	});

	test("enabled for `true`", () => {
		expect(isDynamicSuggestionsEnabled(true)).toBe(true);
	});

	test("enabled when only initial prompts are configured", () => {
		expect(isDynamicSuggestionsEnabled({ initial: ["Hi"] })).toBe(true);
	});

	test("disabled for `false`", () => {
		expect(isDynamicSuggestionsEnabled(false)).toBe(false);
	});

	test("disabled when dynamic is explicitly turned off", () => {
		expect(
			isDynamicSuggestionsEnabled({ initial: ["Hi"], dynamic: false }),
		).toBe(false);
	});

	test("returns false for a dynamic-only config object", () => {
		expect(isDynamicSuggestionsEnabled({ dynamic: false })).toBe(false);
	});
});

describe("toSuggestionsConfig", () => {
	test("returns undefined when neither field is set", () => {
		expect(toSuggestionsConfig({})).toBeUndefined();
	});

	test("maps starter prompts to initial", () => {
		expect(toSuggestionsConfig({ suggestions: ["Hi"] })).toEqual({
			initial: ["Hi"],
			dynamic: undefined,
		});
	});

	test("forwards the dynamic opt-out even without starter prompts", () => {
		expect(toSuggestionsConfig({ dynamicSuggestions: false })).toEqual({
			initial: undefined,
			dynamic: false,
		});
	});

	test("forwards both fields together", () => {
		expect(
			toSuggestionsConfig({ suggestions: ["Hi"], dynamicSuggestions: false }),
		).toEqual({ initial: ["Hi"], dynamic: false });
	});

	test("composes with the gate: opt-out without starter prompts disables pills", () => {
		expect(
			isDynamicSuggestionsEnabled(
				toSuggestionsConfig({ dynamicSuggestions: false }),
			),
		).toBe(false);
	});
});
