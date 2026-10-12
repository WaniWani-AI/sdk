import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryKvStore } from "../../kv/memory-kv-store";
import type { FlowTokenContent, McpServer, RegisteredTool } from "../@types";
import { END, START } from "../@types";
import { splitAskedFields } from "../asked-fields";
import { createFlow } from "../create-flow";
import { readFlowGraph } from "../definition-meta";
import { neverPrefilled } from "../held-answers";
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

	test("holds a value for a later question and fills it when the flow asks it", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		const done = await harness.continueWith({
			plate: "1234ABC",
			postcode: "28001",
		});

		expect(done.status).toBe("complete");
		expect(done.decodedState?.state).toMatchObject({
			postcode: "28001",
			price: 300,
		});
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

	test("reset with only a computed field never reaches state", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		await harness.continueWith({ plate: "1234ABC" });
		const same = await harness.resetWith({ vehicleId: "v-forged" });
		const done = await harness.continueWith({ postcode: "28001" });

		expect(asInterrupt(same).field).toBe("postcode");
		expect(done.status).toBe("complete");
		expect(done.decodedState?.state).toMatchObject({
			vehicleId: "v-1234ABC",
			price: 300,
		});
	});

	test("reset with only fields the flow does not declare is refused", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		await harness.continueWith({ plate: "1234ABC" });
		const refused = await harness.resetWith({ discount: 100 });

		expect(refused.status).toBe("error");
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

describe("a path through the prototype", () => {
	test("writes nothing, in this session or in the next one", async () => {
		const { flow, store } = carQuote();
		const handler = await handlerFor(flow);
		const other = { _meta: { sessionId: "another-session" } };

		await handler({ action: "start", intent: "quote my car" }, EXTRA);
		await handler(
			{
				action: "continue",
				stateUpdates: {
					plate: "1234ABC",
					"__proto__.postcode": "28001",
					"constructor.prototype.vehicleId": "v-forged",
				},
			},
			EXTRA,
		);
		const next = parsePayload(
			await handler({ action: "start", intent: "quote my car" }, other),
		);

		expect(({} as Record<string, unknown>).postcode).toBeUndefined();
		expect(({} as Record<string, unknown>).vehicleId).toBeUndefined();
		expect(next.field).toBe("plate");
		expect((await store.get(SESSION_ID))?.state).toEqual({
			plate: "1234ABC",
			vehicleId: "v-1234ABC",
		});
	});
});

describe("held answers", () => {
	async function startWith(
		flow: { register: (server: McpServer) => Promise<void> },
		stateUpdates: Record<string, unknown>,
	) {
		const handler = await handlerFor(flow);
		const payload = parsePayload(
			await handler(
				{ action: "start", intent: "quote my car", stateUpdates },
				EXTRA,
			),
		);
		return { handler, payload };
	}

	test("everything stated on start runs the flow to the end", async () => {
		const { flow, store } = carQuote();

		const { payload } = await startWith(flow, {
			plate: "1234ABC",
			postcode: "28001",
		});

		expect(payload.status).toBe("complete");
		expect((await store.get(SESSION_ID))?.state.price).toBe(300);
	});

	test("a computed field sent on start is never applied, and is gone once the flow ends", async () => {
		const { flow, store } = carQuote();

		const { payload } = await startWith(flow, {
			plate: "1234ABC",
			vehicleId: "v-forged",
			postcode: "28001",
		});

		expect(payload.status).toBe("complete");
		const record = await store.get(SESSION_ID);
		expect(record?.state).toMatchObject({ vehicleId: "v-1234ABC", price: 300 });
		expect(record?.held).toBeUndefined();
	});

	test("a held value the validator rejects comes back as the rejection", async () => {
		const { flow } = carQuote();

		const { payload } = await startWith(flow, { plate: "bad" });

		expect(payload.field).toBe("plate");
		expect(payload.context).toContain("Not a plate");
	});

	test("a held value that does not fit the field's schema is dropped and the question asked", async () => {
		const { flow, store } = carQuote();

		const { payload } = await startWith(flow, {
			plate: "1234ABC",
			postcode: 28001,
		});

		expect(payload.field).toBe("postcode");
		expect((await store.get(SESSION_ID))?.held).toBeUndefined();
	});

	test("a fresh answer wins over a held one", async () => {
		const { flow, store } = carQuote();

		const { handler } = await startWith(flow, { postcode: "11111" });
		await handler(
			{
				action: "continue",
				stateUpdates: { plate: "1234ABC", postcode: "28001" },
			},
			EXTRA,
		);

		expect((await store.get(SESSION_ID))?.state.postcode).toBe("28001");
	});

	test("reset corrects a field that was filled from the hold", async () => {
		const { flow, store } = carQuote();

		const { handler } = await startWith(flow, { plate: "1234ABC" });
		const corrected = parsePayload(
			await handler(
				{ action: "reset", stateUpdates: { plate: "9999ZZZ" } },
				EXTRA,
			),
		);

		expect(corrected.field).toBe("postcode");
		expect((await store.get(SESSION_ID))?.state.plate).toBe("9999ZZZ");
	});

	test("never fills a widget's field", async () => {
		const consentCard: RegisteredTool = {
			id: "consent_card",
			title: "Consent card",
			description: "Agree to the notice",
			register: async () => {},
		};
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "consent",
			title: "Consent",
			description: "Agree, then answer.",
			state: {
				agreed: z.boolean().describe("Agreed to the notice"),
				name: z.string().describe("Name"),
			},
		})
			.addNode("agree", ({ showWidget }) =>
				showWidget({ tool: consentCard, field: "agreed" }),
			)
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addEdge(START, "agree")
			.addEdge("agree", "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });

		const { handler, payload } = await startWith(flow, {
			agreed: true,
			name: "Ana",
		});
		expect(payload.status).toBe("widget");

		const done = parsePayload(
			await handler(
				{ action: "continue", stateUpdates: { agreed: true } },
				EXTRA,
			),
		);
		expect(done.status).toBe("complete");
		expect((await store.get(SESSION_ID))?.state).toEqual({
			agreed: true,
			name: "Ana",
		});
	});

	test("a correction to an answer still held replaces it, with no restart", async () => {
		const { flow, store } = carQuote();

		const { handler } = await startWith(flow, { postcode: "11111" });
		const same = parsePayload(
			await handler(
				{ action: "reset", stateUpdates: { postcode: "22222" } },
				EXTRA,
			),
		);
		await handler(
			{ action: "continue", stateUpdates: { plate: "1234ABC" } },
			EXTRA,
		);

		expect(same.status).toBe("interrupt");
		expect(same.field).toBe("plate");
		expect((await store.get(SESSION_ID))?.state.postcode).toBe("22222");
	});

	test("a field marked neverPrefilled is asked even when answered up front", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "share",
			title: "Share",
			description: "Answer, then agree to sharing.",
			state: {
				name: z.string().describe("Name"),
				agreed: neverPrefilled(
					z.boolean().describe("Agreed to share data with partners"),
				),
			},
		})
			.addNode("ask_name", ({ interrupt }) =>
				interrupt({ name: { question: "Name?" } }),
			)
			.addNode("ask_agreement", ({ interrupt }) =>
				interrupt({
					agreed: {
						question: "Do you agree that we share your data with partners?",
					},
				}),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", "ask_agreement")
			.addEdge("ask_agreement", END)
			.compile({ store });

		const { payload } = await startWith(flow, { name: "Ana", agreed: true });

		expect(payload.field).toBe("agreed");
		const record = await store.get(SESSION_ID);
		expect(record?.state).toEqual({ name: "Ana" });
		expect(record?.held).toBeUndefined();
	});

	test("a group question never fills a member marked neverPrefilled", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "group_consent",
			title: "Group consent",
			description: "Driver details, then the driver's consent.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						consent: neverPrefilled(
							z.boolean().optional().describe("Agrees to a records check"),
						),
					})
					.describe("Driver details"),
			},
		})
			.addNode("ask_driver", ({ interrupt }) =>
				interrupt({ driver: { question: "Who is driving?" } }),
			)
			.addNode("ask_consent", ({ interrupt }) =>
				interrupt({
					"driver.consent": { question: "May we check your records?" },
				}),
			)
			.addEdge(START, "ask_driver")
			.addEdge("ask_driver", "ask_consent")
			.addEdge("ask_consent", END)
			.compile({ store });

		const { payload } = await startWith(flow, {
			driver: { name: "Ana", consent: true },
		});

		expect(payload.field).toBe("driver.consent");
		expect((await store.get(SESSION_ID))?.state).toEqual({
			driver: { name: "Ana" },
		});
	});

	test("fills a member of a group declared optional", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "optional_group",
			title: "Optional group",
			description: "Optional driver details.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						license: z.string().describe("License number"),
					})
					.optional()
					.describe("Driver details"),
			},
		})
			.addNode("ask_driver", ({ interrupt }) =>
				interrupt({
					"driver.name": { question: "Name?" },
					"driver.license": { question: "License?" },
				}),
			)
			.addEdge(START, "ask_driver")
			.addEdge("ask_driver", END)
			.compile({ store });

		const { payload } = await startWith(flow, { "driver.name": "Ana" });

		expect(payload.field).toBe("driver.license");
		expect(payload.fieldSchema).toMatchObject({ type: "string" });
		expect((await store.get(SESSION_ID))?.state).toEqual({
			driver: { name: "Ana" },
		});
	});

	test("a held answer in a batch is validated once the batch is complete", async () => {
		const seen: unknown[] = [];
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "batch",
			title: "Batch",
			description: "Two questions in one node.",
			state: {
				email: z.string().describe("Email"),
				phone: z.string().describe("Phone"),
			},
		})
			.addNode("ask_contact", ({ interrupt }) =>
				interrupt({
					email: {
						question: "Email?",
						validate: (email) => {
							seen.push(email);
						},
					},
					phone: { question: "Phone?" },
				}),
			)
			.addEdge(START, "ask_contact")
			.addEdge("ask_contact", END)
			.compile({ store });

		const { handler, payload } = await startWith(flow, { email: "a@b.co" });
		expect(payload.field).toBe("phone");
		expect(seen).toEqual([]);

		const done = parsePayload(
			await handler(
				{ action: "continue", stateUpdates: { phone: "555" } },
				EXTRA,
			),
		);
		expect(done.status).toBe("complete");
		expect(seen).toEqual(["a@b.co"]);
	});

	test("a nested member of the wrong type is dropped and asked", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "driver",
			title: "Driver",
			description: "Driver details.",
			state: {
				driver: z
					.object({
						name: z.string().describe("Full name"),
						license: z.string().describe("License number"),
					})
					.describe("Driver details"),
			},
		})
			.addNode("ask_driver", ({ interrupt }) =>
				interrupt({
					"driver.name": { question: "Name?" },
					"driver.license": { question: "License?" },
				}),
			)
			.addEdge(START, "ask_driver")
			.addEdge("ask_driver", END)
			.compile({ store });

		const { payload } = await startWith(flow, {
			"driver.name": "Ana",
			"driver.license": 123,
		});

		expect(payload.field).toBe("driver.license");
		expect((await store.get(SESSION_ID))?.state).toEqual({
			driver: { name: "Ana" },
		});
	});

	test("never stores a key the state schema does not declare", async () => {
		const { flow, store } = carQuote();

		await startWith(flow, {
			discount: 100,
			toString: "x",
			constructor: "y",
			postcode: "28001",
		});

		expect((await store.get(SESSION_ID))?.held).toEqual({ postcode: "28001" });
	});

	test("a record written without `asked` holds nothing", async () => {
		const { flow, store } = carQuote();
		const handler = await handlerFor(flow);
		await store.set(SESSION_ID, {
			step: "ask_plate",
			state: {},
			field: "plate",
		});

		await handler(
			{
				action: "continue",
				stateUpdates: { plate: "1234ABC", postcode: "28001" },
			},
			EXTRA,
		);

		const record = await store.get(SESSION_ID);
		expect(record?.state.price).toBe(300);
		expect(record?.held).toBeUndefined();
	});

	test("checks a held value against a schema with an async refinement", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "async_refine",
			title: "Async refine",
			description: "A code checked asynchronously.",
			state: {
				code: z
					.string()
					.refine(async (code) => code.startsWith("OK"))
					.describe("Promo code"),
			},
		})
			.addNode("ask_code", ({ interrupt }) =>
				interrupt({ code: { question: "Code?" } }),
			)
			.addEdge(START, "ask_code")
			.addEdge("ask_code", END)
			.compile({ store });

		const { payload } = await startWith(flow, { code: "OK-42" });

		expect(payload.status).toBe("complete");
	});
});

describe("splitAskedFields", () => {
	test("a question on one member accepts that member alone, in either spelling", () => {
		expect(
			splitAskedFields({ "driver.name": "Ana", driver: { license: "L-1" } }, [
				"driver.name",
			]),
		).toEqual({
			accepted: { driver: { name: "Ana" } },
			unasked: { driver: { license: "L-1" } },
		});
	});

	test("a question on a group accepts every key inside it", () => {
		expect(
			splitAskedFields({ "driver.name": "Ana", "driver.license": "L-1" }, [
				"driver",
			]),
		).toEqual({
			accepted: { driver: { name: "Ana", license: "L-1" } },
			unasked: {},
		});
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
