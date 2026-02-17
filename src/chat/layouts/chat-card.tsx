"use client";

import type { ChatCardProps } from "../@types";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "../ai-elements/conversation";
import {
	PromptInput,
	PromptInputAddAttachments,
	PromptInputSubmit,
	PromptInputTextarea,
} from "../ai-elements/prompt-input";
import { MessageList } from "../components/message-list";
import { useChatEngine } from "../hooks/use-chat-engine";
import { cn } from "../lib/utils";
import { isDarkTheme, mergeTheme, themeToCSSProperties } from "../theme";

export function ChatCard(props: ChatCardProps) {
	const {
		theme: userTheme,
		title = "Assistant",
		subtitle,
		showStatus = true,
		width = 500,
		height = 600,
		allowAttachments = false,
		welcomeMessage,
		resourceEndpoint,
	} = props;

	const resolvedTheme = mergeTheme(userTheme);
	const cssVars = themeToCSSProperties(resolvedTheme);
	const isDark = isDarkTheme(resolvedTheme);

	const engine = useChatEngine(props);

	return (
		<div
			style={{ ...cssVars, width, height }}
			data-waniwani-chat=""
			data-waniwani-layout="card"
			{...(isDark ? { "data-waniwani-dark": "" } : {})}
			className="flex flex-col font-[family-name:var(--ww-font)] text-foreground rounded-[var(--ww-radius)] border border-border shadow-md overflow-hidden"
		>
			{/* Header */}
			<div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-card-header border-b border-border">
				{showStatus && <span className="size-2.5 rounded-full bg-status" />}
				<div className="flex-1 min-w-0">
					<div className="text-sm font-semibold text-card-header-foreground truncate">
						{title}
					</div>
					{subtitle && (
						<div className="text-xs text-muted-foreground truncate">
							{subtitle}
						</div>
					)}
				</div>
			</div>

			{/* Messages */}
			<Conversation className="flex-1 min-h-0 bg-background">
				<ConversationContent>
					<MessageList
						messages={engine.messages}
						status={engine.status}
						welcomeMessage={welcomeMessage}
						resourceEndpoint={resourceEndpoint}
						isDark={isDark}
					/>
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			{/* Input */}
			<div className="shrink-0 border-t border-border bg-background">
				<PromptInput
					onSubmit={engine.handleSubmit}
					globalDrop={allowAttachments}
					multiple={allowAttachments}
					className={cn("rounded-none border-0")}
				>
					<div className="flex items-center gap-1 px-3 py-2">
						{allowAttachments && <PromptInputAddAttachments />}
						<PromptInputTextarea
							onChange={engine.handleTextChange}
							value={engine.text}
							placeholder={`Message ${title}...`}
							className="min-h-0 py-1.5 px-2"
						/>
						<PromptInputSubmit status={engine.status} />
					</div>
				</PromptInput>
			</div>
		</div>
	);
}
