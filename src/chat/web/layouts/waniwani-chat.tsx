"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";
import type {
	ChatAppearance,
	ChatHandle,
	ShowToolCalls,
	WelcomeConfig,
} from "../@types";
import type { EmbedConfig } from "../embed/config";
import { resolveConfig } from "../embed/config";
import {
	fetchRemoteConfig,
	loadCachedConfig,
	saveCachedConfig,
} from "../embed/remote-config";
import type { Locale, MessageOverrides } from "../i18n";
import { firePageView } from "../lib/page-view";
import { ChatEmbed } from "./chat-embed";

/**
 * Safety net so a stalled `/config` doesn't leave the chat surface blank
 * forever. After this, the chrome fades in with whatever we have
 * (programmatic overrides + defaults) even if the fetch is still pending.
 */
const READINESS_TIMEOUT_MS = 600;

/**
 * Per-page overrides for `WaniwaniChat`. The Waniwani dashboard is the
 * source of truth for the agent's display config; reach for these only
 * when you need a local tweak that doesn't justify cloning an agent.
 *
 * `welcome` (with a `ReactNode` icon) is the one field that cannot live
 * in the dashboard — it has to be passed here when used.
 */
export interface WaniwaniChatOverrides {
	/** Sticky header title. */
	title?: string;
	/**
	 * Force-hide the sticky header. Useful when the host page already provides
	 * its own chrome and a header would be redundant.
	 */
	hideHeader?: boolean;
	/** Greeting shown before the first user message. */
	welcomeMessage?: string;
	/** Rich welcome screen (icon, title, suggestion cards). Takes precedence over `welcomeMessage`. */
	welcome?: WelcomeConfig;
	/** Placeholder for the input field. */
	placeholder?: string;
	/** Initial suggestion chips. */
	suggestions?: string[];
	/** Persist conversations across reloads in IndexedDB. */
	enableThreadHistory?: boolean;
	/**
	 * How tool calls render: `true` (default) shows full request/response
	 * panels, `"titles-only"` shows a compact indicator with just the tool
	 * title, `false` hides tool calls entirely.
	 */
	showToolCalls?: ShowToolCalls;
	/** Enable file attachments in the input. */
	allowAttachments?: boolean;
	/**
	 * Theme preset (`light`/`dark`/`auto`) plus per-property overrides.
	 *
	 * ```tsx
	 * appearance={{ theme: "dark", variables: { primaryColor: "#ff6b6b" } }}
	 * ```
	 */
	appearance?: ChatAppearance;
	/** Chat API URL. Defaults to `https://app.waniwani.ai/api/mcp/chat`. */
	api?: string;
	/** Override the MCP server URL (rarely needed). */
	mcpServerUrl?: string;
	/**
	 * AI transparency notice rendered under the input (EU AI Act compliance).
	 * String overrides the default wording; `false` hides it.
	 */
	disclaimer?: string | false;
	/**
	 * UI language for built-in labels. One of `"en"`, `"fr"`, `"es"`.
	 * When omitted, the widget detects the locale from `<html lang>` /
	 * `navigator.language` and falls back to English.
	 */
	locale?: Locale;
	/**
	 * Per-key overrides on top of the resolved locale catalog. Lets you
	 * tweak individual built-in strings without contributing a full locale.
	 */
	messages?: MessageOverrides;
	/**
	 * Opt out of the top-of-funnel `page.viewed` event fired once on mount.
	 * Defaults to `false` (the event fires). Set `true` on surfaces where a
	 * page view is meaningless and would pollute the customer's funnel — an
	 * already-authenticated app shell, an internal tool, a preview, etc.
	 */
	disablePageView?: boolean;
}

/**
 * Hosted-tier Waniwani chat. The React counterpart to the `<script>` embed.
 *
 * Configure the agent (title, welcome message, suggestions, theme, tool
 * behavior) in the Waniwani dashboard — the component fetches that config
 * on mount. Pass a `wwp_...` token and the `channelId` of the agent, and
 * you're done.
 *
 * Forward a `ChatHandle` ref to drive the chat imperatively
 * (`sendMessage`, `sendMessageAndWait`, `reset`, `focus`, `messages`).
 *
 * Use `overrides` only for per-page tweaks that don't justify a new agent,
 * or for the `welcome` field (which can't be serialized to the dashboard
 * because its `icon` is a `ReactNode`).
 *
 * If you are self-hosting the chat backend, use {@link ChatEmbed} instead.
 *
 * @example
 * ```tsx
 * import { useRef } from "react";
 * import { WaniwaniChat, type ChatHandle } from "@waniwani/sdk/chat";
 *
 * function MyPage() {
 *   const ref = useRef<ChatHandle>(null);
 *
 *   return (
 *     <>
 *       <WaniwaniChat
 *         ref={ref}
 *         token="wwp_..."
 *         channelId="51c3658a-..."
 *       />
 *       <button onClick={() => ref.current?.sendMessage("Show me pricing")}>
 *         Ask about pricing
 *       </button>
 *     </>
 *   );
 * }
 * ```
 */
