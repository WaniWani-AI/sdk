import { buildApiUrl } from "../lib/api-url";
import type { EmbedConfig } from "./config";

/**
 * Which two URLs the WebMCP surface talks to, and whether it runs at all.
 *
 * Its own module, and pure, because this is the whole of the decision.
 */

export type WebMcpEndpoints = {
	/** Where `list` and `call` are posted. */
	toolsEndpoint: string;
	/**
	 * The channel to attribute calls to, when one is known.
	 *
	 * Ingest drops events it cannot attribute, and a token-only embed learns its
	 * channel from `/config` rather than from its own markup, so this may be
	 * absent on the very first visit and present from the second page onward.
	 */
	channelId?: string;
	/** `Authorization` for that POST. */
	headers: Record<string, string>;
	/** Where a widget's HTML is fetched from. */
	resourceEndpoint: string;
};

/**
 * `Partial`, because `token` is required on `EmbedConfig` and a self-hosted
 * page legitimately has none.
 */
export type ResolveInput = Partial<
	Pick<EmbedConfig, "api" | "token" | "webmcp" | "mcpServerUrl" | "channelId">
>;

/**
 * The endpoints, or null when the surface should stay quiet.
 *
 * Derived from the token, the same way every other part of the embed derives
 * its URLs. The page neither knows nor needs the MCP server's address: the
 * token identifies the environment and the server resolves `environment.url`
 * from it per request, which is exactly what `/config` and `/resource` already
 * do. A surface that made the customer paste an origin onto the script tag
 * would be the only one that did.
 *
 * `mcpServerUrl` does not change where the page points. It rides along as a
 * query param the server reads and gates, the way `/resource` already accepts
 * one, so a site overriding its chat's MCP server gets both surfaces on that
 * same server rather than two surfaces on two.
 *
 * There is deliberately no way to point the page at an MCP server directly.
 * Doing so would need CORS on that server for every customer origin and a
 * `frame-ancestors` policy on its views, and it would put a second copy of the
 * tools route in the kit. Nothing needs it while the token can answer the same
 * question.
 *
 * @param channelEnabled the channel's own switch, when the config carrying it
 *   has been seen. `undefined` means unknown, which reads as on.
 * @param resolvedChannelId the channel the server resolved from the token, for
 *   an embed whose markup names none.
 */
export function resolveWebMcpEndpoints(
	config: ResolveInput,
	channelEnabled?: boolean,
	resolvedChannelId?: string,
): WebMcpEndpoints | null {
	// Either switch closes it. The page's is explicit intent from whoever owns
	// the markup; the channel's is the dashboard kill switch, and it arrives
	// through `/config` so it can be thrown without touching the site.
	if (config.webmcp?.enabled === false || channelEnabled === false) {
		return null;
	}

	const api = config.api ?? "";
	if (!config.token) {
		return null;
	}

	const override = config.mcpServerUrl
		? { mcpServerUrl: config.mcpServerUrl }
		: undefined;

	return {
		toolsEndpoint: buildApiUrl(api, "/webmcp", override),
		// Author-set wins over the one the server resolved from the token, the
		// same precedence the chat's own tracking client uses.
		...((config.channelId ?? resolvedChannelId) && {
			channelId: config.channelId ?? resolvedChannelId,
		}),
		// A POST can carry a header, so it does. The resource endpoint below
		// cannot: an iframe navigates by GET, so its token goes in the URL, where
		// it is no more exposed than it already is in `data-token`.
		headers: { Authorization: `Bearer ${config.token}` },
		// Built here rather than through `buildResourceEndpoint`, whose job is to
		// dig the token out of a headers record. This already has the token.
		resourceEndpoint: buildApiUrl(api, "/resource", {
			token: config.token,
			...override,
		}),
	};
}
