/**
 * Reading a widget's view binding off MCP `_meta`.
 *
 * Kept in `shared/` because three surfaces ask the same question and none of
 * them should own the answer: the chat resolves a tool part's view before
 * rendering it, the WebMCP endpoint resolves a display tool's view before
 * handing it to the page, and both have to agree or a widget renders in one
 * place and not the other.
 *
 * The three spellings below are not alternatives to choose between. They are
 * what three host generations actually emit, and a server built on any of them
 * is a server we have to render.
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function uiObject(
	meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	return asRecord(meta?.ui);
}

/** Anything carrying MCP `_meta`: a tool definition, a tool result, a resource. */
export type MetaCarrier = {
	_meta?: Record<string, unknown>;
};

/**
 * The view a `_meta` binds to, checking all three shapes in priority order:
 *
 * 1. `_meta.ui.resourceUri` — MCP Apps, nested (skybridge, ext-apps)
 * 2. `_meta["ui/resourceUri"]` — MCP Apps, flat (earlier drafts, still in the wild)
 * 3. `_meta["openai/outputTemplate"]` — OpenAI Apps SDK
 *
 * Order is priority, not preference: a server emitting more than one emits them
 * as aliases of the same view, and the nested form is the one the current spec
 * defines.
 */
export function resourceUriFromMeta(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	if (!meta) {
		return undefined;
	}
	const nested = uiObject(meta)?.resourceUri;
	if (typeof nested === "string" && nested.length > 0) {
		return nested;
	}
	const flat = meta["ui/resourceUri"];
	if (typeof flat === "string" && flat.length > 0) {
		return flat;
	}
	const openai = meta["openai/outputTemplate"];
	if (typeof openai === "string" && openai.length > 0) {
		return openai;
	}
	return undefined;
}

/** Whether the host should size the frame from the view's content. */
export function autoHeightFromMeta(
	meta: Record<string, unknown> | undefined,
): boolean {
	return uiObject(meta)?.autoHeight === true;
}

/** The `_meta` on a tool result, if it has one. */
export function metaOf(value: unknown): Record<string, unknown> | undefined {
	return asRecord(asRecord(value)?._meta);
}

/**
 * The view a tool renders, read from its definition.
 *
 * Definition rather than result on purpose. A spec-compliant server binds the
 * view on the tool, so a result carries the binding only by accident, and
 * reading the result first means a tool whose view is declared correctly looks
 * like a tool with no view at all.
 */
export function viewUriFor(tool: MetaCarrier | undefined): string | undefined {
	return resourceUriFromMeta(tool?._meta);
}

/**
 * Whether a tool exists to render something rather than to be reasoned about.
 *
 * The distinction matters wherever a tool list crosses a boundary. A display
 * tool advertised to a browsing agent is a tool it will try to call to make a
 * widget appear, on a surface with no widget host in it, which burns a turn and
 * strands the conversation on a render nobody performs.
 */
export function isDisplayTool(tool: MetaCarrier | undefined): boolean {
	return viewUriFor(tool) !== undefined;
}
