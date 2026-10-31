import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { FlowGraphEdge, FlowTokenContent } from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";
import type { FlowStore } from "../flow-store";

class MemStore implements FlowStore {
	private readonly map = new Map<string, FlowTokenContent>();
	async get(key: string) {
		return this.map.get(key) ?? null;
	}
	async set(key: string, value: FlowTokenContent) {
		this.map.set(key, value);
	}
	async delete(key: string) {
		this.map.delete(key);
	}
}

const store = new MemStore();

function makeFlow() {
	return createFlow({
		id: "router",
		title: "Router",
		description: "Routes based on plan.",
		state: {
			plan: z.string().describe("Plan"),
			next: z.string().describe("Computed next step"),
		},
	})
		.addNode("start_node", () => ({ plan: "pro" }))
		.addNode("upgrade", () => ({ next: "done" }))
		.addNode("downgrade", () => ({ next: "done" }));
}

function conditionalEdge(edges: FlowGraphEdge[], from: string) {
	const edge = edges.find((e) => e.from === from);
	if (!edge || edge.type !== "conditional") {
		throw new Error(`No conditional edge from "${from}"`);
	}
	return edge;
}

describe("graph introspection reads declared conditional targets", () => {
	test("uses declared targets verbatim", () => {
		const flow = makeFlow()
			.addEdge(START, "start_node")
			.addConditionalEdge("start_node", ["upgrade", "downgrade"], (state) =>
				state.plan === "pro" ? "upgrade" : "downgrade",
			)
			.addEdge("upgrade", END)
			.addEdge("downgrade", END)
			.compile({ store });

		const edge = conditionalEdge(flow.flowGraph.edges, "start_node");
		expect(edge.to).toEqual(["upgrade", "downgrade"]);
	});

	test("declared END target survives introspection", () => {
		const flow = makeFlow()
			.addEdge(START, "start_node")
			.addConditionalEdge("start_node", ["upgrade", END], (state) =>
				state.plan === "pro" ? "upgrade" : END,
			)
			.addEdge("upgrade", END)
			.addEdge("downgrade", END)
			.compile({ store });

		const edge = conditionalEdge(flow.flowGraph.edges, "start_node");
		expect(edge.to).toEqual(["upgrade", END]);
	});

	test("declared targets render as explicit Mermaid branches", () => {
		const flow = makeFlow()
			.addEdge(START, "start_node")
			.addConditionalEdge("start_node", ["upgrade", "downgrade"], (state) =>
				state.plan === "pro" ? "upgrade" : "downgrade",
			)
			.addEdge("upgrade", END)
			.addEdge("downgrade", END)
			.compile({ store });

		const mermaid = flow.graph();
		expect(mermaid).toContain("start_node -.-> upgrade");
		expect(mermaid).toContain("start_node -.-> downgrade");
		expect(mermaid).not.toContain("start_node_branch");
	});

	test("introspection is exact even when the condition is computed", () => {
		// The real target is derived through a local variable — source parsing
		// could never see it. Declared targets make introspection exact.
		const flow = makeFlow()
			.addEdge(START, "start_node")
			.addConditionalEdge("start_node", ["downgrade"], (state) => {
				const tier = state.plan === "pro" ? "high" : "low";
				return tier === "high" ? "downgrade" : "downgrade";
			})
			.addEdge("upgrade", END)
			.addEdge("downgrade", END)
			.compile({ store });

		const edge = conditionalEdge(flow.flowGraph.edges, "start_node");
		expect(edge.to).toEqual(["downgrade"]);
	});
});

describe("addConditionalEdge enforces declared targets", () => {
	test("the condition cannot return an undeclared node", () => {
		makeFlow()
			.addEdge(START, "start_node")
			.addConditionalEdge("start_node", ["upgrade"], (state) =>
				// @ts-expect-error — "downgrade" is not in the declared `to`
				state.plan === "pro" ? "upgrade" : "downgrade",
			);
	});

	test("`to` cannot reference a non-existent node", () => {
		makeFlow()
			.addEdge(START, "start_node")
			.addConditionalEdge(
				"start_node",
				// @ts-expect-error — "missing" is not a registered node id
				["upgrade", "missing"],
				() => "upgrade",
			);
	});

	test("rejects an empty `to` list at runtime", () => {
		expect(() =>
			makeFlow()
				.addEdge(START, "start_node")
				// @ts-expect-error — empty `to` makes the condition return `never`;
				// this guards JS callers that bypass the type.
				.addConditionalEdge("start_node", [], () => END),
		).toThrow(/must declare at least one target/);
	});
});
