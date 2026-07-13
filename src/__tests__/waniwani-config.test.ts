import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetProjectConfigCache } from "../project-config.js";
import { waniwani } from "../waniwani.js";

// Verifies apiUrl resolution order in waniwani(): explicit config >
// WANIWANI_API_URL env var > https://app.waniwani.ai default. The env-var
// fallback exists so `withWaniwani(server)` (which builds its own client when
// no `client` is passed) targets the right region instead of defaulting to US.

const prevApiUrl = process.env.WANIWANI_API_URL;
const prevApiKey = process.env.WANIWANI_API_KEY;

beforeEach(() => {
	resetProjectConfigCache();
	delete process.env.WANIWANI_API_URL;
	delete process.env.WANIWANI_API_KEY;
});

afterEach(() => {
	if (prevApiUrl === undefined) {
		delete process.env.WANIWANI_API_URL;
	} else {
		process.env.WANIWANI_API_URL = prevApiUrl;
	}
	if (prevApiKey === undefined) {
		delete process.env.WANIWANI_API_KEY;
	} else {
		process.env.WANIWANI_API_KEY = prevApiKey;
	}
});

describe("waniwani() apiUrl resolution", () => {
	test("defaults to US when nothing is configured", () => {
		const wani = waniwani();
		expect(wani._config.apiUrl).toBe("https://app.waniwani.ai");
	});

	test("falls back to WANIWANI_API_URL when set", () => {
		process.env.WANIWANI_API_URL = "https://eu.app.waniwani.ai";
		const wani = waniwani();
		expect(wani._config.apiUrl).toBe("https://eu.app.waniwani.ai");
	});

	test("explicit apiUrl wins over the env var", () => {
		process.env.WANIWANI_API_URL = "https://eu.app.waniwani.ai";
		const wani = waniwani({ apiUrl: "https://custom.example.com" });
		expect(wani._config.apiUrl).toBe("https://custom.example.com");
	});
});
