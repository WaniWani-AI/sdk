import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com/pricing" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"MutationObserver",
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
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { usePanelLayout } = await import("../use-panel-layout");
type PanelLayoutControl = import("../use-panel-layout").PanelLayoutControl;
type EmbedConfig = import("../config").EmbedConfig;
type HookConfig = Pick<EmbedConfig, "panelLayout" | "panelDockable">;

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
let latest: PanelLayoutControl | null = null;
let changes: string[] = [];

function Harness({ config }: { config: HookConfig }) {
	latest = usePanelLayout(config, (layout) => {
		changes.push(layout);
	});
	return createElement("div", { "data-layout": latest.layout });
}

async function mount(config: HookConfig) {
	changes = [];
	await act(async () => {
		root.render(createElement(Harness, { config }));
	});
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	latest = null;
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

describe("usePanelLayout", () => {
	test("not dockable: layout is fixed and toggle is inert", async () => {
		await mount({ panelLayout: "sidebar" });
		expect(latest?.dockable).toBe(false);
		expect(latest?.layout).toBe("sidebar");
		await act(async () => {
			latest?.toggle();
		});
		expect(latest?.layout).toBe("sidebar");
		expect(container.querySelector("div")?.getAttribute("data-layout")).toBe(
			"sidebar",
		);
	});

	test("not dockable without a layout: modal", async () => {
		await mount({});
		expect(latest?.dockable).toBe(false);
		expect(latest?.layout).toBe("modal");
	});

	test("dockable: toggle flips modal and sidebar", async () => {
		await mount({ panelDockable: true });
		expect(latest?.dockable).toBe(true);
		expect(latest?.layout).toBe("modal");
		await act(async () => {
			latest?.toggle();
		});
		expect(latest?.layout).toBe("sidebar");
		expect(container.querySelector("div")?.getAttribute("data-layout")).toBe(
			"sidebar",
		);
		await act(async () => {
			latest?.toggle();
		});
		expect(latest?.layout).toBe("modal");
	});

	test("inert: never reports a change", async () => {
		await mount({ panelLayout: "sidebar" });
		await act(async () => {
			latest?.toggle();
		});
		expect(changes).toEqual([]);
	});

	test("reports each committed change and never the mount", async () => {
		await mount({ panelDockable: true });
		expect(changes).toEqual([]);
		await act(async () => {
			latest?.toggle();
		});
		expect(changes).toEqual(["sidebar"]);
		await act(async () => {
			latest?.toggle();
		});
		expect(changes).toEqual(["sidebar", "modal"]);
	});

	test("two toggles in one tick report what React committed", async () => {
		await mount({ panelDockable: true });
		await act(async () => {
			latest?.toggle();
			latest?.toggle();
		});
		expect(latest?.layout).toBe("modal");
		expect(changes.at(-1) ?? "modal").toBe("modal");
	});

	test("dockable: panelLayout is the starting placement", async () => {
		await mount({ panelDockable: true, panelLayout: "sidebar" });
		expect(latest?.layout).toBe("sidebar");
		await act(async () => {
			latest?.toggle();
		});
		expect(latest?.layout).toBe("modal");
	});
});
