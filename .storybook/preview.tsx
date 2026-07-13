import type { Decorator, Preview } from "@storybook/react-vite";
import { ChatStage } from "../src/chat/web/__storybook__/stage";
import { SUPPORTED_LOCALES } from "../src/chat/web/i18n";
// The chat widget's Tailwind entry. The @tailwindcss/vite plugin (see
// main.ts) processes the `@import "tailwindcss" prefix(ww)` inside it and
// generates the `ww:` utilities used across the components.
import "../src/chat/web/tailwind.css";

/**
 * Wraps every story in the themed `[data-waniwani-chat]` stage + `I18nProvider`
 * so widget stories only render their component. Stories that own the full
 * canvas (host pages, floating docks) opt out of the centered card with
 * `parameters: { bare: true }`.
 */
const withChatStage: Decorator = (Story, context) => {
	const theme = context.globals.theme === "dark" ? "dark" : "light";
	const locale = SUPPORTED_LOCALES.find((l) => l === context.globals.locale);
	const bare = context.parameters.bare === true;
	return (
		<ChatStage theme={theme} locale={locale} bare={bare}>
			<Story />
		</ChatStage>
	);
};

const preview: Preview = {
	decorators: [withChatStage],
	parameters: {
		layout: "fullscreen",
		controls: { expanded: true },
	},
	initialGlobals: {
		theme: "light",
		locale: "en",
	},
	globalTypes: {
		theme: {
			description: "Widget palette",
			toolbar: {
				title: "Theme",
				icon: "mirror",
				items: [
					{ value: "light", title: "Light", icon: "sun" },
					{ value: "dark", title: "Dark", icon: "moon" },
				],
				dynamicTitle: true,
			},
		},
		locale: {
			description: "Widget language",
			toolbar: {
				title: "Locale",
				icon: "globe",
				items: SUPPORTED_LOCALES.map((value) => ({
					value,
					title: value.toUpperCase(),
				})),
				dynamicTitle: true,
			},
		},
	},
};

export default preview;
