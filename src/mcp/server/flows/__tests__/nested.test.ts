import { afterEach, describe, expect, test } from "bun:test";
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
		const shape = getObjectShape(schema);
		if (!shape) {
			throw new Error("Expected shape to be non-null");
		}
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

	test("merges dot-key with nested sibling (dot first)", () => {
		expect(
			expandDotPaths({
				"driver.name": "John",
				driver: { license: "ABC" },
			}),
		).toEqual({ driver: { name: "John", license: "ABC" } });
	});

	test("merges dot-key with nested sibling (nested first)", () => {
		expect(
			expandDotPaths({
				driver: { license: "ABC" },
				"driver.name": "John",
			}),
		).toEqual({ driver: { name: "John", license: "ABC" } });
	});

	test("preserves arrays as values, not deep-merged", () => {
		expect(expandDotPaths({ tags: [1, 2, 3] })).toEqual({ tags: [1, 2, 3] });
	});

	test("preserves null values", () => {
		expect(expandDotPaths({ optional: null })).toEqual({ optional: null });
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

describe("prototype keys", () => {
	const PATHS = [
		"__proto__.polluted",
		"constructor.prototype.polluted",
		"driver.__proto__.polluted",
	];

	afterEach(() => {
		delete (Object.prototype as Record<string, unknown>).polluted;
	});

	test("setNestedValue writes nothing through them", () => {
		for (const path of PATHS) {
			const obj: Record<string, unknown> = { driver: {} };
			setNestedValue(obj, path, "yes");
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		}
	});

	test("expandDotPaths drops them, as dot-paths and as own keys", () => {
		const parsed = JSON.parse(
			'{"__proto__": {"polluted": "yes"}, "name": "Ana"}',
		) as Record<string, unknown>;
		const expanded = expandDotPaths({
			...parsed,
			"__proto__.polluted": "yes",
			"constructor.prototype.polluted": "yes",
		});

		expect(expanded).toEqual({ name: "Ana" });
		expect(Object.getPrototypeOf(expanded)).toBe(Object.prototype);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	test("expandDotPaths drops them at any depth inside a value", () => {
		const updates = JSON.parse(
			'{"driver": {"name": "Ana", "__proto__": {"polluted": "yes"}, "cars": [{"__proto__": {"polluted": "yes"}}]}}',
		) as Record<string, unknown>;
		const driver = expandDotPaths(updates).driver as Record<string, unknown>;

		expect(Object.keys(driver)).toEqual(["name", "cars"]);
		expect(Object.getPrototypeOf(driver)).toBe(Object.prototype);
		expect(Object.keys((driver.cars as object[])[0] as object)).toEqual([]);
		expect(
			(Object.assign({}, driver) as Record<string, unknown>).polluted,
		).toBeUndefined();
	});

	test("deepMerge skips them", () => {
		const source = JSON.parse(
			'{"__proto__": {"polluted": "yes"}, "driver": {"__proto__": {"polluted": "yes"}}}',
		) as Record<string, unknown>;
		const merged = deepMerge({ driver: { name: "Ana" } }, source);

		expect(merged).toEqual({ driver: { name: "Ana" } });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	test("getNestedValue reads own keys only", () => {
		(Object.prototype as Record<string, unknown>).polluted = "inherited";

		expect(getNestedValue({}, "polluted")).toBeUndefined();
		expect(getNestedValue({ driver: {} }, "driver.polluted")).toBeUndefined();
		expect(getNestedValue({}, "__proto__")).toBeUndefined();
	});

	test("deleteNestedValue deletes nothing through them", () => {
		(Object.prototype as Record<string, unknown>).polluted = "inherited";

		deleteNestedValue({}, "__proto__.polluted");

		expect(({} as Record<string, unknown>).polluted).toBe("inherited");
	});
});
