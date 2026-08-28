// ============================================================================
// InlineChat — wraps ChatEmbed for the inline mount path.
//
// Owns the remote-config fetch hook so the layered config merge happens
// inside React (post-mount). Plain rendering in embed.ts would leave no
// useEffect to drive the fetch.
// ============================================================================

import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
} from "react";
import type { ChatHandle } from "../@types";
import { useSuggestionIngest } from "../hooks/use-suggestion-ingest";
import { ChatEmbed } from "../layouts/chat-embed";
import type { EmbedConfig } from "./config";
import { useRemoteEmbedConfig } from "./remote-config";
import { useVisibilityGate } from "./use-pathname";
import { useSuggestions } from "./use-suggestions";
import { createWidgetEventEmitter } from "./widget-events";
import { WidgetEventsProvider } from "./widget-events-context";

export interface InlineChatProps {
	config: EmbedConfig;
	programmatic?: Partial<EmbedConfig>;
	/** Pre-parsed `data-*` snapshot. */
	scriptConfig?: Partial<EmbedConfig>;
	onReady?: () => void;
	/**
	 * Called whenever per-URL `visibility` gating flips. `embed.ts` uses it to
	 * collapse the `[data-waniwani-embed]` container (which it owns, outside
	 * React) so a gated page shows no empty card. The chat stays mounted while
	 * hidden, so conversation state survives an SPA route change away and back.
	 */
	onVisibilityChange?: (visible: boolean) => void;
}

export interface InlineChatHandle {
	chat: ChatHandle | null;
}

export const InlineChat = forwardRef<InlineChatHandle, InlineChatProps>(
	function InlineChat(
		{
			config: initialConfig,
			programmatic,
			scriptConfig,
			onReady,
			onVisibilityChange,
		},
		ref,
	) {
		const { config, ready } = useRemoteEmbedConfig(
			initialConfig,
			programmatic,
			scriptConfig,
		);

		const chatRef = useRef<ChatHandle>(null);

		// One emitter per mount. The session id getter reads through the chat
		// handle so events pick up the session id as soon as it exists.
		const widgetEvents = useMemo(
			() =>
				createWidgetEventEmitter({
					mode: "inline",
					getSessionId: () => chatRef.current?.sessionId,
				}),
			[],
		);
		const onEvent = config.onEvent;
		useEffect(() => {
			if (!onEvent) {
				return;
			}
			return widgetEvents.subscribe(onEvent);
		}, [onEvent, widgetEvents]);

		// `chat.ready` once the remote config has resolved.
		const readyEmittedRef = useRef(false);
		useEffect(() => {
			if (ready && !readyEmittedRef.current) {
				readyEmittedRef.current = true;
				widgetEvents.emit({ name: "chat.ready" });
			}
		}, [ready, widgetEvents]);

		// biome-ignore lint/correctness/useExhaustiveDependencies: fire once on mount
		useEffect(() => {
			onReady?.();
		}, []);

		// Per-URL gating. Report the decision up to `embed.ts`, which collapses
		// the container so a gated page shows no empty card. Re-runs on SPA route
		// changes (via `usePathname` inside the hook).
		const visible = useVisibilityGate(config.visibility, ready);
		useEffect(() => {
			onVisibilityChange?.(visible);
		}, [visible, onVisibilityChange]);

		useImperativeHandle(
			ref,
			() => ({
				get chat() {
					return chatRef.current;
				},
			}),
			[],
		);

		// The page and channel rungs for this URL; ids ride along for click
		// attribution. Memoized inside the hook — the pill row keys an effect
		// on this object's identity.
		const suggestions = useSuggestions(config);

		// Record every suggestion click and every rendered pill set server-side,
		// attributed to the authored prompts involved.
		useSuggestionIngest({
			widgetEvents,
			api: config.api,
			token: config.token,
			channelId: config.channelId,
			source: config.source,
			mode: "inline",
			pagePrompts: suggestions.page,
			getSessionId: () => chatRef.current?.sessionId,
		});

		// `mode` tags every chat request with the embed surface so server-logged
		// chat events carry it in `properties.mode`, matching `page.viewed`.
		const body: Record<string, unknown> = { mode: "inline" };
		if (config.mcpServerUrl) {
			body.mcpServerUrl = config.mcpServerUrl;
		}
		if (config.channelId) {
			body.channelId = config.channelId;
		}

		return (
			<WidgetEventsProvider value={widgetEvents}>
				<ChatEmbed
					ref={chatRef}
					api={config.api ?? ""}
					headers={{ Authorization: `Bearer ${config.token}` }}
					skipRemoteConfig
					body={body}
					appearance={config.appearance}
					title={config.title}
					hideHeader={config.hideHeader}
					welcomeMessage={config.welcomeMessage}
					placeholder={config.placeholder}
					suggestions={suggestions}
					enableThreadHistory={config.enableThreadHistory}
					documentUpload={config.documentUpload}
					showToolCalls={config.showToolCalls}
					locale={config.locale}
					initializing={!ready}
				/>
			</WidgetEventsProvider>
		);
	},
);
