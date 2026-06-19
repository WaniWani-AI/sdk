"use client";

import { useTranslation } from "../i18n";

const LOGO_URL = "https://app.waniwani.ai/assets/waniwani-logo.svg";
const HREF = "https://waniwani.ai";

/**
 * Small "powered by Waniwani" link rendered under the chat input. Mirrors
 * the attribution pattern of other embedded chat widgets and links back to
 * the Waniwani site.
 */
export function PoweredBy() {
	const { t } = useTranslation();
	return (
		<a
			href={HREF}
			target="_blank"
			rel="noopener noreferrer"
			className="ww:flex ww:items-center ww:gap-1.5 ww:text-[11px] ww:text-muted-foreground ww:opacity-70 hover:ww:opacity-100 ww:transition-opacity"
		>
			<span>{t.poweredBy.label}</span>
			<img
				src={LOGO_URL}
				alt="Waniwani"
				width={72}
				height={10}
				data-waniwani-logo=""
				className="ww:h-2.5 ww:w-auto"
			/>
		</a>
	);
}
