import { describe, expect, test } from "bun:test";
import { waniwani } from "../../waniwani.js";

describe("tracking smoke", () => {
	test("creates a client with tracking lifecycle methods", () => {
		const client = waniwani({
			apiKey: "test-key",
			baseUrl: "https://example.com",
		});
		expect(typeof client.track).toBe("function");
		expect(typeof client.flush).toBe("function");
		expect(typeof client.shutdown).toBe("function");
	});
});
