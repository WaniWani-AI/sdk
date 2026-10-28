import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com/pricing" });
for (const key of [
	"document",
	"navigator",
	"localStorage",
	"screen",
	"location",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;

const { setConsent } = await import("../../../../shared/consent");
const { __resetPageViewGuard, firePageView } = await import("../page-view");

interface Captured {
	url: string;
	body: string;
}

const API = "https://app.waniwani.ai/api/mcp/chat";
const realFetch = globalThis.fetch;
let calls: Captured[] = [];

function channelsSent(): string[] {
	return calls.map((c) => JSON.parse(c.body).events[0].properties.channelId);
}

/** The grant listener sends without awaiting; give it time to reach fetch. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 5));
	}
}

beforeEach(() => {
	__resetPageViewGuard();
	localStorage.clear();
	calls = [];
	// biome-ignore lint/suspicious/noExplicitAny: test stub
	(globalThis as any).fetch = async (url: any, init: any) => {
		calls.push({ url: String(url), body: String(init?.body) });
		return new Response(null, { status: 202 });
	};
});

afterEach(async () => {
	__resetPageViewGuard();
	setConsent("granted");
	await settle();
	globalThis.fetch = realFetch;
	localStorage.clear();
});

describe("firePageView while consent is pending", () => {
	test("sends nothing and holds the call", async () => {
		setConsent("pending");
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_1" });
		await settle();
		expect(calls).toHaveLength(0);
	});

	test("granting sends the held call exactly once", async () => {
		setConsent("pending");
		await firePageView({
			api: API,
			token: "wwp_test",
			channelId: "chan_1",
			mode: "floating",
			source: "acme-web",
		});
		setConsent("granted");
		await settle();
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(
			"https://app.waniwani.ai/api/mcp/events/v2/batch",
		);
		const [ev] = JSON.parse(calls[0].body).events;
		expect(ev.name).toBe("page.viewed");
		expect(ev.source).toBe("acme-web");
		expect(ev.properties.channelId).toBe("chan_1");
		expect(ev.properties.mode).toBe("floating");
	});

	test("two pending calls for the same api|token|channel send once on grant", async () => {
		setConsent("pending");
		const opts = { api: API, token: "wwp_test", channelId: "chan_1" };
		await firePageView(opts);
		await firePageView(opts);
		setConsent("granted");
		await settle();
		expect(calls).toHaveLength(1);
	});

	test("a call after the grant for the same key does not send a second event", async () => {
		setConsent("pending");
		const opts = { api: API, token: "wwp_test", channelId: "chan_1" };
		await firePageView(opts);
		setConsent("granted");
		await firePageView(opts);
		await settle();
		expect(calls).toHaveLength(1);
	});

	test("held calls for different channels each send once on grant", async () => {
		setConsent("pending");
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_1" });
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_2" });
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_1" });
		setConsent("granted");
		await settle();
		expect(channelsSent().sort()).toEqual(["chan_1", "chan_2"]);
	});

	test("repeating pending before the grant still sends once", async () => {
		setConsent("pending");
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_1" });
		setConsent("pending");
		setConsent("granted");
		await settle();
		expect(calls).toHaveLength(1);
	});

	test("a call that would be skipped anyway is not held", async () => {
		setConsent("pending");
		await firePageView({ api: API, token: "wwp_test" });
		await firePageView({
			api: "https://acme.example/agent/v1/chat",
			token: "wwp_test",
			channelId: "chan_1",
		});
		setConsent("granted");
		await settle();
		expect(calls).toHaveLength(0);
	});

	test("a second grant does not replay a call already sent", async () => {
		setConsent("pending");
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_1" });
		setConsent("granted");
		await settle();
		setConsent("pending");
		setConsent("granted");
		await settle();
		expect(calls).toHaveLength(1);
	});
});

describe("firePageView when consent is denied", () => {
	test("a denial drops the held call and a later grant sends nothing for it", async () => {
		setConsent("pending");
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_1" });
		setConsent("denied");
		await settle();
		expect(calls).toHaveLength(0);
		setConsent("granted");
		await settle();
		expect(calls).toHaveLength(0);
	});

	test("a denial between two pending periods still drops the first held call", async () => {
		setConsent("pending");
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_1" });
		setConsent("denied");
		setConsent("pending");
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_2" });
		setConsent("granted");
		await settle();
		expect(channelsSent()).toEqual(["chan_2"]);
	});

	test("a call under denial sends nothing, now or after a grant", async () => {
		setConsent("denied");
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_1" });
		await settle();
		expect(calls).toHaveLength(0);
		setConsent("granted");
		await settle();
		expect(calls).toHaveLength(0);
	});

	test("a call under denial does not consume the once-per-page guard", async () => {
		const opts = { api: API, token: "wwp_test", channelId: "chan_1" };
		setConsent("denied");
		await firePageView(opts);
		setConsent("granted");
		await firePageView(opts);
		await settle();
		expect(calls).toHaveLength(1);
	});
});

describe("firePageView with consent granted", () => {
	test("sends immediately and a later denial does not unsend or resend", async () => {
		await firePageView({ api: API, token: "wwp_test", channelId: "chan_1" });
		expect(calls).toHaveLength(1);
		setConsent("denied");
		setConsent("granted");
		await settle();
		expect(calls).toHaveLength(1);
	});
});
