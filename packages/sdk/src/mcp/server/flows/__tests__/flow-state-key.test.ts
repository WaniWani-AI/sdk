import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryKvStore } from "../../kv/memory-kv-store";
import type { FlowTokenContent, RegisteredFlow } from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";
import { flowStateKey } from "../flow-store";

const SESSION_ID = "shared-session";

function soleTraderFlow(store: MemoryKvStore<FlowTokenContent>) {
	return createFlow({
		id: "sole_trader",
		title: "Sole trader",
		description: "Register a sole trader business.",
		intro: "Sole trader intro.",
		state: {
			name: z.string().describe("Founder name"),
			activity: z.string().describe("Business activity"),
		},
	})
		.addNode("ask_name", ({ interrupt }) =>
			interrupt({ name: { question: "What's your name?" } }),
		)
		.addNode("ask_activity", ({ interrupt }) =>
			interrupt({ activity: { question: "What's the activity?" } }),
		)
		.addEdge(START, "ask_name")
		.addEdge("ask_name", "ask_activity")
		.addEdge("ask_activity", END)
		.compile({ store });
}

function companyFlow(store: MemoryKvStore<FlowTokenContent>) {
	return createFlow({
		id: "company",
		title: "Company",
		description: "Register a company.",
		intro: "Company intro.",
		state: {
			name: z.string().describe("Founder name"),
			capital: z.number().describe("Share capital"),
		},
	})
		.addNode("ask_name", ({ interrupt }) =>
			interrupt({ name: { question: "What's your name?" } }),
		)
		.addNode("ask_capital", ({ interrupt }) =>
			interrupt({ capital: { question: "How much capital?" } }),
		)
		.addEdge(START, "ask_name")
		.addEdge("ask_name", "ask_capital")
		.addEdge("ask_capital", END)
		.compile({ store });
}

async function connect(flows: RegisteredFlow[]) {
	const server = new SdkMcpServer({ name: "test", version: "1.0.0" });
	for (const flow of flows) {
		await flow.register(server);
	}
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test", version: "1.0.0" });
	await Promise.all([
		client.connect(clientTransport),
		server.connect(serverTransport),
	]);
	return async (
		name: string,
		args: Record<string, unknown>,
	): Promise<Record<string, unknown>> => {
		const result = await client.callTool({
			name,
			arguments: args,
			_meta: { sessionId: SESSION_ID },
		});
		const first = Array.isArray(result.content) ? result.content[0] : undefined;
		if (typeof first?.text !== "string") {
			throw new Error(`${name} returned no text content`);
		}
		return JSON.parse(first.text);
	};
}

describe("two flows in one session", () => {
	test("each flow keeps its own record, intro and position", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const call = await connect([soleTraderFlow(store), companyFlow(store)]);

		const soleStart = await call("sole_trader", {
			action: "start",
			intent: "sole trader",
		});
		expect(soleStart.intro).toEqual({ verbatim: "Sole trader intro." });
		await call("sole_trader", {
			action: "continue",
			stateUpdates: { name: "Ana" },
		});

		const companyStart = await call("company", {
			action: "start",
			intent: "company",
		});
		expect(companyStart.status).toBe("interrupt");
		expect(companyStart.field).toBe("name");
		expect(companyStart.intro).toEqual({ verbatim: "Company intro." });

		const soleRecord = await store.get(flowStateKey("sole_trader", SESSION_ID));
		expect(soleRecord?.step).toBe("ask_activity");
		expect(soleRecord?.state).toEqual({ name: "Ana" });
		expect((await store.get(flowStateKey("company", SESSION_ID)))?.step).toBe(
			"ask_name",
		);
	});

	test("continuing the first flow after starting the second resumes it", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const call = await connect([soleTraderFlow(store), companyFlow(store)]);

		await call("sole_trader", { action: "start", intent: "sole trader" });
		await call("sole_trader", {
			action: "continue",
			stateUpdates: { name: "Ana" },
		});
		await call("company", { action: "start", intent: "company" });
		await call("company", {
			action: "continue",
			stateUpdates: { name: "Bea" },
		});

		const resumed = await call("sole_trader", {
			action: "continue",
			stateUpdates: { activity: "bakery" },
		});
		expect(resumed.status).toBe("complete");
		expect(
			(await store.get(flowStateKey("sole_trader", SESSION_ID)))?.state,
		).toEqual({ name: "Ana", activity: "bakery" });
		expect(
			(await store.get(flowStateKey("company", SESSION_ID)))?.state,
		).toEqual({ name: "Bea" });
	});

	test("continuing a flow the session never started finds no state", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const call = await connect([soleTraderFlow(store), companyFlow(store)]);

		await call("sole_trader", { action: "start", intent: "sole trader" });

		const parsed = await call("company", {
			action: "continue",
			stateUpdates: { name: "Ana" },
		});
		expect(parsed.status).toBe("error");
		expect(parsed.error).toContain("Flow state not found");
	});
});
