import type { Meta, StoryObj } from "@storybook/react-vite";
import { waitFor } from "storybook/test";
import type { EmbedConfig } from "../embed/config";
import { FloatingChat } from "../embed/floating-chat";
import { PARTS } from "../parts";

// A fictional brand built from the script embed's surface alone: every knob in
// `brandConfig`, a `data-css` equivalent in `BRAND_CSS`, a fetch shim for the
// backend. Each `play` throws on the first part missing from its state.

const MOCK_ORIGIN = "https://fernhill.mock";
const MOCK_API = `${MOCK_ORIGIN}/api/mcp/chat`;
const MESSAGES_URL = `${MOCK_ORIGIN}/messages.json`;

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#2f5d50"/><path d="M32 14c9 8 13 17 13 25a13 13 0 0 1-26 0c0-8 4-17 13-25z" fill="#e9c46a"/><path d="M32 24v26" stroke="#2f5d50" stroke-width="3" stroke-linecap="round"/></svg>`;
const AVATAR_URL = `data:image/svg+xml,${encodeURIComponent(AVATAR_SVG)}`;

const TURN_ONE_TEXT = [
	"# Ready for the trail",
	"",
	"Here is what fits a two-day hike in early spring. Pack light, but keep one warm layer you never take off the list.",
	"",
	"## What to pack",
	"",
	"| Item | Weight | Why |",
	"| --- | --- | --- |",
	"| Shell jacket | 380 g | Rain and wind |",
	"| Merino layer | 220 g | Warm when damp |",
	"| Trekking poles | 480 g | Knees on descents |",
	"",
	"### Before you go",
	"",
	"Check the [trail conditions](https://example.com/trails) on the morning you leave. Spring weather turns fast above the tree line, so plan a shorter second day and a way down that avoids exposed ridges.",
	"",
	"Fill both bottles at the trailhead, and keep a paper map in the lid pocket: phones run cold and flat before the batteries say so.",
].join("\n");

const TURN_TWO_TEXT =
	"The **Ridge 38** pack is in stock in both sizes at the Fernhill store, and it ships tomorrow.";

const FOLLOWUPS = [
	"Is the Ridge 38 pack in stock?",
	"Show me rain shells",
	"Plan a three-day loop",
];

function sse(chunk: unknown): string {
	return `data: ${JSON.stringify(chunk)}\n\n`;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function words(id: string, text: string): unknown[] {
	return text
		.split(/(?<= )/)
		.map((delta) => ({ type: "text-delta", id, delta }));
}

function turnOneChunks(): unknown[] {
	return [
		{ type: "start" },
		{ type: "reasoning-start", id: "r1" },
		{
			type: "reasoning-delta",
			id: "r1",
			delta: "Two days in early spring: layers, rain cover, light poles.",
		},
		{ type: "reasoning-end", id: "r1" },
		{
			type: "tool-input-available",
			toolCallId: "c1",
			toolName: "search_catalog",
			input: { season: "spring", days: 2 },
		},
		{
			type: "tool-output-available",
			toolCallId: "c1",
			output: { content: [{ type: "text", text: "12 matching items" }] },
		},
		{
			type: "tool-input-available",
			toolCallId: "c2",
			toolName: "trail_conditions",
			input: { region: "north ridge" },
		},
		{
			type: "tool-output-available",
			toolCallId: "c2",
			output: { content: [{ type: "text", text: "Open, wet underfoot" }] },
		},
		{ type: "text-start", id: "t1" },
		...words("t1", TURN_ONE_TEXT),
		{ type: "text-end", id: "t1" },
		{ type: "data-suggestions", data: { suggestions: FOLLOWUPS } },
		{ type: "finish" },
	];
}

function turnTwoChunks(): unknown[] {
	return [
		{ type: "start" },
		{
			type: "tool-input-available",
			toolCallId: "c3",
			toolName: "check_stock",
			input: { sku: "ridge-38" },
		},
		{
			type: "tool-output-available",
			toolCallId: "c3",
			output: { content: [{ type: "text", text: "In stock: S, M/L" }] },
		},
		{ type: "text-start", id: "t2" },
		...words("t2", TURN_TWO_TEXT),
		{ type: "text-end", id: "t2" },
		{ type: "finish" },
	];
}

function streamResponse(chunks: unknown[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			await wait(1200);
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(sse(chunk)));
				await wait(12);
			}
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
	return new Response(stream, {
		headers: { "content-type": "text/event-stream" },
	});
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
}

