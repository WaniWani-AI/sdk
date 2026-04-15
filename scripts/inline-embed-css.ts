/**
 * Post-build: Inline CSS into the embed IIFE bundle.
 *
 * The embed entry point (src/chat/web/embed/embed.ts) contains a placeholder:
 *   const EMBED_CSS = "__WANIWANI_EMBED_CSS__";
 *
 * This script reads dist/chat/styles.css, escapes it for JS string embedding,
 * and replaces the placeholder in dist/chat/embed.js.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve(import.meta.dirname, "../dist/chat");

const cssPath = resolve(distDir, "styles.css");
const embedPath = resolve(distDir, "embed.js");

// Read CSS
const css = readFileSync(cssPath, "utf-8");

// Read embed JS
let embedJs = readFileSync(embedPath, "utf-8");

// Escape CSS for embedding in a JS string:
// - Escape backslashes first, then quotes, then newlines
const escaped = css
	.replace(/\\/g, "\\\\")
	.replace(/"/g, '\\"')
	.replace(/\n/g, "\\n")
	.replace(/\r/g, "");

// Replace placeholder
const placeholder = "__WANIWANI_EMBED_CSS__";
if (!embedJs.includes(placeholder)) {
	console.error(
		`ERROR: Placeholder "${placeholder}" not found in ${embedPath}`,
	);
	console.error(
		'Make sure src/chat/web/embed/embed.ts contains: const EMBED_CSS = "__WANIWANI_EMBED_CSS__";',
	);
	process.exit(1);
}

embedJs = embedJs.replace(placeholder, escaped);

// Write back
writeFileSync(embedPath, embedJs, "utf-8");

const sizeKB = (Buffer.byteLength(embedJs) / 1024).toFixed(1);
console.log(
	`✓ Inlined ${css.length} bytes of CSS into embed.js (total: ${sizeKB} KB)`,
);
