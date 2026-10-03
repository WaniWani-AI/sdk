import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryKvStore } from "../../kv/memory-kv-store";
import type { FlowTokenContent, McpServer, RegisteredTool } from "../@types";
import { END, START } from "../@types";
import { keepAskedFields } from "../asked-fields";
import { createFlow } from "../create-flow";
import { readFlowGraph } from "../definition-meta";
import { redacted } from "../redacted";
import { createFlowTestHarness, type FlowTestResult } from "../test-utils";

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;

const SESSION_ID = "asked-fields-session";
const EXTRA = { _meta: { sessionId: SESSION_ID } };

/**
 * Plate, then a lookup that resolves the vehicle id for that plate unless one
 * is already set, then the postcode, then a price that depends on the vehicle.
 * A caller able to write `vehicleId` would pick which vehicle gets priced.
 */
function carQuote() {
	const store = new MemoryKvStore<FlowTokenContent>();
	const flow = createFlow({
		id: "car_quote",
		title: "Car quote",
		description: "Quote a car.",
		state: {
			plate: z.string().describe("License plate"),
			vehicleId: z.string().describe("Vehicle id the plate resolves to"),
			postcode: redacted(z.string().describe("Postcode")),
			price: z.number().describe("Quoted yearly price"),
		},
	})
		.addNode("ask_plate", ({ interrupt }) =>
			interrupt({
				plate: {
					question: "What's the plate?",
					validate: (plate) => {
						if (plate === "bad") {
							throw new Error("Not a plate");
						}
					},
				},
			}),
		)
		.addNode("lookup", ({ state }) =>
			state.vehicleId ? {} : { vehicleId: `v-${state.plate}` },
		)
		.addNode("ask_postcode", ({ interrupt }) =>
			interrupt({ postcode: { question: "What's the postcode?" } }),
		)
		.addNode("quote", ({ state }) => ({
			price: state.vehicleId === "v-1234ABC" ? 300 : 999,
		}))
		.addEdge(START, "ask_plate")
		.addEdge("ask_plate", "lookup")
		.addEdge("lookup", "ask_postcode")
		.addEdge("ask_postcode", "quote")
		.addEdge("quote", END)
		.compile({ store });

	return { flow, store };
}

async function handlerFor(flow: {
	register: (server: McpServer) => Promise<void>;
}): Promise<Handler> {
	let handler: Handler | undefined;
	const server = {
		registerTool: (_name: string, _config: unknown, cb: Handler) => {
			handler = cb;
		},
	} as unknown as McpServer;
	await flow.register(server);
	if (!handler) {
		throw new Error("flow did not register a handler");
	}
	return handler;
}

/** Assert `result` is an interrupt and narrow it, so its `field` reads. */
function asInterrupt(result: FlowTestResult) {
	expect(result.status).toBe("interrupt");
	return result as Extract<FlowTestResult, { status: "interrupt" }>;
}

function parsePayload(result: unknown): Record<string, unknown> {
	const content = (result as { content: Array<{ text?: string }> }).content;
	return JSON.parse(content[0]?.text ?? "") as Record<string, unknown>;
}

describe("the tool listing", () => {
	test("names no state field, and sends neither the graph nor the redacted list", async () => {
		const { flow } = carQuote();
		const server = new SdkMcpServer({ name: "test", version: "1.0.0" });
		await flow.register(server);
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "test", version: "1.0.0" });
		await Promise.all([
			client.connect(clientTransport),
			server.connect(serverTransport),
		]);

		// The in-memory transport hands objects over as they are; what a real
		// transport sends is their JSON.
		const wire = JSON.stringify((await client.listTools()).tools);
		const [tool] = JSON.parse(wire) as Array<{
			inputSchema: { properties: Record<string, { properties?: unknown }> };
			_meta?: Record<string, unknown>;
		}>;

		expect(tool?.inputSchema.properties.stateUpdates?.properties).toBe(
			undefined,
		);
		expect(tool?._meta ?? {}).toEqual({});
		for (const leaked of ["vehicleId", "License plate", "postcode", "lookup"]) {
			expect(wire).not.toContain(leaked);
		}
	});

	test("keeps the graph readable on the server", () => {
		const { flow } = carQuote();

		expect(readFlowGraph(flow.config._meta)).toEqual(flow.flowGraph);
	});
});

