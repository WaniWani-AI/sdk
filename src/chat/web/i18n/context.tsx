"use client";

import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { detectLocale } from "./detect";
import { catalogs, type Messages } from "./locales";
import { en } from "./locales/en";
import { DEFAULT_LOCALE, type Locale } from "./types";

type DeepPartial<T> = T extends (...args: never[]) => unknown
	? T
	: T extends object
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T;

export type MessageOverrides = DeepPartial<Messages>;

interface I18nContextValue {
	locale: Locale;
	t: Messages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
	children: ReactNode;
	/**
	 * Explicit locale. When omitted, the provider detects from
	 * `<html lang>` / `navigator.language` and falls back to `'en'`.
	 */
	locale?: string;
	/**
	 * Per-key overrides merged on top of the resolved catalog. Use to
	 * tweak individual strings without contributing a full locale.
	 */
	messages?: MessageOverrides;
}

function mergeMessages(base: Messages, overrides?: MessageOverrides): Messages {
	if (!overrides) {
		return base;
	}
	const out: Record<string, unknown> = { ...base };
	for (const sectionKey of Object.keys(base) as (keyof Messages)[]) {
		const section = base[sectionKey];
		const override = overrides[sectionKey];
		if (override && typeof section === "object") {
			out[sectionKey as string] = { ...section, ...override };
		}
	}
	return out as unknown as Messages;
}

export function I18nProvider({
	children,
	locale,
	messages,
}: I18nProviderProps) {
	// Initial state must be deterministic across server and client to avoid
	// hydration mismatches — calling `detectLocale()` (which reads
	// `navigator.language`) during the initializer would diverge from the
	// server's render. We pick the explicit prop or the default at mount,
	// then resolve the real locale in the effect below once the tree has
	// hydrated. Costs one re-render and a brief flash of English on
	// auto-detected loads; the alternative is a hard hydration error.
	const initial: Locale =
		locale && isLocaleString(locale) ? (locale as Locale) : DEFAULT_LOCALE;
	const [resolved, setResolved] = useState<Locale>(initial);

	useEffect(() => {
		setResolved(detectLocale(locale));
	}, [locale]);

	const value = useMemo<I18nContextValue>(() => {
		const catalog = catalogs[resolved] ?? catalogs[DEFAULT_LOCALE];
		return {
			locale: resolved,
			t: mergeMessages(catalog, messages),
		};
	}, [resolved, messages]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function isLocaleString(value: string): boolean {
	return value === "en" || value === "fr" || value === "es";
}

/**
 * Access translated messages and the active locale. Falls back to the
 * English catalog when called outside an `I18nProvider` (e.g. legacy
 * `ChatCard` usage, isolated tests). This makes the SDK i18n-aware
 * without forcing every existing consumer to wrap their tree.
 */
export function useTranslation(): I18nContextValue {
	const ctx = useContext(I18nContext);
	if (ctx) {
		return ctx;
	}
	return { locale: DEFAULT_LOCALE, t: en };
}
