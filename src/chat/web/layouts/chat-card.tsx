"use client";

import { forwardRef, useCallback, useImperativeHandle } from "react";
import type { ChatCardProps, ChatHandle } from "../@types";
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
import { Suggestions } from "../components/suggestions";
import { useChatEngine } from "../hooks/use-chat-engine";
import { useSuggestions } from "../hooks/use-suggestions";
import { cn } from "../lib/utils";
import { isDarkTheme, mergeTheme, themeToCSSProperties } from "../theme";

export const ChatCard = forwardRef<ChatHandle, ChatCardProps>(
	function ChatCard(props, ref) {
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
			api,
		} = props;

		const effectiveResourceEndpoint =
			resourceEndpoint ?? (api ? `${api}/resource` : undefined);

		const resolvedTheme = mergeTheme(userTheme);
		const cssVars = themeToCSSProperties(resolvedTheme);
		const isDark = isDarkTheme(resolvedTheme);

		const engine = useChatEngine(props);

		const suggestionsState = useSuggestions({
			messages: engine.messages,
			status: engine.status,
			initialSuggestions: props.initialSuggestions,
			suggestions: props.suggestions,
			api: props.api,
			apiKey: props.apiKey,
			headers: props.headers,
		});

		const handleWidgetMessage = useCallback(
			(message: {
				role: string;
				content: Array<{ type: string; text?: string }>;
			}) => {
				const text = message.content
					.map((c) => c.text ?? "")
					.join("")
					.trim();
				if (text) engine.handleSubmit({ text, files: [] });
			},
			[engine.handleSubmit],
		);

		const handleSuggestionSelect = useCallback(
			(suggestion: string) => {
				suggestionsState.clear();
				engine.handleSubmit({ text: suggestion, files: [] });
			},
			[suggestionsState.clear, engine.handleSubmit],
		);

		useImperativeHandle(
			ref,
			() => ({
				sendMessage: (text: string) => {
					engine.handleSubmit({ text, files: [] });
				},
			}),
			[engine.handleSubmit],
		);

		return (
			<div
				style={{ ...cssVars, width, height }}
				data-waniwani-chat=""
				data-waniwani-layout="card"
				{...(isDark ? { "data-waniwani-dark": "" } : {})}
				className="flex flex-col font-[family-name:var(--ww-font)] text-foreground bg-background rounded-[var(--ww-radius)] border border-border shadow-md overflow-hidden"
			>
				{/* Header */}
				<div
					className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border"
					style={{
						backgroundColor: resolvedTheme.headerBackgroundColor,
						color: resolvedTheme.headerTextColor,
					}}
				>
					{showStatus && <span className="size-2.5 rounded-full bg-status" />}
					<div className="flex-1 min-w-0">
						<div className="text-xs font-semibold truncate">{title}</div>
						{subtitle && (
							<div className="text-[11px] text-muted-foreground truncate">
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
							resourceEndpoint={effectiveResourceEndpoint}
							isDark={isDark}
							onFollowUp={handleWidgetMessage}
						/>
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>

				{/* Suggestions */}
				<Suggestions
					suggestions={suggestionsState.suggestions}
					isLoading={suggestionsState.isLoading}
					onSelect={handleSuggestionSelect}
					className="border-t border-border"
				/>

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
								placeholder="Ask anything..."
								className="min-h-0 py-1.5 px-2"
							/>
							<PromptInputSubmit status={engine.status} />
						</div>
					</PromptInput>
				</div>
			</div>
		);
	},
);
