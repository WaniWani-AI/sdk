import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatAppearance } from "../@types";
import { ChatEmbed } from "./chat-embed";

// ============================================================================
// ChatEmbed stories — the bring-your-own-backend chat primitive.
//
// A module-level `fetch` shim stands in for a chat backend so the composer,
// streaming, tool calls and (crucially) MCP App widgets all work offline:
//   - POST …/chat  → a streamed reply; some stories also stream a tool call
//                     whose output carries widget metadata (`_meta.ui`).
//   - anything else → 200 (config/tools are skipped via `skipRemoteConfig`).
//
// The widget itself is a small static file (`.storybook/public/
// ww-mock-widget.html`, served at the Storybook root — see `WIDGET_ENDPOINT`),
// so no widget host is needed either. The widget speaks the MCP UI postMessage
// protocol: it handshakes, reports its size, and can request `fullscreen` — the
// path that exercises the embed's fullscreen takeover.
// ============================================================================

// A dedicated mock host, distinct from other stories' mocks (e.g. FloatingChat
// uses `mock.local`). Storybook evaluates every story module up front, and each
// mock wraps the global `fetch`; a shared host would let whichever installs
// last answer this story's requests. This host is matched (and only this host)
// by the shim below; everything else falls through to the previous `fetch`.
const MOCK_HOST = "chatembed.mock";
const MOCK_API = `https://${MOCK_HOST}/api/chat`;

const MOCK_REPLY =
	"Sure — here's a live widget rendered inside the chat. " +
	"It runs in a sandboxed iframe and talks to the embed over postMessage.";

function sse(chunk: unknown): string {
	return `data: ${JSON.stringify(chunk)}\n\n`;
}

interface ReplyOptions {
	/** Stream a tool call that renders an MCP App widget after the text. */
	withWidget?: boolean;
	/** Mark the widget as auto-height (iframe grows to its content). */
	autoHeight?: boolean;
	/** Stream a reasoning part first (2+ activity parts → chain-of-thought). */
	withReasoning?: boolean;
}

const WIDGET_TOOL = "showActivity";
const WIDGET_URI = "ui://widget/activity";

// A fresh id per streamed turn, so multiple tool calls in one conversation
// don't collide (a shared id would make the fullscreen match hit every turn's
// widget at once).
let turnCounter = 0;

function mockChatResponse(opts: ReplyOptions): Response {
	const encoder = new TextEncoder();
	turnCounter += 1;
	const textId = `t${turnCounter}`;
	const words = MOCK_REPLY.split(" ");
	const toolCallId = `call_${turnCounter}`;
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (chunk: unknown) =>
				controller.enqueue(encoder.encode(sse(chunk)));

			send({ type: "start" });

			if (opts.withReasoning) {
				const reasoningId = `r${turnCounter}`;
				send({ type: "reasoning-start", id: reasoningId });
				for (const word of "Looking up the activity score for Lisbon".split(
					" ",
				)) {
					await new Promise<void>((resolve) => setTimeout(resolve, 25));
					send({ type: "reasoning-delta", id: reasoningId, delta: `${word} ` });
				}
				send({ type: "reasoning-end", id: reasoningId });
			}

			send({ type: "text-start", id: textId });
			for (const word of words) {
				await new Promise<void>((resolve) => setTimeout(resolve, 30));
				send({ type: "text-delta", id: textId, delta: `${word} ` });
			}
			send({ type: "text-end", id: textId });

			if (opts.withWidget) {
				send({
					type: "tool-input-start",
					toolCallId,
					toolName: WIDGET_TOOL,
					dynamic: true,
				});
				send({
					type: "tool-input-available",
					toolCallId,
					toolName: WIDGET_TOOL,
					dynamic: true,
					input: { city: "Lisbon" },
				});
				send({
					type: "tool-output-available",
					toolCallId,
					dynamic: true,
					output: {
						content: [{ type: "text", text: "Activity widget for Lisbon." }],
						structuredContent: { city: "Lisbon", score: 82 },
						_meta: {
							ui: {
								resourceUri: WIDGET_URI,
								...(opts.autoHeight ? { autoHeight: true } : {}),
							},
						},
					},
				});
			}

			send({ type: "finish" });
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
	const w = window as typeof window & { __wwEmbedMock?: boolean };
	if (w.__wwEmbedMock) {
		return;
	}
	w.__wwEmbedMock = true;

	const realFetch = window.fetch;
	const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (!url.includes(MOCK_HOST)) {
			return realFetch(input, init);
		}
		const method = (init?.method ?? "GET").toUpperCase();
		if (method === "POST") {
			// Every mocked chat turn streams a widget so any story that opens
			// the chat can reach the fullscreen path. Reasoning is streamed too
			// so the tool sits inside a chain-of-thought (the realistic shape).
			return Promise.resolve(
				mockChatResponse({ withWidget: true, withReasoning: true }),
			);
		}
		return Promise.resolve(Response.json({ success: true }));
	}) as unknown as typeof window.fetch;
	// React DOM patches the global `fetch` with a `preconnect` method that isn't
	// in the DOM lib types; carry it over so RDOM's preconnect calls still resolve
	// against our shim.
	const preconnect = (realFetch as { preconnect?: unknown }).preconnect;
	if (preconnect) {
		(mockFetch as { preconnect?: unknown }).preconnect = preconnect;
	}
	window.fetch = mockFetch;
}

