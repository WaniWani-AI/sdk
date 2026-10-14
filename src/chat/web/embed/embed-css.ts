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
 * Text properties the host page must not hand down to the widget.
 *
 * A shadow root stops the host's selectors, not inheritance: inherited
 * properties still flow from the page into the host element and on down.
 * saudeprime.pt runs the Divi theme, whose `body { font-weight: 500 }` turned
 * every line of the chat medium-weight — the "bold answers" of WAN-1441, with
 * no `**` anywhere in the messages. Any theme that styles `body` text does the
 * same.
 *
 * Only properties whose initial value is what the widget is designed for are
 * reset. Size, line height, colour and font family still inherit: changing
 * them would resize or recolour the widget on every site that embeds it today.
 * `:host` rules lose to the page's own rules on the host element, so a site
 * that targets the host directly still wins; a `body` rule no longer reaches.
 */
export const HOST_TEXT_RESET =
	":host{font-weight:400;font-style:normal;letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0}";

/**
 * Append the compiled stylesheet to a shadow root, after the text reset.
 *
 * The stylesheet is skipped when the bundle was not post-processed, which is
 * every path other than the IIFE: the React entry points ship `styles.css` for
 * the host page to import, so there is nothing to inline. The reset is always
 * appended — it is what isolates the root, whatever else loads into it.
 */
export function injectEmbedCss(shadowRoot: ShadowRoot): void {
	const reset = document.createElement("style");
	reset.textContent = HOST_TEXT_RESET;
	shadowRoot.appendChild(reset);

	if (!EMBED_CSS || isPlaceholder(EMBED_CSS)) {
		return;
	}
	const style = document.createElement("style");
	style.textContent = EMBED_CSS;
	shadowRoot.appendChild(style);
}
