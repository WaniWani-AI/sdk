import type { McpServer } from "../types";
import { isRecord } from "./helpers.js";

type UnknownRecord = Record<string, unknown>;
type ReadCallback = (...args: unknown[]) => unknown;

const WRAPPED_READ = Symbol.for("waniwani.wrappedReadCallback");

type MaybeWrappedRead = ReadCallback & { [WRAPPED_READ]?: true };

const OPENAI_WIDGET_CSP_KEY = "openai/widgetCSP";

/**
 * Origin of the endpoint widgets post tracking events to, or `undefined` when
 * the API URL does not parse.
 */
export function trackingOrigin(apiUrl: string): string | undefined {
	try {
		return new URL(apiUrl).origin;
	} catch {
		return undefined;
	}
}

function withDomain(value: unknown, domain: string): string[] {
	const domains = Array.isArray(value)
		? value.filter((d): d is string => typeof d === "string")
		: [];
	return domains.includes(domain) ? domains : [...domains, domain];
}

function isWidgetContent(content: UnknownRecord): boolean {
	const meta = content._meta;
	if (
		isRecord(meta) &&
		(isRecord(meta.ui) || isRecord(meta[OPENAI_WIDGET_CSP_KEY]))
	) {
		return true;
	}
	return (
		typeof content.mimeType === "string" &&
		content.mimeType.startsWith("text/html")
	);
}

/**
 * Add `domain` to the connect domains of every widget in a `resources/read`
 * result, so the host's sandbox lets the widget reach the tracking endpoint.
 *
 * Extends each CSP block the resource already declares: MCP Apps
 * `ui.csp.connectDomains` and OpenAI `openai/widgetCSP.connect_domains`. A
 * widget that declares neither gets a `ui.csp` holding only this domain. A
 * resource that declares only `openai/widgetCSP` keeps that as its single
 * block, since a new `ui.csp` would leave out its other directives.
 */
export function addWidgetConnectDomain(result: unknown, domain: string): void {
	if (!isRecord(result) || !Array.isArray(result.contents)) {
		return;
	}

	for (const content of result.contents) {
		if (!isRecord(content) || !isWidgetContent(content)) {
			continue;
		}

		const meta: UnknownRecord = isRecord(content._meta)
			? { ...content._meta }
			: {};
		const openaiCsp = meta[OPENAI_WIDGET_CSP_KEY];
		const ui = isRecord(meta.ui) ? meta.ui : undefined;

		if (isRecord(openaiCsp)) {
			meta[OPENAI_WIDGET_CSP_KEY] = {
				...openaiCsp,
				connect_domains: withDomain(openaiCsp.connect_domains, domain),
			};
		}

		if (isRecord(ui?.csp) || !isRecord(openaiCsp)) {
			const csp = isRecord(ui?.csp) ? ui.csp : {};
			meta.ui = {
				...ui,
				csp: {
					...csp,
					connectDomains: withDomain(csp.connectDomains, domain),
				},
			};
		}

		content._meta = meta;
	}
}

function wrapReadCallback(
	readCallback: MaybeWrappedRead,
	domain: string,
): MaybeWrappedRead {
	if (readCallback[WRAPPED_READ]) {
		return readCallback;
	}
	const wrapped: MaybeWrappedRead = async (...args: unknown[]) => {
		const result = await readCallback(...args);
		addWidgetConnectDomain(result, domain);
		return result;
	};
	wrapped[WRAPPED_READ] = true;
	return wrapped;
}

function wrapRegisteredResource(entry: unknown, domain: string): void {
	if (isRecord(entry) && typeof entry.readCallback === "function") {
		entry.readCallback = wrapReadCallback(
			entry.readCallback as ReadCallback,
			domain,
		);
	}
}

/**
 * Declare `domain` in the CSP of every widget resource the server serves.
 *
 * Widgets post their events to the Waniwani backend from inside the host's
 * sandboxed iframe, so that origin must be in the widget's connect domains or
 * the host blocks each request. Covers resources registered before and after
 * this call, through `registerResource` and the deprecated `resource`. The MCP
 * SDK looks `readCallback` up on the stored entry at read time, so swapping it
 * upgrades a registered resource in place.
 */
export function declareWidgetConnectDomain(
	server: McpServer,
	domain: string,
): void {
	const internals = server as unknown as {
		_registeredResources?: Record<string, unknown>;
		_registeredResourceTemplates?: Record<string, unknown>;
		registerResource?: (...args: unknown[]) => unknown;
		resource?: (...args: unknown[]) => unknown;
	};

	for (const method of ["registerResource", "resource"] as const) {
		const original = internals[method];
		if (typeof original !== "function") {
			continue;
		}
		const bound = original.bind(server);
		internals[method] = (...args: unknown[]) => {
			const registered = bound(...args);
			wrapRegisteredResource(registered, domain);
			return registered;
		};
	}

	for (const registry of [
		internals._registeredResources,
		internals._registeredResourceTemplates,
	]) {
		if (!isRecord(registry)) {
			continue;
		}
		for (const entry of Object.values(registry)) {
			wrapRegisteredResource(entry, domain);
		}
	}
}
