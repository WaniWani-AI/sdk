"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TrackFn } from "../../../tracking/@types";
import { createFrontendClient } from "../../../tracking/frontend";
import { WIDGET_CONFIG_META_KEY } from "../../server/utils";

/**
 * Waniwani widget config injected into tool response `_meta` by
 * `withWaniwani` on the server side, under `waniwani/widget` (canonical)
 * or the legacy bare `waniwani` key.
 */
interface WaniwaniMeta {
	token?: string;
	endpoint?: string;
	sessionId?: string;
	source?: string;
}

interface WaniwaniConfig {
	token?: string;
	endpoint: string;
	sessionId?: string;
	source?: string;
}

interface BaseUseWaniwaniOptions {
	/**
	 * JWT widget token for authenticating directly with the Waniwani backend.
	 * If omitted, the hook resolves from tool response metadata
	 * (`_meta["waniwani/widget"].token`).
	 */
	token?: string;
	/**
	 * Session ID to use for event correlation.
	 * If omitted, the hook resolves from tool response metadata
	 * (`_meta["waniwani/widget"].sessionId`), then falls back to a random UUID
	 * so the widget's own events still group together.
	 */
	sessionId?: string;
	/**
	 * Additional fields merged into every tracked event's envelope metadata.
	 */
	metadata?: Record<string, unknown>;
	/**
	 * Tool response metadata from a host you already have a connection to
	 * (e.g. an MCP-Apps / skybridge host exposing `useToolInfo().responseMetadata`).
	 *
	 * The hook resolves its config (`endpoint`, `source`, `token`, `sessionId`)
	 * from `_meta["waniwani/widget"]` in this object. The hook never opens a host
	 * connection of its own — your app owns the host bridge and passes the
	 * metadata in. Ignored when an explicit `endpoint` is passed.
	 */
	toolResponseMetadata?: Record<string, unknown> | null;
}

/**
 * Metadata-driven options: `endpoint` and `source` are resolved from the
 * `toolResponseMetadata` you pass (`_meta["waniwani/widget"]`). `source` may
 * be overridden explicitly.
 */
interface ContextDrivenOptions extends BaseUseWaniwaniOptions {
	endpoint?: undefined;
	/** Optional override; otherwise resolved from `toolResponseMetadata`. */
	source?: string;
}

/**
 * Explicit-endpoint options: when `endpoint` is passed directly, `source`
 * is required so events never get stamped with a placeholder.
 */
interface ExplicitEndpointOptions extends BaseUseWaniwaniOptions {
	/** V2 batch endpoint URL to POST tracking events to. */
	endpoint: string;
	/** Required when `endpoint` is explicit (e.g. `"chatgpt"`, `"chatbar"`). */
	source: string;
}

/**
 * Options for the useWaniwani hook. Either rely on the widget host
 * (omit `endpoint`) or pass `endpoint` + `source` explicitly.
 */
export type UseWaniwaniOptions = ContextDrivenOptions | ExplicitEndpointOptions;

/**
 * The tracking API returned by `useWaniwani()`.
 */
export interface WaniwaniWidget {
	/**
	 * The session ID stamped on every event this widget emits, so hosts can
	 * correlate widget activity with server-side tracking.
	 *
	 * Resolved from (1) the explicit `sessionId` option, (2) the widget config
	 * injected by `withWaniwani` (`_meta["waniwani/widget"].sessionId`), else a
	 * random UUID generated on mount. `undefined` until the widget initializes
	 * and when no config resolves (no-op widget).
	 */
	readonly sessionId?: string;
	/**
	 * Track a typed event. The exact same surface as the server client:
	 * `track({ event: "quote.succeeded", properties })`,
	 * `track.priceShown({ amount, currency })`, `track.converted({ ... })`.
	 * Identity (session, trace, user) is stamped automatically.
	 */
	track: TrackFn;
	/** Tie all subsequent widget events to this user (emits `user.identified`). */
	identify(
		userId: string,
		traits?: Record<string, unknown>,
	): Promise<{ eventId: string }>;
	/** Flush buffered events immediately instead of waiting for the timer. */
	flush(): Promise<void>;
}

const NOOP_EMIT = async (): Promise<{ eventId: string }> => ({ eventId: "" });

function createNoopTrack(): TrackFn {
	return Object.assign(NOOP_EMIT, {
		priceShown: NOOP_EMIT,
		pricesCompared: NOOP_EMIT,
		optionSelected: NOOP_EMIT,
		leadQualified: NOOP_EMIT,
		converted: NOOP_EMIT,
	}) as TrackFn;
}

/** No-op widget that silently discards all calls. */
const NOOP_WIDGET: WaniwaniWidget = {
	sessionId: undefined,
	track: createNoopTrack(),
	identify: NOOP_EMIT,
	flush: async () => {},
};

interface ResolvedConfig extends WaniwaniConfig {
	source: string;
}

interface WidgetState {
	widget: WaniwaniWidget;
	cleanup: () => void;
	config: ResolvedConfig | null;
}

/** Module-level singleton — shared across all hook consumers. */
let state: WidgetState | null = null;
let consumerCount = 0;

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Extract the Waniwani widget config from a tool response metadata object.
 * Reads the `waniwani/widget` key, on both the metadata root and its nested
 * `_meta`. Returns `null` when no endpoint can be resolved.
 *
 * @internal exported for unit testing.
 */
