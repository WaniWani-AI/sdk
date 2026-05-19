"use client";

const DEFAULT_TEXT = "can make mistakes";

/**
 * Short notice rendered under the chat input warning users that responses
 * come from an AI. Shown by default so embedders stay aligned with EU AI
 * Act transparency requirements; pass `text={false}` to suppress, or a
 * custom string to override the wording.
 */
export function AiDisclaimer({ text }: { text?: string | false }) {
	if (text === false) {
		return null;
	}
	return (
		<span className="ww:text-[11px] ww:text-muted-foreground ww:opacity-70">
			{text || DEFAULT_TEXT}
		</span>
	);
}