function userTurns(body: BodyInit | null | undefined): number {
	return typeof body === "string" ? body.split('"role":"user"').length - 1 : 1;
}

function installMockBackend(): void {
	if (typeof window === "undefined") {
		return;
	}
	const w = window as typeof window & { __wwFernhillMock?: boolean };
	if (w.__wwFernhillMock) {
		return;
	}
	w.__wwFernhillMock = true;

	const realFetch = window.fetch;
	const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url = requestUrl(input);
		if (!url.startsWith(MOCK_ORIGIN)) {
			return realFetch(input, init);
		}
		const { pathname } = new URL(url);
		if (pathname === "/messages.json") {
			return Promise.resolve(
				Response.json({
					en: { workingIndicator: { default: "Checking the trail map…" } },
				}),
			);
		}
		if (pathname.endsWith("/config")) {
			return Promise.resolve(
				Response.json({ success: true, data: { visibility: null } }),
			);
		}
		if (pathname.endsWith("/tools")) {
			return Promise.resolve(Response.json({ tools: [] }));
		}
		if (pathname === "/api/mcp/chat" && init?.method === "POST") {
			const chunks =
				userTurns(init.body) > 1 ? turnTwoChunks() : turnOneChunks();
			return Promise.resolve(streamResponse(chunks));
		}
		return Promise.resolve(Response.json({ success: true }));
	}) as unknown as typeof window.fetch;
	mockFetch.preconnect = realFetch.preconnect;
	window.fetch = mockFetch;
}

installMockBackend();

function brandConfig(): EmbedConfig {
	const here =
		typeof window === "undefined"
			? "https://fernhill.mock/"
			: `${window.location.origin}${window.location.pathname}`;
	return {
		api: MOCK_API,
		token: "wwp_fernhill_demo",
		mode: "floating",
		locale: "en",
		title: "Fernhill guide",
		appearDelay: 0,
		launcherText: "Ask the Fernhill guide",
		placeholder: "Ask about gear, trails or repairs",
		disclaimer:
			"The Fernhill guide is an AI and can be wrong. Check trail conditions before you go.",
		suggestions: [
			"What should I pack for a two-day hike?",
			"Which tent fits two people?",
		],
		pageSuggestions: [
			{
				url: here,
				prompts: [
					{ id: null, text: "What should I pack for a two-day hike?" },
					{ id: null, text: "Which boots for wet trails?" },
					{ id: null, text: "Do you rent stoves?" },
				],
			},
			{
				url: `${here}#repairs`,
				prompts: [{ id: null, text: "Can you fix a torn tent?" }],
			},
		],
		avatar: AVATAR_URL,
		avatarSlots: ["welcome", "header", "message", "composer", "dock"],
		welcomeTitle: "Hello,|where are you heading?",
		welcomeSubtitle: [
			"Gear, trails and repairs, in one place.",
			"Tell us the trip, we pack the list.",
		],
		welcomeSubtitleRotate: 3600,
		messages: {
			en: {
				menu: {
					restart: "Start over",
					copyConversation: "Copy the whole chat",
				},
				dialog: {
					restartTitle: "Clear this chat?",
					copyAndClear: "Copy, then clear",
					clearWithoutCopy: "Clear without copying",
				},
				toast: { conversationCopied: "Chat copied" },
			},
		},
		messagesUrl: MESSAGES_URL,
		suggestionsLayout: "single-row",
		suggestionsPosition: "after-message",
		sendIcon: "right",
		menu: ["restart", "copy-conversation"],
		restartConfirm: true,
		showTableToolbar: false,
		dockChipsTrigger: ["always"],
		dockClick: "expand",
		dockPointerVars: true,
		dockGlow: false,
		dockReadonlyMobile: true,
		panelHistory: true,
		documentUpload: {
			enabled: true,
			maxBytes: 10_000_000,
			maxPdfPages: 20,
			maxFiles: 3,
			accept: ["application/pdf", "image/png"],
		},
	};
}

