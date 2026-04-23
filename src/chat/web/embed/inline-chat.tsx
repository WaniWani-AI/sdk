// ============================================================================
// InlineChat — wraps ChatCard/ChatBar/ChatEmbed for the inline mount path.
//
// Exists so remote config fetching can happen inside React, matching the
// floating mode. Plain rendering of the layout in embed.ts would leave no
// useEffect hook to own the fetch.
// ============================================================================

import { useEffect } from "react";
import { ChatBar } from "../layouts/chat-bar";
import { ChatCard } from "../layouts/chat-card";
import { ChatEmbed } from "../layouts/chat-embed";
import type { EmbedConfig } from "./config";
import { buildChatTheme } from "./config";
import { useRemoteEmbedConfig } from "./remote-config";

export interface InlineChatProps {
	config: EmbedConfig;
	programmatic?: Partial<EmbedConfig>;
	/** Pre-parsed `data-*` snapshot — see FloatingChatProps.scriptConfig. */
	scriptConfig?: Partial<EmbedConfig>;
	onReady?: () => void;
}

export function InlineChat({
	config: initialConfig,
	programmatic,
	scriptConfig,
	onReady,
}: InlineChatProps) {
	const config = useRemoteEmbedConfig(
		initialConfig,
		programmatic,
		scriptConfig,
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: fire once on mount
	useEffect(() => {
		onReady?.();
	}, []);

	const shared = {
		api: config.api,
		headers: { Authorization: `Bearer ${config.token}` },
		skipRemoteConfig: true as const,
		body: config.mcpServerUrl
			? { mcpServerUrl: config.mcpServerUrl }
			: undefined,
		theme: buildChatTheme(config),
		welcomeMessage: config.welcomeMessage,
		placeholder: config.placeholder,
		suggestions: config.suggestions
			? { initial: config.suggestions }
			: undefined,
	};

	const layout = config.layout ?? "card";

	if (layout === "bar") {
		return <ChatBar {...shared} title={config.title ?? "Assistant"} />;
	}

	if (layout === "embed") {
		// ChatEmbed requires a non-optional `api`; shared.api is already resolved
		// from defaults, so non-null assertion is safe.
		return <ChatEmbed {...shared} api={shared.api as string} />;
	}

	return (
		<ChatCard
			{...shared}
			title={config.title ?? "Assistant"}
			width="100%"
			height="100%"
		/>
	);
}
