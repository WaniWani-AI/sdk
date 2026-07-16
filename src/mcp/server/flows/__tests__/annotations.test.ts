/**
 * Tool annotations carry MCP's `title`.
 *
 * Claude's Connectors Directory requires a `title` *inside* `annotations` on
 * every tool and flags the server at the submission portal's Tools step
 * without it — the top-level `title` does not satisfy it. The annotation
 * shapes used to be hand-copied here and omitted `title`, so a caller setting
 * it hit "Object literal may only specify known properties" even though the
 * value passes straight through to `registerTool`.
 *
 * The type is the fix, so these tests earn their keep mostly at `bun run
 * typecheck`: the `title` in each literal below stops compiling if the
 * annotations type ever narrows again. The runtime assertions guard the
 * passthrough.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createTool } from "../../../../legacy/mcp/tools/create-tool";
import type { FlowTokenContent, McpServer } from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";

class TestFlowStateStore {
	private readonly map = new Map<string, FlowTokenContent>();
	async get(key: string): Promise<FlowTokenContent | null> {
		return this.map.get(key) ?? null;
	}
	async set(key: string, value: FlowTokenContent): Promise<void> {
		this.map.set(key, value);
	}
	async delete(key: string): Promise<void> {
		this.map.delete(key);
	}
}

type RegisteredConfig = { annotations?: { title?: string } };

function mockServer() {
	const registered: RegisteredConfig[] = [];
	const server = {
		registerTool: (_name: string, config: RegisteredConfig) => {
			registered.push(config);
		},
	};
	return { server: server as unknown as McpServer, registered };
}

describe("annotations.title", () => {
	test("createFlow passes annotations.title through to registerTool", async () => {
		const flow = createFlow({
			id: "titled_flow",
			title: "Titled Flow",
			description: "A flow whose annotations carry a title.",
			state: { q: z.string().describe("A question.") },
			annotations: {
				title: "Create a titled thing",
				readOnlyHint: false,
				destructiveHint: false,
			},
		})
			.addEdge(START, END)
			.compile({ store: new TestFlowStateStore() });

		const { server, registered } = mockServer();
		await flow.register(server);

		expect(registered).toHaveLength(1);
		expect(registered[0]?.annotations?.title).toBe("Create a titled thing");
	});

	test("createTool passes annotations.title through to registerTool", async () => {
		const tool = createTool(
			{
				id: "titled_tool",
				title: "Titled Tool",
				description: "A tool whose annotations carry a title.",
				inputSchema: { a: z.string() },
				annotations: {
					title: "Show a titled thing",
					readOnlyHint: true,
				},
			},
			async () => ({ text: "ok" }),
		);

		const { server, registered } = mockServer();
		await tool.register(server);

		expect(registered).toHaveLength(1);
		expect(registered[0]?.annotations?.title).toBe("Show a titled thing");
	});

	test("the other MCP hints still round-trip alongside title", async () => {
		const tool = createTool(
			{
				id: "all_hints_tool",
				title: "All Hints",
				description: "Every annotation the MCP spec defines.",
				inputSchema: { a: z.string() },
				annotations: {
					title: "Show everything",
					readOnlyHint: true,
					idempotentHint: true,
					openWorldHint: false,
					destructiveHint: false,
				},
			},
			async () => ({ text: "ok" }),
		);

		const { server, registered } = mockServer();
		await tool.register(server);

		expect(registered[0]?.annotations).toEqual({
			title: "Show everything",
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false,
			destructiveHint: false,
		});
	});
});
