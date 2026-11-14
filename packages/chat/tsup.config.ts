import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

// `decode-named-character-reference` picks `index.dom.js` under the browser
// condition, and that file runs `document.createElement` at module load, so any
// SSR import of the chat entry throws. Node's resolver never applies `browser`,
// so this hands back the isomorphic `index.js`.
const nodeRequire = createRequire(import.meta.url);

const isomorphicEntityDecoder = nodeRequire.resolve(
	"decode-named-character-reference",
);

// The chat reports its own version in timing telemetry, so it is read from
// package.json rather than restated in a source constant that would drift.
const chatVersion: Record<string, string> = {
	__WANIWANI_CHAT_VERSION__: JSON.stringify(
		(nodeRequire("./package.json") as { version: string }).version,
	),
};

// eve's client pre-bundles its own copy of zod, which no bundler can tree-shake
// or share, so it resolves to the zod this build already carries.
const eveSharesZod: Plugin = {
	name: "eve-shares-zod",
	setup(build) {
		build.onResolve({ filter: /^#compiled\/zod\/index\.js$/ }, (args) =>
			build.resolve("zod", { kind: args.kind, resolveDir: args.resolveDir }),
		);
	},
};

// `ai-sdk-react-mcp-apps` is `@ai-sdk/react` at one exact version, inlined for
// `MCPAppRenderer` alone. Its module also imports names from `ai` for hooks the
// chat never uses. `ai` is external here, so those imports would survive into
// the output, where `ai` 6 lacks some of them and the whole chunk fails to
// link. tsup's own external plugin claims every `ai` import before a plugin of
// ours sees it, so this loads the module itself and points its `ai` import at
// a stub, which tree-shaking then drops along with the code that used it. A
// future pin that imports a new name fails the build here.
const RENDERER_AI_NAMES = [
	"AbstractChat",
	"DefaultChatTransport",
	"Experimental_AbstractRealtimeSession",
	"asSchema",
	"callCompletionApi",
	"isDeepEqualData",
	"parsePartialJson",
];
const rendererEntry = nodeRequire.resolve("ai-sdk-react-mcp-apps");
const rendererWithoutAi: Plugin = {
	name: "renderer-without-ai",
	setup(build) {
		build.onResolve({ filter: /^ai-sdk-react-mcp-apps$/ }, () => ({
			path: rendererEntry,
			namespace: "mcp-app-renderer",
		}));
		build.onLoad(
			{ filter: /.*/, namespace: "mcp-app-renderer" },
			async (args) => {
				const source = await readFile(args.path, "utf8");
				const contents = source.replace(
					/from\s*["']ai["']/g,
					'from "mcp-app-renderer-ai-stub"',
				);
				if (contents === source) {
					throw new Error(
						`${args.path} no longer imports from "ai"; drop rendererWithoutAi`,
					);
				}
				return { contents, loader: "js", resolveDir: dirname(args.path) };
			},
		);
		build.onResolve({ filter: /^mcp-app-renderer-ai-stub$/ }, () => ({
			path: "ai",
			namespace: "mcp-app-renderer-ai-stub",
		}));
		build.onLoad({ filter: /.*/, namespace: "mcp-app-renderer-ai-stub" }, () => ({
			contents: RENDERER_AI_NAMES.map(
				(name) => `export const ${name} = undefined;`,
			).join("\n"),
			loader: "js",
		}));
	},
};

export default defineConfig([
	// React components. platform "browser" keeps nanoid and streamdown → unified → vfile off their Node entries, which leak bare crypto/path/process/url imports.
	// `@waniwani/core` is a private workspace package, so the code and the
	// types are both inlined here.
	{
		entry: { index: "src/index.ts" },
		format: ["esm"],
		target: "es2022",
		platform: "browser",
		dts: true,
		clean: true,
		shims: false,
		splitting: true,
		sourcemap: true,
		minify: true,
		outDir: "dist",
		external: ["react", "react-dom", "@ai-sdk/react", "ai"],
		noExternal: ["@waniwani/core", "ai-sdk-react-mcp-apps"],
		banner: {
			js: '"use client";',
		},
		define: chatVersion,
		esbuildOptions(options) {
			options.alias = {
				...options.alias,
				"decode-named-character-reference": isomorphicEntityDecoder,
			};
		},
		esbuildPlugins: [eveSharesZod, rendererWithoutAi],
	},
	// Chat embed (self-contained IIFE for any website)
	{
		entry: { embed: "src/embed/embed.ts" },
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
		esbuildPlugins: [eveSharesZod],
		define: {
			"process.env.NODE_ENV": '"production"',
			...chatVersion,
		},
		esbuildOptions(options) {
			// Lighter alternatives for the embed IIFE bundle.
			// The full deps are used in the ESM build (Next.js apps) where
			// they're external / tree-shaken by the host bundler. For the
			// self-contained IIFE we swap heavy deps with minimal shims.
			options.alias = {
				...options.alias,
				// Node built-in → browser Web Crypto API
				crypto: "./src/embed/shims/crypto.ts",
				// Shiki (8 MB of syntax grammars) → no-op code plugin
				"@streamdown/code": "./src/embed/shims/streamdown-code.ts",
				// CJK line-break plugin → no-op
				"@streamdown/cjk": "./src/embed/shims/streamdown-cjk.ts",
				// rehype-raw pulls in parse5 HTML parser (~100 KB) → passthrough
				"rehype-raw": "./src/embed/shims/rehype-raw.ts",
				// tailwind-merge (~26 KB) → simple concat (Shadow DOM prevents conflicts)
				"tailwind-merge": "./src/embed/shims/tailwind-merge.ts",
				// zod (~200 KB) → passthrough shim (schemas only validated server-side)
				zod: "./src/embed/shims/zod.ts",
				"zod/v4": "./src/embed/shims/zod.ts",
				"zod/v3": "./src/embed/shims/zod.ts",
				"zod/v4/core": "./src/embed/shims/zod.ts",
			};
		},
	},
]);
