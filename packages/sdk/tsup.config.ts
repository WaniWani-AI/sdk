import { defineConfig } from "tsup";

// `@waniwani/protocol` is a private workspace package that is never published,
// so every entry inlines its code and its types (`noExternal` below).
const protocol = ["@waniwani/protocol"];

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
		noExternal: protocol,
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
		noExternal: protocol,
		external: [
			"@modelcontextprotocol/sdk",
			"zod",
			"react",
		],
	},
	// MCP client-side (React/Browser)
	{
		entry: { "mcp/react": "src/mcp/react/index.ts" },
		format: ["esm"],
		target: "es2022",
		platform: "browser",
		dts: true,
		clean: false,
		shims: false,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		noExternal: protocol,
		external: [
			"react",
			"@modelcontextprotocol/sdk",
		],
		banner: {
			js: '"use client";',
		},
	},
	// MCP client-side skybridge adapter (React/Browser). Thin wrapper that
	// feeds skybridge's `useToolInfo().responseMetadata` into the core hook.
	// `skybridge` is an optional peer dependency, kept external.
	{
		entry: { "mcp/react/skybridge": "src/mcp/react/skybridge.ts" },
		format: ["esm"],
		target: "es2022",
		platform: "browser",
		dts: true,
		clean: false,
		shims: false,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		noExternal: protocol,
		external: [
			"react",
			"skybridge",
			"skybridge/web",
			"@modelcontextprotocol/sdk",
		],
		banner: {
			js: '"use client";',
		},
	},
	// `@waniwani/sdk/chat`: the deprecated re-export of `@waniwani/chat`, an
	// optional peer kept external. Removed in 0.28.0.
	{
		entry: { "chat/index": "src/chat/index.ts" },
		format: ["esm"],
		target: "es2022",
		platform: "browser",
		dts: true,
		clean: false,
		shims: false,
		splitting: false,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: ["@waniwani/chat"],
		banner: {
			js: '"use client";',
		},
	},
	// Internal SDK surface (mounted at @waniwani/sdk/internal — not public).
	// Used by the Waniwani platform (app.waniwani.ai). Not for third parties.
	{
		entry: { "internal/index": "src/internal/index.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: false,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		noExternal: protocol,
		external: ["ai", "zod"],
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
		noExternal: protocol,
		external: ["ai"],
	},
	// Documents (Node.js, server-side). `zod` stays external: a caller reaches
	// this entry by passing a Zod schema, so it is always present.
	{
		entry: { "documents/index": "src/documents/index.ts" },
		format: ["esm"],
		target: "node20",
		dts: true,
		clean: false,
		shims: true,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		noExternal: protocol,
		external: ["zod"],
	},
]);
