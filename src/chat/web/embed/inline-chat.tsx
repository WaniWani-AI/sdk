// ============================================================================
// InlineChat — wraps ChatEmbed for the inline mount path.
//
// Owns the remote-config fetch hook so the layered config merge happens
// inside React (post-mount). Plain rendering in embed.ts would leave no
// useEffect to drive the fetch.
// ============================================================================

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ChatHandle } from "../@types";
import { ChatEmbed } from "../layouts/chat-embed";
import type { EmbedConfig } from "./config";
import { buildChatTheme } from "./config";
import { useRemoteEmbedConfig } from "./remote-config";

export interface InlineChatProps {
	config: EmbedConfig;
	programmatic?: Partial<EmbedConfig>;
	/** Pre-parsed `data-*` snapshot. */
	scriptConfig?: Partial<EmbedConfig>;
	onReady?: () => void;
}

export interface InlineChatHandle {
	chat: ChatHandle | null;
}

export const InlineChat = forwardRef<InlineChatHandle, InlineChatProps>(
	function InlineChat(
		{ config: initialConfig, programmatic, scriptConfig, onReady },
		ref,
	) {
		const config = useRemoteEmbedConfig(
			initialConfig,
			programmatic,
			scriptConfig,
		);

		const chatRef = useRef<ChatHandle>(null);

		// biome-ignore lint/correctness/useExhaustiveDependencies: fire once on mount
		useEffect(() => {
			onReady?.();
		}, []);

		useImperativeHandle(
			ref,
			() => ({
				get chat() {
					return chatRef.current;
				},
			}),
			[],
		);

		const theme = buildChatTheme(config);

		const body: Record<string, unknown> = {};
		if (config.mcpServerUrl) {
			body.mcpServerUrl = config.mcpServerUrl;
		}
		if (config.channelId) {
			body.channelId = config.channelId;
		}

		return (
			<ChatEmbed
				ref={chatRef}
				api={config.api ?? ""}
				headers={{ Authorization: `Bearer ${config.token}` }}
				skipRemoteConfig
				body={Object.keys(body).length > 0 ? body : undefined}
				theme={theme}
				title={config.title}
				welcomeMessage={config.welcomeMessage}
				placeholder={config.placeholder}
				suggestions={
					config.suggestions ? { initial: config.suggestions } : undefined
				}
				enableThreadHistory={config.enableThreadHistory}
				showToolCalls={config.showToolCalls}
			/>
		);
	},
);
