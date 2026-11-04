import { describe, expect, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type {
	LocaleMessageOverrides as PublicLocaleMessageOverrides,
	MessageOverrides as PublicMessageOverrides,
} from "../index";
import {
	I18nProvider,
	type LocaleMessageOverrides,
	type MessageOverrides,
	mergeOverrideSources,
	resolveMessageOverrides,
	useTranslation,
} from "./context";
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

describe("resolveMessageOverrides", () => {
	test("resolveMessageOverrides picks the active locale map", () => {
		const raw = {
			fr: { workingIndicator: { default: "Un instant…" } },
			en: { workingIndicator: { default: "One moment…" } },
		};
		expect(resolveMessageOverrides(raw, "fr")).toEqual(raw.fr);
		expect(resolveMessageOverrides(raw, "en")).toEqual(raw.en);
		expect(resolveMessageOverrides(raw, "es")).toBeUndefined();
	});

	test("flat form passes through", () => {
		const flat = { menu: { restart: "Start over" } };
		expect(resolveMessageOverrides(flat, "fr")).toBe(flat);
		expect(resolveMessageOverrides(flat, "en")).toBe(flat);
	});

	test("nothing to resolve stays undefined", () => {
		expect(resolveMessageOverrides(undefined, "en")).toBeUndefined();
	});

	test("flat sections beside locale keys are dropped with one warning naming them", () => {
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const mixed = {
				fr: { menu: { restart: "Recommencer" } },
				menu: { copied: "Copied" },
				dialog: { cancel: "No" },
			};
			expect(resolveMessageOverrides(mixed, "fr")).toEqual(mixed.fr);
			resolveMessageOverrides(mixed, "en");
			expect(warn).toHaveBeenCalledTimes(1);
			const message = String(warn.mock.calls[0]?.[0]);
			expect(message).toContain('"menu"');
			expect(message).toContain('"dialog"');
			expect(message).toContain('ignoring "menu", "dialog".');
		} finally {
			warn.mockRestore();
		}
	});

	test("a purely locale-keyed or purely flat map warns nothing", () => {
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		try {
			resolveMessageOverrides(
				{ fr: { menu: { restart: "Recommencer" } } },
				"fr",
			);
			resolveMessageOverrides({ menu: { restart: "Start over" } }, "fr");
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	test("the public chat entry exports both override shapes", () => {
		const keyed: PublicLocaleMessageOverrides = {
			fr: { menu: { restart: "Recommencer" } },
		};
		const flat: PublicMessageOverrides = { menu: { restart: "Start over" } };
		expect(resolveMessageOverrides(keyed, "fr")).toEqual(keyed.fr);
		expect(resolveMessageOverrides(flat, "fr")).toBe(flat);
	});
});

describe("mergeOverrideSources", () => {
	test("inline wins per key over the fetched map, sections merge", () => {
		const fetched = {
			fr: {
				menu: { restart: "Recommencer", copied: "Copié !" },
				dialog: { cancel: "Non" },
			},
		};
		const inline = { fr: { menu: { restart: "Repartir de zéro" } } };
		expect(mergeOverrideSources(fetched, inline)).toEqual({
			fr: {
				menu: { restart: "Repartir de zéro", copied: "Copié !" },
				dialog: { cancel: "Non" },
			},
		});
	});

	test("a flat source applies to the active locale only after resolution", () => {
		const merged = mergeOverrideSources(
			{ fr: { menu: { restart: "Recommencer" } } },
			{ menu: { copied: "Done" } },
		);
		expect(resolveMessageOverrides(merged, "fr")).toEqual({
			menu: { restart: "Recommencer", copied: "Done" },
		});
		expect(resolveMessageOverrides(merged, "en")).toEqual({
			menu: { copied: "Done" },
		});
	});

	test("a single source is returned as is", () => {
		const only = { menu: { restart: "Start over" } };
		expect(mergeOverrideSources(undefined, only)).toBe(only);
		expect(mergeOverrideSources(only, undefined)).toBe(only);
		expect(mergeOverrideSources(undefined, undefined)).toBeUndefined();
	});
});

describe("the strings the menu, the restart dialog and the transcript need", () => {
	test("every catalog fills every new key except the welcome knob", () => {
		for (const [locale, catalog] of Object.entries(catalogs)) {
			for (const section of ["menu", "dialog", "toast"] as const) {
				for (const [key, value] of Object.entries(catalog[section])) {
					expect(`${locale}.${section}.${key}: ${value}`).not.toMatch(/: $/);
				}
			}
			expect(catalog.welcome).toEqual({ title: "", subtitle: "" });
		}
	});

	test("the transcript header names the date and the site", () => {
		expect(catalogs.en.transcript.header("shop.example", "30/10/2026")).toBe(
			"Conversation with the assistant · 30/10/2026 · shop.example",
		);
		expect(catalogs.fr.transcript.header("shop.example", "30/10/2026")).toBe(
			"Conversation avec l'assistant · 30/10/2026 · shop.example",
		);
		expect(catalogs.es.transcript.header("shop.example", "30/10/2026")).toBe(
			"Conversación con el asistente · 30/10/2026 · shop.example",
		);
	});

	test("menu.newChat reuses the thread menu wording", () => {
		for (const catalog of Object.values(catalogs)) {
			expect(catalog.menu.newChat).toBe(catalog.threadMenu.newChat);
		}
	});
});

describe("I18nProvider with tag overrides", () => {
	function renderWith(
		locale: string,
		messages: MessageOverrides | LocaleMessageOverrides,
	): Messages {
		let seen: Messages | undefined;
		function Probe() {
			seen = useTranslation().t;
			return null;
		}
		renderToString(
			createElement(
				I18nProvider,
				{ locale, messages } as Parameters<typeof I18nProvider>[0],
				createElement(Probe),
			),
		);
		if (!seen) {
			throw new Error("Probe did not render");
		}
		return seen;
	}

	test("the active locale map applies and the rest of the catalog stays", () => {
		const t = renderWith("fr", {
			fr: { menu: { restart: "Recommencer" } },
			en: { menu: { restart: "Start over" } },
		});
		expect(t.menu.restart).toBe("Recommencer");
		expect(t.menu.copied).toBe(catalogs.fr.menu.copied);
	});

	test("a value whose type does not match the built-in one is ignored", () => {
		const t = renderWith("en", {
			reasoning: { thoughtForSeconds: "nope" },
			menu: "not a section",
		} as unknown as MessageOverrides);
		expect(t.reasoning.thoughtForSeconds(2)).toBe("Thought for 2 seconds");
		expect(t.menu).toEqual(catalogs.en.menu);
	});
});
