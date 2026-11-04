import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import {
	CHAT_EMBED_URL,
	DEPRECATION_WARNING,
	forwardChatEmbed,
} from "./embed-forwarder";

const OLD_URL =
	"https://cdn.jsdelivr.net/npm/@waniwani/sdk@latest/dist/chat/embed.js";

/** A page with the old script tag, the way a self-hosted site wrote it. */
function pageWith(attributes: Record<string, string>) {
	const window = new Window({
		url: "https://shop.example/",
		settings: {
			disableJavaScriptEvaluation: true,
			disableJavaScriptFileLoading: true,
			handleDisabledFileLoadingAsSuccess: true,
		},
	});
	const main = window.document.createElement("main");
	window.document.body.appendChild(main);
	const self = window.document.createElement("script");
	self.setAttribute("src", OLD_URL);
	for (const [name, value] of Object.entries(attributes)) {
		self.setAttribute(name, value);
	}
	main.appendChild(self);
	return { main, self: self as unknown as HTMLScriptElement };
}

function attributesOf(element: Element | null): Record<string, string> {
	return Object.fromEntries(
		Array.from(element?.attributes ?? [], ({ name, value }) => [name, value]),
	);
}

// Bun runs every test file in one process, so the spy goes back after each test.
let warn: ReturnType<typeof spyOn<Console, "warn">>;
beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	warn.mockRestore();
});

describe("the dist/chat/embed.js forwarder", () => {
	test("adds a script tag for the @waniwani/chat embed just before its own", () => {
		const { main, self } = pageWith({ "data-token": "wwp_test" });

		const chat = forwardChatEmbed(self);

		expect(chat?.getAttribute("src")).toBe(CHAT_EMBED_URL);
		expect(chat?.nextSibling).toBe(self);
		expect(main.querySelectorAll("script")).toHaveLength(2);
	});

	test("copies every attribute but src and integrity onto the chat's tag", () => {
		const { self } = pageWith({
			"data-token": "wwp_test",
			"data-channel-id": "ch_123",
			"data-visitor-id": "visitor-42",
			"data-api": "https://eu.app.waniwani.ai/api/mcp/chat",
			crossorigin: "anonymous",
			defer: "",
			integrity: "sha384-of-the-old-file",
		});

		const chat = forwardChatEmbed(self);

		expect(attributesOf(chat)).toEqual({
			src: CHAT_EMBED_URL,
			"data-token": "wwp_test",
			"data-channel-id": "ch_123",
			"data-visitor-id": "visitor-42",
			"data-api": "https://eu.app.waniwani.ai/api/mcp/chat",
			crossorigin: "anonymous",
			defer: "",
		});
	});

	test("leaves data-token on the chat's tag only", () => {
		const { main, self } = pageWith({
			"data-token": "wwp_test",
			"data-channel-id": "ch_123",
		});

		forwardChatEmbed(self);

		expect(main.querySelectorAll("script[data-token]")).toHaveLength(1);
		expect(self.hasAttribute("data-token")).toBe(false);
		expect(self.getAttribute("data-channel-id")).toBe("ch_123");
	});

	test("logs one deprecation warning that names the new URL", () => {
		const { self } = pageWith({ "data-token": "wwp_test" });

		forwardChatEmbed(self);

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(DEPRECATION_WARNING);
		expect(DEPRECATION_WARNING).toContain(CHAT_EMBED_URL);
	});

	test("points at major 1 of @waniwani/chat on jsDelivr", () => {
		expect(CHAT_EMBED_URL).toBe(
			"https://cdn.jsdelivr.net/npm/@waniwani/chat@1/dist/embed.js",
		);
	});

	test("does nothing without a script tag in the page", () => {
		const window = new Window();
		const detached = window.document.createElement(
			"script",
		) as unknown as HTMLScriptElement;

		expect(forwardChatEmbed(null)).toBeNull();
		expect(forwardChatEmbed(detached)).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});
});
