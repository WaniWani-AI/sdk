/**
 * Post-build: fill the deprecated `@waniwani/sdk/chat/*` file paths.
 *
 * The chat moved to `@waniwani/chat`, but self-hosted pages still load
 * `@waniwani/sdk/dist/chat/embed.js`, so this copies the embed built by
 * packages/chat into dist/chat/. The 4 MB source map stays behind, and so does
 * the comment that points at it. `styles.css` is one `@import` of the chat's
 * stylesheet instead of a copy, so it always matches the installed
 * `@waniwani/chat`. Both paths go away in 0.28.0, with the `./chat` entry.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const chatDist = resolve(import.meta.dirname, "../../chat/dist");
const outDir = resolve(import.meta.dirname, "../dist/chat");

const embedPath = resolve(chatDist, "embed.js");
if (!existsSync(embedPath)) {
	console.error(
		`ERROR: ${embedPath} is missing. Build @waniwani/chat first (bun run build at the repo root).`,
	);
	process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
	resolve(outDir, "embed.js"),
	readFileSync(embedPath, "utf-8").replace(
		/\n\/\/# sourceMappingURL=embed\.js\.map\s*$/,
		"\n",
	),
);
writeFileSync(
	resolve(outDir, "styles.css"),
	'/* Deprecated: import "@waniwani/chat/styles.css". This path is removed in 0.28.0. */\n@import "@waniwani/chat/styles.css";\n',
);

console.log("✓ Copied the @waniwani/chat embed and stylesheet into dist/chat/");
