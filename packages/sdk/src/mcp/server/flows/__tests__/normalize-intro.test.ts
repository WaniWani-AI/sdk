import { describe, expect, test } from "bun:test";
import { normalizeIntro } from "../intro";

const VERBATIM = "Acme is the data controller.";
const INSTRUCTIONS = "Say hi as Léa from Acme.";

describe("normalizeIntro", () => {
	test("a flow with no intro resolves to nothing", () => {
		expect(normalizeIntro(undefined, "home_quote")).toBeUndefined();
	});

	test("a bare string means verbatim, trimmed", () => {
		expect(normalizeIntro(`  ${VERBATIM}  `, "home_quote")).toEqual({
			verbatim: VERBATIM,
		});
	});

	test("either half alone is enough", () => {
		expect(normalizeIntro({ verbatim: VERBATIM }, "home_quote")).toEqual({
			verbatim: VERBATIM,
		});
		expect(
			normalizeIntro({ instructions: INSTRUCTIONS }, "home_quote"),
		).toEqual({ instructions: INSTRUCTIONS });
	});

	test("both halves are kept", () => {
		expect(
			normalizeIntro(
				{ verbatim: VERBATIM, instructions: INSTRUCTIONS },
				"home_quote",
			),
		).toEqual({ verbatim: VERBATIM, instructions: INSTRUCTIONS });
	});

	test("whitespace-only halves drop out", () => {
		expect(
			normalizeIntro({ verbatim: VERBATIM, instructions: "   " }, "home_quote"),
		).toEqual({ verbatim: VERBATIM });
	});

	test("an unusable intro throws, naming the flow", () => {
		expect(() => normalizeIntro("   ", "home_quote")).toThrow(
			/home_quote.*empty string/s,
		);
		expect(() => normalizeIntro({}, "home_quote")).toThrow(/needs `verbatim`/);
		expect(() => normalizeIntro({ verbatim: " " }, "home_quote")).toThrow(
			/needs `verbatim`/,
		);
	});
});
