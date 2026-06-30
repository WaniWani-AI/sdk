import type { Preview } from "@storybook/react-vite";
// The chat widget's Tailwind entry. The @tailwindcss/vite plugin (see
// main.ts) processes the `@import "tailwindcss" prefix(ww)` inside it and
// generates the `ww:` utilities used across the components.
import "../src/chat/web/tailwind.css";

const preview: Preview = {
	parameters: {
		layout: "fullscreen",
		controls: { expanded: true },
	},
};

export default preview;
