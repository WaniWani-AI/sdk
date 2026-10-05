import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { code, type HighlightResult } from "@streamdown/code";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"MutationObserver",
	"customElements",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
]) {
	Reflect.set(globalThis, key, Reflect.get(win, key));
}
Reflect.set(globalThis, "window", win);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(win, "SyntaxError", SyntaxError);

const { act, createElement, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MessageResponse } = await import("./message");
let root: ReturnType<typeof createRoot>;
let container: HTMLElement;
const restorers: (() => void)[] = [];
function trackSpy<T extends { mockRestore(): void }>(spy: T): T {
	restorers.push(() => spy.mockRestore());
	return spy;
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	for (const restore of restorers.splice(0).reverse()) {
		restore();
	}
});

async function renderFence(input: { language: string; content: string }) {
	await act(async () => {
		root.render(
			createElement(MessageResponse, {
				isStreaming: false,
				children: `\`\`\`${input.language}\n${input.content}\n\`\`\``,
			}),
		);
	});
	for (
		let attempt = 0;
		attempt < 50 && !container.querySelector("pre code");
		attempt++
	) {
		await act(async () => {
			await Bun.sleep(10);
		});
	}
}

function displayedCode() {
	const element = container.querySelector("pre code");
	if (!element) {
		throw new Error("No rendered code block");
	}
	return element.textContent;
}

for (const language of ["env", "unregistered-language"]) {
	test(`completed ${language} fences retain their exact raw content`, async () => {
		const highlight = trackSpy(spyOn(code, "highlight"));
		const errorLog = trackSpy(spyOn(console, "error"));
		await renderFence({
			language,
			content: "API_KEY=example\nVALUE=<tag>&é😀",
		});
		await act(async () => {
			await Bun.sleep(10);
		});
		expect(displayedCode()).toBe("API_KEY=exampleVALUE=<tag>&é😀");
		expect(
			Array.from(
				container.querySelectorAll("pre code > span"),
				(line) => line.textContent,
			).slice(0, 2),
		).toEqual(["API_KEY=example", "VALUE=<tag>&é😀"]);
		expect(highlight).not.toHaveBeenCalled();
		expect(errorLog).not.toHaveBeenCalled();
	});
}

test("changing a highlighted block to unsupported language resets the visible tokens", async () => {
	trackSpy(spyOn(code, "highlight")).mockReturnValue({
		tokens: [
			[{ content: "highlighted original", offset: 0, color: "#ff0000" }],
		],
		fg: "#000000",
		bg: "#ffffff",
	});
	await renderFence({ language: "javascript", content: "const oldValue = 1;" });
	expect(displayedCode()).toBe("highlighted original");
	await renderFence({ language: "env", content: "NEW_VALUE=2" });
	expect(displayedCode()).toBe("NEW_VALUE=2");
	await renderFence({ language: "other-unknown", content: "NEXT_VALUE=3" });
	expect(displayedCode()).toBe("NEXT_VALUE=3");
});

test("a late supported-language callback cannot overwrite an unsupported block", async () => {
	let deliver: ((result: HighlightResult) => void) | undefined;
	trackSpy(spyOn(code, "highlight")).mockImplementation(
		(_options, callback) => {
			deliver = callback;
			return null;
		},
	);
	await renderFence({ language: "javascript", content: "const original = 1;" });
	await renderFence({ language: "env", content: "NEW_VALUE=2" });
	expect(displayedCode()).toBe("NEW_VALUE=2");
	if (!deliver) {
		throw new Error("No supported-language callback registered");
	}
	await act(async () => {
		deliver?.({
			tokens: [[{ content: "STALE_ORIGINAL", offset: 0 }]],
			fg: "#000000",
			bg: "#ffffff",
		});
	});
	expect(displayedCode()).toBe("NEW_VALUE=2");
});

test("invalidating one message preserves pending highlighting in another message", async () => {
	const callbacks = new Map<string, (result: HighlightResult) => void>();
	trackSpy(spyOn(code, "highlight")).mockImplementation((options, callback) => {
		if (callback) {
			callbacks.set(options.code.trim(), callback);
		}
		return null;
	});
	const renderPair = async (first: string) => {
		await act(async () => {
			root.render(
				createElement(
					"div",
					null,
					createElement(MessageResponse, {
						key: "first",
						isStreaming: false,
						children: first,
					}),
					createElement(MessageResponse, {
						key: "second",
						isStreaming: false,
						children: "```javascript\nSECOND\n```",
					}),
				),
			);
		});
	};
	await renderPair("```javascript\nFIRST\n```");
	await renderPair("```env\nNEW_VALUE=2\n```");
	const first = callbacks.get("FIRST");
	const second = callbacks.get("SECOND");
	if (!first || !second) {
		throw new Error("Both messages must register highlight callbacks");
	}
	await act(async () => {
		first({
			tokens: [[{ content: "STALE_FIRST", offset: 0 }]],
			fg: "#000000",
			bg: "#ffffff",
		});
		second({
			tokens: [[{ content: "HIGHLIGHTED_SECOND", offset: 0 }]],
			fg: "#000000",
			bg: "#ffffff",
		});
	});
	expect(
		Array.from(
			container.querySelectorAll("pre code"),
			(element) => element.textContent,
		),
	).toEqual(["NEW_VALUE=2", "HIGHLIGHTED_SECOND"]);
});

