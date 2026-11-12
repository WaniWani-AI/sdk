"use client";

import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";

const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

type DisclaimerSegment =
	| { kind: "text"; start: number; text: string }
	| { kind: "link"; start: number; label: string; href: string };

/**
 * `[label](https://…)` in the wording becomes a link that opens in a new tab,
 * so a notice can point at an information page. Only http(s) URLs qualify;
 * anything else stays plain text.
 */
export function splitDisclaimer(text: string): DisclaimerSegment[] {
	const segments: DisclaimerSegment[] = [];
	let cursor = 0;
	for (const match of text.matchAll(MARKDOWN_LINK)) {
		const start = match.index ?? 0;
		if (start > cursor) {
			segments.push({
				kind: "text",
				start: cursor,
				text: text.slice(cursor, start),
			});
		}
		segments.push({ kind: "link", start, label: match[1], href: match[2] });
		cursor = start + match[0].length;
	}
	if (cursor < text.length) {
		segments.push({ kind: "text", start: cursor, text: text.slice(cursor) });
	}
	return segments;
}

/**
 * Short notice rendered under the chat input warning users that responses
 * come from an AI. Shown by default so embedders stay aligned with EU AI
 * Act transparency requirements; pass `text={false}` to suppress, or a
 * custom string to override the wording. A `[label](url)` in that string
 * renders as a link opening in a new tab.
 */
export function AiDisclaimer({
	text,
	standalone = false,
}: {
	text?: string | false;
	standalone?: boolean;
}) {
	const { t } = useTranslation();
	if (text === false) {
		return null;
	}
	const wording =
		text || (standalone ? t.aiDisclaimer.standalone : t.aiDisclaimer.default);
	return (
		<span
			className={cn(
				PARTS.disclaimer,
				"ww:whitespace-nowrap ww:text-[length:var(--ww-disclaimer-size)] ww:text-[color:var(--ww-disclaimer-fg)] ww:opacity-70",
			)}
		>
			{splitDisclaimer(wording).map((segment) =>
				segment.kind === "text" ? (
					segment.text
				) : (
					<a
						key={segment.start}
						href={segment.href}
						target="_blank"
						rel="noopener noreferrer"
						className={cn(
							PARTS.disclaimerLink,
							"ww:underline ww:underline-offset-2 ww:text-[color:inherit] hover:ww:opacity-80",
						)}
					>
						{segment.label}
					</a>
				),
			)}
		</span>
	);
}
