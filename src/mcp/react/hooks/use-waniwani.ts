"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { WidgetClientContext } from "../context";
import { type AutoCaptureToggles, initAutoCapture } from "./auto-capture";
import type { WidgetEvent } from "./widget-transport";
import { WidgetTransport } from "./widget-transport";

/**
 * Waniwani widget config injected into tool response `_meta.waniwani`
 * by `withWaniwani` on the server side.
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
	 * (`toolResponseMetadata.waniwani` or `toolResponseMetadata._meta.waniwani`).
	 */
	token?: string;
	/**
	 * Session ID to use for event correlation.
	 * If omitted, the hook resolves from tool response metadata
	 * (`toolResponseMetadata.waniwani.sessionId`), then falls back to a random UUID.
	 */
	sessionId?: string;
	/**
	 * Additional metadata to include with every tracked event.
	 */
	metadata?: Record<string, unknown>;
	/**
	 * Opt-in toggles for noisy auto-capture event types. Default: all off.
	 * Always-on capture: widget_render, widget_error, widget_link_click,
	 * `data-ww-step` / `data-ww-conversion` clicks.
	 *
	 * @example
	 * useWaniwani({ capture: { click: true, scroll: true } });
	 */
	capture?: AutoCaptureToggles;
}

/**
 * Context-driven options: `endpoint` and `source` are resolved from
 * `WidgetProvider`'s `toolResponseMetadata.waniwani`. `source` may be
 * overridden explicitly.
 */
