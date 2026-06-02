import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "./types";

/**
 * Resolve the active locale. Precedence:
 *   explicit prop > `navigator.language(s)` > `<html lang>` > `'en'`.
 *
 * Visitor preference wins over the host page's declared language so a
 * Spanish-speaking visitor on an `<html lang="en">` site sees Spanish
 * chrome — matches how chat widgets (Intercom, Drift) behave.
 *
 * Region tags fall back to the language prefix (e.g. `fr-CA` → `fr`,
 * `es-ES` → `es`). SSR-safe: returns the fallback when `navigator` /
 * `document` are absent.
 */
export function detectLocale(explicit?: string): Locale {
	if (explicit && isSupportedLocale(explicit)) {
		return explicit;
	}
	if (explicit) {
		const prefix = explicit.split("-")[0]?.toLowerCase();
		if (prefix && isSupportedLocale(prefix)) {
			return prefix;
		}
	}

	const candidates: string[] = [];

	if (typeof navigator !== "undefined") {
		if (navigator.language) {
			candidates.push(navigator.language);
		}
		if (navigator.languages) {
			candidates.push(...navigator.languages);
		}
	}

	if (typeof document !== "undefined") {
		const htmlLang = document.documentElement.getAttribute("lang");
		if (htmlLang) {
			candidates.push(htmlLang);
		}
	}

	for (const raw of candidates) {
		const lowered = raw.toLowerCase();
		if (isSupportedLocale(lowered)) {
			return lowered;
		}
		const prefix = lowered.split("-")[0];
		if (prefix && isSupportedLocale(prefix)) {
			return prefix;
		}
	}

	return DEFAULT_LOCALE;
}
