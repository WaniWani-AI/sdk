import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";

const originalApiKey = process.env.WANIWANI_API_KEY;

beforeEach(() => {
	delete process.env.WANIWANI_API_KEY;
});

afterEach(() => {
	if (originalApiKey === undefined) {
		delete process.env.WANIWANI_API_KEY;
	} else {
		process.env.WANIWANI_API_KEY = originalApiKey;
	}
});

describe("createFlow misconfiguration", () => {
	test("throws a clear error when no store and no WANIWANI_API_KEY", () => {
		const flow = createFlow({
			id: "misconfig_demo",
			title: "Misconfig Demo",
			description: "Demonstrates the misconfiguration error path",
			state: { value: z.string().describe("placeholder") },
		})
			.addNode("done", () => ({ value: "ok" }))
			.addEdge(START, "done")
			.addEdge("done", END);

		expect(() => flow.compile()).toThrow(/no flow store configured/);
		expect(() => flow.compile()).toThrow(/MemoryKvStore/);
		expect(() => flow.compile()).toThrow(/WANIWANI_API_KEY/);
	});

	test("does not throw when WANIWANI_API_KEY is set", () => {
		process.env.WANIWANI_API_KEY = "test-key";
		const flow = createFlow({
			id: "with_key",
			title: "With Key",
			description: "Flow compiles when API key is present",
			state: { value: z.string().describe("placeholder") },
		})
			.addNode("done", () => ({ value: "ok" }))
			.addEdge(START, "done")
			.addEdge("done", END);

		expect(() => flow.compile()).not.toThrow();
	});

	test("does not throw when a store is passed explicitly", () => {
		const memoryStore = {
			data: new Map<string, unknown>(),
			async get(k: string) {
				return (this.data.get(k) as never) ?? null;
			},
			async set(k: string, v: unknown) {
				this.data.set(k, v);
			},
			async delete(k: string) {
				this.data.delete(k);
			},
		};

		const flow = createFlow({
			id: "with_store",
			title: "With Store",
			description: "Flow compiles when explicit store is provided",
			state: { value: z.string().describe("placeholder") },
		})
			.addNode("done", () => ({ value: "ok" }))
			.addEdge(START, "done")
			.addEdge("done", END);

		// biome-ignore lint/suspicious/noExplicitAny: store shape matches FlowStore via duck-typing
		expect(() => flow.compile({ store: memoryStore as any })).not.toThrow();
	});
});