// ----------------------------------------------------------------------------
// The brand's `data-css` file
// ----------------------------------------------------------------------------

const BRAND_CSS = `
[data-waniwani-chat] {
	--ww-font: "Avenir Next", "Segoe UI", system-ui, sans-serif;
	--ww-text: #22302c;
	--ww-muted: #66736e;
	--ww-border: #dcd6cb;
	--ww-bg: #fbf8f3;
	--ww-input-bg: #ffffff;
	--ww-primary: #2f5d50;
	--ww-primary-fg: #ffffff;
	--ww-user-bubble: #e8efe9;
	--ww-user-bubble-text: #22302c;
	--ww-msg-radius: 14px;
	--ww-destructive: #b3402a;

	--ww-content-max-width: 640px;
	--ww-header-height: 56px;
	--ww-avatar-size: 28px;
	--ww-heading-1: 1.5rem;
	--ww-heading-2: 1.25rem;
	--ww-heading-3: 1.0625rem;

	--ww-send-bg: #d9773f;
	--ww-send-fg: #ffffff;
	--ww-send-size: 2.25rem;
	--ww-send-radius: 12px;
	--ww-send-disabled-bg: #e7e1d7;
	--ww-send-disabled-fg: #8a8378;
	--ww-send-disabled-opacity: 1;
	--ww-stop-bg: #22302c;
	--ww-stop-fg: #ffffff;

	--ww-input-radius: 20px;
	--ww-input-border: #dcd6cb;
	--ww-input-border-width: 1.5px;
	--ww-input-shadow: 0 6px 24px rgba(34, 48, 44, 0.08);

	--ww-suggestion-bg: #f1ece3;
	--ww-suggestion-fg: #22302c;
	--ww-suggestion-border: transparent;
	--ww-suggestion-radius: 10px;
	--ww-suggestion-hover-bg: #e6dfd2;
	--ww-suggestion-stagger: 70ms;

	--ww-disclaimer-fg: #66736e;
	--ww-disclaimer-size: 0.6875rem;

	--ww-panel-width: min(960px, calc(100vw - 48px));
	--ww-panel-height: min(640px, calc(100vh - 96px));
	--ww-panel-radius: 24px;
	--ww-panel-offset: 24px;
	--ww-panel-open-duration: 480ms;
	--ww-panel-close-duration: 320ms;

	--ww-dock-width: min(560px, calc(100vw - 32px));
	--ww-dock-width-expanded: min(680px, calc(100vw - 32px));
	--ww-dock-radius: 28px;
	--ww-dock-bg: rgba(251, 248, 243, 0.86);
	--ww-dock-border: rgba(47, 93, 80, 0.18);
	--ww-dock-field-radius: 9999px;
	--ww-dock-field-border: #dcd6cb;
	--ww-dock-field-border-width: 1px;

	--ww-z-index: 1000;
	--ww-toast-duration: 2600ms;
	--ww-toast-leave-duration: 280ms;
}

/* Floating bar */
.ww-dock { padding: 6px; }
.ww-dock::after {
	content: "";
	position: absolute;
	inset: 0;
	border-radius: var(--ww-dock-radius);
	pointer-events: none;
	opacity: 0;
	background: radial-gradient(240px circle at var(--ww-pointer-x, 50%) var(--ww-pointer-y, 0%), rgba(233, 196, 106, 0.35), transparent 70%);
}
.ww-dock[data-hover="true"]::after { opacity: 1; }
.ww-dock[data-expanded="true"] .ww-dock-card { box-shadow: 0 18px 40px rgba(34, 48, 44, 0.16); }
.ww-dock-field { background: #ffffff; }
.ww-dock-input::placeholder { color: #8a8378; }
.ww-dock-send { background: #e7e1d7; color: #8a8378; }
.ww-dock[data-has-text="true"] .ww-dock-send { background: #d9773f; color: #ffffff; }
.ww-dock-close { color: #66736e; }
.ww-avatar[data-slot="dock"] { --ww-avatar-size: 24px; margin-right: 6px; }
.ww-suggestion[data-origin="dock"] { --ww-suggestion-bg: #ffffff; --ww-suggestion-border: #dcd6cb; }

/* Panel and header */
.ww-panel { border-color: #dcd6cb; }
.ww-header { border-bottom-color: #ece6dc; }
.ww-header-title { font-weight: 600; letter-spacing: 0.01em; }
.ww-header-actions { gap: 4px; }
.ww-menu-button, .ww-close { border-radius: 9999px; }
.ww-menu-button[data-state="open"] { background: #ece6dc; }
.ww-menu { border-radius: 14px; box-shadow: 0 12px 32px rgba(34, 48, 44, 0.16); }
.ww-menu-item { border-radius: 10px; }
.ww-menu-item[data-action="restart"] { color: #b3402a; }
.ww-menu-item[data-action="copy-conversation"][data-state="copied"] { color: #2f5d50; }
.ww-menu-item[data-action="copy-conversation"][data-state="failed"] { color: #b3402a; }
.ww-new-chat { border-radius: 9999px; }

/* Welcome */
.ww-avatar[data-slot="welcome"] { --ww-avatar-size: 72px; }
.ww-avatar[data-slot="header"] { --ww-avatar-size: 28px; }
.ww-avatar[data-slot="message"] { --ww-avatar-size: 24px; }
.ww-avatar[data-slot="composer"] { --ww-avatar-size: 22px; margin-left: 8px; }
.ww-welcome-title { font-size: 1.25rem; font-weight: 600; }
.ww-welcome-subtitle { color: #66736e; min-height: 1.5em; }
.ww-welcome-suggestions { gap: 8px; }
.ww-suggestion[data-origin="welcome"] { --ww-suggestion-bg: #ffffff; --ww-suggestion-border: #dcd6cb; }

/* Conversation */
.ww-thread { scrollbar-gutter: stable; }
.ww-message-user .ww-bubble { box-shadow: 0 1px 2px rgba(34, 48, 44, 0.08); }
.ww-message-assistant .ww-bubble { line-height: 1.55; }
.ww-message[data-streaming="true"] .ww-bubble > :last-child::after { content: "▍"; color: #d9773f; margin-left: 2px; }
.ww-loader { color: #2f5d50; }
.ww-reasoning { border-left: 2px solid #e9c46a; padding-left: 8px; }
.ww-reasoning[data-state="open"] .ww-reasoning-toggle { color: #2f5d50; }
.ww-reasoning-step[data-status="running"] { color: #d9773f; }
.ww-reasoning-step[data-status="stopped"] { color: #b3402a; }
.ww-tool { border-radius: 12px; }
.ww-tool[data-state="open"] { border-color: #2f5d50; }
.ww-widget[data-display-mode="fullscreen"] { border-radius: 0; }
.ww-suggestions[data-origin="followup"] .ww-suggestion { --ww-suggestion-bg: #e8efe9; }
.ww-scroll-latest { background: #ffffff; }
.ww-error { color: #b3402a; }
[data-waniwani-chat] [data-streamdown="heading-1"],
[data-waniwani-chat] [data-streamdown="heading-2"],
[data-waniwani-chat] [data-streamdown="heading-3"] { color: #2f5d50; font-weight: 650; }
[data-waniwani-chat] [data-streamdown="link"] { color: #2f5d50; text-decoration-color: #d9773f; text-underline-offset: 3px; }
[data-waniwani-chat] [data-streamdown="table"] { border-radius: 12px; overflow: hidden; }
[data-waniwani-chat] [data-streamdown="table-header"] { background: #f1ece3; }
[data-waniwani-chat] [data-streamdown="table-wrapper"] > div:first-child:has(button) { display: none; }

/* Composer */
.ww-input { background: #ffffff; }
.ww-input-row { align-items: center; gap: 6px; padding: 6px; }
.ww-input[data-multiline="true"] { --ww-input-radius: 16px; }
.ww-input[data-empty="true"] .ww-send { cursor: default; }
.ww-input[data-streaming="true"] { border-color: #e9c46a; }
.ww-textarea::placeholder { color: #8a8378; }
.ww-attach { color: #66736e; }
.ww-composer[data-composer-variant="outline"] { --ww-composer-radius: 20px; }
.ww-footer { flex-wrap: wrap; row-gap: 2px; text-align: center; }
.ww-disclaimer { white-space: normal; text-wrap: balance; }
.ww-powered-by { opacity: 0.8; }

/* Dialog and toast */
.ww-dialog { border-radius: 20px; }
.ww-dialog::backdrop { background: rgba(34, 48, 44, 0.45); }
.ww-dialog-title { color: #22302c; }
.ww-dialog-text { color: #4d5955; }
.ww-dialog-actions { gap: 12px; }
.ww-dialog-primary { background: #d9773f; color: #ffffff; border-radius: 9999px; }
.ww-dialog-secondary { border-color: #22302c; border-radius: 9999px; }
.ww-dialog-close { border-radius: 9999px; }
.ww-toast { background: #2f5d50; color: #ffffff; border: 0; }
.ww-toast[data-kind="error"] { background: #b3402a; }

/* Motion: state attributes and duration tokens, keyframes are the brand's own */
@keyframes fernhill-rise {
	from { opacity: 0; transform: translateY(10px); filter: blur(4px); }
	to { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes fernhill-panel-in {
	from { opacity: 0; transform: translateY(24px) scale(0.96); }
	to { opacity: 1; transform: none; }
}
@keyframes fernhill-panel-out {
	from { opacity: 1; transform: none; }
	to { opacity: 0; transform: translateY(24px) scale(0.96); }
}
@keyframes fernhill-toast {
	from { transform: translate(-50%, 16px); opacity: 0; }
	to { transform: translate(-50%, 0); opacity: 1; }
}

@media (prefers-reduced-motion: no-preference) {
	.ww-dock[data-appeared="true"][data-state="shown"] .ww-dock-field { animation: fernhill-rise 0.5s ease-out both; }
	.ww-suggestion[data-origin="dock"],
	.ww-welcome[data-appeared="true"] .ww-suggestion {
		animation: fernhill-rise 0.42s ease-out both;
		animation-delay: calc(var(--ww-suggestion-stagger) * var(--ww-index, 0));
	}
	.ww-welcome[data-appeared="true"] .ww-welcome-title { animation: fernhill-rise 0.4s ease-out both; }
	.ww-welcome-subtitle [data-rotating="true"] { filter: blur(3px); transition: filter 0.2s, opacity 0.2s; }
	.ww-panel[data-state="opening"],
	.ww-panel[data-state="shown"],
	.ww-panel[data-state="closing"] { clip-path: none; opacity: 1; visibility: visible; }
	.ww-panel[data-state="opening"] { animation: fernhill-panel-in var(--ww-panel-open-duration) cubic-bezier(0.22, 1, 0.36, 1) both; }
	.ww-panel[data-state="closing"] { animation: fernhill-panel-out var(--ww-panel-close-duration) ease-in both; }
	.ww-suggestions[data-origin="followup"] .ww-suggestion:hover { transform: translateY(-1px); }
	.ww-toast[data-state="entering"],
	.ww-toast[data-state="shown"] { animation: fernhill-toast 0.3s ease-out both; }
	.ww-toast[data-state="leaving"] { animation: fernhill-toast var(--ww-toast-leave-duration) ease-in reverse both; }
}

@media (prefers-reduced-motion: reduce) {
	[data-waniwani-chat] {
		--ww-panel-open-duration: 0ms;
		--ww-panel-close-duration: 0ms;
		--ww-suggestion-stagger: 0ms;
		--ww-toast-leave-duration: 0ms;
	}
}
`;

