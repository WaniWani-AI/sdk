import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const WANIWANI_WIDGET_BASE_URL_PLACEHOLDER =
	"__WANIWANI_WIDGET_BASE_URL__";

/**
 * Directory inside the consuming project where `withWaniwaniWidgets()`
 * stores generated build artifacts (currently the widget manifest).
 * Anchoring on the project root rather than `node_modules/@waniwani/sdk`
 * avoids polluting pnpm's content-addressed store across consumers.
 */
export const WANIWANI_BUILD_DIR = ".waniwani";
export const WANIWANI_WIDGETS_MANIFEST_FILENAME = "widgets-manifest.json";
/** Path relative to the project root, e.g. for `outputFileTracingIncludes`. */
export const WANIWANI_WIDGETS_MANIFEST_RELATIVE_PATH = `${WANIWANI_BUILD_DIR}/${WANIWANI_WIDGETS_MANIFEST_FILENAME}`;

export type WaniwaniWidgetsManifest = {
	version: 1;
	byId: Record<string, string>;
	byHtmlPath: Record<string, string>;
};

/**
 * Absolute path to the manifest JSON for a given project root. Defaults to
 * `process.cwd()`, which is correct for both `next start` and Vercel
 * serverless functions (where the deployed function root preserves files
 * pulled in via `outputFileTracingIncludes`).
 */
export function getManifestFilePath(projectRoot?: string): string {
	return resolve(
		projectRoot ?? process.cwd(),
		WANIWANI_WIDGETS_MANIFEST_RELATIVE_PATH,
	);
}

let cachedManifestPath: string | undefined;
let cachedManifest: WaniwaniWidgetsManifest | null | undefined;
let testOverrideManifest: WaniwaniWidgetsManifest | null | undefined;

function getManifest(): WaniwaniWidgetsManifest | null {
	if (testOverrideManifest !== undefined) {
		return testOverrideManifest;
	}

	const manifestPath = getManifestFilePath();
	if (cachedManifestPath === manifestPath && cachedManifest !== undefined) {
		return cachedManifest;
	}

	cachedManifestPath = manifestPath;
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
	cachedManifestPath = undefined;
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
