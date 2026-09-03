/**
 * The embed's compiled stylesheet, and the one way to get it into a shadow
 * root.
 *
 * Its own module because more than one root needs it: the chat's, and the
 * WebMCP overlay's, which mounts separately so a widget step renders whether or
 * not the panel is open. Two roots, one stylesheet, one placeholder.
 *
 * The constant is a placeholder at build time. `scripts/inline-embed-css.ts`
 * replaces the first occurrence of it in `dist/chat/embed.js` with the compiled
 * `styles.css`, so it must appear exactly once in the bundle — which is the
 * other reason this is a module rather than a constant copied per entry.
 */

const EMBED_CSS = "__WANIWANI_EMBED_CSS__";

/**
 * Recognise the un-replaced placeholder without writing it out a second time.
 *
 * `inline-embed-css.ts` swaps the first occurrence of that string in the built
 * bundle, so a second copy of it here would be a coin flip over which one the
 * CSS lands in. A prefix nobody would author into a stylesheet is enough to
 * tell them apart, and there is only ever one full literal to replace.
 */
function isPlaceholder(value: string): boolean {
	return value.startsWith("__WANIWANI");
}

/**
 * Append the compiled stylesheet to a shadow root.
 *
 * A no-op when the bundle was not post-processed, which is every path other
 * than the IIFE: the React entry points ship `styles.css` for the host page to
 * import, so there is nothing to inline and nothing to inject.
 */
export function injectEmbedCss(shadowRoot: ShadowRoot): void {
	if (!EMBED_CSS || isPlaceholder(EMBED_CSS)) {
		return;
	}
	const style = document.createElement("style");
	style.textContent = EMBED_CSS;
	shadowRoot.appendChild(style);
}