function HostPage() {
	const sections = [
		{ id: "gear", title: "Gear for every season" },
		{ id: "trips", title: "Guided trips" },
		{ id: "repairs", title: "Repairs and rentals" },
	];
	return (
		<div
			style={{
				minHeight: "160vh",
				padding: "48px 24px 240px",
				background: "#f4efe6",
				color: "#22302c",
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<h1 style={{ fontSize: 30, fontWeight: 700 }}>Fernhill Outfitters</h1>
			{sections.map((section) => (
				<section
					key={section.id}
					id={section.id}
					style={{ maxWidth: 640, marginTop: 40, minHeight: 280 }}
				>
					<h2 style={{ fontSize: 22, fontWeight: 600 }}>{section.title}</h2>
					<p style={{ marginTop: 10, lineHeight: 1.7, opacity: 0.8 }}>
						Placeholder copy so the floating bar has a page to sit on.
					</p>
				</section>
			))}
		</div>
	);
}

// ----------------------------------------------------------------------------
// Part assertions
// ----------------------------------------------------------------------------

type Part = (typeof PARTS)[keyof typeof PARTS];

const DOCK_PARTS: Part[] = [
	PARTS.dock,
	PARTS.dockCard,
	PARTS.dockSuggestions,
	PARTS.dockField,
	PARTS.dockInput,
	PARTS.dockSend,
	PARTS.dockClose,
	PARTS.avatar,
	PARTS.suggestion,
];

const PANEL_PARTS: Part[] = [
	PARTS.panel,
	PARTS.root,
	PARTS.content,
	PARTS.header,
	PARTS.headerTitle,
	PARTS.headerActions,
	PARTS.menuButton,
	PARTS.close,
	PARTS.thread,
	PARTS.input,
	PARTS.inputRow,
	PARTS.textarea,
	PARTS.send,
	PARTS.attach,
	PARTS.footer,
	PARTS.disclaimer,
	PARTS.poweredBy,
];

const WELCOME_PARTS: Part[] = [
	PARTS.welcome,
	PARTS.welcomeTitle,
	PARTS.welcomeSubtitle,
	PARTS.welcomeSuggestions,
];

const SUBMITTED_PARTS: Part[] = [PARTS.loader, PARTS.stop];

const ANSWER_PARTS: Part[] = [
	PARTS.message,
	PARTS.bubble,
	PARTS.reasoning,
	PARTS.reasoningToggle,
	PARTS.reasoningSteps,
	PARTS.reasoningStep,
	PARTS.suggestions,
];

const MENU_PARTS: Part[] = [PARTS.menu, PARTS.menuItem];

const DIALOG_PARTS: Part[] = [
	PARTS.dialog,
	PARTS.dialogTitle,
	PARTS.dialogText,
	PARTS.dialogActions,
	PARTS.dialogPrimary,
	PARTS.dialogSecondary,
	PARTS.dialogClose,
];

const TIMEOUT = { timeout: 12_000 };

async function expectParts(root: HTMLElement, parts: Part[]): Promise<void> {
	await waitFor(() => {
		const missing = parts.filter(
			(part) => root.querySelector(`.${part}`) === null,
		);
		if (missing.length > 0) {
			throw new Error(`Missing parts: ${missing.join(", ")}`);
		}
	}, TIMEOUT);
}

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

async function panelState(root: HTMLElement, state: string): Promise<void> {
	await find(root, `.${PARTS.panel}[data-state="${state}"]`);
}

function stubClipboard(): void {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: async () => {} },
	});
}

