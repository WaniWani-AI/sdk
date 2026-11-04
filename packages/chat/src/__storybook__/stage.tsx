"use client";

import type { ReactNode } from "react";
import type { Locale } from "../i18n";
import { I18nProvider } from "../i18n";

export type StageTheme = "light" | "dark";

export interface ChatStageProps {
	/** Palette to render under. Toggled by the Storybook toolbar. */
	theme?: StageTheme;
	/** Locale for the `I18nProvider` that wraps the story. */
	locale?: Locale;
	/**
	 * Drop the centered card framing and let the story own the full canvas
	 * (host pages, floating docks). The `[data-waniwani-chat]` context and the
	 * palette are still supplied.
	 */
	bare?: boolean;
	children: ReactNode;
}

/**
 * The single wrapper every widget story renders inside. It reproduces the two
 * things the real chat widget always provides:
 *   1. the `[data-waniwani-chat]` element that declares the `--ww-*` CSS
 *      variables (see `tailwind.css`), plus the `.dark` class that swaps the
 *      palette, and
 *   2. an `I18nProvider` so `useTranslation()` resolves against a real catalog.
 *
 * Applied globally from `.storybook/preview.tsx`, so individual stories only
 * render their component with representative props.
 */
export function ChatStage({
	theme = "light",
	locale,
	bare = false,
	children,
}: ChatStageProps) {
	return (
		<I18nProvider locale={locale}>
			<div
				data-waniwani-chat=""
				className={theme === "dark" ? "dark" : undefined}
				style={{
					minHeight: "100vh",
					background: "var(--ww-color-background)",
					color: "var(--ww-color-foreground)",
					fontFamily: "var(--ww-font-sans)",
					padding: bare ? 0 : "48px",
				}}
			>
				{bare ? (
					children
				) : (
					<div style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
						{children}
					</div>
				)}
			</div>
		</I18nProvider>
	);
}
