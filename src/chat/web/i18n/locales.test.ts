import { describe, expect, test } from "bun:test";
import { catalogs, type Messages } from "./locales";

const PLACEHOLDER = /\{[a-zA-Z]+\}/g;

function flatten(
	value: unknown,
	prefix = "",
	out: Record<string, string> = {},
): Record<string, string> {
	if (typeof value === "string") {
		out[prefix] = value;
		return out;
	}
	if (value && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, prefix ? `${prefix}.${key}` : key, out);
		}
	}
	return out;
}

const english = flatten(catalogs.en);
const others = Object.entries(catalogs).filter(
	([locale]) => locale !== "en",
) as [keyof typeof catalogs, Messages][];

describe("locale catalogs stay in step with English", () => {
	for (const [locale, catalog] of others) {
		test(`${locale} translates every English string`, () => {
			expect(Object.keys(flatten(catalog)).sort()).toEqual(
				Object.keys(english).sort(),
			);
		});

		test(`${locale} keeps every interpolation slot English declares`, () => {
			const translated = flatten(catalog);
			const drifted: string[] = [];

			for (const [key, source] of Object.entries(english)) {
				const expected = (source.match(PLACEHOLDER) ?? []).sort();
				const actual = (translated[key]?.match(PLACEHOLDER) ?? []).sort();
				if (expected.join(",") !== actual.join(",")) {
					drifted.push(`${key}: expected ${expected} got ${actual}`);
				}
			}

			expect(drifted).toEqual([]);
		});
	}
});

describe("the attachment strings the document upload needs", () => {
	test("English names the file and the limit in the messages that report a reject", () => {
		expect(catalogs.en.promptInput.errorAccept).toContain("{name}");
		expect(catalogs.en.promptInput.errorTooLarge).toContain("{name}");
		expect(catalogs.en.promptInput.errorTooLarge).toContain("{limit}");
		expect(catalogs.en.promptInput.errorTooMany).toContain("{limit}");
	});

	test("no catalog leaves an attachment string empty", () => {
		for (const [locale, catalog] of Object.entries(catalogs)) {
			for (const [key, value] of Object.entries(catalog.promptInput)) {
				expect(`${locale}.${key}: ${value}`).not.toMatch(/: $/);
			}
		}
	});
});

describe("the strings the sent-turn attachment tiles and the paperclip need", () => {
	const KIND_KEYS = ["kindPdf", "kindImage", "kindFile"] as const;

	test("every catalog names the three document kinds", () => {
		const missing: string[] = [];
		for (const [locale, catalog] of Object.entries(catalogs)) {
			for (const key of KIND_KEYS) {
				if ((catalog.attachments[key] ?? "").trim() === "") {
					missing.push(`${locale}.attachments.${key}`);
				}
			}
		}

		expect(missing).toEqual([]);
	});

	test("a kind label is never one of the others in the same catalog", () => {
		for (const [locale, catalog] of Object.entries(catalogs)) {
			const labels = KIND_KEYS.map((key) => catalog.attachments[key]);
			expect(`${locale}: ${labels.join("/")}`).toBe(
				`${locale}: ${[...new Set(labels)].join("/")}`,
			);
		}
	});

	test("every catalog declares exactly the {limit} slot in the paperclip's label", () => {
		for (const [locale, catalog] of Object.entries(catalogs)) {
			const slots =
				catalog.promptInput.uploadFilesUpTo.match(PLACEHOLDER) ?? [];
			expect(`${locale}: ${slots.join(",")}`).toBe(`${locale}: {limit}`);
		}
	});

	test("the paperclip's capped and uncapped labels are both present and differ", () => {
		for (const [locale, catalog] of Object.entries(catalogs)) {
			expect(`${locale}: ${catalog.promptInput.uploadFiles.trim()}`).not.toBe(
				`${locale}: `,
			);
			expect(catalog.promptInput.uploadFilesUpTo).not.toBe(
				catalog.promptInput.uploadFiles,
			);
		}
	});
});
