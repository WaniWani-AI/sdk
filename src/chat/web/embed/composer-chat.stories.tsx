import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { INITIAL_VIEWPORTS } from "storybook/viewport";
import { ComposerChat } from "./composer-chat";
import type { EmbedConfig } from "./config";

// ============================================================================
// ComposerChat stories — visual playground for `mode: "composer"`.
//
// The composer renders in the page flow (a hero box here); sending the first
// message opens the panel over the page. A module-level `fetch` shim stands in
// for the Waniwani backend so both halves work offline:
//   - GET  …/config  → empty remote config (the story drives config via props)
//   - GET  …/tools   → no tools
//   - POST …/chat    → a slow, streamed assistant reply
//   - anything else  → 200 (tracking / page-view beacons)
//
// A dedicated mock host, distinct from other story modules' mocks. Storybook
// evaluates every story module up front and each mock wraps the global
// `fetch`; a shared host would let whichever installs last answer this story's
// requests.
// ============================================================================

const MOCK_API = "https://composer.mock/api/mcp/chat";
const MOCK_TOKEN = "wwp_storybook_demo";

const MOCK_REPLY =
	"This is a mocked streaming reply from the Storybook backend. " +
	"It lets you exercise the handoff from the in-page composer to the " +
	"panel without a live server.";

function sse(chunk: unknown): string {
	return `data: ${JSON.stringify(chunk)}\n\n`;
}

function mockChatResponse(): Response {
	const encoder = new TextEncoder();
	const id = "t1";
	const words = MOCK_REPLY.split(" ");
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(encoder.encode(sse({ type: "start" })));
			controller.enqueue(encoder.encode(sse({ type: "text-start", id })));
			for (const word of words) {
				await new Promise<void>((resolve) => setTimeout(resolve, 45));
				controller.enqueue(
					encoder.encode(sse({ type: "text-delta", id, delta: `${word} ` })),
				);
			}
			controller.enqueue(encoder.encode(sse({ type: "text-end", id })));
			controller.enqueue(encoder.encode(sse({ type: "finish" })));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
	return new Response(stream, {
		headers: { "content-type": "text/event-stream" },
	});
}

function installMockBackend(): void {
	if (typeof window === "undefined") {
		return;
	}
	const w = window as typeof window & { __wwComposerMockInstalled?: boolean };
	if (w.__wwComposerMockInstalled) {
		return;
	}
	w.__wwComposerMockInstalled = true;

	const realFetch = window.fetch;
	const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const method = (init?.method ?? "GET").toUpperCase();

		if (!url.includes("composer.mock")) {
			return realFetch(input, init);
		}
		if (url.includes("/config")) {
			return Promise.resolve(
				Response.json({ success: true, data: { visibility: null } }),
			);
		}
		if (url.endsWith("/tools")) {
			return Promise.resolve(Response.json({ tools: [] }));
		}
		if (method === "POST") {
			return Promise.resolve(mockChatResponse());
		}
		return Promise.resolve(Response.json({ success: true }));
	}) as unknown as typeof window.fetch;
	mockFetch.preconnect = realFetch.preconnect;
	window.fetch = mockFetch;
}

installMockBackend();

// ----------------------------------------------------------------------------
// Story args → EmbedConfig
// ----------------------------------------------------------------------------

interface ComposerArgs {
	title: string;
	placeholder: string;
	welcomeMessage: string;
	suggestions: string[];
	theme: NonNullable<NonNullable<EmbedConfig["appearance"]>["theme"]>;
}

function buildConfig(args: ComposerArgs): EmbedConfig {
	return {
		api: MOCK_API,
		token: MOCK_TOKEN,
		mode: "composer",
		title: args.title,
		placeholder: args.placeholder,
		welcomeMessage: args.welcomeMessage,
		suggestions: args.suggestions,
		appearance: { theme: args.theme },
	};
}

/**
 * Stands in for `embed.ts`'s body-level overlay host. The real mount gives the
 * panel its own shadow root; in Storybook the styles are already global, so a
 * plain fixed, click-through div is enough to reproduce the portal target.
 */
function usePanelContainer(): HTMLElement | null {
	const [el, setEl] = useState<HTMLElement | null>(null);
	useEffect(() => {
		const node = document.createElement("div");
		node.style.cssText =
			"position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
		document.body.appendChild(node);
		setEl(node);
		return () => node.remove();
	}, []);
	return el;
}

// A faux host page with a hero, so the composer sits in real page content the
// way a customer would place it.
function HeroPage({
	dark,
	children,
}: {
	dark: boolean;
	children: React.ReactNode;
}) {
	return (
		<div
			style={{
				minHeight: "100vh",
				padding: "72px 24px",
				background: dark ? "#0f1115" : "#f7f7f8",
				color: dark ? "#e5e7eb" : "#1f2937",
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
				<h1 style={{ fontSize: 40, fontWeight: 800 }}>How can we help?</h1>
				<p style={{ marginTop: 12, lineHeight: 1.6, opacity: 0.8 }}>
					The box below is the whole embed. Type a question and press Enter (or
					pick a suggestion) and the chat panel opens over the page.
				</p>
				<div style={{ marginTop: 32 }}>{children}</div>
			</div>
		</div>
	);
}

function ComposerStory(args: ComposerArgs) {
	const panelContainer = usePanelContainer();
	return (
		<HeroPage dark={args.theme === "dark"}>
			{panelContainer && (
				<ComposerChat
					config={buildConfig(args)}
					panelContainer={panelContainer}
				/>
			)}
		</HeroPage>
	);
}

const meta: Meta<ComposerArgs> = {
	title: "Chat/ComposerChat",
	render: (args) => <ComposerStory {...args} />,
	args: {
		title: "Demo Assistant",
		placeholder: "Ask anything about the product…",
		welcomeMessage: "Hi! Ask me anything about the product.",
		suggestions: ["What can you do?", "How much does it cost?", "Book a demo"],
		theme: "light",
	},
	argTypes: {
		theme: {
			control: "inline-radio",
			options: ["light", "dark", "auto"],
		},
	},
	// `bare` lets the story own the full canvas (it renders its own host page)
	// instead of the shared centered card.
	parameters: {
		viewport: { options: INITIAL_VIEWPORTS },
		bare: true,
	},
};

export default meta;

type Story = StoryObj<ComposerArgs>;

/** Default: in-flow composer with three suggestion pills under it. */
export const Default: Story = {};

/** Dark theme. */
export const DarkTheme: Story = {
	args: { theme: "dark" },
};

/** No suggestions — just the box. The chat still opens on send. */
export const NoSuggestions: Story = {
	args: { suggestions: [] },
};

/**
 * Phone viewport: the composer is as wide as its container and the opened
 * panel becomes a full-screen sheet (the `max-width:639px` branch).
 */
export const Mobile: Story = {
	globals: { viewport: { value: "mobile2", isRotated: false } },
};
