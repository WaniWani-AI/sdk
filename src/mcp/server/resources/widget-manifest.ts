export const WANIWANI_WIDGETS_MANIFEST_ENV = "WANIWANI_WIDGETS_MANIFEST";
export const WANIWANI_WIDGET_BASE_URL_PLACEHOLDER =
	"__WANIWANI_WIDGET_BASE_URL__";

export type WaniwaniWidgetsManifest = {
	version: 1;
	byId: Record<string, string>;
	byHtmlPath: Record<string, string>;
};

let parsedManifest:
	| {
			raw: string | undefined;
			value: WaniwaniWidgetsManifest | null;
	  }
	| undefined;

function getManifest(): WaniwaniWidgetsManifest | null {
	const raw = process.env[WANIWANI_WIDGETS_MANIFEST_ENV];
	if (parsedManifest && parsedManifest.raw === raw) {
		return parsedManifest.value;
	}

	if (!raw) {
		parsedManifest = { raw, value: null };
		return null;
	}

	try {
		const value = JSON.parse(raw) as WaniwaniWidgetsManifest;
		parsedManifest = { raw, value };
		return value;
	} catch {
		parsedManifest = { raw, value: null };
		return null;
	}
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
