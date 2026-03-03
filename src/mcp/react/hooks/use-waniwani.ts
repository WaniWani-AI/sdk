"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { initAutoCapture } from "./auto-capture";
import { WidgetClientContext } from "./use-widget";
import type { WidgetEvent } from "./widget-transport";
import { WidgetTransport } from "./widget-transport";

/**
 * WaniWani widget config injected into tool response `_meta.waniwani`
 * by `withWaniwani` on the server side.
 */
interface WaniwaniMeta {
	token?: string;
	endpoint?: string;
	sessionId?: string;
}

interface WaniwaniConfig {
	token?: string;
	endpoint: string;
	sessionId?: string;
}

/**
 * Options for the useWaniwani hook.
 */
export interface UseWaniwaniOptions {
	/**
	 * JWT widget token for authenticating directly with the WaniWani backend.
	 * If omitted, the hook resolves from tool response metadata
	 * (`toolResponseMetadata.waniwani` or `toolResponseMetadata._meta.waniwani`).
	 */
	token?: string;
	/**
	 * The V2 batch endpoint URL to POST tracking events to.
	 * If omitted, the hook resolves from tool response metadata
	 * (`toolResponseMetadata.waniwani` or `toolResponseMetadata._meta.waniwani`).
	 */
	endpoint?: string;
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
}

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

interface WidgetState {
	widget: WaniwaniWidget;
	cleanup: () => void;
	config: WaniwaniConfig | null;
}

/** Module-level singleton — shared across all hook consumers. */
let state: WidgetState | null = null;
let consumerCount = 0;

function eventId(): string {
	return crypto.randomUUID();
}

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function createNoopState(): WidgetState {
	return { widget: NOOP_WIDGET, cleanup: () => {}, config: null };
}

/**
 * Try to extract WaniWani config from the WidgetProvider context.
 * Returns the config from `toolResponseMetadata.waniwani` (or nested `_meta`) if available.
 */
function resolveConfigFromContext(
	client: { getToolResponseMetadata(): Record<string, unknown> | null } | null,
): WaniwaniConfig | null {
	if (!client) return null;
	const meta = client.getToolResponseMetadata();
	if (!meta) return null;

	const nestedMeta = meta._meta as Record<string, unknown> | undefined;
	const waniwani = (meta.waniwani ?? nestedMeta?.waniwani) as
		| WaniwaniMeta
		| undefined;
	const endpoint = normalizeString(waniwani?.endpoint);
	if (!endpoint) return null;

	return {
		endpoint,
		token: normalizeString(waniwani?.token),
		sessionId: normalizeString(waniwani?.sessionId),
	};
}

function isSameConfig(
	a: WaniwaniConfig | null | undefined,
	b: WaniwaniConfig | null | undefined,
): boolean {
	return (
		a?.endpoint === b?.endpoint &&
		a?.token === b?.token &&
		a?.sessionId === b?.sessionId
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
	config: WaniwaniConfig,
	metadata?: Record<string, unknown>,
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

	const cleanupCapture = initAutoCapture(
		{ sessionId, traceId, metadata },
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
			source: "widget",
			session_id: sessionId,
			trace_id: traceId,
			user_id: userId,
			...extra,
		};
	}

	return {
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
 * React hook for WaniWani widget tracking.
 *
 * Auto-captures DOM events (clicks, link clicks, errors, scrolls, form
 * interactions) and provides manual tracking methods. Returns a singleton
 * instance shared across all consumers.
 *
 * Config resolution order:
 * 1. Explicit `endpoint` (+ optional `token` / `sessionId`) options
 * 2. `toolResponseMetadata.waniwani` from WidgetProvider context
 * 3. No-op if neither is available
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

	// Stabilize config identity — only changes when the three primitives change
	const config = useMemo<WaniwaniConfig | null>(() => {
		if (explicitEndpoint) {
			return {
				endpoint: explicitEndpoint,
				token: explicitToken ?? contextConfig?.token,
				sessionId: explicitSessionId ?? contextConfig?.sessionId,
			};
		}
		return contextConfig;
	}, [explicitEndpoint, explicitToken, explicitSessionId, contextConfig]);

	const [widget, setWidget] = useState<WaniwaniWidget>(NOOP_WIDGET);
	const metadataRef = useRef(options.metadata);
	metadataRef.current = options.metadata;

	// Track consumer mount/unmount for singleton lifecycle
	useEffect(() => {
		consumerCount++;
		return () => {
			consumerCount = Math.max(consumerCount - 1, 0);
			if (consumerCount === 0) {
				state?.cleanup();
				state = null;
			}
		};
	}, []);

	// Create/swap singleton state when config changes.
	// All side effects (timers, DOM listeners) happen here in useEffect,
	// making this safe in Strict Mode and concurrent rendering.
	useEffect(() => {
		if (typeof window === "undefined") return;

		if (!config) {
			if (state?.config) {
				state.cleanup();
				state = createNoopState();
				setWidget(NOOP_WIDGET);
			}
			return;
		}

		if (!isSameConfig(state?.config, config)) {
			state?.cleanup();
			state = createState(config, metadataRef.current);
			setWidget(state.widget);
		}
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
