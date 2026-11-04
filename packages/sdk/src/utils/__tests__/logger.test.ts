import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createLogger, getGlobalLevel } from "../logger.js";

const ENV_KEYS = ["WANIWANI_LOG_LEVEL", "WANIWANI_DEBUG"] as const;

describe("createLogger", () => {
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = saved[key];
			}
		}
	});

	test("writes to stderr, never stdout, so a stdio MCP server's JSON-RPC stays clean", () => {
		const stdout = spyOn(console, "log").mockImplementation(() => {});
		const stderr = spyOn(console, "error").mockImplementation(() => {});
		try {
			createLogger("test", true)("hello", 1);
			expect(stdout).not.toHaveBeenCalled();
			expect(stderr).toHaveBeenCalledWith("[waniwani:test]", "hello", 1);
		} finally {
			stdout.mockRestore();
			stderr.mockRestore();
		}
	});

	test("stays silent when the level is not debug", () => {
		const stderr = spyOn(console, "error").mockImplementation(() => {});
		try {
			createLogger("test")("hidden");
			process.env.WANIWANI_LOG_LEVEL = "warn";
			createLogger("test")("hidden");
			expect(stderr).not.toHaveBeenCalled();
		} finally {
			stderr.mockRestore();
		}
	});

	test("WANIWANI_LOG_LEVEL=debug turns it on", () => {
		process.env.WANIWANI_LOG_LEVEL = "debug";
		const stderr = spyOn(console, "error").mockImplementation(() => {});
		try {
			createLogger("test")("shown");
			expect(stderr).toHaveBeenCalledTimes(1);
		} finally {
			stderr.mockRestore();
		}
	});
});

describe("getGlobalLevel", () => {
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = saved[key];
			}
		}
	});

	test("defaults to none", () => {
		expect(getGlobalLevel()).toBe("none");
	});

	test("an unknown WANIWANI_LOG_LEVEL falls back to WANIWANI_DEBUG", () => {
		process.env.WANIWANI_LOG_LEVEL = "verbose";
		expect(getGlobalLevel()).toBe("none");
		process.env.WANIWANI_DEBUG = "1";
		expect(getGlobalLevel()).toBe("debug");
	});
});
