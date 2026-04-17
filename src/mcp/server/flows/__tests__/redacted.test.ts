import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { McpServer } from "../@types";
import { END, START } from "../@types";
import { createFlow } from "../create-flow";
import {
	collectRedactedStateFields,
	isFieldRedacted,
	REDACTED_STATE_UPDATE_FIELDS_META_KEY,
	redacted,
} from "../redacted";

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
type RegisterToolArgs = [string, Record<string, unknown>, Handler];

function mockServer() {
	const registered: RegisterToolArgs[] = [];
	const server = {
		registerTool: (...args: unknown[]) => {
			registered.push(args as RegisterToolArgs);
		},
	};
	return { server: server as unknown as McpServer, registered };
}

describe("redacted()", () => {
	test("marks a schema so isFieldRedacted returns true", () => {
		const schema = redacted(z.string().describe("age"));
		expect(isFieldRedacted(schema)).toBe(true);
	});

	test("unmarked schemas return false", () => {
		expect(isFieldRedacted(z.string())).toBe(false);
	});

	test("collectRedactedStateFields returns marked field names", () => {
		const fields = collectRedactedStateFields({
			locale: z.enum(["es", "en"]).default("es"),
			ages: redacted(z.string().describe("ages")),
			zipcode: redacted(z.string().describe("zipcode")),
			company: z.string().default("all"),
		});
		expect(fields.sort()).toEqual(["ages", "zipcode"]);
	});

	test("empty state returns empty list", () => {
		expect(collectRedactedStateFields(undefined)).toEqual([]);
		expect(collectRedactedStateFields({})).toEqual([]);
	});
});

describe("flow compile — redacted state fields on tool _meta", () => {
	test("attaches field names to tool _meta when any are marked", async () => {
		const flow = createFlow({
			id: "test_flow",
			title: "Test",
			description: "desc",
			state: {
				locale: z.enum(["es", "en"]).default("es"),
				ages: redacted(z.string().describe("ages")),
				zipcode: redacted(z.string().describe("zipcode")),
			},
		})
			.addEdge(START, END)
			.compile();

		const mock = mockServer();
		await flow.register(mock.server);

		const [, config] = mock.registered[0] ?? [];
		const meta = config?._meta as Record<string, unknown> | undefined;
		expect(meta).toBeDefined();
		expect(
			(meta?.[REDACTED_STATE_UPDATE_FIELDS_META_KEY] as string[]).sort(),
		).toEqual(["ages", "zipcode"]);
	});

	test("omits _meta when no fields are marked", async () => {
		const flow = createFlow({
			id: "plain_flow",
			title: "Plain",
			description: "desc",
			state: {
				locale: z.enum(["es", "en"]).default("es"),
			},
		})
			.addEdge(START, END)
			.compile();

		const mock = mockServer();
		await flow.register(mock.server);

		const [, config] = mock.registered[0] ?? [];
		const meta = config?._meta as Record<string, unknown> | undefined;
		expect(meta?.[REDACTED_STATE_UPDATE_FIELDS_META_KEY]).toBe(undefined);
	});
});
