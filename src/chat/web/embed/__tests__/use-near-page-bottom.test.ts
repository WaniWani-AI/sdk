import { describe, expect, test } from "bun:test";
import { isNearPageBottom } from "../use-near-page-bottom";

const page = (scrollY: number) => ({
	scrollY,
	viewportHeight: 800,
	documentHeight: 3000,
});

describe("isNearPageBottom", () => {
	test("hides once within the threshold of the end of the page", () => {
		// 3000 - (2000 + 800) = 200px left.
		expect(isNearPageBottom(page(2000), 120, false)).toBe(false);
		// 3000 - (2100 + 800) = 100px left.
		expect(isNearPageBottom(page(2100), 120, false)).toBe(true);
		expect(isNearPageBottom(page(2200), 120, false)).toBe(true);
	});

	test("needs a scroll past the hysteresis band to come back", () => {
		// 150px left: outside the threshold, inside threshold + 48.
		expect(isNearPageBottom(page(2050), 120, false)).toBe(false);
		expect(isNearPageBottom(page(2050), 120, true)).toBe(true);
		// 200px left clears the band.
		expect(isNearPageBottom(page(2000), 120, true)).toBe(false);
	});

	test("a page that doesn't scroll never hides the dock", () => {
		expect(
			isNearPageBottom(
				{ scrollY: 0, viewportHeight: 800, documentHeight: 800 },
				120,
				false,
			),
		).toBe(false);
	});
});
