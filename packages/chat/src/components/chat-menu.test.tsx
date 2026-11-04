import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLDialogElement",
	"MutationObserver",
	"customElements",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"MouseEvent",
	"KeyboardEvent",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(win as any).SyntaxError = SyntaxError;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const { ChatMenu } = await import("./chat-menu");
const { copyText } = await import("../lib/conversation-transcript");
const { en } = await import("../i18n/locales/en");

type ChatMenuProps = Parameters<typeof ChatMenu>[0];

let root: Root;
let container: HTMLElement;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
	delete (navigator as unknown as Record<string, unknown>).clipboard;
});

function stubClipboard(value: unknown) {
	Object.defineProperty(navigator, "clipboard", {
		value,
		configurable: true,
	});
}

function render(overrides: Partial<ChatMenuProps> = {}) {
	const props: ChatMenuProps = {
		actions: ["restart", "copy-conversation"],
		restartConfirm: true,
		onNewChat: mock(() => {}),
		onRestart: mock(() => {}),
		onCopy: () => copyText("You:\nhello"),
		...overrides,
	};
	act(() => {
		root.render(createElement(ChatMenu, props));
	});
	return props;
}

function find(selector: string): HTMLElement {
	const found = container.querySelector<HTMLElement>(selector);
	if (!found) {
		throw new Error(`nothing matches ${selector}`);
	}
	return found;
}

async function click(selector: string) {
	await act(async () => {
		find(selector).click();
	});
}

async function openRestartDialog() {
	await click(".ww-menu-button");
	await click('.ww-menu-item[data-action="restart"]');
}

describe("ChatMenu", () => {
	test("renders one item per action with data-action", async () => {
		render({
			actions: [
				"new-chat",
				"restart",
				"copy-conversation",
				"history",
				"delete",
			],
		});
		const button = find(".ww-menu-button");
		expect(button.getAttribute("aria-label")).toBe(en.menu.label);
		expect(button.getAttribute("data-state")).toBe("closed");

		await click(".ww-menu-button");

		expect(button.getAttribute("data-state")).toBe("open");
		const items = Array.from(
			container.querySelectorAll(".ww-menu .ww-menu-item"),
		);
		expect(items.map((item) => item.getAttribute("data-action"))).toEqual([
			"new-chat",
			"restart",
			"copy-conversation",
			"history",
			"delete",
		]);
	});

	test("restart with confirm opens the dialog", async () => {
		const props = render();

		await openRestartDialog();

		expect(container.querySelector(".ww-dialog[open]")).not.toBeNull();
		expect(find(".ww-dialog-title").textContent).toBe(en.dialog.restartTitle);
		expect(find(".ww-dialog-primary").textContent).toBe(en.dialog.copyAndClear);
		expect(find(".ww-dialog-secondary").textContent).toBe(
			en.dialog.clearWithoutCopy,
		);
		expect(props.onRestart).not.toHaveBeenCalled();
	});

	test("escape closes the dialog and keeps the conversation", async () => {
		const props = render();

		await openRestartDialog();
		await act(async () => {
			find(".ww-dialog").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});

		expect(container.querySelector(".ww-dialog[open]")).toBeNull();
		expect(props.onRestart).not.toHaveBeenCalled();
	});

	function clickDialogAt(clientX: number, clientY: number) {
		const dialog = find(".ww-dialog");
		dialog.getBoundingClientRect = () =>
			({
				left: 100,
				top: 100,
				right: 600,
				bottom: 400,
				width: 500,
				height: 300,
				x: 100,
				y: 100,
			}) as DOMRect;
		dialog.dispatchEvent(
			new MouseEvent("click", { bubbles: true, clientX, clientY }),
		);
	}

	test("a click on the backdrop closes the dialog and keeps the conversation", async () => {
		const props = render();

		await openRestartDialog();
		await act(async () => {
			clickDialogAt(20, 20);
		});

		expect(container.querySelector(".ww-dialog[open]")).toBeNull();
		expect(props.onRestart).not.toHaveBeenCalled();
	});

	test("a click on the dialog's own padding keeps it open", async () => {
		render();

		await openRestartDialog();
		await act(async () => {
			clickDialogAt(110, 110);
		});

		expect(container.querySelector(".ww-dialog[open]")).not.toBeNull();
	});

	test("a click inside the dialog content keeps it open", async () => {
		render();

		await openRestartDialog();
		await act(async () => {
			find(".ww-dialog-title").dispatchEvent(
				new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 }),
			);
		});

		expect(container.querySelector(".ww-dialog[open]")).not.toBeNull();
	});

	test("copy failure keeps the conversation", async () => {
		stubClipboard(undefined);
		const props = render();

		await openRestartDialog();
		await click(".ww-dialog-primary");

		expect(props.onRestart).not.toHaveBeenCalled();
		expect(container.querySelector(".ww-dialog[open]")).not.toBeNull();
		expect(find(".ww-dialog-text").textContent).toContain(en.dialog.copyError);
		expect(find('.ww-dialog [role="alert"]').textContent).toBe(
			en.dialog.copyError,
		);
		expect(container.querySelector(".ww-toast")).toBeNull();
	});

	test("copy success resets and toasts", async () => {
		const written: string[] = [];
		stubClipboard({
			writeText: async (text: string) => {
				written.push(text);
			},
		});
		const props = render();

		await openRestartDialog();
		await click(".ww-dialog-primary");

		expect(written).toEqual(["You:\nhello"]);
		expect(props.onRestart).toHaveBeenCalledTimes(1);
		expect(container.querySelector(".ww-dialog[open]")).toBeNull();
		expect(find(".ww-toast").textContent).toBe(en.toast.conversationCopied);
	});

	test("the copy item reports its state for the status window", async () => {
		render({ onCopy: async () => true });
		await click(".ww-menu-button");
		const item = () => find('.ww-menu-item[data-action="copy-conversation"]');
		expect(item().getAttribute("data-state")).toBe("idle");

		await click('.ww-menu-item[data-action="copy-conversation"]');
		expect(item().getAttribute("data-state")).toBe("copied");
		expect(item().textContent).toBe(en.menu.copied);
		expect(
			find('.ww-menu-item[data-action="restart"]').hasAttribute("data-state"),
		).toBe(false);
	});

	test("a failed copy marks the item failed", async () => {
		render({ onCopy: async () => false });
		await click(".ww-menu-button");
		await click('.ww-menu-item[data-action="copy-conversation"]');
		expect(
			find('.ww-menu-item[data-action="copy-conversation"]').getAttribute(
				"data-state",
			),
		).toBe("failed");
	});

	test("the toast leaves over --ww-toast-leave-duration", async () => {
		container.className = "ww-root";
		container.style.setProperty("--ww-toast-duration", "10ms");
		container.style.setProperty("--ww-toast-leave-duration", "60ms");
		render({ onCopy: async () => true });
		await click(".ww-menu-button");
		await click('.ww-menu-item[data-action="copy-conversation"]');

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 40));
		});
		expect(find(".ww-toast").getAttribute("data-state")).toBe("leaving");

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 110));
		});
		expect(container.querySelector(".ww-toast")).toBeNull();
	});
});
