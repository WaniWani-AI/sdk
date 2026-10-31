import type { Locale } from "./types";

/**
 * Localized "5 minutes ago"-style formatter using `Intl.RelativeTimeFormat`.
 * Falls back to compact English ("5m ago") on environments without Intl
 * RelativeTimeFormat (very old browsers).
 */
export function formatRelativeTime(timestamp: number, locale: Locale): string {
	const diff = Date.now() - timestamp;

	if (diff < 60_000) {
		try {
			return new Intl.RelativeTimeFormat(locale, {
				numeric: "auto",
				style: "narrow",
			}).format(0, "second");
		} catch {
			return "just now";
		}
	}

	let value: number;
	let unit: Intl.RelativeTimeFormatUnit;
	if (diff < 60 * 60_000) {
		value = -Math.floor(diff / 60_000);
		unit = "minute";
	} else if (diff < 24 * 60 * 60_000) {
		value = -Math.floor(diff / (60 * 60_000));
		unit = "hour";
	} else {
		value = -Math.floor(diff / (24 * 60 * 60_000));
		unit = "day";
	}

	try {
		return new Intl.RelativeTimeFormat(locale, {
			numeric: "auto",
			style: "short",
		}).format(value, unit);
	} catch {
		const abs = Math.abs(value);
		const suffix = unit === "minute" ? "m" : unit === "hour" ? "h" : "d";
		return `${abs}${suffix} ago`;
	}
}