async function walkDesktop(root: HTMLElement): Promise<void> {
	await expectParts(root, [...DOCK_PARTS, ...PANEL_PARTS, ...WELCOME_PARTS]);

	(
		await find<HTMLButtonElement>(
			root,
			`.${PARTS.dockSuggestions} .${PARTS.suggestion}`,
		)
	).click();
	await panelState(root, "shown");
	await expectParts(root, SUBMITTED_PARTS);

	await find(root, `.${PARTS.suggestions}[data-origin="followup"]`);
	(
		await find<HTMLButtonElement>(
			root,
			`.${PARTS.reasoning} .${PARTS.reasoningToggle}`,
		)
	).click();
	await expectParts(root, ANSWER_PARTS);

	const thread = await find(root, `.${PARTS.panel} .${PARTS.thread}`);
	thread.scrollTop = 0;
	thread.dispatchEvent(new Event("scroll"));
	await expectParts(root, [PARTS.scrollLatest]);

	(
		await find<HTMLButtonElement>(
			root,
			`.${PARTS.suggestions}[data-origin="followup"] .${PARTS.suggestion}`,
		)
	).click();
	await expectParts(root, [PARTS.tool]);
	await waitFor(() => {
		if (root.querySelector(`.${PARTS.input}[data-streaming]`)) {
			throw new Error("Still streaming");
		}
	}, TIMEOUT);

	stubClipboard();
	(await find<HTMLButtonElement>(root, `.${PARTS.menuButton}`)).click();
	await expectParts(root, MENU_PARTS);
	(
		await find<HTMLButtonElement>(
			root,
			`.${PARTS.menuItem}[data-action="copy-conversation"]`,
		)
	).click();
	await expectParts(root, [PARTS.toast]);

	(await find<HTMLButtonElement>(root, `.${PARTS.menuButton}`)).click();
	(
		await find<HTMLButtonElement>(
			root,
			`.${PARTS.menuItem}[data-action="restart"]`,
		)
	).click();
	await expectParts(root, DIALOG_PARTS);
	(await find<HTMLButtonElement>(root, `.${PARTS.dialogClose}`)).click();
}

