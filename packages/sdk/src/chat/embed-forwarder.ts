/**
 * `@waniwani/sdk/dist/chat/embed.js`, kept until 2.0.0.
 *
 * The chat embed lives in `@waniwani/chat`. A page that loads this file from a
 * CDN through a moving tag (`@waniwani/sdk@latest/dist/chat/embed.js`) would
 * get a 404 at the next SDK release without it. So the file loads the chat's
 * embed the way the app.waniwani.ai/embed.js loader does: it adds a script tag
 * for the new bundle and copies this tag's attributes onto it.
 */

export const CHAT_EMBED_URL =
	"https://cdn.jsdelivr.net/npm/@waniwani/chat@1/dist/embed.js";

export const DEPRECATION_WARNING =
	"[Waniwani] @waniwani/sdk/dist/chat/embed.js is deprecated, and @waniwani/sdk 2.0.0 removes it. " +
	"Load the chat with the snippet from your Waniwani dashboard, or from " +
	`${CHAT_EMBED_URL}.`;

// `src` points at this file and `integrity` hashes it, so neither may move to
// the chat's tag.
const STAYS_ON_THIS_TAG = new Set(["src", "integrity"]);

export function forwardChatEmbed(
	self: HTMLOrSVGScriptElement | null,
): HTMLScriptElement | null {
	const parent = self?.parentNode;
	if (!self || !parent) {
		return null;
	}

	const chat = self.ownerDocument.createElement("script");
	chat.src = CHAT_EMBED_URL;
	for (const { name, value } of Array.from(self.attributes)) {
		if (!STAYS_ON_THIS_TAG.has(name)) {
			chat.setAttribute(name, value);
		}
	}

	// In place of this tag, so an inline embed mounts where the page put it.
	parent.insertBefore(chat, self);
	// The chat finds its config on the script that carries `data-token` when
	// `document.currentScript` is null, so only its own tag may keep one.
	self.removeAttribute("data-token");

	console.warn(DEPRECATION_WARNING);
	return chat;
}
