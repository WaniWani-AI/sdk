"use client";

import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { ChatBarProps, ChatHandle } from "../@types";
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

export const ChatBar = forwardRef<ChatHandle, ChatBarProps>(
	function ChatBar(props, ref) {
		const {
			theme: userTheme,
			width = 600,
			expandedHeight = 400,
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

		const [isFocused, setIsFocused] = useState(false);
		const containerRef = useRef<HTMLDivElement>(null);
		const isExpanded = isFocused;

		// Close on outside click
		useEffect(() => {
			if (!isFocused) return;
			const handleClickOutside = (e: MouseEvent) => {
				if (
					containerRef.current &&
					!containerRef.current.contains(e.target as Node)
				) {
					setIsFocused(false);
				}
			};
			document.addEventListener("mousedown", handleClickOutside);
			return () =>
				document.removeEventListener("mousedown", handleClickOutside);
		}, [isFocused]);

		const handleFocus = useCallback(() => {
			setIsFocused(true);
		}, []);

		return (
			<div
				ref={containerRef}
				style={{ ...cssVars, width }}
				data-waniwani-chat=""
				data-waniwani-layout="bar"
				{...(isDark ? { "data-waniwani-dark": "" } : {})}
				className="flex flex-col font-[family-name:var(--ww-font)] text-foreground"
			>
				{/* Messages panel — fades up on expand */}
				<div
					className={cn(
						"overflow-hidden bg-background/80 backdrop-blur-xl transition-all duration-300 ease-out",
						isExpanded
							? "opacity-100 translate-y-0"
							: "opacity-0 translate-y-2 pointer-events-none max-h-0",
					)}
					style={{
						...(isExpanded ? { maxHeight: expandedHeight } : undefined),
						maskImage:
							"linear-gradient(to bottom, transparent, black 24px, black calc(100% - 16px), transparent), linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)",
						maskComposite: "intersect",
						WebkitMaskImage:
							"linear-gradient(to bottom, transparent, black 24px, black calc(100% - 16px), transparent), linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)",
						WebkitMaskComposite: "source-in",
					}}
				>
					<Conversation className="flex-1" style={{ height: expandedHeight }}>
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
				</div>

				{/* Suggestions */}
				<Suggestions
					suggestions={suggestionsState.suggestions}
					isLoading={suggestionsState.isLoading}
					onSelect={handleSuggestionSelect}
				/>

				{/* Input bar — always visible */}
				<div className="shrink-0">
					<PromptInput
						onSubmit={engine.handleSubmit}
						globalDrop={allowAttachments}
						multiple={allowAttachments}
						className={cn(
							"rounded-[var(--ww-radius)] shadow-sm transition-all duration-300 ease-out",
						)}
					>
						<div className="flex items-center gap-1 px-3 py-2">
							{allowAttachments && <PromptInputAddAttachments />}
							<PromptInputTextarea
								onChange={engine.handleTextChange}
								value={engine.text}
								placeholder="Ask anything..."
								onFocus={handleFocus}
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