export interface WaniwaniChatProps {
	/** Public token (`wwp_...`) from the Waniwani dashboard. */
	token: string;
	/** Agent channel ID — routes the conversation to the right agent. */
	channelId?: string;
	/** Additional class names applied to the root element. */
	className?: string;
	/**
	 * Per-page overrides of dashboard-configured display fields. The
	 * dashboard is the source of truth; use this only when a local tweak
	 * doesn't justify a new agent, or to pass `welcome` (whose `icon`
	 * can't be serialized to the dashboard).
	 */
	overrides?: WaniwaniChatOverrides;
}

const DEFAULT_API = "https://app.waniwani.ai/api/mcp/chat";

export const WaniwaniChat = forwardRef<ChatHandle, WaniwaniChatProps>(
	function WaniwaniChat(props, ref) {
		const { token, channelId, className, overrides } = props;

		const programmatic = useMemo<Partial<EmbedConfig>>(
			() => ({
				token,
				channelId,
				api: overrides?.api,
				mcpServerUrl: overrides?.mcpServerUrl,
				title: overrides?.title,
				hideHeader: overrides?.hideHeader,
				welcomeMessage: overrides?.welcomeMessage,
				placeholder: overrides?.placeholder,
				suggestions: overrides?.suggestions,
				enableThreadHistory: overrides?.enableThreadHistory,
				showToolCalls: overrides?.showToolCalls,
				appearance: overrides?.appearance,
				disclaimer: overrides?.disclaimer,
				locale: overrides?.locale,
			}),
			[
				token,
				channelId,
				overrides?.api,
				overrides?.mcpServerUrl,
				overrides?.title,
				overrides?.hideHeader,
				overrides?.welcomeMessage,
				overrides?.placeholder,
				overrides?.suggestions,
				overrides?.enableThreadHistory,
				overrides?.showToolCalls,
				overrides?.appearance,
				overrides?.disclaimer,
				overrides?.locale,
			],
		);

		// Remote config is fetched once per (api, token) pair. Display fields
		// from the dashboard are merged below the programmatic overrides, so
		// any local override always wins.
		//
		// Initial state must match the server (no `window`) — reading
		// `sessionStorage` here would cause a hydration mismatch on the
		// cache-hit path. The cache is consulted in the `useEffect` below,
		// which runs immediately after hydration; a cache hit flips state
		// before the browser paints, so repeat visits still feel instant.
		const resolvedApi = overrides?.api ?? DEFAULT_API;

		const [remote, setRemote] = useState<Partial<EmbedConfig>>({});
		const [ready, setReady] = useState<boolean>(false);

		useEffect(() => {
			if (!token) {
				setReady(true);
				return;
			}
			const cached = loadCachedConfig(resolvedApi, token, channelId);
			if (cached) {
				setRemote(cached);
				setReady(true);
			}
			const controller = new AbortController();
			const safety = setTimeout(() => setReady(true), READINESS_TIMEOUT_MS);
			void fetchRemoteConfig(resolvedApi, token, controller.signal, channelId)
				.then((r) => {
					if (controller.signal.aborted) {
						return;
					}
					if (Object.keys(r).length > 0) {
						saveCachedConfig(resolvedApi, token, channelId, r);
						setRemote(r);
					}
					setReady(true);
				})
				.catch((err) => {
					console.error("[Waniwani] Remote config fetch failed:", err);
					setReady(true);
				})
				.finally(() => clearTimeout(safety));
			return () => {
				controller.abort();
				clearTimeout(safety);
			};
		}, [resolvedApi, token, channelId]);

		// Top-of-funnel signal: fire once when the component mounts (the host
		// page rendered the widget), independent of whether a conversation
		// ever starts. Guarded inside `firePageView` to fire at most once.
		// Skippable via `overrides.disablePageView` on surfaces where a landing
		// event is noise.
		const disablePageView = overrides?.disablePageView;
		useEffect(() => {
			if (!token || disablePageView) {
				return;
			}
			void firePageView({
				api: resolvedApi,
				token,
				channelId,
				mode: "inline",
			});
		}, [resolvedApi, token, channelId, disablePageView]);

		const config = useMemo(
			() => resolveConfig(programmatic, remote, undefined),
			[programmatic, remote],
		);

		const body: Record<string, unknown> = {};
		if (config.mcpServerUrl) {
			body.mcpServerUrl = config.mcpServerUrl;
		}
		if (config.channelId) {
			body.channelId = config.channelId;
		}

		return (
			<ChatEmbed
				ref={ref}
				api={config.api ?? DEFAULT_API}
				headers={{ Authorization: `Bearer ${config.token}` }}
				skipRemoteConfig
				body={Object.keys(body).length > 0 ? body : undefined}
				appearance={config.appearance}
				title={config.title}
				hideHeader={config.hideHeader}
				welcomeMessage={config.welcomeMessage}
				welcome={overrides?.welcome}
				placeholder={config.placeholder}
				suggestions={
					config.suggestions ? { initial: config.suggestions } : undefined
				}
				enableThreadHistory={config.enableThreadHistory}
				showToolCalls={config.showToolCalls}
				disclaimer={config.disclaimer}
				allowAttachments={overrides?.allowAttachments}
				locale={config.locale}
				messages={overrides?.messages}
				className={className}
				initializing={!ready}
			/>
		);
	},
);
