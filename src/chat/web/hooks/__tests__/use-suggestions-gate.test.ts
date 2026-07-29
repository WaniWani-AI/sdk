import { describe, expect, test } from "bun:test";
import { isDynamicSuggestionsEnabled } from "../use-suggestions";

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
});
