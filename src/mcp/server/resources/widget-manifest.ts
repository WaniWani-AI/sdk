import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WANIWANI_WIDGET_BASE_URL_PLACEHOLDER =
	"__WANIWANI_WIDGET_BASE_URL__";

/**
 * Path to the manifest file shipped inside the SDK's `dist/` directory.
 * `withWaniwaniWidgets()` overwrites this file at build time with the
 * resources discovered for the consuming app. The runtime reads it via
 * `fs.readFileSync` so that Next.js / Vercel file tracing bundles it into
 * the serverless function output.
 */
export const WANIWANI_WIDGETS_MANIFEST_FILENAME = "widgets-manifest.json";

export type WaniwaniWidgetsManifest = {
	version: 1;
	byId: Record<string, string>;
	byHtmlPath: Record<string, string>;
};

const manifestPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	WANIWANI_WIDGETS_MANIFEST_FILENAME,
);

/**
 * Absolute path to the manifest JSON file. Both the runtime reader (here)
 * and the build-time writer (`withWaniwaniWidgets`) resolve to the same
 * location so the bridge works in tests (uncompiled TS) and in published
 * builds (compiled `dist/`).
 */
export function getManifestFilePath(): string {
	return manifestPath;
}

let cachedManifest: WaniwaniWidgetsManifest | null | undefined;
let testOverrideManifest: WaniwaniWidgetsManifest | null | undefined;

function getManifest(): WaniwaniWidgetsManifest | null {
	if (testOverrideManifest !== undefined) {
		return testOverrideManifest;
	}
	if (cachedManifest !== undefined) {
		return cachedManifest;
	}

	try {
		const raw = readFileSync(manifestPath, "utf8");
		cachedManifest = JSON.parse(raw) as WaniwaniWidgetsManifest;
	} catch {
		cachedManifest = null;
	}
	return cachedManifest;
}

/** Test-only: override the manifest used by `resolveResourceHtmlPath`. */
export function __setManifestForTesting(
	manifest: WaniwaniWidgetsManifest | null | undefined,
): void {
	testOverrideManifest = manifest;
	cachedManifest = undefined;
}

export function getDefaultResourceHtmlPath(id: string): string {
	return `/${id}`;
}

export function resolveResourceHtmlPath(id: string, htmlPath?: string): string {
	const configuredHtmlPath = htmlPath ?? getDefaultResourceHtmlPath(id);
	const manifest = getManifest();

	return (
		manifest?.byHtmlPath[configuredHtmlPath] ??
		manifest?.byId[id] ??
		configuredHtmlPath
	);
}

export function replaceWidgetTemplatePlaceholders(
	html: string,
	baseUrl: string,
): string {
	const normalizedBaseUrl = baseUrl.endsWith("/")
		? baseUrl.slice(0, -1)
		: baseUrl;
	return html.replaceAll(
		WANIWANI_WIDGET_BASE_URL_PLACEHOLDER,
		normalizedBaseUrl,
	);
}
