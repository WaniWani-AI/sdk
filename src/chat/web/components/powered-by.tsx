"use client";

const LOGO_URL = "https://app.waniwani.ai/assets/waniwani-logo.svg";
const HREF = "https://waniwani.ai";

/**
 * Small "powered by WaniWani" link rendered under the chat input. Mirrors
 * the attribution pattern of other embedded chat widgets and links back to
 * the WaniWani site.
 */
export function PoweredBy() {
	return (
		<div className="ww:pt-2 ww:pb-1 ww:flex ww:justify-center">
			<a
				href={HREF}
				target="_blank"
				rel="noopener noreferrer"
				className="ww:flex ww:items-center ww:gap-1.5 ww:text-[11px] ww:text-muted-foreground ww:opacity-70 hover:ww:opacity-100 ww:transition-opacity"
			>
				<span>powered by</span>
				<img
					src={LOGO_URL}
					alt="WaniWani"
					width={72}
					height={10}
					data-waniwani-logo=""
					className="ww:h-2.5 ww:w-auto"
				/>
			</a>
		</div>
	);
}
