import { describe, expect, test } from "bun:test";
import { extractConfigFromMetadata } from "./use-waniwani";

describe("extractConfigFromMetadata", () => {
	test("returns null for null metadata", () => {
		expect(extractConfigFromMetadata(null)).toBeNull();
	});

	test("returns null when no waniwani/widget key is present", () => {
		expect(extractConfigFromMetadata({ other: "value" })).toBeNull();
	});

	test("returns null when the widget config has no endpoint", () => {
		expect(
			extractConfigFromMetadata({
				"waniwani/widget": { source: "chatgpt", token: "t" },
			}),
		).toBeNull();
	});

	test("reads the config from the metadata root key", () => {
		expect(
			extractConfigFromMetadata({
				"waniwani/widget": {
					endpoint: "https://api.waniwani.ai/v2/track",
					source: "chatgpt",
					token: "tok",
					sessionId: "sess",
				},
			}),
		).toEqual({
			endpoint: "https://api.waniwani.ai/v2/track",
			source: "chatgpt",
			token: "tok",
			sessionId: "sess",
		});
	});

	test("reads the config from a nested _meta object", () => {
		expect(
			extractConfigFromMetadata({
				_meta: {
					"waniwani/widget": {
						endpoint: "https://api.waniwani.ai/v2/track",
						source: "claude",
					},
				},
			}),
		).toEqual({
			endpoint: "https://api.waniwani.ai/v2/track",
			source: "claude",
			token: undefined,
			sessionId: undefined,
		});
	});

	test("prefers the root key over the nested _meta key", () => {
		expect(
			extractConfigFromMetadata({
				"waniwani/widget": {
					endpoint: "https://root.example/track",
					source: "root",
				},
				_meta: {
					"waniwani/widget": {
						endpoint: "https://nested.example/track",
						source: "nested",
					},
				},
			}),
		).toMatchObject({ endpoint: "https://root.example/track", source: "root" });
	});

	test("normalizes blank strings to undefined and trims values", () => {
		expect(
			extractConfigFromMetadata({
				"waniwani/widget": {
					endpoint: "  https://api.waniwani.ai/v2/track  ",
					source: "   ",
					token: "",
				},
			}),
		).toEqual({
			endpoint: "https://api.waniwani.ai/v2/track",
			source: undefined,
			token: undefined,
			sessionId: undefined,
		});
	});
});
