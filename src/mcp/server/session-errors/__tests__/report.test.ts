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
});