export function extractConfigFromMetadata(
	meta: Record<string, unknown> | null,
): WaniwaniConfig | null {
	if (!meta) {
		return null;
	}

	const nestedMeta = meta._meta as Record<string, unknown> | undefined;
	const waniwani = (meta[WIDGET_CONFIG_META_KEY] ??
		nestedMeta?.[WIDGET_CONFIG_META_KEY]) as WaniwaniMeta | undefined;
	const endpoint = normalizeString(waniwani?.endpoint);
	if (!endpoint) {
		return null;
	}

	return {
		endpoint,
		token: normalizeString(waniwani?.token),
		sessionId: normalizeString(waniwani?.sessionId),
		source: normalizeString(waniwani?.source),
	};
}

function isSameConfig(
	a: WaniwaniConfig | null | undefined,
	b: WaniwaniConfig | null | undefined,
): boolean {
	return (
		a?.endpoint === b?.endpoint &&
		a?.token === b?.token &&
		a?.sessionId === b?.sessionId &&
		a?.source === b?.source
	);
}

function createState(
	config: ResolvedConfig,
	metadata?: Record<string, unknown>,
): WidgetState {
	const sessionId = config.sessionId ?? crypto.randomUUID();
	const traceId = crypto.randomUUID();

	const client = createFrontendClient({
		endpoint: config.endpoint,
		token: config.token,
		source: config.source,
		identity: () => ({ sessionId, traceId }),
		metadata,
	});

	// The top-of-widget-funnel signal: emitted once per mount with resolved
	// config, so "widget shown" exists even when nothing is tracked manually.
	void client.track({ event: "widget_render" });

	return {
		config,
		widget: {
			sessionId,
			track: client.track,
			identify: (userId, traits) => client.identify(userId, traits),
			flush: () => client.flush(),
		},
		cleanup: () => {
			void client.shutdown();
		},
	};
}

/**
 * React hook for tracking from inside an MCP-app widget. Returns the same
 * `track` surface as the server client, with session identity stamped
 * automatically from the config `withWaniwani` injects into tool responses.
 *
 * The hook never opens a host connection of its own. Supply config one of
 * two ways:
 * 1. Explicit `endpoint` + `source` (plus optional `token` / `sessionId`)
 * 2. `toolResponseMetadata` — the `_meta` object your host already exposes
 *    (e.g. skybridge's `useToolInfo().responseMetadata`); the hook reads
 *    `_meta["waniwani/widget"]` from it
 *
 * No-op when neither resolves an `endpoint` and a `source`.
 *
 * @example
 * ```tsx
 * function MyWidget() {
 *   const { responseMetadata } = useToolInfo();
 *   const wani = useWaniwani({ toolResponseMetadata: responseMetadata });
 *   // wani.sessionId correlates with server-side tracking
 *   return (
 *     <button
 *       onClick={() =>
 *         wani.track.optionSelected({ id: "pro", amount: 49, currency: "EUR" })
 *       }
 *     >
 *       Choose Pro
 *     </button>
 *   );
 * }
 * ```
 */
export function useWaniwani(options: UseWaniwaniOptions = {}): WaniwaniWidget {
	const explicitEndpoint = normalizeString(options.endpoint);
	const explicitToken = normalizeString(options.token);
	const explicitSessionId = normalizeString(options.sessionId);
	const explicitSource = normalizeString(options.source);

	// Config from the host metadata passed in. Ignored in explicit-endpoint
	// mode, where every field comes from the options directly.
	const suppliedConfig = explicitEndpoint
		? null
		: extractConfigFromMetadata(options.toolResponseMetadata ?? null);
	const ctxEndpoint = suppliedConfig?.endpoint;
	const ctxToken = suppliedConfig?.token;
	const ctxSessionId = suppliedConfig?.sessionId;
	const ctxSource = suppliedConfig?.source;

	// Stabilize config identity — only changes when the resolved primitives do,
	// so a new `toolResponseMetadata` object of identical content is a no-op.
	const config = useMemo<ResolvedConfig | null>(() => {
		const source = explicitSource ?? ctxSource;
		if (!source) {
			return null;
		}
		if (explicitEndpoint) {
			return {
				endpoint: explicitEndpoint,
				token: explicitToken,
				sessionId: explicitSessionId,
				source,
			};
		}
		if (!ctxEndpoint) {
			return null;
		}
		return {
			endpoint: ctxEndpoint,
			token: explicitToken ?? ctxToken,
			sessionId: explicitSessionId ?? ctxSessionId,
			source,
		};
	}, [
		explicitEndpoint,
		explicitToken,
		explicitSessionId,
		explicitSource,
		ctxEndpoint,
		ctxToken,
		ctxSessionId,
		ctxSource,
	]);

	const [widget, setWidget] = useState<WaniwaniWidget>(NOOP_WIDGET);
	// Ref, not a dependency: metadata is captured when the singleton is
	// created and must not force a transport restart on every render.
	const metadataRef = useRef(options.metadata);
	metadataRef.current = options.metadata;

	// Create/swap singleton state when config changes.
	// All side effects (timers, network) happen here in useEffect, making
	// this safe in Strict Mode and concurrent rendering.
	//
	// Only consumers with a resolved config hold a stake in the singleton.
	// A consumer with `config === null` becomes a local no-op without
	// touching the singleton (other consumers may still be driving it),
	// and the singleton is torn down only when the last stake is released.
	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		if (!config) {
			setWidget(NOOP_WIDGET);
			return;
		}

		let current = state;
		if (!current || !isSameConfig(current.config, config)) {
			current?.cleanup();
			current = createState(config, metadataRef.current);
			state = current;
		}
		setWidget(current.widget);
		consumerCount++;

		return () => {
			consumerCount = Math.max(consumerCount - 1, 0);
			if (consumerCount === 0) {
				state?.cleanup();
				state = null;
			}
		};
	}, [config]);

	return widget;
}

/**
 * Reset the singleton (for testing only).
 * @internal
 */
export function _resetWidgetInstance(): void {
	state?.cleanup();
	state = null;
}
