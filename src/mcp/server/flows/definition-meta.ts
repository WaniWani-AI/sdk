import type { FlowGraph } from "./@types";

/**
 * What a flow's tool definition carries for the server alone.
 *
 * A tool definition's `_meta` goes to every client in `tools/list`. The flow
 * graph and the list of redacted fields are read only by `withWaniwani`, on
 * the server, so each sits in a wrapper whose `toJSON` returns `undefined`.
 * `JSON.stringify` leaves such a property out, so every transport that
 * serializes (stdio, Streamable HTTP) drops it, while an object spread (the
 * kit and skybridge both copy `_meta` that way) keeps it.
 */
class ServerOnly<T> {
	constructor(readonly value: T) {}

	toJSON(): undefined {
		return undefined;
	}
}

export const FLOW_GRAPH_META_KEY = "waniwani/flowGraph";
export const REDACTED_FIELDS_META_KEY = "waniwani/redactedStateUpdateFields";

/**
 * The plain key some apps set by hand to carry a flow's graph, and the one
 * flows compiled with 0.23 and earlier write. `withWaniwani` reads it and moves
 * it under {@link FLOW_GRAPH_META_KEY}, so it stays out of `tools/list`.
 *
 * @deprecated A compiled flow's config carries its graph. Delete any
 * hand-set `_meta._flowGraph`; the key stops being read in 0.25.0.
 */
export const LEGACY_FLOW_GRAPH_META_KEY = "_flowGraph";

/** Wrap a `_meta` value so the server can read it and `tools/list` never sends it. */
export function serverOnly<T>(value: T): ServerOnly<T> {
	return new ServerOnly(value);
}

/**
 * The value behind a server-only entry, or the entry itself when it is a plain
 * value. Matched by shape, so a wrapper made by another copy of the SDK in the
 * same process reads too.
 */
function unwrap(entry: unknown): unknown {
	if (
		entry !== null &&
		typeof entry === "object" &&
		"value" in entry &&
		typeof (entry as { toJSON?: unknown }).toJSON === "function"
	) {
		return (entry as { value: unknown }).value;
	}
	return entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFlowGraph(value: unknown): value is FlowGraph {
	return isRecord(value) && Array.isArray(value.nodes);
}

/** The flow graph a tool definition's `_meta` carries, if any. */
export function readFlowGraph(meta: unknown): FlowGraph | undefined {
	if (!isRecord(meta)) {
		return undefined;
	}
	const graph =
		unwrap(meta[FLOW_GRAPH_META_KEY]) ?? meta[LEGACY_FLOW_GRAPH_META_KEY];
	return isFlowGraph(graph) ? graph : undefined;
}

/** The redacted state fields a tool definition's `_meta` carries. */
export function readRedactedFields(meta: unknown): string[] {
	if (!isRecord(meta)) {
		return [];
	}
	const fields = unwrap(meta[REDACTED_FIELDS_META_KEY]);
	return Array.isArray(fields)
		? fields.filter((f): f is string => typeof f === "string")
		: [];
}

/**
 * The same `_meta` with a hand-set `_flowGraph` moved under
 * {@link FLOW_GRAPH_META_KEY}, or `meta` itself when there is nothing to move.
 */
export function hideLegacyFlowGraph(
	meta: Record<string, unknown>,
): Record<string, unknown> {
	const { [LEGACY_FLOW_GRAPH_META_KEY]: legacy, ...rest } = meta;
	if (legacy === undefined) {
		return meta;
	}
	return {
		...rest,
		[FLOW_GRAPH_META_KEY]: rest[FLOW_GRAPH_META_KEY] ?? serverOnly(legacy),
	};
}