describe("stateUpdates", () => {
	test("drops a field the flow computes, sent alongside an answer", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		await harness.continueWith({ plate: "1234ABC", vehicleId: "v-forged" });
		const done = await harness.continueWith({ postcode: "28001" });

		expect(done.status).toBe("complete");
		expect(done.decodedState?.state).toMatchObject({
			vehicleId: "v-1234ABC",
			price: 300,
		});
	});

	test("drops a value for a later question until the flow asks it", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		const next = await harness.continueWith({
			plate: "1234ABC",
			postcode: "28001",
		});

		expect(asInterrupt(next).field).toBe("postcode");
		expect(next.decodedState?.state.postcode).toBeUndefined();
	});

	test("the record lists every field the run has asked", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		const next = await harness.continueWith({ plate: "1234ABC" });

		expect(next.decodedState?.asked).toEqual(["plate", "postcode"]);
	});

	test("reset corrects a field the flow asked earlier", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		await harness.continueWith({ plate: "1234ABC" });
		const corrected = await harness.resetWith({ plate: "9999ZZZ" });

		expect(asInterrupt(corrected).field).toBe("postcode");
		expect(corrected.decodedState?.state.plate).toBe("9999ZZZ");
	});

	test("reset with only a computed field is refused", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		await harness.continueWith({ plate: "1234ABC" });
		const refused = await harness.resetWith({ vehicleId: "v-forged" });

		expect(refused.status).toBe("error");
		expect(refused.decodedState?.state.vehicleId).toBe("v-1234ABC");
	});

	test("a record written without `asked` merges everything for that call", async () => {
		const { flow, store } = carQuote();
		const handler = await handlerFor(flow);
		await store.set(SESSION_ID, {
			step: "ask_postcode",
			state: { plate: "1234ABC", vehicleId: "v-1234ABC" },
			field: "postcode",
		});

		const done = parsePayload(
			await handler(
				{ action: "continue", stateUpdates: { postcode: "28001" } },
				EXTRA,
			),
		);

		expect(done.status).toBe("complete");
		expect((await store.get(SESSION_ID))?.state.price).toBe(300);
	});

	test("accepts the field an interactive widget fills", async () => {
		const planPicker: RegisteredTool = {
			id: "plan_picker",
			title: "Plan picker",
			description: "Pick a plan",
			register: async () => {},
		};
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "plan",
			title: "Plan",
			description: "Pick a plan.",
			state: {
				plan: z.string().describe("Chosen plan"),
				discount: z.number().describe("Discount the flow grants"),
			},
		})
			.addNode("pick", ({ showWidget }) =>
				showWidget({ tool: planPicker, field: "plan" }),
			)
			.addEdge(START, "pick")
			.addEdge("pick", END)
			.compile({ store });
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("pick a plan");
		const done = await harness.continueWith({ plan: "pro", discount: 100 });

		expect(done.status).toBe("complete");
		expect(done.decodedState?.state).toEqual({ plan: "pro" });
	});
});

describe("keepAskedFields", () => {
	test("a question on one member accepts that member alone, in either spelling", () => {
		expect(
			keepAskedFields({ "driver.name": "Ana", driver: { license: "L-1" } }, [
				"driver.name",
			]),
		).toEqual({ driver: { name: "Ana" } });
	});

	test("a question on a group accepts every key inside it", () => {
		expect(
			keepAskedFields({ "driver.name": "Ana", "driver.license": "L-1" }, [
				"driver",
			]),
		).toEqual({ driver: { name: "Ana", license: "L-1" } });
	});
});

describe("createFlowTestHarness start(intent, known)", () => {
	test("answers each question from `known` and stops on the first it cannot", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		const result = await harness.start("quote my car", {
			plate: "1234ABC",
			vehicleId: "v-forged",
		});

		expect(asInterrupt(result).field).toBe("postcode");
		expect(result.decodedState?.state.vehicleId).toBe("v-1234ABC");
	});

	test("runs to the end when `known` covers every question", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		const result = await harness.start("quote my car", {
			plate: "1234ABC",
			postcode: "28001",
		});

		expect(result.status).toBe("complete");
	});

	test("sends a rejected value once and returns the rejection", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		const result = await harness.start("quote my car", { plate: "bad" });

		const rejected = asInterrupt(result);
		expect(rejected.field).toBe("plate");
		expect(rejected.context).toContain("Not a plate");
	});
});
