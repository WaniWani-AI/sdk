import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "@storybook/react-vite";

// Dev-only. Storybook is not part of the published package (the `files`
// allowlist in package.json only ships `dist`). Runs under bun via:
//   bun run storybook
const config: StorybookConfig = {
	stories: ["../src/**/*.stories.@(ts|tsx)"],
	framework: { name: "@storybook/react-vite", options: {} },
	// Tailwind v4 with the same `ww` prefix the chat widget uses, so stories
	// render with the real utility classes from `src/chat/web/tailwind.css`.
	async viteFinal(viteConfig) {
		viteConfig.plugins = viteConfig.plugins ?? [];
		viteConfig.plugins.push(tailwindcss());
		return viteConfig;
	},
};

export default config;
