import { describe, expect, test } from "bun:test";
import { resolveStarters, resolveSuggestions } from "../resolve-suggestions";

const page = [{ id: "p1", text: "Page one" }];
const channel = ["Fixed one", "Fixed two"];

describe("resolveSuggestions — fixed hierarchy flow > followup > page > channel", () => {
	test("flow wins over followup", () => {
		expect(
			resolveSuggestions({
				flow: ["From flow"],
				followup: ["From followup"],
				starters: null,
			}),
		).toEqual({
			origin: "flow",
			suggestions: [{ id: null, text: "From flow" }],
		});
	});

	test("an empty flow entry is an authoritative clear — followup is suppressed", () => {
		expect(
			resolveSuggestions({
				flow: [],
				followup: ["From followup"],
				starters: null,
			}),
		).toEqual({ origin: "flow", suggestions: [] });
	});

	test("no flow entry lets followup fill the row", () => {
		expect(
			resolveSuggestions({
				flow: null,
				followup: ["From followup"],
				starters: null,
			}),
		).toEqual({
			origin: "followup",
			suggestions: [{ id: null, text: "From followup" }],
		});
	});

	test("a turn with neither flow nor followup resolves to null", () => {
		expect(
			resolveSuggestions({ flow: null, followup: null, starters: null }),
		).toBeNull();
	});

	test("an empty followup with no flow entry resolves to null", () => {
		expect(
			resolveSuggestions({ flow: null, followup: [], starters: null }),
		).toBeNull();
	});

	test("pre-conversation: page starters win over channel", () => {
		expect(
			resolveSuggestions({
				flow: null,
				followup: null,
				starters: { page, channel },
			}),
		).toEqual({ origin: "page", suggestions: page });
	});

	test("pre-conversation: channel fills when no page matches", () => {
		expect(
			resolveSuggestions({
				flow: null,
				followup: null,
				starters: { page: null, channel },
			}),
		).toEqual({
			origin: "channel",
			suggestions: [
				{ id: null, text: "Fixed one" },
				{ id: null, text: "Fixed two" },
			],
		});
	});

	test("pre-conversation: an empty page match falls back to channel", () => {
		expect(
			resolveSuggestions({
				flow: null,
				followup: null,
				starters: { page: [], channel },
			})?.origin,
		).toBe("channel");
	});

	test("nothing anywhere resolves to null", () => {
		expect(
			resolveSuggestions({
				flow: null,
				followup: null,
				starters: { page: null, channel: [] },
			}),
		).toBeNull();
	});

	test("flow wins even over starters (defensive: these never co-occur in practice)", () => {
		expect(
			resolveSuggestions({
				flow: ["From flow"],
				followup: null,
				starters: { page, channel },
			})?.origin,
		).toBe("flow");
	});
});

describe("resolveStarters", () => {
	test("page prompts win when present", () => {
		expect(resolveStarters({ page, channel })).toEqual({
			origin: "page",
			suggestions: page,
		});
	});

	test("channel is the fallback", () => {
		expect(resolveStarters({ page: null, channel })?.origin).toBe("channel");
	});

	test("no starters at all resolves to null", () => {
		expect(resolveStarters({ page: null, channel: [] })).toBeNull();
	});
});
