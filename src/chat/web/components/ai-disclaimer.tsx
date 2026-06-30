"use client";

import { useTranslation } from "../i18n";

/**
 * Short notice rendered under the chat input warning users that responses
 * come from an AI. Shown by default so embedders stay aligned with EU AI
 * Act transparency requirements; pass `text={false}` to suppress, or a
 * custom string to override the wording.
 */
export function AiDisclaimer({ text }: { text?: string | false }) {
	const { t } = useTranslation();
	if (text === false) {
		return null;
	}
	return (
		<span className="ww:whitespace-nowrap ww:text-[10px] ww:sm:text-[11px] ww:text-muted-foreground ww:opacity-70">
			{text || t.aiDisclaimer.default}
		</span>
	);
}
