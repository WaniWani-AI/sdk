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
import type { ChatEmbedProps, ChatHandle } from "../@types";
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
import { MessageList } from "../components/message-list";
import { Suggestions } from "../components/suggestions";
import { useCallTool } from "../hooks/use-call-tool";
import { useChatEngine } from "../hooks/use-chat-engine";
import { useSuggestions } from "../hooks/use-suggestions";
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
import { cn } from "../lib/utils";
import { isDarkTheme, mergeTheme, themeToCSSProperties } from "../theme";

/**
 * Standalone, borderless chat component — bring your own backend.
 *
 * Fills its parent container with no header, border, or shadow.
 * Does **not** call any WaniWani-specific endpoints (`/config`, `/tool`, `/sessions`).
 * Point `api` at your own AI-SDK-compatible streaming endpoint and pass extra
 * request fields via `body`.
 *
 * Supports the same ref API as ChatCard (`sendMessage`, `sendMessageAndWait`, `focus`).
 *
 * @example
 * ```tsx
 * <ChatEmbed
 *   api={`/api/mcp/projects/${projectId}/chat`}
 *   body={{ environmentId, chatSessionId }}
 *   suggestions={{ initial: ["What can you do?"] }}
 * />
 * ```
 */
export const ChatEmbed = forwardRef<ChatHandle, ChatEmbedProps>(
	function ChatEmbed(props, ref) {
		const {
			theme: userTheme,
			className,
			allowAttachments = false,
			welcomeMessage,
			welcome,
			placeholder = "Ask me anything...",
			triggerEvent = "triggerDemoRequest",
			api,
			mcp,
			debug = false,
			readOnly = false,
		} = props;

		const resolvedTheme = mergeTheme(userTheme);
		const cssVars = themeToCSSProperties(resolvedTheme);
		const isDark = isDarkTheme(resolvedTheme);

		const engine = useChatEngine({ ...props, api });
		const handleCallTool = useCallTool({
			...props,
			api,
			sessionId: engine.sessionId,
			onCallTool: mcp?.onCallTool,
		});

		const animatedPlaceholder = useTypingPlaceholder(placeholder, !engine.text);

		const [fullscreenToolCallId, setFullscreenToolCallId] = useState<
			string | null
		>(null);
		const panelRef = useRef<HTMLDivElement>(null);

		const focusInput = useCallback(() => {
			const container = panelRef.current;
			if (!container) {
				return;
			}
			const textarea = container.querySelector("textarea");
			if (textarea) {
				textarea.focus();
			}
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

		useImperativeHandle(
			ref,
			() => ({
				sendMessage: (text: string) => {
					engine.handleSubmit({ text, files: [] });
					focusInput();
				},
				sendMessageAndWait: (text: string) => engine.sendMessageAndWait(text),
				reset: engine.reset,
				focus: focusInput,
				get messages() {
					return engine.messages;
				},
			}),
			[
				engine.handleSubmit,
				engine.sendMessageAndWait,
				engine.reset,
				engine.messages,
				focusInput,
			],
		);

		// Listen for custom trigger event
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

		return (
			<div
				ref={panelRef}
				style={cssVars}
				data-waniwani-chat=""
				data-waniwani-layout="embed"
				{...(isDark ? { "data-waniwani-dark": "" } : {})}
				className={cn(
					"ww:flex ww:flex-col ww:w-full ww:h-full ww:font-[family-name:var(--ww-font)] ww:text-foreground ww:bg-background ww:overflow-hidden",
					className,
				)}
			>
				{/* Messages */}
				<Conversation className="ww:flex-1 ww:min-h-0 ww:bg-background">
					<ConversationContent
						scrollClassName={
							fullscreenToolCallId
								? "ww:!relative ww:!overflow-hidden"
								: undefined
						}
					>
						<MessageList
							messages={engine.messages}
							status={engine.status}
							welcomeMessage={welcomeMessage}
							welcome={welcome}
							onSuggestionSelect={handleSuggestionSelect}
							resourceEndpoint={mcp?.resourceEndpoint}
							chatSessionId={engine.sessionId}
							isDark={isDark}
							onFollowUp={handleWidgetMessage}
							onCallTool={handleCallTool}
							fullscreenToolCallId={fullscreenToolCallId}
							debug={debug}
							toolDefinitions={engine.toolDefinitions}
							onWidgetDisplayModeChange={(mode, widget) => {
								setFullscreenToolCallId(
									mode === "fullscreen" ? widget.toolCallId : null,
								);
							}}
						/>
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>

				{/* Suggestions — hide when fullscreen or readOnly */}
				{!readOnly && (
					<div style={fullscreenToolCallId ? { display: "none" } : undefined}>
						<Suggestions
							suggestions={suggestionsState.suggestions}
							isLoading={suggestionsState.isLoading}
							onSelect={handleSuggestionSelect}
						/>
					</div>
				)}

				{/* Queue — hide when fullscreen or readOnly */}
				{!readOnly && (
					<div style={fullscreenToolCallId ? { display: "none" } : undefined}>
						<ChatQueue
							queuedMessages={engine.queuedMessages}
							onRemove={engine.removeQueuedMessage}
						/>
					</div>
				)}

				{/* Input — hide when fullscreen or readOnly */}
				{!readOnly && (
					<div style={fullscreenToolCallId ? { display: "none" } : undefined}>
						<div className="ww:shrink-0 ww:px-4 ww:pb-8 ww:pt-2 ww:bg-background">
							<div className="ww:mx-auto ww:w-full ww:max-w-3xl">
								<PromptInput
									onSubmit={engine.handleSubmit}
									globalDrop={allowAttachments}
									multiple={allowAttachments}
									className="ww:rounded-2xl ww:border-border ww:bg-input"
								>
									<div className="ww:flex ww:items-center ww:gap-1 ww:pl-4 ww:pr-3 ww:py-2.5">
										{allowAttachments && <PromptInputAddAttachments />}
										<PromptInputTextarea
											onChange={engine.handleTextChange}
											value={engine.text}
											placeholder={animatedPlaceholder}
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
					</div>
				)}
			</div>
		);
	},
);