test("changing one block preserves pending highlighting for an unchanged sibling block", async () => {
	const callbacks = new Map<string, (result: HighlightResult) => void>();
	trackSpy(spyOn(code, "highlight")).mockImplementation((options, callback) => {
		if (callback) {
			callbacks.set(options.code.trim(), callback);
		}
		return null;
	});
	const renderBlocks = async (first: string) => {
		await act(async () => {
			root.render(
				createElement(MessageResponse, {
					isStreaming: false,
					children: `${first}\n\n\`\`\`javascript\nSECOND\n\`\`\``,
				}),
			);
		});
	};
	await renderBlocks("```javascript\nFIRST\n```");
	const first = callbacks.get("FIRST");
	await renderBlocks("```env\nNEW_VALUE=2\n```");
	const second = callbacks.get("SECOND");
	if (!first || !second) {
		throw new Error("Both code blocks must register highlight callbacks");
	}
	await act(async () => {
		first({
			tokens: [[{ content: "STALE_FIRST", offset: 0 }]],
			fg: "#000000",
			bg: "#ffffff",
		});
		second({
			tokens: [[{ content: "HIGHLIGHTED_SECOND", offset: 0 }]],
			fg: "#000000",
			bg: "#ffffff",
		});
	});
	expect(
		Array.from(
			container.querySelectorAll("pre code"),
			(element) => element.textContent,
		),
	).toEqual(["NEW_VALUE=2", "HIGHLIGHTED_SECOND"]);
});

test("StrictMode effect replay still accepts the active highlighting callback", async () => {
	const callbacks: ((result: HighlightResult) => void)[] = [];
	trackSpy(spyOn(code, "highlight")).mockImplementation(
		(_options, callback) => {
			if (callback) {
				callbacks.push(callback);
			}
			return null;
		},
	);
	await act(async () => {
		root.render(
			createElement(
				StrictMode,
				null,
				createElement(MessageResponse, {
					isStreaming: false,
					children: "```javascript\nSTRICT_MODE\n```",
				}),
			),
		);
	});
	expect(callbacks.length).toBeGreaterThanOrEqual(2);
	const active = callbacks.at(-1);
	if (!active) {
		throw new Error("No active highlight callback");
	}
	await act(async () => {
		active({
			tokens: [[{ content: "HIGHLIGHTED_ACTIVE", offset: 0 }]],
			fg: "#000000",
			bg: "#ffffff",
		});
	});
	expect(displayedCode()).toBe("HIGHLIGHTED_ACTIVE");
});

test("streaming updates retain their renderer and defer highlighting until completion", async () => {
	const highlight = trackSpy(spyOn(code, "highlight")).mockReturnValue({
		tokens: [[{ content: "HIGHLIGHTED_FINAL", offset: 0 }]],
		fg: "#000000",
		bg: "#ffffff",
	});
	const content = "```javascript\nlet x=1;\n```";
	await act(async () => {
		root.render(
			createElement(MessageResponse, { isStreaming: true, children: content }),
		);
	});
	for (
		let attempt = 0;
		attempt < 50 && !container.querySelector("pre code");
		attempt++
	) {
		await act(async () => {
			await Bun.sleep(10);
		});
	}
	const streamingRenderer = container.firstElementChild;
	if (!streamingRenderer || !container.querySelector("pre code")) {
		throw new Error("Streaming code renderer is missing");
	}
	await act(async () => {
		root.render(
			createElement(MessageResponse, {
				isStreaming: true,
				children: `${content}\nMore text`,
			}),
		);
	});
	expect(container.firstElementChild).toBe(streamingRenderer);
	expect(highlight).not.toHaveBeenCalled();
	await act(async () => {
		root.render(
			createElement(MessageResponse, {
				isStreaming: false,
				children: `${content}\nMore text`,
			}),
		);
	});
	expect(container.firstElementChild).not.toBe(streamingRenderer);
	expect(displayedCode()).toBe("HIGHLIGHTED_FINAL");
});
