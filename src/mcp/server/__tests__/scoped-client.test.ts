import { describe, expect, test } from "bun:test";
import type { KbClient } from "../../../kb/types.js";
import type { TrackInput } from "../../../tracking/@types.js";
import { createScopedClient } from "../scoped-client.js";

function makeBase() {
	const captured: TrackInput[] = [];
	const base = {
		track: async (event: TrackInput) => {
			captured.push(event);
			return { eventId: "evt_test" };
		},
		identify: async () => ({ eventId: "evt_id" }),
		kb: {} as KbClient,
	};
	return { base, captured };
}

describe("createScopedClient", () => {
	test("track is callable and exposes the flat revenue helpers", () => {
		const { base } = makeBase();
		const scoped = createScopedClient(base, { "waniwani/sessionId": "sess-9" });
		expect(typeof scoped.track).toBe("function");
		expect(typeof scoped.track.converted).toBe("function");
	});

	test("revenue helpers map to typed events and inherit scoped meta", async () => {
		const { base, captured } = makeBase();
		const scoped = createScopedClient(base, { "waniwani/sessionId": "sess-9" });

		await scoped.track.converted({ amount: 85, currency: "EUR" });

		expect(captured).toHaveLength(1);
		expect(captured[0]).toMatchObject({
			event: "converted",
			properties: { amount: 85, currency: "EUR" },
		});
		// Request meta is merged so identity carries from the MCP request.
		expect(captured[0]?.meta).toMatchObject({ "waniwani/sessionId": "sess-9" });
	});

	test("generic track still merges scoped meta", async () => {
		const { base, captured } = makeBase();
		const scoped = createScopedClient(base, { "waniwani/sessionId": "sess-9" });

		await scoped.track({ event: "session.started", meta: { extra: "1" } });

		expect(captured[0]).toMatchObject({ event: "session.started" });
		expect(captured[0]?.meta).toMatchObject({
			"waniwani/sessionId": "sess-9",
			extra: "1",
		});
	});
});
