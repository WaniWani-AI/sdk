/**
 * Chat widget translation types.
 *
 * The English catalog is the source of truth — its shape is inferred and
 * every other locale must match it exactly (enforced by `ExactShape`).
 * Add a key in `en.ts` and TypeScript will flag the missing key in `fr.ts`
 * / `es.ts`.
 */

export const SUPPORTED_LOCALES = ["en", "fr", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export type MessageValue =
	| string
	| ((...args: never[]) => string)
	| { [key: string]: MessageValue };

type ExactShape<T> = T extends (...args: infer A) => string
	? (...args: A) => string
	: T extends string
		? string
		: T extends Record<string, MessageValue>
			? { [K in keyof T]: ExactShape<T[K]> }
			: MessageValue;

export type MessagesFor<T extends Record<string, MessageValue>> = ExactShape<T>;

export function isSupportedLocale(value: string): value is Locale {
	return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
