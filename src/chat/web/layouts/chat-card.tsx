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

export const ChatCard = forwardRef<ChatHandle, ChatCardProps>(
	function ChatCard(props, ref) {
		const {
			theme: userTheme,
			title = "Assistant",

			width,
			height,
			className,
			allowAttachments = false,
			welcomeMessage,
			placeholder = "Ask me anything...",
			triggerEvent = "triggerDemoRequest",
			resourceEndpoint,
			api,
			debug,
		} = props;

		const effectiveApi = api ?? "/api/waniwani";
		const effectiveResourceEndpoint =
			resourceEndpoint ?? `${effectiveApi}/resource`;

		const resolvedTheme = mergeTheme(userTheme);
		const cssVars = themeToCSSProperties(resolvedTheme);
		const isDark = isDarkTheme(resolvedTheme);

		const [serverDebug, setServerDebug] = useState(false);
		const effectiveDebug = debug ?? serverDebug;

		useEffect(() => {
			(async () => {
				try {
					const r = await fetch(`${effectiveApi}/config`);
					const data = await r.json();
					if (data.debug === true) {
						setServerDebug(true);
					}
				} catch {}
			})();
		}, [effectiveApi]);

		const engine = useChatEngine({ ...props, api: effectiveApi });
		const handleCallTool = useCallTool({
			...props,
			api: effectiveApi,
			sessionId: engine.sessionId,
		});

		const animatedPlaceholder = useTypingPlaceholder(placeholder, !engine.text);

		const [isHighlighted, setIsHighlighted] = useState(false);
		const [fullscreenToolCallId, setFullscreenToolCallId] = useState<
			string | null
		>(null);
		const cardRef = useRef<HTMLDivElement>(null);
		const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

		const focusInput = useCallback(() => {
			const container = cardRef.current;
			if (!container) {
				return;
			}
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
				focus: focusInput,
			}),
			[engine.handleSubmit, engine.sendMessageAndWait, focusInput],
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

		return (
			<div
				ref={cardRef}
				style={{ ...cssVars, width, height }}
				data-waniwani-chat=""
				data-waniwani-layout="card"
				{...(isDark ? { "data-waniwani-dark": "" } : {})}
				className={cn(
					"ww:flex ww:flex-col ww:font-[family-name:var(--ww-font)] ww:text-foreground ww:bg-background ww:rounded-[var(--ww-radius)] ww:overflow-hidden",
					isHighlighted &&
						"ww:ring-2 ww:ring-blue-400/70 ww:ring-offset-2 ww:ring-offset-background",
					className,
				)}
			>
				{/* Header */}
				<div
					className="ww:shrink-0 ww:flex ww:items-center ww:px-6 ww:py-3"
					style={{
						backgroundColor: resolvedTheme.headerBackgroundColor,
						color: resolvedTheme.headerTextColor,
					}}
				>
					<div className="ww:text-sm ww:font-semibold ww:truncate">{title}</div>
					{effectiveDebug && <ExportSessionButton messages={engine.messages} />}
				</div>

				{/* Messages */}
				<Conversation
					className={cn(
						"ww:flex-1 ww:min-h-0 ww:bg-background",
						fullscreenToolCallId && "[&>div]:ww:!overflow-hidden",
					)}
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
							debug={effectiveDebug}
							onWidgetDisplayModeChange={(mode, widget) => {
								setFullscreenToolCallId(
									mode === "fullscreen" ? widget.toolCallId : null,
								);
							}}
						/>
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>

				{/* Suggestions — hide when fullscreen */}
				<div style={fullscreenToolCallId ? { display: "none" } : undefined}>
					<Suggestions
						suggestions={suggestionsState.suggestions}
						isLoading={suggestionsState.isLoading}
						onSelect={handleSuggestionSelect}
					/>
				</div>

				{/* Queue — hide when fullscreen */}
				<div style={fullscreenToolCallId ? { display: "none" } : undefined}>
					<ChatQueue
						queuedMessages={engine.queuedMessages}
						onRemove={engine.removeQueuedMessage}
					/>
				</div>

				{/* Input — hide when fullscreen */}
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
			</div>
		);
	},
);
