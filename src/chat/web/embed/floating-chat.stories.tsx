import type { Meta, StoryObj } from "@storybook/react-vite";
import type { EmbedConfig } from "./config";
import { FloatingChat } from "./floating-chat";

// ============================================================================
// FloatingChat stories — visual playground for the floating bar.
//
// A module-level `fetch` shim stands in for the Waniwani backend so the dock,
// the click-to-expand behavior, and the open animation all work offline:
//   - GET  …/config  → empty remote config (the story drives config via props)
//   - GET  …/tools    → no tools
//   - POST …/chat     → a slow, streamed assistant reply
//   - anything else    → 200 (tracking / page-view beacons)
// ============================================================================

const MOCK_API = "https://mock.local/api/mcp/chat";
const MOCK_TOKEN = "wwp_storybook_demo";

const MOCK_REPLY =
	"This is a mocked streaming reply from the Storybook backend. " +
	"It lets you exercise the open animation and the in-panel composer " +
	"without a live server.";

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
	const w = window as typeof window & { __wwMockInstalled?: boolean };
	if (w.__wwMockInstalled) {
		return;
	}
	w.__wwMockInstalled = true;

	const realFetch = window.fetch;
	const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const method = (init?.method ?? "GET").toUpperCase();

		if (!url.includes("mock.local")) {
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

interface FloatingArgs {
	title: string;
	placeholder: string;
	welcomeMessage: string;
	suggestions: string[];
	position: NonNullable<EmbedConfig["position"]>;
	appearDelay: number;
	theme: NonNullable<NonNullable<EmbedConfig["appearance"]>["theme"]>;
}

function buildConfig(args: FloatingArgs): EmbedConfig {
	return {
		api: MOCK_API,
		token: MOCK_TOKEN,
		mode: "floating",
		title: args.title,
		placeholder: args.placeholder,
		welcomeMessage: args.welcomeMessage,
		suggestions: args.suggestions,
		position: args.position,
		appearDelay: args.appearDelay,
		appearance: { theme: args.theme },
	};
}

// A faux host page so the floating bar has content to sit on top of.
function FakePage({ dark }: { dark: boolean }) {
	return (
		<div
			style={{
				minHeight: "100vh",
				padding: "48px",
				background: dark ? "#0f1115" : "#f7f7f8",
				color: dark ? "#e5e7eb" : "#1f2937",
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<h1 style={{ fontSize: 28, fontWeight: 700 }}>Example host page</h1>
			<p
				style={{ maxWidth: 560, marginTop: 12, lineHeight: 1.6, opacity: 0.8 }}
			>
				The floating bar appears at the bottom after the configured delay. Click
				it to widen the bar and reveal the suggestion CTAs; send a message (type
				or pick a suggestion) to expand the full chat panel from the input.
			</p>
		</div>
	);
}

const meta: Meta<FloatingArgs> = {
	title: "Chat/FloatingChat",
	// Each story re-creates the component from args; this render is shared.
	render: (args) => (
		<>
			<FakePage dark={args.theme === "dark"} />
			<FloatingChat config={buildConfig(args)} />
		</>
	),
	args: {
		title: "Demo Assistant",
		placeholder: "What would you like to know?",
		welcomeMessage: "Hi! Ask me anything about the product.",
		suggestions: ["What can you do?", "How much does it cost?", "Book a demo"],
		position: "bottom-center",
		appearDelay: 3000,
		theme: "light",
	},
	argTypes: {
		position: {
			control: "inline-radio",
			options: ["bottom-center", "bottom-right", "bottom-left"],
		},
		theme: {
			control: "inline-radio",
			options: ["light", "dark", "auto"],
		},
		appearDelay: {
			control: { type: "number", min: 0, step: 250 },
		},
	},
};

export default meta;

type Story = StoryObj<FloatingArgs>;

/** Default: centered dock, 3s appear delay, three suggestions. */
export const Default: Story = {};

/** No delay — the bar is present from first paint (still fades in). */
export const InstantAppear: Story = {
	args: { appearDelay: 0 },
};

/** Anchored bottom-right; the panel grows out of the right-hand input. */
export const BottomRight: Story = {
	args: { position: "bottom-right" },
};

/** Dark theme. */
export const DarkTheme: Story = {
	args: { theme: "dark" },
};

/** No suggestions — clicking the bar just widens it; the chat opens on send. */
export const NoSuggestions: Story = {
	args: { suggestions: [] },
};