interface ContextDrivenOptions extends BaseUseWaniwaniOptions {
	endpoint?: undefined;
	/** Optional override; otherwise resolved from context. */
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
 * Options for the useWaniwani hook. Either rely on `WidgetProvider`
 * context (omit `endpoint`) or pass `endpoint` + `source` explicitly.
 */
export type UseWaniwaniOptions = ContextDrivenOptions | ExplicitEndpointOptions;

/**
 * The tracking API returned by `useWaniwani()`.
 */
export interface WaniwaniWidget {
	/** Tie all subsequent widget events to this user. */
	identify(userId: string, traits?: Record<string, unknown>): void;
	/** Record a funnel step. Auto-incrementing sequence per session. */
	step(name: string, meta?: Record<string, unknown>): void;
	/** Record a generic custom event. */
	track(event: string, properties?: Record<string, unknown>): void;
	/** Record a conversion event. */
	conversion(name: string, data?: Record<string, unknown>): void;
}

/** No-op widget that silently discards all calls. */
const NOOP_WIDGET: WaniwaniWidget = {
	identify() {},
	step() {},
	track() {},
	conversion() {},
};

interface ResolvedConfig extends WaniwaniConfig {
	source: string;
}

interface WidgetState {
	widget: WaniwaniWidget;
	cleanup: () => void;
	config: ResolvedConfig | null;
	captureKey: string;
}

/** Module-level singleton — shared across all hook consumers. */
let state: WidgetState | null = null;
let consumerCount = 0;

function eventId(): string {
	return crypto.randomUUID();
}

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function captureKeyOf(capture?: AutoCaptureToggles): string {
	if (!capture) {
		return "";
	}
	return [
		capture.click ? "1" : "0",
		capture.scroll ? "1" : "0",
		capture.formField ? "1" : "0",
		capture.formSubmit ? "1" : "0",
	].join("");
}

/**
 * Try to extract Waniwani config from the WidgetProvider context.
 * Returns the config from `toolResponseMetadata.waniwani` (or nested `_meta`) if available.
 */
function resolveConfigFromContext(
	client: { getToolResponseMetadata(): Record<string, unknown> | null } | null,
): WaniwaniConfig | null {
	if (!client) {
		return null;
	}
	const meta = client.getToolResponseMetadata();
	if (!meta) {
		return null;
	}

	const nestedMeta = meta._meta as Record<string, unknown> | undefined;
	const waniwani = (meta.waniwani ?? nestedMeta?.waniwani) as
		| WaniwaniMeta
		| undefined;
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

function useContextConfig(
	client: {
		getToolResponseMetadata(): Record<string, unknown> | null;
		onToolResponseMetadataChange(
			callback: (metadata: Record<string, unknown> | null) => void,
		): () => void;
	} | null,
): WaniwaniConfig | null {
	const [config, setConfig] = useState<WaniwaniConfig | null>(() =>
		resolveConfigFromContext(client),
	);

	useEffect(() => {
		if (!client) {
			setConfig((prev) => (prev === null ? prev : null));
			return;
		}

		const sync = () => {
			const next = resolveConfigFromContext(client);
			setConfig((prev) => (isSameConfig(prev, next) ? prev : next));
		};

		sync();
		return client.onToolResponseMetadataChange(() => {
			sync();
		});
	}, [client]);

	return config;
}

function createState(
	config: ResolvedConfig,
	metadata?: Record<string, unknown>,
	capture?: AutoCaptureToggles,
): WidgetState {
	const sessionId = config.sessionId ?? crypto.randomUUID();
	const traceId = crypto.randomUUID();

	const transport = new WidgetTransport({
		endpoint: config.endpoint,
		token: config.token,
		metadata,
	});
	let userId: string | undefined;
	let stepSequence = 0;

	const enqueue = (events: WidgetEvent[]) => {
		transport.send(events);
	};

	const source = config.source;

	const cleanupCapture = initAutoCapture(
		{ sessionId, traceId, metadata, source, capture },
		enqueue,
	);

	function baseFields(
		eventType: string,
		extra?: Record<string, unknown>,
	): WidgetEvent {
		return {
			event_id: eventId(),
			event_type: eventType,
			timestamp: new Date().toISOString(),
			source,
			session_id: sessionId,
			trace_id: traceId,
			user_id: userId,
			...extra,
		};
	}

	return {
		captureKey: captureKeyOf(capture),
		widget: {
			identify(id: string, traits?: Record<string, unknown>) {
				userId = id;
				enqueue([
					baseFields("identify", {
						user_id: id,
						user_traits: traits,
					}),
				]);
			},

			step(name: string, meta?: Record<string, unknown>) {
				stepSequence++;
				enqueue([
					baseFields("step", {
						event_name: name,
						step_sequence: stepSequence,
						metadata: meta,
					}),
				]);
			},

			track(event: string, properties?: Record<string, unknown>) {
				enqueue([
					baseFields("track", {
						event_name: event,
						metadata: properties,
					}),
				]);
			},

			conversion(name: string, data?: Record<string, unknown>) {
				enqueue([
					baseFields("conversion", {
						event_name: name,
						metadata: data,
					}),
				]);
			},
		},
		cleanup: () => {
			cleanupCapture();
			transport.stop();
		},
		config,
	};
}

/**
 * React hook for Waniwani widget tracking.
 *
 * Auto-captures DOM events (clicks, link clicks, errors, scrolls, form
 * interactions) and provides manual tracking methods. Returns a singleton
 * instance shared across all consumers.
 *
 * Config resolution order:
 * 1. Explicit `endpoint` / `token` / `sessionId` / `source` options
 * 2. `toolResponseMetadata.waniwani` from WidgetProvider context
 * 3. No-op if `endpoint` cannot be resolved or `source` is unknown
 *
 * @example
 * ```tsx
 * function MyWidget() {
 *   const wani = useWaniwani();
 *   // Auto-captures clicks, links, errors, scrolls, forms
 *   // Optionally call wani.track("custom_event") for manual events
 *   return <a href="https://example.com">Visit</a>;
 * }
 * ```
 */
export function useWaniwani(options: UseWaniwaniOptions = {}): WaniwaniWidget {
	// Read WidgetProvider context if available (won't throw if outside provider)
	const widgetClient = useContext(WidgetClientContext);
	const contextConfig = useContextConfig(widgetClient);
	const explicitEndpoint = normalizeString(options.endpoint);
	const explicitToken = normalizeString(options.token);
	const explicitSessionId = normalizeString(options.sessionId);
	const explicitSource = normalizeString(options.source);

	// Stabilize config identity — only changes when the primitives change
	const config = useMemo<ResolvedConfig | null>(() => {
		const source = explicitSource ?? contextConfig?.source;
		if (!source) {
			return null;
		}
		if (explicitEndpoint) {
			return {
				endpoint: explicitEndpoint,
				token: explicitToken ?? contextConfig?.token,
				sessionId: explicitSessionId ?? contextConfig?.sessionId,
				source,
			};
		}
		if (!contextConfig) {
			return null;
		}
		return { ...contextConfig, source };
	}, [
		explicitEndpoint,
		explicitToken,
		explicitSessionId,
		explicitSource,
		contextConfig,
	]);

	const [widget, setWidget] = useState<WaniwaniWidget>(NOOP_WIDGET);
	const metadataRef = useRef(options.metadata);
	metadataRef.current = options.metadata;
	const captureRef = useRef(options.capture);
	captureRef.current = options.capture;
	const captureKey = captureKeyOf(options.capture);

	// Create/swap singleton state when config changes.
	// All side effects (timers, DOM listeners) happen here in useEffect,
	// making this safe in Strict Mode and concurrent rendering.
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

		if (
			!isSameConfig(state?.config, config) ||
			state?.captureKey !== captureKey
		) {
			state?.cleanup();
			state = createState(config, metadataRef.current, captureRef.current);
		}
		setWidget(state.widget);
		consumerCount++;

		return () => {
			consumerCount = Math.max(consumerCount - 1, 0);
			if (consumerCount === 0) {
				state?.cleanup();
				state = null;
			}
		};
	}, [config, captureKey]);

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