// ----------------------------------------------------------------------------
// Stories
// ----------------------------------------------------------------------------

interface DeepArgs {
	config: Partial<EmbedConfig>;
}

const meta: Meta<DeepArgs> = {
	title: "Chat/Theming Deep Customisation",
	render: ({ config }) => (
		<>
			<style>{BRAND_CSS}</style>
			<HostPage />
			<FloatingChat config={{ ...brandConfig(), ...config }} />
		</>
	),
	args: { config: {} },
	parameters: {
		bare: true,
		viewport: {
			options: {
				phone390: {
					name: "Phone 390",
					styles: { width: "390px", height: "844px" },
					type: "mobile",
				},
			},
		},
	},
};

export default meta;

type Story = StoryObj<DeepArgs>;

/**
 * Desktop: the bar with its chips, then the panel through a full exchange
 * (loader, reasoning chain, table, follow-ups after the message), a lone tool
 * call, the menu, the copy toast and the restart dialog.
 */
export const DesktopPanel: Story = {
	play: async ({ canvasElement }) => {
		await walkDesktop(canvasElement);
	},
};

/**
 * Phone: the bar's input is read-only so a tap opens the full-screen panel
 * without the keyboard, and the back gesture closes it.
 */
export const MobileViewport: Story = {
	args: {
		config: { dockChipsTrigger: ["hover", "scroll"], dockClick: "open" },
	},
	globals: { viewport: { value: "phone390", isRotated: false } },
	play: async ({ canvasElement }) => {
		const input = await find<HTMLInputElement>(
			canvasElement,
			`.${PARTS.dockInput}`,
		);
		if (!input.readOnly) {
			throw new Error("The bar's input should be read-only on a phone");
		}
		await expectParts(canvasElement, [...DOCK_PARTS, ...PANEL_PARTS]);

		input.click();
		await panelState(canvasElement, "shown");
		await expectParts(canvasElement, WELCOME_PARTS);

		window.history.back();
		await panelState(canvasElement, "hidden");

		input.click();
		await panelState(canvasElement, "shown");
	},
};

/**
 * Reduced motion, through the media query: emulate
 * `prefers-reduced-motion: reduce` (DevTools Rendering panel or the OS setting)
 * and reload. The brand keyframes sit behind `no-preference` and its `reduce`
 * block zeroes the duration tokens, so the panel opens straight to `shown` and
 * nothing animates. Without the emulation it plays like `DesktopPanel`.
 */
export const ReducedMotion: Story = {
	play: async ({ canvasElement }) => {
		await walkDesktop(canvasElement);
		const view = canvasElement.ownerDocument.defaultView;
		if (!view?.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			return;
		}
		const panel = await find(canvasElement, `.${PARTS.panel}`);
		const openDuration = view
			.getComputedStyle(panel)
			.getPropertyValue("--ww-panel-open-duration")
			.trim();
		if (openDuration !== "0ms") {
			throw new Error(`Panel open duration is ${openDuration}, expected 0ms`);
		}
		await waitFor(() => {
			const running = canvasElement.ownerDocument
				.getAnimations()
				.filter((animation) => animation.playState === "running");
			if (running.length > 0) {
				throw new Error(`${running.length} animations still running`);
			}
		}, TIMEOUT);
	},
};
