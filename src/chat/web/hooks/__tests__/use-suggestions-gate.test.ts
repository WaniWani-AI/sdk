import { describe, expect, test } from "bun:test";
import {
	isDynamicSuggestionsEnabled,
	isFlowSuggestionsEnabled,
	toSuggestionsConfig,
} from "../use-suggestions";

describe("isDynamicSuggestionsEnabled", () => {
	test("disabled when the host passes no suggestions config at all", () => {
		expect(isDynamicSuggestionsEnabled(undefined)).toBe(false);
	});

	test("enabled for `true`", () => {
		expect(isDynamicSuggestionsEnabled(true)).toBe(true);
	});

	test("enabled when only initial prompts are configured", () => {
		expect(isDynamicSuggestionsEnabled({ initial: ["Hi"] })).toBe(true);
	});

	test("enabled for an empty config object", () => {
		expect(isDynamicSuggestionsEnabled({})).toBe(true);
	});

	test("enabled for an explicit dynamic opt-in", () => {
		expect(isDynamicSuggestionsEnabled({ dynamic: true })).toBe(true);
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

describe("isFlowSuggestionsEnabled", () => {
	test("disabled when the host passes no suggestions config at all", () => {
		expect(isFlowSuggestionsEnabled(undefined)).toBe(false);
	});

	test("enabled for `true`", () => {
		expect(isFlowSuggestionsEnabled(true)).toBe(true);
	});

	test("disabled for `false`", () => {
		expect(isFlowSuggestionsEnabled(false)).toBe(false);
	});

	test("disabled when only initial prompts are configured", () => {
		expect(isFlowSuggestionsEnabled({ initial: ["Hi"] })).toBe(false);
	});

	test("enabled for a dynamic-only opt-in", () => {
		expect(isFlowSuggestionsEnabled({ dynamic: true })).toBe(true);
	});

	test("enabled when initial prompts and the opt-in are combined", () => {
		expect(isFlowSuggestionsEnabled({ initial: ["Hi"], dynamic: true })).toBe(
			true,
		);
	});

	test("disabled when dynamic is explicitly turned off", () => {
		expect(isFlowSuggestionsEnabled({ dynamic: false })).toBe(false);
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

	test("forwards a dynamic false even without starter prompts", () => {
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

	test("composes with the gate: dynamic false without starter prompts disables per-turn suggestions", () => {
		expect(
			isDynamicSuggestionsEnabled(
				toSuggestionsConfig({ dynamicSuggestions: false }),
			),
		).toBe(false);
	});

	test("composes with the flow gate: the opt-in enables flow pills", () => {
		expect(
			isFlowSuggestionsEnabled(
				toSuggestionsConfig({ dynamicSuggestions: true }),
			),
		).toBe(true);
	});

	test("composes with the flow gate: starter prompts alone leave flow pills off", () => {
		expect(
			isFlowSuggestionsEnabled(toSuggestionsConfig({ suggestions: ["Hi"] })),
		).toBe(false);
	});
});
