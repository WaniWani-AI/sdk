import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef } from "react";
import { waitFor } from "storybook/test";
import type { EmbedConfig } from "../embed/config";
import { FloatingChat, type FloatingChatHandle } from "../embed/floating-chat";
import { PARTS } from "../parts";

// The stock panel with the layout toggle: no brand CSS, so the stories show the
// default button, icons and motion an integrator gets from the attribute alone.

const MOCK_ORIGIN = "https://dockable.mock";
const MOCK_API = `${MOCK_ORIGIN}/api/mcp/chat`;

function installMockBackend(): void {
	if (typeof window === "undefined") {
		return;
	}
	const w = window as typeof window & { __wwDockableMock?: boolean };
	if (w.__wwDockableMock) {
		return;
	}
	w.__wwDockableMock = true;
	const realFetch = window.fetch;
	const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (!url.startsWith(MOCK_ORIGIN)) {
			return realFetch(input, init);
		}
		const { pathname } = new URL(url);
		if (pathname.endsWith("/config")) {
			return Promise.resolve(
				Response.json({ success: true, data: { visibility: null } }),
			);
		}
		if (pathname.endsWith("/tools")) {
			return Promise.resolve(Response.json({ tools: [] }));
		}
		return Promise.resolve(Response.json({ success: true }));
	}) as unknown as typeof window.fetch;
	mockFetch.preconnect = realFetch.preconnect;
	window.fetch = mockFetch;
}

installMockBackend();

const BASE_CONFIG: EmbedConfig = {
	api: MOCK_API,
	token: "wwp_dockable_demo",
	mode: "floating",
	locale: "en",
	title: "Assistant",
	appearDelay: 0,
	suggestions: ["What can you help with?", "Show me the pricing"],
	welcomeTitle: "Hello,|how can we help?",
};

function HostPage() {
	return (
		<div
			style={{
				minHeight: "160vh",
				padding: "48px 24px 240px",
				background: "#f6f6f4",
				color: "#1f2428",
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<h1 style={{ fontSize: 30, fontWeight: 700 }}>A page with a chat</h1>
			{["Overview", "Features", "Pricing"].map((title) => (
				<section
					key={title}
					style={{ maxWidth: 640, marginTop: 40, minHeight: 280 }}
				>
					<h2 style={{ fontSize: 22, fontWeight: 600 }}>{title}</h2>
					<p style={{ marginTop: 10, lineHeight: 1.7, opacity: 0.8 }}>
						Placeholder copy so the floating bar has a page to sit on, and the
						docked panel has something to sit next to.
					</p>
				</section>
			))}
		</div>
	);
}

const TIMEOUT = { timeout: 8_000 };

async function find<T extends HTMLElement>(
	root: HTMLElement,
	selector: string,
): Promise<T> {
	return waitFor(() => {
		const el = root.querySelector<T>(selector);
		if (!el) {
			throw new Error(`Nothing matches ${selector}`);
		}
		return el;
	}, TIMEOUT);
}

async function expectAbsent(
	root: HTMLElement,
	selector: string,
): Promise<void> {
	await waitFor(() => {
		if (root.querySelector(selector)) {
			throw new Error(`${selector} should not render`);
		}
	}, TIMEOUT);
}

interface DockArgs {
	config: Partial<EmbedConfig>;
}

const handle = createRef<FloatingChatHandle>();

const meta: Meta<DockArgs> = {
	title: "Chat/Panel Layout Toggle",
	render: ({ config }) => (
		<>
			<HostPage />
			<FloatingChat ref={handle} config={{ ...BASE_CONFIG, ...config }} />
		</>
	),
	args: { config: {} },
	parameters: { bare: true },
};

export default meta;

type Story = StoryObj<DockArgs>;

/** Without the attribute the header holds only the close button. */
export const Default: Story = {
	play: async ({ canvasElement }) => {
		await find(canvasElement, `.${PARTS.panel}`);
		handle.current?.open();
		await find(canvasElement, `.${PARTS.panel}[data-state="shown"]`);
		await find(canvasElement, `.${PARTS.close}`);
		await expectAbsent(canvasElement, `.${PARTS.layoutToggle}`);
	},
};

/** The toggle moves the panel from the center to the right edge and back. */
export const Dockable: Story = {
	args: { config: { panelDockable: true } },
	play: async ({ canvasElement }) => {
		await find(canvasElement, `.${PARTS.panel}`);
		handle.current?.open();
		await find(canvasElement, `.${PARTS.panel}[data-state="shown"]`);
		const button = await find<HTMLButtonElement>(
			canvasElement,
			`.${PARTS.layoutToggle}[data-layout="modal"]`,
		);
		button.click();
		await find(canvasElement, `.${PARTS.panel}[data-layout="sidebar"]`);
		await find(canvasElement, `.${PARTS.layoutToggle}[data-layout="sidebar"]`);
	},
};

/** `panelLayout` is the starting placement when the toggle is on. */
export const DockableStartsDocked: Story = {
	args: { config: { panelDockable: true, panelLayout: "sidebar" } },
	play: async ({ canvasElement }) => {
		await find(canvasElement, `.${PARTS.panel}[data-layout="sidebar"]`);
		handle.current?.open();
		await find(canvasElement, `.${PARTS.panel}[data-state="shown"]`);
		await find(canvasElement, `.${PARTS.layoutToggle}[data-layout="sidebar"]`);
	},
};
