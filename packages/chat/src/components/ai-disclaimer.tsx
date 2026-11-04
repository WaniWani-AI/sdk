"use client";

import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";

/**
 * Short notice rendered under the chat input warning users that responses
 * come from an AI. Shown by default so embedders stay aligned with EU AI
 * Act transparency requirements; pass `text={false}` to suppress, or a
 * custom string to override the wording.
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
	return (
		<span
			className={cn(
				PARTS.disclaimer,
				"ww:whitespace-nowrap ww:text-[length:var(--ww-disclaimer-size)] ww:text-[color:var(--ww-disclaimer-fg)] ww:opacity-70",
			)}
		>
			{text ||
				(standalone ? t.aiDisclaimer.standalone : t.aiDisclaimer.default)}
		</span>
	);
}
