import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type {
	FlowIntro,
	FlowTokenContent,
	McpServer,
	RegisteredTool,
} from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";
import type { FlowStore } from "../flow-store";

class MemoryFlowStore implements FlowStore {
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

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
type RegisterToolArgs = [string, Record<string, unknown>, Handler];

const SESSION_ID = "intro-session-1";
const EXTRA = { _meta: { sessionId: SESSION_ID } };
const INTENT = "user wants a home insurance quote";

const VERBATIM =
	"Acme Insurance is the data controller. Your answers are used for this quote only and deleted after 30 days.";
const INSTRUCTIONS =
	"Introduce yourself as Léa from Acme in one short friendly sentence.";

type IntroPayload = { verbatim?: string; instructions?: string };
type Payload = Record<string, unknown> & { intro?: IntroPayload };

const quotePicker: RegisteredTool = {
	id: "quote_picker",
	title: "Quote Picker",
	description: "Show the quote options",
	register: async () => {},
};

/**
 * Home insurance flow: address, then postcode, then city, then occupancy.
 * Opening the conversation with an address already stated skips the first
 * three nodes, which is the case the intro exists for.
 */
function quoteFlow(options?: { intro?: FlowIntro; store?: FlowStore }) {
	const store = options?.store ?? new MemoryFlowStore();
	const flow = createFlow({
		id: "home_quote",
		title: "Home insurance quote",
		description: "Quote a home insurance policy.",
		...(options?.intro !== undefined ? { intro: options.intro } : {}),
		state: {
			address: z.string().describe("Street address"),
			postcode: z.string().describe("Postcode"),
			city: z.string().describe("City"),
			occupancy: z.enum(["owner", "tenant"]).describe("Occupancy status"),
		},
	})
		.addNode({
			id: "ask_address",
			run: ({ interrupt }) =>
				interrupt({ address: { question: "What's the address?" } }),
		})
		.addNode({
			id: "ask_postcode",
			run: ({ interrupt }) =>
				interrupt({ postcode: { question: "What's the postcode?" } }),
		})
		.addNode({
			id: "ask_city",
			run: ({ interrupt }) => interrupt({ city: { question: "Which city?" } }),
		})
		.addNode({
			id: "ask_occupancy",
			run: ({ interrupt }) =>
				interrupt({ occupancy: { question: "Is the flat owned or rented?" } }),
		})
		.addEdge(START, "ask_address")
		.addEdge("ask_address", "ask_postcode")
		.addEdge("ask_postcode", "ask_city")
		.addEdge("ask_city", "ask_occupancy")
		.addEdge("ask_occupancy", END)
		.compile({ store });

	return { flow, store };
}

function widgetFlow(intro: FlowIntro) {
	const store = new MemoryFlowStore();
	const flow = createFlow({
		id: "widget_intro",
		title: "Widget Intro",
		description: "Show options first.",
		intro,
		state: { plan: z.string().describe("Chosen plan") },
	})
		.addNode({
			id: "pick_plan",
			run: ({ showWidget }) => showWidget({ tool: quotePicker, field: "plan" }),
		})
		.addEdge(START, "pick_plan")
		.addEdge("pick_plan", END)
		.compile({ store });

	return { flow, store };
}

async function handlerFor(flow: {
	register: (server: McpServer) => Promise<void>;
}): Promise<Handler> {
	const registered: RegisterToolArgs[] = [];
	const server = {
		registerTool: (...args: unknown[]) => {
			registered.push(args as RegisterToolArgs);
		},
	} as unknown as McpServer;
	await flow.register(server);
	const handler = registered[0]?.[2];
	if (!handler) {
		throw new Error("flow did not register a handler");
	}
	return handler;
}

function parsePayload(result: unknown): Payload {
	const content = (result as { content: Array<{ text?: string }> }).content;
	return JSON.parse(content[0]?.text ?? "") as Payload;
}

const PREFILLED_LOCATION = {
	address: "12 rue de Rivoli",
	postcode: "75001",
	city: "Paris",
};

describe("flow intro", () => {
	test("rides along on a start that skips pre-filled nodes", async () => {
		const { flow, store } = quoteFlow({
			intro: { verbatim: VERBATIM, instructions: INSTRUCTIONS },
		});
		const handler = await handlerFor(flow);

		const parsed = parsePayload(
			await handler(
				{
					action: "start",
					intent: INTENT,
					stateUpdates: PREFILLED_LOCATION,
				},
				EXTRA,
			),
		);

		expect(parsed.status).toBe("interrupt");
		expect(parsed.field).toBe("occupancy");
		expect(parsed.intro).toEqual({
			verbatim: VERBATIM,
			instructions: INSTRUCTIONS,
		});
		expect((await store.get(SESSION_ID))?.internal).toBeUndefined();
	});

	test("intro is the first key in the serialized payload", async () => {
		const { flow } = quoteFlow({ intro: VERBATIM });
		const handler = await handlerFor(flow);

		const parsed = parsePayload(
			await handler({ action: "start", intent: INTENT }, EXTRA),
		);

		expect(Object.keys(parsed)[0]).toBe("intro");
	});

	test("is absent on the following continue", async () => {
		const { flow, store } = quoteFlow({ intro: VERBATIM });
		const handler = await handlerFor(flow);

		await handler(
			{ action: "start", intent: INTENT, stateUpdates: PREFILLED_LOCATION },
			EXTRA,
		);
		const parsed = parsePayload(
			await handler(
				{ action: "continue", stateUpdates: { occupancy: "tenant" } },
				EXTRA,
			),
		);

		expect(parsed.status).toBe("complete");
		expect(parsed.intro).toBeUndefined();
		expect((await store.get(SESSION_ID))?.internal).toBeUndefined();
	});

	test("rides along on a start that completes the whole flow", async () => {
		const { flow, store } = quoteFlow({ intro: VERBATIM });
		const handler = await handlerFor(flow);

		const parsed = parsePayload(
			await handler(
				{
					action: "start",
					intent: INTENT,
					stateUpdates: { ...PREFILLED_LOCATION, occupancy: "owner" },
				},
				EXTRA,
			),
		);

		expect(parsed.status).toBe("complete");
		expect(parsed.intro).toEqual({ verbatim: VERBATIM });
		expect((await store.get(SESSION_ID))?.internal).toBeUndefined();
	});

	test("rides along when the first step is a widget", async () => {
		const { flow, store } = widgetFlow(VERBATIM);
		const handler = await handlerFor(flow);

		const parsed = parsePayload(
			await handler({ action: "start", intent: INTENT }, EXTRA),
		);

		expect(parsed.status).toBe("widget");
		expect(parsed.tool).toBe("quote_picker");
		expect(parsed.intro).toEqual({ verbatim: VERBATIM });
		expect((await store.get(SESSION_ID))?.internal).toBeUndefined();
	});

	test("is not attached to an error response, and survives to the next call", async () => {
		const { flow, store } = quoteFlow({ intro: VERBATIM });
		const handler = await handlerFor(flow);

		// No session record yet — continue fails before any node runs.
		const failed = parsePayload(await handler({ action: "continue" }, EXTRA));
		expect(failed.status).toBe("error");
		expect(failed.intro).toBeUndefined();
		expect(await store.get(SESSION_ID)).toBeNull();

		const parsed = parsePayload(
			await handler({ action: "start", intent: INTENT }, EXTRA),
		);
		expect(parsed.intro).toEqual({ verbatim: VERBATIM });
	});

	test("is not repeated by a second start on the same session", async () => {
		const { flow } = quoteFlow({ intro: VERBATIM });
		const handler = await handlerFor(flow);

		const first = parsePayload(
			await handler({ action: "start", intent: INTENT }, EXTRA),
		);
		const second = parsePayload(
			await handler({ action: "start", intent: INTENT }, EXTRA),
		);

		expect(first.intro).toEqual({ verbatim: VERBATIM });
		expect(second.intro).toBeUndefined();
	});

	test("is not repeated by a reset", async () => {
		const { flow, store } = quoteFlow({ intro: VERBATIM });
		const handler = await handlerFor(flow);

		await handler(
			{ action: "start", intent: INTENT, stateUpdates: PREFILLED_LOCATION },
			EXTRA,
		);
		const parsed = parsePayload(
			await handler({ action: "reset", stateUpdates: { city: "Lyon" } }, EXTRA),
		);

		expect(parsed.status).toBe("interrupt");
		expect(parsed.intro).toBeUndefined();
		expect((await store.get(SESSION_ID))?.internal).toBeUndefined();
	});

	test("is delivered when the engine generates the session id", async () => {
		const { flow } = quoteFlow({ intro: VERBATIM });
		const handler = await handlerFor(flow);

		const parsed = parsePayload(
			await handler({ action: "start", intent: INTENT }, { _meta: {} }),
		);

		expect(parsed.intro).toEqual({ verbatim: VERBATIM });
		expect(typeof parsed.sessionId).toBe("string");
	});

	test("string shorthand means verbatim", async () => {
		const { flow } = quoteFlow({ intro: `  ${VERBATIM}  ` });
		const handler = await handlerFor(flow);

		const parsed = parsePayload(
			await handler({ action: "start", intent: INTENT }, EXTRA),
		);

		expect(parsed.intro).toEqual({ verbatim: VERBATIM });
	});

	test("instructions alone are passed through", async () => {
		const { flow } = quoteFlow({ intro: { instructions: INSTRUCTIONS } });
		const handler = await handlerFor(flow);

		const parsed = parsePayload(
			await handler({ action: "start", intent: INTENT }, EXTRA),
		);

		expect(parsed.intro).toEqual({ instructions: INSTRUCTIONS });
	});

	test("a flow without an intro never carries the key", async () => {
		const { flow, store } = quoteFlow();
		const handler = await handlerFor(flow);

		const parsed = parsePayload(
			await handler({ action: "start", intent: INTENT }, EXTRA),
		);

		expect("intro" in parsed).toBe(false);
		expect(await store.get(SESSION_ID)).toEqual({
			step: "ask_address",
			state: {},
			field: "address",
		});
	});

	test("a session that has already spent its intro never sees it again", async () => {
		const store = new MemoryFlowStore();
		const { flow } = quoteFlow({ intro: VERBATIM, store });
		const handler = await handlerFor(flow);

		// Mid-flow record with no intro left on it.
		await store.set(SESSION_ID, {
			step: "ask_occupancy",
			state: PREFILLED_LOCATION,
			field: "occupancy",
		});

		const continued = parsePayload(
			await handler(
				{ action: "continue", stateUpdates: { occupancy: "tenant" } },
				EXTRA,
			),
		);
		expect(continued.intro).toBeUndefined();

		const restarted = parsePayload(
			await handler({ action: "start", intent: INTENT }, EXTRA),
		);
		expect(restarted.intro).toBeUndefined();
	});

	test("carries forward internal fields it does not recognize", async () => {
		const store = new MemoryFlowStore();
		const { flow } = quoteFlow({ intro: VERBATIM, store });
		const handler = await handlerFor(flow);

		// A record as a newer engine might have written it: the pending intro this
		// version knows, plus a field it has never heard of.
		await store.set(SESSION_ID, {
			step: "ask_occupancy",
			state: PREFILLED_LOCATION,
			field: "occupancy",
			internal: {
				intro: { verbatim: VERBATIM },
				consent: { accepted: true },
			},
		} as FlowTokenContent);

		const parsed = parsePayload(
			await handler(
				{ action: "continue", stateUpdates: { occupancy: "tenant" } },
				EXTRA,
			),
		);

		expect(parsed.intro).toEqual({ verbatim: VERBATIM });
		expect((await store.get(SESSION_ID))?.internal).toEqual({
			consent: { accepted: true },
		} as FlowTokenContent["internal"]);
	});

	test("the protocol block only mentions intro when the flow declares one", async () => {
		const { flow: withIntro } = quoteFlow({ intro: VERBATIM });
		const { flow: without } = quoteFlow();

		expect(withIntro.config.description).toContain("OPENING MESSAGE");
		expect(withIntro.config.description).toContain("word for word");
		expect(without.config.description).not.toContain("OPENING MESSAGE");
	});

	test("an empty intro fails at compile time", () => {
		expect(() => quoteFlow({ intro: "   " })).toThrow(/empty string/);
		expect(() => quoteFlow({ intro: {} })).toThrow(/needs `verbatim`/);
		expect(() => quoteFlow({ intro: { verbatim: "  " } })).toThrow(
			/needs `verbatim`/,
		);
	});
});
