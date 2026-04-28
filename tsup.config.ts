import { defineConfig } from "tsup";

export default defineConfig([
	// Core tracking SDK
	{
		entry: { index: "src/index.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: true,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
	},
	// MCP server-side (Node.js)
	{
		entry: { "mcp/index": "src/mcp/index.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: false,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: [
			"@modelcontextprotocol/sdk",
			"@modelcontextprotocol/ext-apps",
			"zod",
			"react",
		],
	},
	// MCP client-side (React/Browser)
	{
		entry: { "mcp/react": "src/mcp/react/index.ts" },
		format: ["esm"],
		target: "es2022",
		dts: true,
		clean: false,
		shims: false,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: [
			"react",
			"@modelcontextprotocol/sdk",
			"@modelcontextprotocol/ext-apps",
		],
		banner: {
			js: '"use client";',
		},
	},
	// Chat widget (React component)
	{
		entry: { "chat/index": "src/chat/web/index.ts" },
		format: ["esm"],
		target: "es2022",
		dts: true,
		clean: false,
		shims: false,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: [
			"react",
			"react-dom",
			"@ai-sdk/react",
			"ai",
			"@modelcontextprotocol/ext-apps",
			/^@modelcontextprotocol\/ext-apps\//,
		],
		banner: {
			js: '"use client";',
		},
	},
	// Chat server-side handler (Node.js)
	{
		entry: { "chat/server/index": "src/chat/server/index.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: false,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: [
			"ai",
			"@ai-sdk/mcp",
			"@modelcontextprotocol/sdk",
		],
	},
	// Next.js adapter
	{
		entry: { "chat/next-js/index": "src/chat/server/next-js/index.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: false,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: [
			"ai",
			"@ai-sdk/mcp",
			"@modelcontextprotocol/sdk",
		],
	},
	// Next.js widget build adapter
	{
		entry: { "next/index": "src/next/index.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: false,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: [
			"@tailwindcss/vite",
			"@vitejs/plugin-react",
			"vite",
			"react",
			"react-dom",
		],
	},
	// Knowledge Base (Node.js, server-side)
	{
		entry: { "kb/index": "src/kb/index.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: false,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: ["ai"],
	},
	// Evals (Node.js — replay, scenarios, chat — no optional deps)
	{
		entry: { "evals/index": "src/evals/index.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: false,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: ["ai", "zod"],
	},
	// Evals scorers (Node.js — braintrust + autoevals required)
	{
		entry: { "evals/scorers": "src/evals/scorers-entry.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: false,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: ["ai", "braintrust", "autoevals", "zod"],
	},
	// Chat embed (self-contained IIFE for any website)
	{
		entry: { "chat/embed": "src/chat/web/embed/embed.ts" },
		format: ["iife"],
		globalName: "WaniWaniChatEmbed",
		target: "es2020",
		dts: false,
		clean: false,
		splitting: false,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		noExternal: [/.*/], // bundle everything including React
		outExtension() {
			return { js: ".js" };
		},
		platform: "browser",
		define: {
			"process.env.NODE_ENV": '"production"',
		},
		esbuildOptions(options) {
			// Lighter alternatives for the embed IIFE bundle.
			// The full deps are used in the ESM build (Next.js apps) where
			// they're external / tree-shaken by the host bundler. For the
			// self-contained IIFE we swap heavy deps with minimal shims.
			options.alias = {
				...options.alias,
				// Node built-in → browser Web Crypto API
				crypto: "./src/chat/web/embed/shims/crypto.ts",
				// Shiki (8 MB of syntax grammars) → no-op code plugin
				"@streamdown/code": "./src/chat/web/embed/shims/streamdown-code.ts",
				// CJK line-break plugin → no-op
				"@streamdown/cjk": "./src/chat/web/embed/shims/streamdown-cjk.ts",
				// rehype-raw pulls in parse5 HTML parser (~100 KB) → passthrough
				"rehype-raw": "./src/chat/web/embed/shims/rehype-raw.ts",
				// tailwind-merge (~26 KB) → simple concat (Shadow DOM prevents conflicts)
				"tailwind-merge": "./src/chat/web/embed/shims/tailwind-merge.ts",
				// zod (~200 KB) → passthrough shim (schemas only validated server-side)
				zod: "./src/chat/web/embed/shims/zod.ts",
				"zod/v4": "./src/chat/web/embed/shims/zod.ts",
				"zod/v3": "./src/chat/web/embed/shims/zod.ts",
			};
		},
	},
]);
