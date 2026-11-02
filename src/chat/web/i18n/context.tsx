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
import {
	DEFAULT_LOCALE,
	isSupportedLocale,
	type Locale,
	SUPPORTED_LOCALES,
} from "./types";

type DeepPartial<T> = T extends (...args: never[]) => unknown
	? T
	: T extends object
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T;

export type MessageOverrides = DeepPartial<Messages>;

/** Overrides keyed by locale: `{ "fr": { … }, "en": { … } }`. */
export type LocaleMessageOverrides = Partial<Record<Locale, MessageOverrides>>;

type AnyMessageOverrides = MessageOverrides | LocaleMessageOverrides;

const warnedDroppedSections = new Set<string>();

function warnDroppedSections(dropped: string[]): void {
	const id = dropped.join(",");
	if (warnedDroppedSections.has(id)) {
		return;
	}
	warnedDroppedSections.add(id);
	const names = dropped.map((key) => `"${key}"`).join(", ");
	console.warn(
		`[Waniwani] messages mixes locale keys with flat sections; ignoring ${names}. Nest them under a locale key such as "fr".`,
	);
}

function isLocaleKeyed(
	raw: AnyMessageOverrides,
): raw is LocaleMessageOverrides {
	const keys = Object.keys(raw);
	if (!keys.some(isSupportedLocale)) {
		return false;
	}
	const dropped = keys.filter((key) => !isSupportedLocale(key));
	if (dropped.length > 0) {
		warnDroppedSections(dropped);
	}
	return true;
}

/**
 * Picks the overrides that apply to `locale`. A top-level key naming a
 * supported locale marks the locale-keyed form; anything else is the flat
 * form, which applies to every locale.
 */
export function resolveMessageOverrides(
	raw: AnyMessageOverrides | undefined,
	locale: Locale,
): MessageOverrides | undefined {
	if (!raw) {
		return undefined;
	}
	return isLocaleKeyed(raw) ? raw[locale] : raw;
}

function mergeSections(
	base: MessageOverrides | undefined,
	top: MessageOverrides | undefined,
): MessageOverrides | undefined {
	if (!base || !top) {
		return top ?? base;
	}
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(top)) {
		const under = out[key];
		out[key] =
			isPlainObject(under) && isPlainObject(value)
				? { ...under, ...value }
				: value;
	}
	return out as MessageOverrides;
}

function toLocaleKeyed(raw: AnyMessageOverrides): LocaleMessageOverrides {
	if (isLocaleKeyed(raw)) {
		return raw;
	}
	return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, raw]));
}

/** Layers `top` over `base`, section by section; `top` wins on a shared key. */
export function mergeOverrideSources(
	base: AnyMessageOverrides | undefined,
	top: AnyMessageOverrides | undefined,
): AnyMessageOverrides | undefined {
	if (!base || !top) {
		return top ?? base;
	}
	if (!isLocaleKeyed(base) && !isLocaleKeyed(top)) {
		return mergeSections(base, top);
	}
	const keyedBase = toLocaleKeyed(base);
	const keyedTop = toLocaleKeyed(top);
	const out: LocaleMessageOverrides = {};
	for (const locale of SUPPORTED_LOCALES) {
		const merged = mergeSections(keyedBase[locale], keyedTop[locale]);
		if (merged) {
			out[locale] = merged;
		}
	}
	return out;
}

/**
 * Overrides can come from untrusted JSON on the script tag, which cannot
 * carry functions: a string sent for a function-valued key would crash the
 * render, so a value replaces the built-in one only when the types match.
 */
function sameTypedKeys(
	section: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(override)) {
		if (typeof value === typeof section[key]) {
			out[key] = value;
		}
	}
	return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface I18nContextValue {
	locale: Locale;
	t: Messages;
	/**
	 * `true` once the locale has been resolved against the runtime
	 * (`navigator.language` / `<html lang>`). Always `true` when an
	 * explicit `locale` was passed to the provider, or on the no-provider
	 * fallback path. Consumers can mask their UI (opacity 0) while this is
	 * `false` to avoid showing a flash of the default-locale catalog before
	 * the post-mount detection effect runs.
	 */
	ready: boolean;
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
	 * tweak individual strings without contributing a full locale. Either
	 * flat (applies to every locale) or keyed by locale.
	 */
	messages?: AnyMessageOverrides;
}

function mergeMessages(base: Messages, overrides?: MessageOverrides): Messages {
	if (!overrides) {
		return base;
	}
	const out: Record<string, unknown> = { ...base };
	for (const sectionKey of Object.keys(base) as (keyof Messages)[]) {
		const section = base[sectionKey] as Record<string, unknown>;
		const override = overrides[sectionKey];
		if (isPlainObject(override)) {
			out[sectionKey] = { ...section, ...sameTypedKeys(section, override) };
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
	// hydrated. `ready` lets consumers (ChatEmbed) mask their UI during
	// the detection window so users don't see a flash of English chrome
	// before the catalog swaps.
	const explicit = Boolean(locale && isLocaleString(locale));
	const initial: Locale = explicit ? (locale as Locale) : DEFAULT_LOCALE;
	const [resolved, setResolved] = useState<Locale>(initial);
	const [ready, setReady] = useState<boolean>(explicit);

	useEffect(() => {
		setResolved(detectLocale(locale));
		setReady(true);
	}, [locale]);

	const value = useMemo<I18nContextValue>(() => {
		const catalog = catalogs[resolved] ?? catalogs[DEFAULT_LOCALE];
		return {
			locale: resolved,
			t: mergeMessages(catalog, resolveMessageOverrides(messages, resolved)),
			ready,
		};
	}, [resolved, messages, ready]);

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
	return { locale: DEFAULT_LOCALE, t: en, ready: true };
}
