"use client";

import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { ModelContextUpdate } from "../../../shared/model-context";
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
import { ChatQueue } from "../components/chat-queue";
import { ExportSessionButton } from "../components/export-session";
import { MessageList } from "../components/message-list";
import { Suggestions } from "../components/suggestions";
import { useCallTool } from "../hooks/use-call-tool";
import { useChatEngine } from "../hooks/use-chat-engine";
import { useSuggestions } from "../hooks/use-suggestions";
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
import { cn } from "../lib/utils";
import { isDarkTheme, mergeTheme, themeToCSSProperties } from "../theme";

export const ChatBar = forwardRef<ChatHandle, ChatBarProps>(
	function ChatBar(props, ref) {
		const {
			theme: userTheme,
			title = "Assistant",
			width = 600,
			expandedWidth: userExpandedWidth,
			expandedHeight = 400,
			allowAttachments = false,
			welcomeMessage,
			placeholder = "Ask me anything...",
			triggerEvent = "triggerDemoRequest",
			resourceEndpoint,
			api,
			debug,
		} = props;

		const expandedWidth =
			userExpandedWidth ??
			Math.round((typeof width === "number" ? width : 600) * 1.2);

		const effectiveResourceEndpoint =
			resourceEndpoint ?? (api ? `${api}/resource` : undefined);

		const resolvedTheme = mergeTheme(userTheme);
		const cssVars = themeToCSSProperties(resolvedTheme);
		const isDark = isDarkTheme(resolvedTheme);

		const engine = useChatEngine(props);
		const handleCallTool = useCallTool({
			...props,
			sessionId: engine.sessionId,
		});

		const suggestionsState = useSuggestions({
			messages: engine.messages,
			status: engine.status,
			config: props.suggestions,
		});

		const handleWidgetMessage = useCallback(
			(message: {
				role: string;
				content: Array<{ type: string; text?: string }>;
				modelContext?: ModelContextUpdate;
			}) => {
				const text = message.content
					.map((c) => c.text ?? "")
					.join("")
					.trim();
				if (text) {
					engine.handleSubmit({
						text,
						files: [],
						modelContext: message.modelContext,
					});
				}
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

		const animatedPlaceholder = useTypingPlaceholder(placeholder, !engine.text);

		const [isFocused, setIsFocused] = useState(false);
		const [isHighlighted, setIsHighlighted] = useState(false);
		const [fullscreenToolCallId, setFullscreenToolCallId] = useState<
			string | null
		>(null);
		const containerRef = useRef<HTMLDivElement>(null);
		const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

		const focusInput = useCallback(() => {
			const container = containerRef.current;
			if (!container) {
				return;
			}
			container.scrollIntoView({ behavior: "smooth", block: "center" });
			const textarea = container.querySelector("textarea");
			if (textarea) {
				setTimeout(() => textarea.focus(), 300);
			}
			setIsFocused(true);
			setIsHighlighted(true);
			clearTimeout(highlightTimerRef.current);
			highlightTimerRef.current = setTimeout(
				() => setIsHighlighted(false),
				2000,
			);
		}, []);

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
			if (!triggerEvent) {
				return;
			}
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

		const isExpanded = isFocused || fullscreenToolCallId !== null;

		// Close on outside click
		useEffect(() => {
			if (!isFocused) {
				return;
			}
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
				style={{
					...cssVars,
					width: isExpanded ? expandedWidth : width,
					transition: "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
				}}
				data-waniwani-chat=""
				data-waniwani-layout="bar"
				{...(isDark ? { "data-waniwani-dark": "" } : {})}
				className="ww:flex ww:flex-col ww:font-[family-name:var(--ww-font)] ww:text-foreground"
			>
				{/* Card section — grows from nothing on focus */}
				<div
					style={{
						overflow: "hidden",
						backgroundColor: resolvedTheme.backgroundColor,
						borderRadius: "var(--ww-radius) var(--ww-radius) 0 0",
						maxHeight: isExpanded ? expandedHeight + 200 : 0,
						opacity: isExpanded ? 1 : 0,
						transform: isExpanded ? "scaleX(1)" : "scaleX(0.88)",
						transformOrigin: "center bottom",
						transition:
							"max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
					}}
				>
					{/* Header */}
					<div
						className="ww:shrink-0 ww:flex ww:items-center ww:px-6 ww:py-3"
						style={{
							backgroundColor: resolvedTheme.headerBackgroundColor,
							color: resolvedTheme.headerTextColor,
						}}
					>
						<div className="ww:text-sm ww:font-semibold ww:truncate">
							{title}
						</div>
						{debug && <ExportSessionButton messages={engine.messages} />}
					</div>

					{/* Messages */}
					<Conversation
						className={cn(
							"ww:flex-1",
							fullscreenToolCallId && "[&>div]:ww:!overflow-hidden",
						)}
						style={{ height: expandedHeight }}
					>
						<ConversationContent>
							<MessageList
								messages={engine.messages}
								status={engine.status}
								welcomeMessage={welcomeMessage}
								resourceEndpoint={effectiveResourceEndpoint}
								chatSessionId={engine.sessionId}
								isDark={isDark}
								onFollowUp={handleWidgetMessage}
								onCallTool={handleCallTool}
								fullscreenToolCallId={fullscreenToolCallId}
								onWidgetDisplayModeChange={(mode, widget) => {
									setFullscreenToolCallId(
										mode === "fullscreen" ? widget.toolCallId : null,
									);
								}}
							/>
						</ConversationContent>
						<ConversationScrollButton />
					</Conversation>

					{/* Suggestions */}
					<div style={fullscreenToolCallId ? { display: "none" } : undefined}>
						<Suggestions
							suggestions={suggestionsState.suggestions}
							isLoading={suggestionsState.isLoading}
							onSelect={handleSuggestionSelect}
						/>
					</div>

					{/* Queue */}
					<div style={fullscreenToolCallId ? { display: "none" } : undefined}>
						<ChatQueue
							queuedMessages={engine.queuedMessages}
							onRemove={engine.removeQueuedMessage}
						/>
					</div>
				</div>

				{/* Input section — always visible, joins card when expanded */}
				<div
					style={{
						backgroundColor: isExpanded
							? resolvedTheme.backgroundColor
							: "transparent",
						borderRadius: isExpanded
							? "0 0 var(--ww-radius) var(--ww-radius)"
							: undefined,
						boxShadow: isExpanded ? "0 8px 24px rgba(0,0,0,0.1)" : "none",
						transition:
							"background-color 0.2s ease, border-radius 0.3s ease, box-shadow 0.35s ease, padding 0.3s ease",
						padding: isExpanded ? "8px 16px 16px" : "0",
					}}
				>
					<PromptInput
						onSubmit={engine.handleSubmit}
						globalDrop={allowAttachments}
						multiple={allowAttachments}
						className={cn(
							"ww:rounded-2xl ww:border-border ww:bg-input ww:transition-all ww:duration-300",
							!isExpanded && "ww:shadow-sm",
							isHighlighted &&
								"ww:ring-2 ww:ring-blue-400/70 ww:ring-offset-2 ww:ring-offset-background",
						)}
					>
						<div className="ww:flex ww:items-center ww:gap-1 ww:pl-4 ww:pr-3 ww:py-2.5">
							{allowAttachments && <PromptInputAddAttachments />}
							<PromptInputTextarea
								onChange={engine.handleTextChange}
								value={engine.text}
								placeholder={animatedPlaceholder}
								onFocus={handleFocus}
								className="ww:min-h-0 ww:py-1 ww:px-0"
							/>
							<PromptInputSubmit
								status={engine.status}
								disabled={engine.queueFull}
							/>
						</div>
					</PromptInput>
				</div>
			</div>
		);
	},
);
