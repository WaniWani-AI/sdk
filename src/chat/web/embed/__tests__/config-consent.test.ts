import { describe, expect, test } from "bun:test";

// biome-ignore lint/suspicious/noExplicitAny: test setup
const g = globalThis as any;
g.HTMLScriptElement ??= class HTMLScriptElement {};
g.document ??= {
	currentScript: null,
	querySelector: () => null,
	querySelectorAll: () => [],
};

async function parseWithAttrs(
	attrs: Record<string, string>,
): Promise<Record<string, unknown>> {
	const { parseConfigFromScript } = await import(
		`../config?t=${Date.now()}-${Math.random()}`
	);
	const fakeScript = {
		getAttribute(name: string) {
			return name in attrs ? attrs[name] : null;
		},
	};
	const prevDocument = g.document;
	const prevHtmlScriptElement = g.HTMLScriptElement;
	g.HTMLScriptElement = class {};
	Object.setPrototypeOf(fakeScript, g.HTMLScriptElement.prototype);
	g.document = { currentScript: fakeScript, querySelectorAll: () => [] };
	try {
		return parseConfigFromScript();
	} finally {
		g.document = prevDocument;
		g.HTMLScriptElement = prevHtmlScriptElement;
	}
}

describe("parseConfigFromScript — data-consent", () => {
	for (const value of ["pending", "granted", "denied"] as const) {
		test(`"${value}" sets consent`, async () => {
			const cfg = await parseWithAttrs({
				"data-token": "tok",
				"data-consent": value,
			});
			expect(cfg.consent).toBe(value);
		});
	}

	test("is case tolerant", async () => {
		expect(
			(await parseWithAttrs({ "data-token": "tok", "data-consent": "PENDING" }))
				.consent,
		).toBe("pending");
		expect(
			(await parseWithAttrs({ "data-token": "tok", "data-consent": "Denied" }))
				.consent,
		).toBe("denied");
		expect(
			(await parseWithAttrs({ "data-token": "tok", "data-consent": "GrAnTeD" }))
				.consent,
		).toBe("granted");
	});

	test("is whitespace tolerant", async () => {
		expect(
			(
				await parseWithAttrs({
					"data-token": "tok",
					"data-consent": "  pending  ",
				})
			).consent,
		).toBe("pending");
		expect(
			(
				await parseWithAttrs({
					"data-token": "tok",
					"data-consent": "\n\tDENIED ",
				})
			).consent,
		).toBe("denied");
	});

	test("an unknown value sets nothing", async () => {
		for (const value of [
			"yes",
			"accept",
			"true",
			"grant",
			"granted-ish",
			"pend ing",
			"0",
		]) {
			const cfg = await parseWithAttrs({
				"data-token": "tok",
				"data-consent": value,
			});
			expect(cfg.consent).toBeUndefined();
			expect("consent" in cfg).toBe(false);
		}
	});

	test("an empty or blank value sets nothing", async () => {
		for (const value of ["", "   "]) {
			const cfg = await parseWithAttrs({
				"data-token": "tok",
				"data-consent": value,
			});
			expect("consent" in cfg).toBe(false);
		}
	});

	test("absent attribute sets nothing", async () => {
		const cfg = await parseWithAttrs({ "data-token": "tok" });
		expect("consent" in cfg).toBe(false);
	});

	test("does not disturb the other attributes", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-consent": "pending",
			"data-visitor-id": "posthog-1",
		});
		expect(cfg.consent).toBe("pending");
		expect(cfg.visitorId).toBe("posthog-1");
	});
});
