import { describe, expect, test } from "bun:test";
import type { KbSearchTrace } from "../../../kb/types.js";
import { buildTrackInput } from "./helpers.js";

const trace: KbSearchTrace[] = [
	{
		query: "q",
		resultCount: 1,
		results: [{ source: "a.md", heading: "A", score: 0.5 }],
	},
];

describe("buildTrackInput kbSearch fold-in", () => {
	test("folds kbSearch onto tool.called properties", () => {
		const input = buildTrackInput(
			"ask",
			{},
			{},
			undefined,
			undefined,
			{ input: {}, output: {} },
			trace,
		);
		expect("event" in input && input.event).toBe("tool.called");
		expect(input.properties?.kbSearch).toEqual(trace);
	});

	test("omits kbSearch when no searches ran", () => {
		const input = buildTrackInput(
			"ask",
			{},
			{},
			undefined,
			undefined,
			{ input: {}, output: {} },
			[],
		);
		expect(input.properties && "kbSearch" in input.properties).toBe(false);
	});
});
