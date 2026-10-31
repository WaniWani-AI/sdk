import { describe, expect, it } from "bun:test";
import {
	autoHeightFromMeta,
	isDisplayTool,
	metaOf,
	resourceUriFromMeta,
	viewUriFor,
} from "../view-uri";

describe("resourceUriFromMeta", () => {
	it("reads the nested MCP Apps spelling", () => {
		expect(
			resourceUriFromMeta({ ui: { resourceUri: "ui://views/a.html" } }),
		).toBe("ui://views/a.html");
	});

	it("reads the flat MCP Apps spelling", () => {
		expect(resourceUriFromMeta({ "ui/resourceUri": "ui://views/b.html" })).toBe(
			"ui://views/b.html",
		);
	});

	it("reads the OpenAI Apps SDK spelling", () => {
		expect(
			resourceUriFromMeta({ "openai/outputTemplate": "ui://views/c.html" }),
		).toBe("ui://views/c.html");
	});

	it("prefers nested over flat over openai when a server emits several", () => {
		expect(
			resourceUriFromMeta({
				ui: { resourceUri: "ui://nested" },
				"ui/resourceUri": "ui://flat",
				"openai/outputTemplate": "ui://openai",
			}),
		).toBe("ui://nested");
		expect(
			resourceUriFromMeta({
				"ui/resourceUri": "ui://flat",
				"openai/outputTemplate": "ui://openai",
			}),
		).toBe("ui://flat");
	});

	it("ignores empty strings rather than returning them", () => {
		expect(
			resourceUriFromMeta({
				ui: { resourceUri: "" },
				"ui/resourceUri": "ui://flat",
			}),
		).toBe("ui://flat");
	});

	it("ignores non-string values", () => {
		expect(resourceUriFromMeta({ ui: { resourceUri: 42 } })).toBeUndefined();
		expect(resourceUriFromMeta({ "ui/resourceUri": null })).toBeUndefined();
	});

	it("survives a non-object ui key", () => {
		expect(resourceUriFromMeta({ ui: "nope" })).toBeUndefined();
		expect(resourceUriFromMeta({ ui: null })).toBeUndefined();
	});

	it("returns undefined for absent meta", () => {
		expect(resourceUriFromMeta(undefined)).toBeUndefined();
		expect(resourceUriFromMeta({})).toBeUndefined();
	});
});

describe("autoHeightFromMeta", () => {
	it("is true only for an explicit boolean true", () => {
		expect(autoHeightFromMeta({ ui: { autoHeight: true } })).toBe(true);
		expect(autoHeightFromMeta({ ui: { autoHeight: "true" } })).toBe(false);
		expect(autoHeightFromMeta({ ui: {} })).toBe(false);
		expect(autoHeightFromMeta(undefined)).toBe(false);
	});
});

describe("metaOf", () => {
	it("pulls _meta off a result", () => {
		expect(metaOf({ _meta: { a: 1 } })).toEqual({ a: 1 });
	});

	it("returns undefined for anything without one", () => {
		expect(metaOf(undefined)).toBeUndefined();
		expect(metaOf(null)).toBeUndefined();
		expect(metaOf("text")).toBeUndefined();
		expect(metaOf({})).toBeUndefined();
		expect(metaOf({ _meta: "nope" })).toBeUndefined();
	});
});

describe("viewUriFor / isDisplayTool", () => {
	it("reads the binding off a tool definition", () => {
		const tool = { _meta: { ui: { resourceUri: "ui://views/book.html?v=9" } } };
		expect(viewUriFor(tool)).toBe("ui://views/book.html?v=9");
		expect(isDisplayTool(tool)).toBe(true);
	});

	it("treats a tool with no view as an ordinary tool", () => {
		expect(viewUriFor({ _meta: { other: true } })).toBeUndefined();
		expect(isDisplayTool({ _meta: { other: true } })).toBe(false);
		expect(isDisplayTool({})).toBe(false);
		expect(isDisplayTool(undefined)).toBe(false);
	});
});
