import { describe, expect, test } from "bun:test";
import type { ScopedWaniWaniClient } from "../../scoped-client";
import { reportSessionError } from "../report";

describe("reportSessionError", () => {
	test("returns normally when the client's track throws synchronously", () => {
		const client = {
			track: () => {
				throw new Error("synchronous track failure");
			},
		} as unknown as ScopedWaniWaniClient;

		expect(() =>
			reportSessionError({
				waniwani: client,
				code: "agent_failed",
				cause: "flow_dead_end",
				properties: { node: "start" },
			}),
		).not.toThrow();
	});

	test("returns normally when the client's track returns a non-promise value", () => {
		const client = {
			track: () => undefined,
		} as unknown as ScopedWaniWaniClient;

		expect(() =>
			reportSessionError({
				waniwani: client,
				code: "agent_failed",
				cause: "flow_dead_end",
				properties: { node: "start" },
			}),
		).not.toThrow();
	});

	test("returns normally and still tracks when console.error throws", () => {
		const tracked: unknown[] = [];
		const client = {
			track: (event: unknown) => {
				tracked.push(event);
				return Promise.resolve({ eventId: "1" });
			},
		} as unknown as ScopedWaniWaniClient;

		const originalConsoleError = console.error;
		console.error = () => {
			throw new Error("host logger failure");
		};

		try {
			expect(() =>
				reportSessionError({
					waniwani: client,
					code: "agent_failed",
					cause: "flow_dead_end",
					properties: { node: "start" },
				}),
			).not.toThrow();
		} finally {
			console.error = originalConsoleError;
		}

		expect(tracked).toHaveLength(1);
	});
});
