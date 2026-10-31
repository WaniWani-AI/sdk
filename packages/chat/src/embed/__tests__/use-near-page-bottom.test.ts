import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { findPageFooter, isNearPageBottom } from "../use-near-page-bottom";

const page = (scrollY: number, footerTop: number | null = null) => ({
	scrollY,
	viewportHeight: 800,
	documentHeight: 3000,
	footerTop,
});

describe("isNearPageBottom — footer", () => {
	test("hides once the footer's top edge enters the viewport", () => {
		expect(isNearPageBottom(page(1500, 900), "footer", false)).toBe(false);
		expect(isNearPageBottom(page(1700, 700), "footer", false)).toBe(true);
	});

	test("needs the footer to leave by the hysteresis band to come back", () => {
		// 820 is below the fold, but inside the 48px band.
		expect(isNearPageBottom(page(1580, 820), "footer", false)).toBe(false);
		expect(isNearPageBottom(page(1580, 820), "footer", true)).toBe(true);
		expect(isNearPageBottom(page(1500, 900), "footer", true)).toBe(false);
	});

	test("falls back to 120px from the end when there's no footer", () => {
		// 3000 - (2000 + 800) = 200px left.
		expect(isNearPageBottom(page(2000), "footer", false)).toBe(false);
		// 100px left.
		expect(isNearPageBottom(page(2100), "footer", false)).toBe(true);
	});
});

describe("isNearPageBottom — fixed distance", () => {
	test("a number ignores the footer and measures from the end", () => {
		expect(isNearPageBottom(page(1700, 700), 120, false)).toBe(false);
		expect(isNearPageBottom(page(2100, 0), 120, false)).toBe(true);
	});

	test("needs a scroll past the hysteresis band to come back", () => {
		// 150px left: outside the threshold, inside threshold + 48.
		expect(isNearPageBottom(page(2050), 120, false)).toBe(false);
		expect(isNearPageBottom(page(2050), 120, true)).toBe(true);
		expect(isNearPageBottom(page(2000), 120, true)).toBe(false);
	});
});

describe("isNearPageBottom — never strands the dock", () => {
	test("a page that doesn't scroll keeps the dock", () => {
		expect(
			isNearPageBottom(
				{
					scrollY: 0,
					viewportHeight: 800,
					documentHeight: 800,
					footerTop: 600,
				},
				"footer",
				false,
			),
		).toBe(false);
	});

	test("a page that loads with its footer in view keeps the dock until a scroll", () => {
		expect(isNearPageBottom(page(0, 600), "footer", false)).toBe(false);
		expect(isNearPageBottom(page(10, 590), "footer", false)).toBe(true);
	});
});

describe("findPageFooter", () => {
	const docWith = (html: string) => {
		const win = new Window();
		win.document.body.innerHTML = html;
		return win.document as unknown as Document;
	};

	test("picks the last footer, not an article's", () => {
		const doc = docWith(
			'<article><footer id="card"></footer></article><footer id="site"></footer>',
		);
		expect(findPageFooter(doc)?.id).toBe("site");
	});

	test("accepts role=contentinfo", () => {
		const doc = docWith('<div role="contentinfo" id="site"></div>');
		expect(findPageFooter(doc)?.id).toBe("site");
	});

	test("skips a fixed footer", () => {
		const doc = docWith(
			'<footer id="site"></footer><footer id="bar" style="position: fixed"></footer>',
		);
		expect(findPageFooter(doc)?.id).toBe("site");
	});

	test("null when the page has none", () => {
		expect(findPageFooter(docWith("<main></main>"))).toBeNull();
	});
});
