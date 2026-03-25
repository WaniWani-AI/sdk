import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	deepMerge,
	deleteNestedValue,
	expandDotPaths,
	getNestedValue,
	getObjectShape,
	isObjectSchema,
	setNestedValue,
} from "../nested";

describe("isObjectSchema", () => {
	test("returns true for z.object", () => {
		expect(isObjectSchema(z.object({ name: z.string() }))).toBe(true);
	});

	test("returns false for z.string", () => {
		expect(isObjectSchema(z.string())).toBe(false);
	});

	test("returns false for z.record", () => {
		expect(isObjectSchema(z.record(z.string(), z.unknown()))).toBe(false);
	});
});

describe("getObjectShape", () => {
	test("returns shape for z.object", () => {
		const schema = z.object({
			name: z.string().describe("Name"),
			age: z.number().describe("Age"),
		});
		const shape = getObjectShape(schema)!;
		expect(Object.keys(shape)).toEqual(["name", "age"]);
	});

	test("returns null for non-object schemas", () => {
		expect(getObjectShape(z.string())).toBe(null);
		expect(getObjectShape(z.number())).toBe(null);
	});
});

describe("getNestedValue", () => {
	test("resolves flat path", () => {
		expect(getNestedValue({ email: "a@b.com" }, "email")).toBe("a@b.com");
	});

	test("resolves dot path", () => {
		expect(getNestedValue({ driver: { name: "John" } }, "driver.name")).toBe(
			"John",
		);
	});

	test("returns undefined for missing intermediate", () => {
		expect(getNestedValue({}, "driver.name")).toBe(undefined);
	});

	test("returns undefined for null intermediate", () => {
		expect(getNestedValue({ driver: null }, "driver.name")).toBe(undefined);
	});
});

describe("setNestedValue", () => {
	test("sets flat path", () => {
		const obj: Record<string, unknown> = {};
		setNestedValue(obj, "email", "a@b.com");
		expect(obj.email).toBe("a@b.com");
	});

	test("sets dot path creating intermediates", () => {
		const obj: Record<string, unknown> = {};
		setNestedValue(obj, "driver.name", "John");
		expect(obj).toEqual({ driver: { name: "John" } });
	});

	test("preserves existing siblings", () => {
		const obj: Record<string, unknown> = { driver: { license: "ABC" } };
		setNestedValue(obj, "driver.name", "John");
		expect(obj).toEqual({ driver: { name: "John", license: "ABC" } });
	});
});

describe("deleteNestedValue", () => {
	test("deletes flat path", () => {
		const obj: Record<string, unknown> = { email: "a@b.com" };
		deleteNestedValue(obj, "email");
		expect(obj.email).toBe(undefined);
	});

	test("deletes only the leaf", () => {
		const obj: Record<string, unknown> = {
			driver: { name: "John", license: "ABC" },
		};
		deleteNestedValue(obj, "driver.name");
		expect(obj).toEqual({ driver: { license: "ABC" } });
	});

	test("no-op for missing path", () => {
		const obj: Record<string, unknown> = {};
		deleteNestedValue(obj, "driver.name");
		expect(obj).toEqual({});
	});
});

describe("expandDotPaths", () => {
	test("expands dot paths", () => {
		expect(
			expandDotPaths({ "driver.name": "John", "driver.license": "ABC" }),
		).toEqual({ driver: { name: "John", license: "ABC" } });
	});

	test("passes through flat keys unchanged", () => {
		expect(expandDotPaths({ email: "a@b.com" })).toEqual({
			email: "a@b.com",
		});
	});

	test("handles mix of dot and flat keys", () => {
		expect(expandDotPaths({ "driver.name": "John", email: "a@b.com" })).toEqual(
			{ driver: { name: "John" }, email: "a@b.com" },
		);
	});
});

describe("deepMerge", () => {
	test("merges flat objects", () => {
		expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
	});

	test("preserves existing nested keys", () => {
		expect(
			deepMerge(
				{ driver: { name: "John", license: "ABC" } },
				{ driver: { name: "Jane" } },
			),
		).toEqual({ driver: { name: "Jane", license: "ABC" } });
	});

	test("overwrites primitives", () => {
		expect(deepMerge({ email: "old" }, { email: "new" })).toEqual({
			email: "new",
		});
	});

	test("overwrites arrays (not deep-merged)", () => {
		expect(deepMerge({ tags: [1, 2] }, { tags: [3] })).toEqual({
			tags: [3],
		});
	});

	test("creates new nested keys", () => {
		expect(deepMerge({}, { driver: { name: "John" } })).toEqual({
			driver: { name: "John" },
		});
	});
});
