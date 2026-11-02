import { describe, expect, test } from "bun:test";
import { parseCssDuration } from "./css-duration";

describe("parseCssDuration", () => {
	test("reads milliseconds and seconds, with surrounding whitespace", () => {
		expect(parseCssDuration("250ms")).toBe(250);
		expect(parseCssDuration(" 1.5s ")).toBe(1500);
		expect(parseCssDuration(".5s")).toBe(500);
	});

	test("a zero duration is a value, not a miss", () => {
		expect(parseCssDuration("0ms")).toBe(0);
		expect(parseCssDuration("0s")).toBe(0);
	});

	test("anything that is not a CSS time is undefined", () => {
		expect(parseCssDuration("")).toBeUndefined();
		expect(parseCssDuration("fast")).toBeUndefined();
		expect(parseCssDuration("-200ms")).toBeUndefined();
		expect(parseCssDuration("200")).toBeUndefined();
	});
});
