"use client";

import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
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
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
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
			placeholder = "Ask me anything...",
			triggerEvent = "triggerDemoRequest",
			resourceEndpoint,
			api,
		} = props;

		const effectiveResourceEndpoint =
			resourceEndpoint ?? (api ? `${api}/resource` : undefined);

		const resolvedTheme = mergeTheme(userTheme);
		const cssVars = themeToCSSProperties(resolvedTheme);
		const isDark = isDarkTheme(resolvedTheme);

		const engine = useChatEngine(props);

		const animatedPlaceholder = useTypingPlaceholder(placeholder, !engine.text);

		const [isHighlighted, setIsHighlighted] = useState(false);
		const cardRef = useRef<HTMLDivElement>(null);
		const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

		const focusInput = useCallback(() => {
			const container = cardRef.current;
			if (!container) return;
			container.scrollIntoView({ behavior: "smooth", block: "center" });
			const textarea = container.querySelector("textarea");
			if (textarea) {
				setTimeout(() => textarea.focus(), 300);
			}
			setIsHighlighted(true);
			clearTimeout(highlightTimerRef.current);
			highlightTimerRef.current = setTimeout(
				() => setIsHighlighted(false),
				2000,
			);
		}, []);

		const suggestionsState = useSuggestions({
			messages: engine.messages,
			status: engine.status,
			config: props.suggestions,
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
					focusInput();
				},
				focus: focusInput,
			}),
			[engine.handleSubmit, focusInput],
		);

		// Listen for custom trigger event (e.g. "triggerDemoRequest")
		useEffect(() => {
			if (!triggerEvent) return;
			const handler = (e: Event) => {
				const detail = (e as CustomEvent).detail;
				const message =
					typeof detail?.message === "string" ? detail.message : undefined;
				if (message) {
					engine.handleSubmit({ text: message, files: [] });
				}
				focusInput();
			};
			window.addEventListener(triggerEvent, handler);
			return () => window.removeEventListener(triggerEvent, handler);
		}, [triggerEvent, engine.handleSubmit, focusInput]);

		return (
			<div
				ref={cardRef}
				style={{ ...cssVars, width, height }}
				data-waniwani-chat=""
				data-waniwani-layout="card"
				{...(isDark ? { "data-waniwani-dark": "" } : {})}
				className={cn(
					"ww:flex ww:flex-col ww:font-[family-name:var(--ww-font)] ww:text-foreground ww:bg-background ww:rounded-[var(--ww-radius)] ww:border ww:border-border ww:shadow-md ww:overflow-hidden ww:transition-shadow ww:duration-300",
					isHighlighted &&
						"ww:ring-2 ww:ring-blue-400/70 ww:ring-offset-2 ww:ring-offset-background",
				)}
			>
				{/* Header */}
				<div
					className="ww:shrink-0 ww:flex ww:items-center ww:gap-3 ww:px-4 ww:py-2 ww:border-b ww:border-border"
					style={{
						backgroundColor: resolvedTheme.headerBackgroundColor,
						color: resolvedTheme.headerTextColor,
					}}
				>
					{showStatus && (
						<span className="ww:size-2.5 ww:rounded-full ww:bg-status" />
					)}
					<div className="ww:flex-1 ww:min-w-0">
						<div className="ww:text-xs ww:font-semibold ww:truncate">
							{title}
						</div>
						{subtitle && (
							<div className="ww:text-[11px] ww:text-muted-foreground ww:truncate">
								{subtitle}
							</div>
						)}
					</div>
				</div>

				{/* Messages */}
				<Conversation className="ww:flex-1 ww:min-h-0 ww:bg-background">
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
					className="ww:border-t ww:border-border"
				/>

				{/* Input */}
				<div className="ww:shrink-0 ww:border-t ww:border-border ww:bg-background">
					<PromptInput
						onSubmit={engine.handleSubmit}
						globalDrop={allowAttachments}
						multiple={allowAttachments}
						className={cn("ww:rounded-none ww:border-0")}
					>
						<div className="ww:flex ww:items-center ww:gap-1 ww:px-3 ww:py-2">
							{allowAttachments && <PromptInputAddAttachments />}
							<PromptInputTextarea
								onChange={engine.handleTextChange}
								value={engine.text}
								placeholder={animatedPlaceholder}
								className="ww:min-h-0 ww:py-1.5 ww:px-2"
							/>
							<PromptInputSubmit status={engine.status} />
						</div>
					</PromptInput>
				</div>
			</div>
		);
	},
);
