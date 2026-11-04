import { describe, expect, test } from "bun:test";
import { buildAvatar, buildWelcome } from "../embed-welcome";

// biome-ignore lint/suspicious/noExplicitAny: test setup
const g = globalThis as any;

async function parseWithAttrs(
	attrs: Record<string, string>,
): Promise<Record<string, unknown>> {
	const { parseConfigFromScript } = await import(
		`../config?t=${Date.now()}-${Math.random()}`
	);
	const fakeScript = {
		getAttribute(name: string) {
			return name in attrs ? attrs[name] : null;
		},
	};
	const prevDocument = g.document;
	const prevHtmlScriptElement = g.HTMLScriptElement;
	g.HTMLScriptElement = class {};
	Object.setPrototypeOf(fakeScript, g.HTMLScriptElement.prototype);
	g.document = { currentScript: fakeScript, querySelectorAll: () => [] };
	try {
		return parseConfigFromScript();
	} finally {
		g.document = prevDocument;
		g.HTMLScriptElement = prevHtmlScriptElement;
	}
}

describe("parseConfigFromScript: avatar and welcome", () => {
	test("parses data-avatar and slots", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-avatar": " ./assets/face.svg ",
			"data-avatar-slots": "welcome, composer,dock,bogus",
		});
		expect(cfg.avatar).toBe("./assets/face.svg");
		expect(cfg.avatarSlots).toEqual(["welcome", "composer", "dock"]);
		expect(buildAvatar({ token: "tok", ...cfg })).toEqual({
			src: "./assets/face.svg",
			slots: ["welcome", "composer", "dock"],
		});
	});

	test("parses data-avatar-intro and its duration", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-avatar": "./face.svg",
			"data-avatar-intro": " ./face.webp ",
			"data-avatar-intro-duration": "7000",
		});
		expect(cfg.avatarIntro).toBe("./face.webp");
		expect(cfg.avatarIntroDuration).toBe(7000);
		expect(buildAvatar({ token: "tok", ...cfg })?.intro).toEqual({
			src: "./face.webp",
			durationMs: 7000,
		});
	});

	test("intro duration defaults to 7000 ms and ignores bad values", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-avatar": "./face.svg",
			"data-avatar-intro": "./face.webp",
			"data-avatar-intro-duration": "0",
		});
		expect(cfg.avatarIntroDuration).toBeUndefined();
		expect(buildAvatar({ token: "tok", ...cfg })?.intro?.durationMs).toBe(7000);
	});

	test("no intro attribute leaves the avatar without one", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-avatar": "./face.svg",
			"data-avatar-intro-duration": "7000",
		});
		expect("avatarIntro" in cfg).toBe(false);
		expect(buildAvatar({ token: "tok", ...cfg })).toEqual({
			src: "./face.svg",
			slots: ["welcome", "header"],
		});
	});

	test("default slots are welcome and header", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-avatar": "https://x/a.svg",
		});
		expect(cfg.avatarSlots).toBeUndefined();
		expect(buildAvatar({ token: "tok", ...cfg })?.slots).toEqual([
			"welcome",
			"header",
		]);
	});

	test("parses data-welcome-subtitle into a list", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-welcome-title": "Bonjour,|parlez-nous de votre projet",
			"data-welcome-subtitle": "Premier.| Second. |",
			"data-welcome-subtitle-rotate": "3600",
		});
		expect(cfg.welcomeTitle).toBe("Bonjour,|parlez-nous de votre projet");
		expect(cfg.welcomeSubtitle).toEqual(["Premier.", "Second."]);
		expect(cfg.welcomeSubtitleRotate).toBe(3600);
		expect(buildWelcome({ token: "tok", ...cfg })).toEqual({
			title: "Bonjour,|parlez-nous de votre projet",
			description: "Premier.",
			subtitles: ["Premier.", "Second."],
			subtitleRotateMs: 3600,
		});
	});

	test("no avatar or welcome attribute leaves everything unset", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-welcome-subtitle-rotate": "soon",
		});
		for (const key of [
			"avatar",
			"avatarSlots",
			"welcomeTitle",
			"welcomeSubtitle",
			"welcomeSubtitleRotate",
		]) {
			expect(key in cfg).toBe(false);
		}
		expect(buildAvatar({ token: "tok", ...cfg })).toBeUndefined();
		expect(buildWelcome({ token: "tok", ...cfg })).toBeUndefined();
	});
});
