// ============================================================================
// InlineChat — wraps ChatCard for the `data-container` inline mount path.
//
// Exists so remote config fetching can happen inside React, matching the
// floating mode. Plain rendering of ChatCard in embed.ts would leave no
// useEffect hook to own the fetch.
// ============================================================================

import { useEffect } from "react";
import { ChatCard } from "../layouts/chat-card";
import type { EmbedConfig } from "./config";
import { buildChatTheme } from "./floating-chat";
import { useRemoteEmbedConfig } from "./remote-config";

export interface InlineChatProps {
	config: EmbedConfig;
	programmatic?: Partial<EmbedConfig>;
	onReady?: () => void;
}

export function InlineChat({
	config: initialConfig,
	programmatic,
	onReady,
}: InlineChatProps) {
	const config = useRemoteEmbedConfig(initialConfig, programmatic);

	// biome-ignore lint/correctness/useExhaustiveDependencies: fire once on mount
	useEffect(() => {
		onReady?.();
	}, []);

	return (
		<ChatCard
			api={config.api}
			headers={{ Authorization: `Bearer ${config.token}` }}
			skipRemoteConfig
			body={
				config.mcpServerUrl ? { mcpServerUrl: config.mcpServerUrl } : undefined
			}
			theme={buildChatTheme(config)}
			title={config.title ?? "Assistant"}
			welcomeMessage={config.welcomeMessage}
			placeholder={config.placeholder}
			suggestions={
				config.suggestions ? { initial: config.suggestions } : undefined
			}
			width="100%"
			height="100%"
		/>
	);
}
