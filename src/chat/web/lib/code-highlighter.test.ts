import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
	code,
	type HighlightOptions,
	type HighlightResult,
} from "@streamdown/code";
import { codeHighlighter } from "./code-highlighter";

const restorers: (() => void)[] = [];
function trackSpy<T extends { mockRestore(): void }>(spy: T): T {
	restorers.push(() => spy.mockRestore());
	return spy;
}
afterEach(() => {
	for (const restore of restorers.splice(0).reverse()) {
		restore();
	}
});

describe("chat code highlighting", () => {
	for (const language of [
		"env",
		"waniwani-unknown-language",
		"",
		"text",
		"plaintext",
	]) {
		test(`returns plain fallback for unsupported fence ${language} without starting Shiki`, () => {
			const highlight = trackSpy(spyOn(code, "highlight"));
			const callback = mock(() => {});
			const result = Reflect.apply(codeHighlighter.highlight, codeHighlighter, [
				{
					code: "API_KEY=example\nLABEL=é😀",
					language,
					themes: code.getThemes(),
				},
				callback,
			]);
			expect(result).toBeNull();
			expect(highlight).not.toHaveBeenCalled();
			expect(callback).not.toHaveBeenCalled();
		});
	}

	test("a supported language returns highlighted tokens through its async callback", async () => {
		const options: HighlightOptions = {
			code: "const answer = 42;",
			language: "javascript",
			themes: codeHighlighter.getThemes(),
		};
		const result = await new Promise<HighlightResult>((resolve) => {
			const immediate = codeHighlighter.highlight(options, resolve);
			if (immediate) {
				resolve(immediate);
			}
		});
		expect(
			result.tokens
				.flat()
				.map((token) => token.content)
				.join(""),
		).toBe("const answer = 42;");
		expect(
			result.tokens.flat().some((token) => token.color !== "inherit"),
		).toBe(true);
		expect(codeHighlighter.highlight(options)).toEqual(result);
	});

	test("supported requests preserve options, callbacks and the delegate result", () => {
		const options: HighlightOptions = {
			code: "const amount = 7;",
			language: "typescript",
			themes: ["github-light", "github-dark"],
		};
		const result: HighlightResult = {
			tokens: [[{ content: options.code, offset: 0 }]],
			fg: "#000000",
			bg: "#ffffff",
		};
		const callback = mock(() => {});
		const highlight = trackSpy(spyOn(code, "highlight")).mockReturnValue(
			result,
		);
		expect(codeHighlighter.highlight(options, callback)).toBe(result);
		expect(highlight).toHaveBeenCalledWith(options, callback);
		expect(codeHighlighter.supportsLanguage("typescript")).toBe(true);
		expect(codeHighlighter.getSupportedLanguages()).toContain("typescript");
		expect(codeHighlighter.getThemes()).toEqual(code.getThemes());
	});

	test("the embed no-language contract returns fallback even for a known grammar", () => {
		trackSpy(spyOn(code, "supportsLanguage")).mockReturnValue(false);
		const highlight = trackSpy(spyOn(code, "highlight"));
		expect(
			codeHighlighter.highlight({
				code: "const x = 1",
				language: "javascript",
				themes: code.getThemes(),
			}),
		).toBeNull();
		expect(highlight).not.toHaveBeenCalled();
	});
});
