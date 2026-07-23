import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME, mergeTheme, themeToCSSProperties } from "../theme";

describe("theme defaults preserve current rendering", () => {
	test("messageBorderRadius default is 8 (matches hardcoded rounded-lg)", () => {
		expect(DEFAULT_THEME.messageBorderRadius).toBe(8);
	});
});

describe("themeToCSSProperties", () => {
	test("emits --ww-msg-radius in px when set", () => {
		const vars = themeToCSSProperties({ messageBorderRadius: 20 });
		expect(vars["--ww-msg-radius"]).toBe("20px");
	});

	test("omits keys the user did not set", () => {
		const vars = themeToCSSProperties({ primaryColor: "#000" });
		expect(vars["--ww-msg-radius"]).toBeUndefined();
		expect(vars["--ww-primary"]).toBe("#000");
	});

	test("mergeTheme fills unset keys from defaults", () => {
		const merged = mergeTheme({ primaryColor: "#f00" });
		expect(merged.primaryColor).toBe("#f00");
		expect(merged.messageBorderRadius).toBe(8);
	});

	test("emits new bubble + typography vars", () => {
		const vars = themeToCSSProperties({
			userBubbleTextColor: "#fff",
			assistantBubbleTextColor: "#eee",
			messagePaddingX: 20,
			messagePaddingY: 14,
			messageMaxWidth: "70%",
			fontSize: 15,
			lineHeight: "1.6",
		});
		expect(vars["--ww-user-bubble-text"]).toBe("#fff");
		expect(vars["--ww-assistant-bubble-text"]).toBe("#eee");
		expect(vars["--ww-msg-pad-x"]).toBe("20px");
		expect(vars["--ww-msg-pad-y"]).toBe("14px");
		expect(vars["--ww-msg-max-width"]).toBe("70%");
		expect(vars["--ww-font-size"]).toBe("15px");
		expect(vars["--ww-line-height"]).toBe("1.6");
	});
});
