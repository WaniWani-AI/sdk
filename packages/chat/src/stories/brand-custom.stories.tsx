import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UIMessage } from "ai";
import type { ChatAppearance, ChatClassNames } from "../@types";
import { ChatEmbed } from "../layouts/chat-embed";

// ============================================================================
// Custom-brand theming stories — exercise every customization knob at once:
// colors, typography (family + size + line height), message-bubble
// radius/padding/max-width/text-color, the opt-in assistant bubble, and the
// per-slot `classNames` escape hatch.
//
// Messages are seeded via `initialMessages` so both a user and an assistant
// bubble render on mount — no backend round-trip needed to eyeball the theme.
// `api` points at an unreachable mock host with `skipRemoteConfig`, so nothing
// is fetched; the seeded conversation is all we render.
// ============================================================================

const MOCK_API = "https://brand.mock/api/chat";

const SEEDED_MESSAGES: UIMessage[] = [
	{
		id: "u1",
		role: "user",
		parts: [{ type: "text", text: "Can you help me get started?" }],
	},
	{
		id: "a1",
		role: "assistant",
		parts: [
			{
				type: "text",
				text: "Absolutely — tell me what you're looking for and I'll walk you through it step by step.",
			},
		],
	},
];

const BRAND_APPEARANCE: ChatAppearance = {
	theme: "light",
	assistantBubble: true,
	variables: {
		primaryColor: "#0a6c74",
		backgroundColor: "#f7fbfb",
		userBubbleColor: "#0a6c74",
		userBubbleTextColor: "#ffffff",
		assistantBubbleColor: "#e6f2f2",
		assistantBubbleTextColor: "#0b2b2e",
		messageBorderRadius: 20,
		messagePaddingX: 18,
		messagePaddingY: 12,
		messageMaxWidth: "75%",
		fontFamily: "Georgia, serif",
		fontSize: 15,
		lineHeight: "1.6",
		headerBackgroundColor: "#0a6c74",
		headerTextColor: "#ffffff",
	},
};

const BRAND_CLASSNAMES: ChatClassNames = {
	input: "ww:ring-2 ww:ring-[#0a6c74]",
	header: "ww:uppercase ww:tracking-wide",
};

interface BrandArgs {
	appearance?: ChatAppearance;
	classNames?: ChatClassNames;
}

function Embed(args: BrandArgs) {
	return (
		<ChatEmbed
			api={MOCK_API}
			skipRemoteConfig
			title="Assistant"
			initialMessages={SEEDED_MESSAGES}
			appearance={args.appearance}
			classNames={args.classNames}
		/>
	);
}

const meta: Meta<BrandArgs> = {
	title: "Chat/Theming — Custom Brand",
	render: (args) => (
		<div style={{ height: "100dvh", width: "100%" }}>
			<Embed {...args} />
		</div>
	),
	parameters: { bare: true },
};

export default meta;

type Story = StoryObj<BrandArgs>;

/**
 * A full custom-brand rebrand. Verify every knob at once:
 * - user bubble: brand fill, white text, 20px radius, 18/12 padding, ≤75% width
 * - assistant bubble: tinted fill (opt-in ON), dark text, same shape
 * - header: brand bg, white uppercase text (via `classNames.header`)
 * - font: Georgia serif at 15px / 1.6 line-height
 * - input: brand ring (via `classNames.input`)
 */
export const CustomBrand: Story = {
	args: {
		appearance: BRAND_APPEARANCE,
		classNames: BRAND_CLASSNAMES,
	},
};

/**
 * Back-compat regression guard: no `appearance`, no `classNames`. The assistant
 * message must render as plain text (NO bubble), and the user bubble must look
 * exactly like production — grey `userBubble`, 8px radius, 12/16 padding. If an
 * assistant background appears here, the opt-in default has regressed.
 */
export const DefaultLook: Story = {
	args: {},
};
