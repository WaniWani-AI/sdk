import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { classifyCause } from "../classify";

describe("classifyCause", () => {
	test("an aborted request is a timeout", () => {
		const error = new Error("The operation was aborted");
		error.name = "AbortError";
		expect(classifyCause({ error })).toBe("timeout");
	});

	test("a 429 is rate limiting", () => {
		expect(
			classifyCause({
				error: Object.assign(new Error("slow down"), { statusCode: 429 }),
			}),
		).toBe("rate_limited");
	});

	test("a 503 is an upstream server failure", () => {
		expect(
			classifyCause({
				error: Object.assign(new Error("unavailable"), { status: 503 }),
			}),
		).toBe("upstream_5xx");
	});

	test("a 404 is an upstream client failure", () => {
		expect(
			classifyCause({
				error: Object.assign(new Error("not found"), { status: 404 }),
			}),
		).toBe("upstream_4xx");
	});

	test("a failed fetch is a network fault", () => {
		expect(classifyCause({ error: new TypeError("fetch failed") })).toBe(
			"network",
		);
	});

	test("a schema failure is invalid output", () => {
		const parsed = z.object({ a: z.string() }).safeParse({ a: 1 });
		expect(parsed.success).toBe(false);
		expect(classifyCause({ error: parsed.success ? null : parsed.error })).toBe(
			"invalid_output",
		);
	});

	test("anything unrecognized is unknown", () => {
		expect(classifyCause({ error: new Error("something went sideways") })).toBe(
			"unknown",
		);
		expect(classifyCause({ error: "a bare string" })).toBe("unknown");
		expect(classifyCause({ error: undefined })).toBe("unknown");
	});
});
