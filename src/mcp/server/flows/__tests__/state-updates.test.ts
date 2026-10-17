import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryKvStore } from "../../kv/memory-kv-store";
import type { FlowTokenContent, McpServer, RegisteredTool } from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";
import { readFlowGraph } from "../definition-meta";
import { redacted } from "../redacted";
import {
	acceptStateUpdates,
	listStateFields,
	neverPrefilled,
} from "../state-updates";
import { createFlowTestHarness, type FlowTestResult } from "../test-utils";

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;

const SESSION_ID = "state-updates-session";
const EXTRA = { _meta: { sessionId: SESSION_ID } };

/**
 * Plate, then a lookup that resolves the vehicle id for that plate unless one
 * is already set, then the postcode, then a price that depends on the vehicle.
 * `vehicleId` is marked `neverPrefilled()` so the tests can drive the marker
 * on a field no question asks. `usage` is never asked: the model fills it from
 * what the user says, and the price depends on it.
 */
function carQuote() {
	const store = new MemoryKvStore<FlowTokenContent>();
	const flow = createFlow({
		id: "car_quote",
		title: "Car quote",
		description: "Quote a car.",
		state: {
			plate: z.string().describe("License plate"),
			vehicleId: neverPrefilled(
				z.string().describe("Vehicle id the plate resolves to"),
			),
			usage: z
				.enum(["personal", "business"])
				.optional()
				.describe("What the car is used for"),
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
			price:
				(state.vehicleId === "v-1234ABC" ? 300 : 999) +
				(state.usage === "business" ? 100 : 0),
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

async function startWith(
	flow: { register: (server: McpServer) => Promise<void> },
	stateUpdates?: Record<string, unknown>,
) {
	const handler = await handlerFor(flow);
	const payload = parsePayload(
		await handler(
			{
				action: "start",
				intent: "quote my car",
				...(stateUpdates ? { stateUpdates } : {}),
			},
			EXTRA,
		),
	);
	return { handler, payload };
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

describe("fields", () => {
	test("the first question lists every field the conversation may fill", async () => {
		const { flow } = carQuote();

		const { payload } = await startWith(flow);

		expect(payload.field).toBe("plate");
		expect(payload.fields).toEqual({
			plate: { type: "string", description: "License plate" },
			usage: {
				type: "enum",
				values: ["personal", "business"],
				description: "What the car is used for",
				optional: true,
			},
			postcode: { type: "string", description: "Postcode" },
			price: { type: "number", description: "Quoted yearly price" },
		});
		expect(payload.nextStep).toContain("`fields`");
	});

	test("goes out once per conversation", async () => {
		const { flow } = carQuote();

		const { handler } = await startWith(flow);
		const next = parsePayload(
			await handler(
				{ action: "continue", stateUpdates: { plate: "1234ABC" } },
				EXTRA,
			),
		);
		const again = parsePayload(
			await handler({ action: "start", intent: "quote another car" }, EXTRA),
		);

		expect(next.field).toBe("postcode");
		expect(next.fields).toBeUndefined();
		expect(again.field).toBe("plate");
		expect(again.fields).toBeUndefined();
	});

	test("rides on the first widget too, after the widget's own data", async () => {
		const planPicker: RegisteredTool = {
			id: "plan_picker",
			title: "Plan picker",
			description: "Pick a plan",
			register: async () => {},
		};
		const flow = createFlow({
			id: "plan",
			title: "Plan",
			description: "Pick a plan.",
			state: { plan: z.string().describe("Chosen plan") },
		})
			.addNode("pick", ({ showWidget }) =>
				showWidget({ tool: planPicker, field: "plan" }),
			)
			.addEdge(START, "pick")
			.addEdge("pick", END)
			.compile({ store: new MemoryKvStore<FlowTokenContent>() });

		const { payload } = await startWith(flow);

		expect(payload.status).toBe("widget");
		expect(payload.fields).toEqual({
			plan: { type: "string", description: "Chosen plan" },
		});
		expect(Object.keys(payload).slice(-2)).toEqual(["fields", "nextStep"]);
	});

	test("waits for a question when the first run completes without one", async () => {
		const { flow } = carQuote();

		const { handler, payload } = await startWith(flow, {
			plate: "1234ABC",
			postcode: "28001",
		});
		const next = parsePayload(
			await handler({ action: "start", intent: "quote another car" }, EXTRA),
		);

		expect(payload.status).toBe("complete");
		expect(payload.fields).toBeUndefined();
		expect(next.field).toBe("plate");
		expect(next.fields).toBeDefined();
	});
});

describe("listStateFields", () => {
	test("lists group members as dot-paths and leaves out fields marked neverPrefilled", () => {
		expect(
			listStateFields({
				name: z.string().describe("Name"),
				consent: neverPrefilled(z.boolean().describe("Consent")),
				driver: z
					.object({
						license: z.string().describe("License number"),
						check: neverPrefilled(z.boolean().describe("Records check")),
					})
					.optional(),
				secret: neverPrefilled(z.object({ token: z.string() })),
			}),
		).toEqual({
			name: { type: "string", description: "Name" },
			"driver.license": { type: "string", description: "License number" },
		});
	});

	test("is undefined for a flow with nothing to fill", () => {
		expect(listStateFields({})).toBeUndefined();
		expect(listStateFields({ id: neverPrefilled(z.string()) })).toBeUndefined();
	});
});

describe("stateUpdates", () => {
	test("sets a field no question asks", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		await harness.continueWith({ plate: "1234ABC", usage: "business" });
		const done = await harness.continueWith({ postcode: "28001" });

		expect(done.status).toBe("complete");
		expect(done.decodedState?.state).toMatchObject({
			usage: "business",
			price: 400,
		});
	});

	test("drops a field marked neverPrefilled, sent alongside an answer", async () => {
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

	test("a value for a later question fills it, and the flow skips the question", async () => {
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

	test("drops a value that does not fit its field's schema, and asks the question", async () => {
		const { flow, store } = carQuote();

		const { payload } = await startWith(flow, {
			plate: "1234ABC",
			postcode: 28001,
			usage: "racing",
		});

		expect(payload.field).toBe("postcode");
		expect((await store.get(SESSION_ID))?.state).toEqual({
			plate: "1234ABC",
			vehicleId: "v-1234ABC",
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

		expect((await store.get(SESSION_ID))?.state).toEqual({
			postcode: "28001",
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

	test("reset corrects a field set before its question", async () => {
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

		expect(same.field).toBe("plate");
		expect((await store.get(SESSION_ID))?.state).toMatchObject({
			postcode: "22222",
			price: 300,
		});
	});

	test("reset with only a field marked neverPrefilled, not asked, is refused", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		await harness.start("quote my car");
		await harness.continueWith({ plate: "1234ABC" });
		const refused = await harness.resetWith({ vehicleId: "v-forged" });

		expect(refused.status).toBe("error");
		expect((await harness.lastState())?.state.vehicleId).toBe("v-1234ABC");
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
				discount: neverPrefilled(
					z.number().describe("Discount the flow grants"),
				),
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

	test("a widget's field marked neverPrefilled shows the widget even when answered up front", async () => {
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
				agreed: neverPrefilled(z.boolean().describe("Agreed to the notice")),
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
});

describe("a value kept out of state", () => {
	test("a node keys it by ctx.sessionId, and no call can reach it", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const vehicles = new MemoryKvStore<{ vehicleId: string }>();
		const flow = createFlow({
			id: "car_quote_private",
			title: "Car quote",
			description: "Quote a car.",
			state: {
				plate: z.string().describe("License plate"),
				price: z.number().describe("Quoted yearly price"),
			},
		})
			.addNode("ask_plate", ({ interrupt }) =>
				interrupt({ plate: { question: "What's the plate?" } }),
			)
			.addNode("lookup", async ({ state, sessionId }) => {
				await vehicles.set(`vehicle:${sessionId}`, {
					vehicleId: `v-${state.plate}`,
				});
				return {};
			})
			.addNode("quote", async ({ sessionId }) => {
				const vehicle = await vehicles.get(`vehicle:${sessionId}`);
				return { price: vehicle?.vehicleId === "v-1234ABC" ? 300 : 999 };
			})
			.addEdge(START, "ask_plate")
			.addEdge("ask_plate", "lookup")
			.addEdge("lookup", "quote")
			.addEdge("quote", END)
			.compile({ store });

		const { handler, payload } = await startWith(flow, {
			vehicleId: "v-forged",
		});
		const done = parsePayload(
			await handler(
				{
					action: "continue",
					stateUpdates: { plate: "1234ABC", vehicleId: "v-forged" },
				},
				EXTRA,
			),
		);

		expect(Object.keys(payload.fields as object)).toEqual(["plate", "price"]);
		expect(done.status).toBe("complete");
		expect((await store.get(SESSION_ID))?.state).toEqual({
			plate: "1234ABC",
			price: 300,
		});
		expect(await vehicles.get(`vehicle:${SESSION_ID}`)).toEqual({
			vehicleId: "v-1234ABC",
		});
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

describe("values sent before their question", () => {
	test("everything stated on start runs the flow to the end", async () => {
		const { flow, store } = carQuote();

		const { payload } = await startWith(flow, {
			plate: "1234ABC",
			postcode: "28001",
		});

		expect(payload.status).toBe("complete");
		expect((await store.get(SESSION_ID))?.state.price).toBe(300);
	});

	test("a value the validator rejects comes back as the rejection", async () => {
		const { flow } = carQuote();

		const { payload } = await startWith(flow, { plate: "bad" });

		expect(payload.field).toBe("plate");
		expect(payload.context).toContain("Not a plate");
	});

	test("a node that asks only while its field is empty runs its rest", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "greet",
			title: "Greet",
			description: "Greet the user.",
			state: {
				name: z.string().describe("Name"),
				greeting: z.string().describe("Greeting the flow builds"),
			},
		})
			.addNode("ask_name", ({ state, interrupt }) =>
				state.name
					? { greeting: `Hi ${state.name}` }
					: interrupt({ name: { question: "What's your name?" } }),
			)
			.addEdge(START, "ask_name")
			.addEdge("ask_name", END)
			.compile({ store });

		const { payload } = await startWith(flow, { name: "Ana" });

		expect(payload.status).toBe("complete");
		expect((await store.get(SESSION_ID))?.state).toEqual({
			name: "Ana",
			greeting: "Hi Ana",
		});
	});

	test("a long flow answered up front does not run out of steps", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const fields = Array.from({ length: 30 }, (_, i) => `q${i}`);
		let builder = createFlow({
			id: "long",
			title: "Long",
			description: "Many questions.",
			state: Object.fromEntries(
				fields.map((f) => [f, z.string().describe(f)]),
			) as Record<string, z.ZodString>,
		});
		for (const f of fields) {
			builder = builder.addNode(f, ({ interrupt }) =>
				interrupt({ [f]: { question: f } }),
			);
		}
		builder = builder.addEdge(START, fields[0] as never);
		fields.forEach((f, i) => {
			builder = builder.addEdge(f as never, (fields[i + 1] ?? END) as never);
		});
		const flow = builder.compile({ store });

		const { payload } = await startWith(
			flow,
			Object.fromEntries(fields.map((f) => [f, "x"])),
		);

		expect(payload.status).toBe("complete");
	});

	test("a fresh answer replaces one sent earlier", async () => {
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

		const { handler, payload } = await startWith(flow, {
			name: "Ana",
			agreed: true,
		});
		expect(payload.field).toBe("agreed");
		expect((await store.get(SESSION_ID))?.state).toEqual({ name: "Ana" });

		const done = parsePayload(
			await handler(
				{ action: "continue", stateUpdates: { agreed: true } },
				EXTRA,
			),
		);
		expect(done.status).toBe("complete");
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

	test("a node that sets the field afterwards wins over the value sent", async () => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "refill",
			title: "Refill",
			description: "A year the flow fills, clears and asks again.",
			state: {
				year: z.number().describe("Model year"),
				confirmed: z.boolean().describe("Year looks right"),
			},
		})
			.addNode("lookup", () => ({ year: 2021 }))
			.addNode("ask_year", ({ interrupt }) =>
				interrupt({ year: { question: "Model year?" } }),
			)
			.addNode("ask_confirm", ({ interrupt }) =>
				interrupt({ confirmed: { question: "Is that year right?" } }),
			)
			.addNode("clear_year", ({ state }) =>
				state.confirmed ? {} : { year: undefined },
			)
			.addNode("ask_year_again", ({ interrupt }) =>
				interrupt({ year: { question: "Which year is it, then?" } }),
			)
			.addEdge(START, "lookup")
			.addEdge("lookup", "ask_year")
			.addEdge("ask_year", "ask_confirm")
			.addEdge("ask_confirm", "clear_year")
			.addEdge("clear_year", "ask_year_again")
			.addEdge("ask_year_again", END)
			.compile({ store });

		const { handler, payload } = await startWith(flow, { year: 2019 });
		expect(payload.field).toBe("confirmed");
		expect((await store.get(SESSION_ID))?.state.year).toBe(2021);

		const next = parsePayload(
			await handler(
				{ action: "continue", stateUpdates: { confirmed: false } },
				EXTRA,
			),
		);

		expect(next.field).toBe("year");
	});

	test("a value in a batch is validated once the batch is complete", async () => {
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

	test("checks a value against a schema with an async refinement", async () => {
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

describe("acceptStateUpdates", () => {
	const stateSchema = {
		driver: z.object({
			name: z.string(),
			license: z.string(),
			check: neverPrefilled(z.boolean()),
		}),
		age: z.number(),
	};

	test("a question on one member accepts that member as sent, in either spelling", async () => {
		expect(
			await acceptStateUpdates({
				updates: { "driver.name": 42, driver: { license: "L-1" } },
				asked: ["driver.name"],
				stateSchema,
			}),
		).toEqual({ driver: { name: 42, license: "L-1" } });
	});

	test("a question on a group accepts every key inside it", async () => {
		expect(
			await acceptStateUpdates({
				updates: { "driver.check": true, "driver.license": "L-1" },
				asked: ["driver"],
				stateSchema,
			}),
		).toEqual({ driver: { check: true, license: "L-1" } });
	});

	test("before its question, a value merges only when it fits and is not marked", async () => {
		expect(
			await acceptStateUpdates({
				updates: {
					age: "forty",
					"driver.name": "Ana",
					"driver.check": true,
					extra: 1,
				},
				asked: [],
				stateSchema,
			}),
		).toEqual({ driver: { name: "Ana" } });
	});

	test("a record written without `asked` merges everything", async () => {
		expect(
			await acceptStateUpdates({
				updates: { extra: 1 },
				asked: undefined,
				stateSchema,
			}),
		).toEqual({ extra: 1 });
	});
});

describe("createFlowTestHarness start(intent, known)", () => {
	test("sends `known` on start, and stops on the first question it cannot answer", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		const result = await harness.start("quote my car", {
			plate: "1234ABC",
			vehicleId: "v-forged",
			usage: "business",
		});

		expect(asInterrupt(result).field).toBe("postcode");
		expect(result.decodedState?.state).toMatchObject({
			vehicleId: "v-1234ABC",
			usage: "business",
		});
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

	test("returns the rejection for a value the validator rejects", async () => {
		const { flow, store } = carQuote();
		const harness = await createFlowTestHarness(flow, { stateStore: store });

		const result = await harness.start("quote my car", { plate: "bad" });

		const rejected = asInterrupt(result);
		expect(rejected.field).toBe("plate");
		expect(rejected.context).toContain("Not a plate");
	});
});
