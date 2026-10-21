import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { INITIAL_VIEWPORTS } from "storybook/viewport";
import { ComposerChat } from "./composer-chat";
import type {
	ComposerAppearance,
	ComposerSize,
	ComposerVariant,
	EmbedConfig,
} from "./config";

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
	variant: ComposerVariant;
	size: ComposerSize;
	showSuggestions: boolean;
	align: NonNullable<ComposerAppearance["align"]>;
	trigger: boolean;
	mobileTrigger: boolean;
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
		composer: {
			variant: args.variant,
			size: args.size,
			showSuggestions: args.showSuggestions,
			align: args.align,
			trigger: args.trigger,
			mobileTrigger: args.mobileTrigger,
		},
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
		variant: "glow",
		size: "md",
		showSuggestions: true,
		align: "start",
		trigger: false,
		mobileTrigger: true,
	},
	argTypes: {
		theme: {
			control: "inline-radio",
			options: ["light", "dark", "auto"],
		},
		variant: {
			control: "inline-radio",
			options: ["glow", "outline"],
		},
		size: { control: "inline-radio", options: ["sm", "md", "lg"] },
		align: { control: "inline-radio", options: ["start", "center"] },
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

// ============================================================================
// Basics
// ============================================================================

/** Default: in-flow composer with three suggestion pills under it. */
export const Default: Story = {
	args: {
		trigger: true,
		welcomeMessage: "",
		placeholder:
			"Hi! Ask me anything about the product.Hi! Ask me anything about the product.Hi! Ask me anything about the product.Hi! Ask me anything about the product.",
	},
};

/** Dark theme. */
export const DarkTheme: Story = {
	args: { theme: "dark" },
};

/** No suggestions — just the box. The chat still opens on send. */
export const NoSuggestions: Story = {
	args: { suggestions: [] },
};

// ============================================================================
// Variants
//
// Two starting points. Anything past them is CSS — see the `CssVariables`
// story at the bottom.
// ============================================================================

/** Filled box with the one-off border sweep once the config resolves. */
export const Glow: Story = {
	args: { variant: "glow" },
};

/** Hairline border, no glow sweep. Sits quietly inside an existing card. */
export const Outline: Story = {
	args: { variant: "outline" },
};

// ============================================================================
// Trigger instead of an input
// ============================================================================

/**
 * `trigger: true` — not an input. The box is a tap target dressed as one:
 * clicking opens the panel and the caret lands in the panel's own field, with
 * no in-page typing. It keeps the variant's chrome, so this is the `glow` box
 * with the textarea swapped out. `mobileTrigger: false` here only so the story
 * shows the option itself rather than the mobile rule, which produces the same
 * thing below 640px.
 */
export const TriggerOnly: Story = {
	args: { trigger: true, showSuggestions: false, mobileTrigger: false },
};

// ============================================================================
// Gallery
// ============================================================================

const GALLERY: { label: string; look: ComposerAppearance }[] = [
	{ label: "glow · md", look: { variant: "glow" } },
	{ label: "outline · md", look: { variant: "outline" } },
	{
		label: "outline · md · trigger",
		look: { variant: "outline", trigger: true, showSuggestions: false },
	},
	{
		label: "outline · sm",
		look: { variant: "outline", size: "sm", showSuggestions: false },
	},
	{
		label: "outline · lg",
		look: { variant: "outline", size: "lg", showSuggestions: false },
	},
];

/**
 * Every variant, size and the trigger option on one page. Each row is a full `ComposerChat` mount,
 * so any of them opens the same panel — handy for eyeballing the set against a
 * real background rather than a screenshot.
 */
export const Gallery: Story = {
	render: (args) => (
		<Stack dark={args.theme === "dark"}>
			{GALLERY.map((row) => (
				<GalleryRow key={row.label} args={args} {...row} />
			))}
		</Stack>
	),
};

function GalleryRow({
	label,
	look,
	args,
}: {
	label: string;
	look: ComposerAppearance;
	args: ComposerArgs;
}) {
	const panelContainer = usePanelContainer();
	return (
		<div>
			<RowLabel>{label}</RowLabel>
			{panelContainer && (
				<ComposerChat
					config={{ ...buildConfig(args), composer: look }}
					panelContainer={panelContainer}
				/>
			)}
		</div>
	);
}

// ============================================================================
// Scale and alignment
// ============================================================================

/** Small: tight enough for a sidebar or a row under a table. */
export const SizeSmall: Story = {
	args: { size: "sm", variant: "outline" },
};

/** Large: a hero search box as the page's primary call to action. */
export const SizeLarge: Story = {
	args: { size: "lg" },
};

/** Centered pills and label, for a centered hero. */
export const Centered: Story = {
	args: { align: "center" },
};

// ============================================================================
// Mobile
// ============================================================================

/**
 * Phone viewport, default config. Below 640px the box renders as a tap target
 * rather than a live input — one tap opens the panel, which is a full-screen
 * sheet at this width, and typing happens there. The variant's chrome is
 * unchanged; only the textarea is swapped out. Nothing here sets
 * `trigger`: this is the automatic rule.
 */
export const Mobile: Story = {
	globals: { viewport: { value: "mobile2", isRotated: false } },
};

/**
 * The same phone viewport with `mobileTrigger: false`: a real input at every
 * width, for hosts that want in-page typing on mobile too.
 */
export const MobileKeepsInput: Story = {
	args: { mobileTrigger: false },
	globals: { viewport: { value: "mobile2", isRotated: false } },
};

/**
 * A placeholder longer than the box, in a phone-width container, with
 * `mobileTrigger: false` so the real textarea renders. An empty composer is
 * one row tall, so the placeholder is clamped to a single line and ellipsized
 * rather than wrapping into a second line with nowhere to go. Typing restores
 * normal wrapping and the box grows.
 */
export const LongPlaceholderNarrow: Story = {
	args: {
		placeholder:
			"Ask anything about pricing, onboarding, integrations or billing…",
		showSuggestions: false,
		mobileTrigger: false,
	},
	render: (args) => {
		const panelContainer = usePanelContainer();
		return (
			<div
				style={{
					minHeight: "100vh",
					padding: 24,
					background: args.theme === "dark" ? "#0f1115" : "#f7f7f8",
					fontFamily: "system-ui, sans-serif",
				}}
			>
				{/* 320px: narrower than any phone, so the clamp shows at any window
				    size rather than only under the mobile viewport addon. */}
				<div style={{ width: 320 }}>
					{panelContainer && (
						<ComposerChat
							config={buildConfig(args)}
							panelContainer={panelContainer}
						/>
					)}
				</div>
			</div>
		);
	},
};

// ============================================================================
// Restyling with CSS
//
// What a customer actually reaches for. Everything below is one `style`
// object of `--ww-composer-*` properties on a wrapper around the embed —
// exactly what they would write on `[data-waniwani-embed]`.
// ============================================================================

const CSS_RECIPES: {
	label: string;
	vars: Record<string, string>;
	look?: ComposerAppearance;
}[] = [
	{ label: "outline · untouched", vars: {} },
	{
		// The old `minimal` variant, rebuilt from CSS alone — which is why it is
		// no longer a variant of its own.
		label: "flat, rule underneath",
		vars: {
			"--ww-composer-bg": "transparent",
			"--ww-composer-radius": "0",
			"--ww-composer-shadow": "none",
			"--ww-composer-border-width": "0 0 1px 0",
		},
	},
	{
		// The old `pill` variant, which is one property — which is why it is no
		// longer a variant either.
		label: "fully rounded search bar",
		vars: { "--ww-composer-radius": "9999px", "--ww-composer-shadow": "none" },
	},
	{
		label: "square, heavy border, no shadow",
		vars: {
			"--ww-composer-radius": "4px",
			"--ww-composer-border-width": "2px",
			"--ww-composer-border-color": "#1f2937",
			"--ww-composer-shadow": "none",
		},
	},
	{
		label: "tinted fill, branded send button",
		vars: {
			"--ww-composer-bg": "#eef2ff",
			"--ww-composer-border-color": "#c7d2fe",
			"--ww-composer-send-bg": "#4f46e5",
			"--ww-composer-send-fg": "#ffffff",
			"--ww-composer-shadow": "none",
		},
	},
	{
		// The same properties on the `glow` variant, which paints through
		// BorderGlow rather than a plain shell. Both paths read the same
		// properties, and this row is what catches it if they ever drift.
		label: "glow · tinted fill, square",
		look: { variant: "glow", showSuggestions: false },
		vars: {
			"--ww-composer-bg": "#fdf2f8",
			"--ww-composer-radius": "6px",
			"--ww-composer-border-color": "#fbcfe8",
			"--ww-composer-send-bg": "#db2777",
			"--ww-composer-send-fg": "#ffffff",
		},
	},
];

/**
 * The `--ww-composer-*` custom properties. Every row is the same variant with
 * the same config; only the CSS differs. Custom properties inherit through the
 * widget's shadow root, which is what lets a host restyle the box without the
 * SDK shipping a variant per taste.
 */
export const CssVariables: Story = {
	args: { variant: "outline", showSuggestions: false },
	render: (args) => (
		<Stack dark={args.theme === "dark"}>
			{CSS_RECIPES.map((recipe) => (
				<CssRecipeRow key={recipe.label} args={args} {...recipe} />
			))}
		</Stack>
	),
};

function CssRecipeRow({
	label,
	vars,
	look,
	args,
}: {
	label: string;
	vars: Record<string, string>;
	look?: ComposerAppearance;
	args: ComposerArgs;
}) {
	const panelContainer = usePanelContainer();
	const config = buildConfig(args);
	return (
		<div>
			<RowLabel>{label}</RowLabel>
			{/* Exactly what a customer writes on `[data-waniwani-embed]`. */}
			<div style={vars as React.CSSProperties}>
				{panelContainer && (
					<ComposerChat
						config={look ? { ...config, composer: look } : config}
						panelContainer={panelContainer}
					/>
				)}
			</div>
		</div>
	);
}

// ----------------------------------------------------------------------------
// Shared layout for the multi-row stories
// ----------------------------------------------------------------------------

function Stack({
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
				padding: "56px 24px",
				background: dark ? "#0f1115" : "#f7f7f8",
				color: dark ? "#e5e7eb" : "#1f2937",
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<div
				style={{
					maxWidth: 620,
					margin: "0 auto",
					display: "flex",
					flexDirection: "column",
					gap: 40,
				}}
			>
				{children}
			</div>
		</div>
	);
}

function RowLabel({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				fontSize: 12,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				opacity: 0.55,
				marginBottom: 10,
			}}
		>
			{children}
		</div>
	);
}
