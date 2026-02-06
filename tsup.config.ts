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
		entry: { "mcp/react": "src/mcp/react.ts" },
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
		entry: { "chat/index": "src/chat/index.ts" },
		format: ["esm"],
		target: "es2022",
		dts: true,
		clean: false,
		shims: false,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: ["react", "react-dom", "@ai-sdk/react", "ai"],
		banner: {
			js: '"use client";',
		},
	},
	// Chat widget (embeddable script - self-contained IIFE)
	{
		entry: { "chat/embed": "src/chat/embed/embed.ts" },
		format: ["iife"],
		target: "es2020",
		dts: false,
		clean: false,
		shims: true,
		splitting: false,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		platform: "browser",
		noExternal: [/.*/],
		outExtension: () => ({ js: ".js" }),
	},
]);
