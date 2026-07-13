import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "@storybook/react-vite";

// Dev-only. Storybook is not part of the published package (the `files`
// allowlist in package.json only ships `dist`). Runs under bun via:
//   bun run storybook
const config: StorybookConfig = {
	stories: ["../src/**/*.stories.@(ts|tsx)"],
	// Serves `./public` at the Storybook root — e.g. `ww-mock-widget.html`, the
	// self-contained MCP UI widget the ChatEmbed stories load into their iframe.
	// Same-origin (not a `data:` URL) so the sandboxed frame runs its scripts in
	// every browser.
	staticDirs: ["./public"],
	framework: { name: "@storybook/react-vite", options: {} },
	// Disable react-docgen: its separate Babel pass chokes on some component
	// syntax that tsc/Vite handle fine (surfacing as a dev transform error),
	// and this playground doesn't need auto-generated prop tables.
	typescript: { reactDocgen: false },
	// Tailwind v4 with the same `ww` prefix the chat widget uses, so stories
	// render with the real utility classes from `src/chat/web/tailwind.css`.
	async viteFinal(viteConfig) {
		viteConfig.plugins = viteConfig.plugins ?? [];
		viteConfig.plugins.push(tailwindcss());
		return viteConfig;
	},
};

export default config;
