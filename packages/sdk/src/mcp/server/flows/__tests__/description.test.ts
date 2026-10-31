/**
 * The tool description is consent-card copy, not a place for operating
 * instructions. ChatGPT flags a description that prescribes conversation
 * behavior, tool sequencing, required follow-up calls, or policy outcomes with
 * a "Suspicious Instruction" warning on the connector approval card, because
 * an honest protocol and an injected one are indistinguishable in that field.
 *
 * So: the description stays descriptive, and everything about what to do next
 * comes back on the response as `nextStep`. These tests hold that line.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { FlowTokenContent, McpServer, RegisteredTool } from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";

class TestStore {
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

const picker: RegisteredTool = {
	id: "plan_picker",
	title: "Plan Picker",
	description: "Show the plans",
	register: async () => {},
};

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
type Payload = Record<string, unknown> & { nextStep?: string };

const AUTHOR_DESCRIPTION =
	"Quote a pet insurance policy in Sweden for a dog or a cat.";

function petFlow(options?: { interactive?: boolean }) {
	const store = new TestStore();
	const flow = createFlow({
		id: "pet_quote",
		title: "Pet insurance quote",
		description: AUTHOR_DESCRIPTION,
		state: {
			breed: z.string().describe("Breed"),
			plan: z.string().describe("Chosen plan"),
		},
	})
		.addNode({
			id: "ask_breed",
			run: ({ interrupt }) =>
				interrupt({ breed: { question: "Which breed?" } }),
		})
		.addNode({
			id: "show_plans",
			run: ({ showWidget }) =>
				options?.interactive === false
					? showWidget({ tool: picker, interactive: false })
					: showWidget({ tool: picker, field: "plan" }),
		})
		.addEdge(START, "ask_breed")
		.addEdge("ask_breed", "show_plans")
		.addEdge("show_plans", END)
		.compile({ store });

	return flow;
}

async function handlerFor(flow: {
	register: (server: McpServer) => Promise<void>;
}): Promise<Handler> {
	const registered: Array<[string, Record<string, unknown>, Handler]> = [];
	const server = {
		registerTool: (...args: unknown[]) => {
			registered.push(args as [string, Record<string, unknown>, Handler]);
		},
	} as unknown as McpServer;
	await flow.register(server);
	const handler = registered[0]?.[2];
	if (!handler) {
		throw new Error("flow did not register a handler");
	}
	return handler;
}

function parse(result: unknown): Payload {
	const content = (result as { content: Array<{ text?: string }> }).content;
	return JSON.parse(content[0]?.text ?? "") as Payload;
}

describe("flow tool description", () => {
	test("carries the author's description and no execution protocol", () => {
		const description = petFlow().config.description;

		expect(description).toContain(AUTHOR_DESCRIPTION);
		expect(description).not.toContain("PROTOCOL");
		expect(description).not.toContain("Follow this protocol");
	});

	/**
	 * The patterns a description-level classifier reads as an attempt to steer
	 * the model: shouted imperatives, prohibitions, and sequencing.
	 */
	test("holds no directive language", () => {
		const description = petFlow().config.description;

		for (const pattern of [
			/\bDo NOT\b/,
			/\bMUST\b/,
			/\bSTOP\b/,
			/\bWAIT\b/,
			/\bNEVER\b/,
			/\bFIRST\b/,
			/\bONLY AFTER\b/,
		]) {
			expect(description).not.toMatch(pattern);
		}
	});

	test("stays short enough to read on a consent card", () => {
		// The protocol block ran past 3 000 characters. A description is a
		// sentence or two about what the tool does.
		expect(petFlow().config.description.length).toBeLessThan(400);
	});
});

describe("nextStep on the response", () => {
	test("an interrupt explains the continue call", async () => {
		const handler = await handlerFor(petFlow());
		const payload = parse(
			await handler(
				{ action: "start", intent: "user wants a dog quote" },
				{ _meta: { sessionId: "s1" } },
			),
		);

		expect(payload.status).toBe("interrupt");
		expect(payload.nextStep).toContain('action: "continue"');
		expect(payload.nextStep).toContain("stateUpdates");
		// The correction path rides along, since it applies from here.
		expect(payload.nextStep).toContain('action: "reset"');
	});

	test("an interactive widget names the tool and the wait", async () => {
		const handler = await handlerFor(petFlow());
		await handler(
			{ action: "start", intent: "user wants a dog quote" },
			{ _meta: { sessionId: "s2" } },
		);
		const payload = parse(
			await handler(
				{ action: "continue", stateUpdates: { breed: "golden retriever" } },
				{ _meta: { sessionId: "s2" } },
			),
		);

		expect(payload.status).toBe("widget");
		expect(payload.nextStep).toContain("plan_picker");
		expect(payload.nextStep).toContain("waits");
	});

	test("a display-only widget still says to render it before continuing", async () => {
		const handler = await handlerFor(petFlow({ interactive: false }));
		await handler(
			{ action: "start", intent: "user wants a cat quote" },
			{ _meta: { sessionId: "s3" } },
		);
		const payload = parse(
			await handler(
				{ action: "continue", stateUpdates: { breed: "ragdoll" } },
				{ _meta: { sessionId: "s3" } },
			),
		);

		expect(payload.status).toBe("widget");
		expect(payload.nextStep).toContain("plan_picker");
		expect(payload.nextStep).toContain("display-only");
		expect(payload.nextStep).toContain('action: "continue"');
	});

	test("the sessionId reminder appears only when the response echoes one", async () => {
		const handler = await handlerFor(petFlow());

		// No sessionId in _meta: the engine generates one and echoes it back,
		// so the caller has to carry it.
		const echoed = parse(
			await handler({ action: "start", intent: "user wants a quote" }, {}),
		);
		expect(echoed.sessionId).toBeString();
		expect(echoed.nextStep).toContain("sessionId");

		// Transport-supplied sessionId: nothing for the caller to carry.
		const fromMeta = parse(
			await handler(
				{ action: "start", intent: "user wants a quote" },
				{ _meta: { sessionId: "s4" } },
			),
		);
		expect(fromMeta.nextStep).not.toContain("sessionId");
	});
});