installMockBackend();

// ----------------------------------------------------------------------------
// The widget served into the iframe.
//
// `ww-mock-widget.html` (in `.storybook/public`, served at the Storybook root
// via `staticDirs`) is a self-contained MCP UI widget. On load it handshakes
// (`ui/initialize` → `initialized`), reports a size so the inline iframe has a
// height, and renders an "Expand" button that requests `fullscreen`; the host
// echoes the granted mode via `host-context-changed` and the widget swaps to a
// "Minimize" layout. `?auto=1` makes it request fullscreen on its own right
// after the handshake.
//
// It's served same-origin (not a `data:` URL) so the sandboxed iframe
// (`allow-scripts allow-same-origin`) runs its scripts in every browser — a
// `data:` URL is blocked from executing scripts in some engines, which would
// leave the widget as an invisible zero-height frame.
// ----------------------------------------------------------------------------

const WIDGET_ENDPOINT = "/ww-mock-widget.html";
const AUTO_WIDGET_ENDPOINT = "/ww-mock-widget.html?auto=1";

// ----------------------------------------------------------------------------
// Story args
// ----------------------------------------------------------------------------

interface EmbedArgs {
	title: string;
	welcomeMessage: string;
	placeholder: string;
	theme: NonNullable<ChatAppearance["theme"]>;
	hideHeader: boolean;
	/** Which widget the iframe loads. Swapped by the auto-fullscreen story. */
	resourceEndpoint: string;
}

// The embed itself, shared across every story's render so only the wrapping
// container (full-bleed vs. fixed card) differs.
function Embed(args: EmbedArgs) {
	return (
		<ChatEmbed
			api={MOCK_API}
			skipRemoteConfig
			mcp={{ resourceEndpoint: args.resourceEndpoint }}
			appearance={{ theme: args.theme }}
			title={args.title}
			hideHeader={args.hideHeader}
			welcomeMessage={args.welcomeMessage}
			placeholder={args.placeholder}
		/>
	);
}

const meta: Meta<EmbedArgs> = {
	title: "Chat/ChatEmbed",
	// Full-bleed by default: the embed fills the viewport the way the hosted
	// channel page places it (`<div class="h-dvh">`), which is the realistic
	// deployment. The chat scrolls internally. `FixedSize` is the one story
	// that puts it in a bounded card instead.
	render: (args) => (
		<div style={{ height: "100dvh", width: "100%" }}>
			<Embed {...args} />
		</div>
	),
	args: {
		title: "Support Assistant",
		welcomeMessage: "Hi! Ask me anything, or say “show me the widget”.",
		placeholder: "Ask me anything…",
		theme: "light",
		hideHeader: false,
		resourceEndpoint: WIDGET_ENDPOINT,
	},
	argTypes: {
		theme: { control: "inline-radio", options: ["light", "dark", "auto"] },
		resourceEndpoint: { table: { disable: true } },
	},
	parameters: { bare: true },
};

export default meta;

type Story = StoryObj<EmbedArgs>;

/**
 * Default: a full-bleed embed (fills the viewport). Send any message to stream
 * a reply plus an inline MCP App widget. Click **Expand to fullscreen** on the
 * widget to take over the embed; **Minimize** returns it inline.
 */
export const Default: Story = {};

/** Dark theme. */
export const DarkTheme: Story = {
	args: { theme: "dark" },
};

/** Header hidden — just the message list and composer. */
export const NoHeader: Story = {
	args: { hideHeader: true },
};

/**
 * Fullscreen widget takeover. Send a message, then click **Expand to
 * fullscreen** on the widget: it requests `ui/request-display-mode:fullscreen`,
 * the embed hides every other message plus the composer, and the widget fills
 * the whole chat surface. **Minimize** requests `inline` and restores the
 * conversation. This is the path that stresses the embed's fullscreen
 * takeover.
 */
export const FullscreenWidget: Story = {};

/**
 * Auto-fullscreen widget. The widget requests `fullscreen` on its own the
 * instant it finishes handshaking — no user click — so the embed flips to the
 * takeover as soon as the tool result lands. Mimics a widget authored to always
 * own the surface (a map, a full-page form). **Minimize** returns it inline.
 */
export const AutoFullscreenWidget: Story = {
	args: { resourceEndpoint: AUTO_WIDGET_ENDPOINT },
};

/**
 * Unbounded parent: `ChatEmbed` sits in a plain block with no `height` /
 * `max-height`, so it grows with its content instead of scrolling internally
 * (the documented standalone default). Send a message and expand the widget to
 * fullscreen — the takeover must still fill a usable area rather than collapse
 * to nothing.
 */
export const UnboundedParent: Story = {
	render: (args) => (
		<div style={{ maxWidth: 560, margin: "0 auto" }}>
			<Embed {...args} />
		</div>
	),
};

/**
 * The one fixed-size placement: the embed in a bounded card (fixed height and
 * width), e.g. dropped into a sidebar or a marketing section. The chat scrolls
 * within the card and a fullscreen widget fills just the card, not the page.
 */
export const FixedSize: Story = {
	render: (args) => (
		<div
			style={{
				height: 640,
				width: 400,
				margin: "24px auto",
				border: "1px solid var(--ww-color-border)",
				borderRadius: 12,
				overflow: "hidden",
			}}
		>
			<Embed {...args} />
		</div>
	),
};
