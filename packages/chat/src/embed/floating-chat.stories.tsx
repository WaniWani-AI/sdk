import type { Meta, StoryObj } from "@storybook/react-vite";
import { INITIAL_VIEWPORTS } from "storybook/viewport";
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
				The floating bar appears at the bottom after the configured delay, then
				widens on its own a second later to reveal the suggestion CTAs (clicking
				it does the same immediately). Send a message (type or pick a
				suggestion) to expand the full chat panel from the input.
			</p>
		</div>
	);
}

// A host page with a full-height hero up top, then long scrollable content.
// The floating bar is configured to appear only after `#ww-hero` scrolls above
// the viewport — mimicking a site whose hero already has its own floating card.
function HeroPage({ dark }: { dark: boolean }) {
	const border = dark ? "#1f2530" : "#e5e7eb";
	const sections = Array.from({ length: 6 }, (_, i) => i);
	return (
		<div
			style={{
				background: dark ? "#0f1115" : "#f7f7f8",
				color: dark ? "#e5e7eb" : "#1f2937",
				fontFamily: "system-ui, sans-serif",
			}}
		>
			{/* While any part of this hero is on screen the bar stays hidden. */}
			<section
				id="ww-hero"
				style={{
					minHeight: "92vh",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					textAlign: "center",
					padding: "48px 24px",
					borderBottom: `1px solid ${border}`,
				}}
			>
				<span
					style={{
						fontSize: 13,
						textTransform: "uppercase",
						letterSpacing: 1,
						opacity: 0.6,
					}}
				>
					#ww-hero
				</span>
				<h1 style={{ fontSize: 40, fontWeight: 800, marginTop: 12 }}>
					Hero section
				</h1>
				<p
					style={{
						maxWidth: 520,
						marginTop: 12,
						lineHeight: 1.6,
						opacity: 0.8,
					}}
				>
					The floating bar is held back while this hero is in view — imagine a
					floating card living here. Scroll down past it and the bar slides in;
					scroll back up and it hides again (reactive).
				</p>
				<p style={{ marginTop: 24, fontSize: 13, opacity: 0.6 }}>
					↓ scroll down
				</p>
			</section>

			<div
				style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px 200px" }}
			>
				{sections.map((i) => (
					<section key={i} style={{ marginTop: i === 0 ? 0 : 40 }}>
						<h2 style={{ fontSize: 22, fontWeight: 700 }}>Section {i + 1}</h2>
						<p style={{ marginTop: 10, lineHeight: 1.7, opacity: 0.85 }}>
							Body content below the hero. The bar is visible here because
							`#ww-hero` has scrolled above the top of the viewport.
						</p>
					</section>
				))}
			</div>
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
		appearDelay: 2000,
		theme: "light",
	},
	argTypes: {
		theme: {
			control: "inline-radio",
			options: ["light", "dark", "auto"],
		},
		appearDelay: {
			control: { type: "number", min: 0, step: 250 },
		},
	},
	// Expose the device presets in the toolbar so any story can be checked at
	// phone widths (the panel goes full-screen below 640px). `bare` lets this
	// story own the full canvas (it renders its own host page + dock) instead
	// of the shared centered card.
	parameters: {
		viewport: { options: INITIAL_VIEWPORTS },
		bare: true,
	},
};

export default meta;

type Story = StoryObj<FloatingArgs>;

/** Default: centered dock, 2s appear delay, three suggestions. */
export const Default: Story = {
	args: {
		placeholder: "WASSUP",
	},
};

/** No delay — the bar is present from first paint (still fades in). */
export const InstantAppear: Story = {
	args: { appearDelay: 0 },
};

/** Dark theme. */
export const DarkTheme: Story = {
	args: { theme: "dark" },
};

/** No suggestions — no frosted card at all; it stays the plain input bar and
 *  the chat opens on send. */
export const NoSuggestions: Story = {
	args: { suggestions: [] },
};

/**
 * Appear-after-a-section: the bar is hidden while the `#ww-hero` section is in
 * view and slides in only once you scroll past it (reactive — it hides again on
 * the way back up). Configured via the channel's `visibility.appearRules`
 * (`glob: "**"` matches Storybook's iframe path). The `appearDelay` timer is
 * ignored while a scroll rule applies. Scroll the preview to try it.
 */
export const AppearAfterSection: Story = {
	args: { appearDelay: 0 },
	render: (args) => (
		<>
			<HeroPage dark={args.theme === "dark"} />
			<FloatingChat
				config={{
					...buildConfig(args),
					visibility: {
						default: "show",
						appearRules: [{ glob: "**", appearAfter: "#ww-hero" }],
					},
				}}
			/>
		</>
	),
};

/**
 * Phone viewport: the dock is fluid (full width minus margins) and the open
 * panel becomes a full-screen sheet (the `max-width:639px` branch). Switch the
 * toolbar viewport to any device to check other stories at phone widths too.
 */
export const Mobile: Story = {
	globals: { viewport: { value: "mobile2", isRotated: false } },
};
