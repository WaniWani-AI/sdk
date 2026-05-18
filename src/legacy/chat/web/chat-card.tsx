"use client";

import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type {
	ChatBaseProps,
	ChatHandle,
	ChatTheme,
} from "../../../chat/web/@types";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "../../../chat/web/ai-elements/conversation";
import {
	PromptInput,
	PromptInputAddAttachments,
	PromptInputSubmit,
	PromptInputTextarea,
} from "../../../chat/web/ai-elements/prompt-input";
import { ChatQueue } from "../../../chat/web/components/chat-queue";
import { ExportSessionButton } from "../../../chat/web/components/export-session";
import { MessageList } from "../../../chat/web/components/message-list";
import { PoweredBy } from "../../../chat/web/components/powered-by";
import { Suggestions } from "../../../chat/web/components/suggestions";
import { ThreadMenu } from "../../../chat/web/components/thread-menu";
import { useCallTool } from "../../../chat/web/hooks/use-call-tool";
import { useChatEngine } from "../../../chat/web/hooks/use-chat-engine";
import { useConfig } from "../../../chat/web/hooks/use-config";
import { useSuggestions } from "../../../chat/web/hooks/use-suggestions";
import { useTypingPlaceholder } from "../../../chat/web/hooks/use-typing-placeholder";
import { buildResourceEndpoint } from "../../../chat/web/lib/resource-endpoint";
import { cn } from "../../../chat/web/lib/utils";
import { mergeTheme, themeToCSSProperties } from "../../../chat/web/theme";
import type { ModelContextUpdate } from "../../../shared/model-context";

/** @deprecated Use `WaniwaniChat` (hosted, React) or the `<script>` embed for new code. `ChatCard` is preserved for back-compat only and lives under `@waniwani/sdk/legacy`. */
export interface ChatCardProps extends ChatBaseProps {
	/** Title shown in the card header. Defaults to "Assistant". */
	title?: string;
	/** Subtitle or status text shown under the title. */
	subtitle?: string;
	/** Show the status dot in the header. Defaults to true. */
	showStatus?: boolean;
	/** Card width. Accepts a pixel number or any CSS value (e.g. "100%", "50vw"). Defaults to 500. */
	width?: number | string;
	/** Card height. Accepts a pixel number or any CSS value (e.g. "100%", "80vh"). Defaults to 600. */
	height?: number | string;
	/** Additional class names applied to the root element (e.g. Tailwind classes). */
	className?: string;
	/** Theme overrides. Legacy API; new code should use the `appearance` field on `WaniwaniChat` / `ChatEmbed`. */
	theme?: ChatTheme;
}

/**
 * @deprecated Use `WaniwaniChat` from `@waniwani/sdk/chat` for new code.
 * `ChatCard` is preserved for back-compat with customer MCPs that pre-date
 * the hosted-tier React component. It is also re-exported from
 * `@waniwani/sdk/chat` for now; that re-export will be removed in a future
 * minor release — import from `@waniwani/sdk/legacy` going forward.
 */
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
			welcome,
			placeholder = "Ask me anything...",
			triggerEvent = "triggerDemoRequest",
			api,
			debug,
			enableThreadHistory = false,
			showToolCalls = true,
		} = props;

		const effectiveApi = api ?? "/api/waniwani";
		const effectiveResourceEndpoint = buildResourceEndpoint(
			effectiveApi,
			props.headers,
		);

		const resolvedTheme = mergeTheme(userTheme);
		const cssVars = themeToCSSProperties(resolvedTheme);
		// Legacy heuristic: dark when the background's perceived luminance is low.
		// New code uses the explicit `appearance.theme` preset instead.
		const hex = resolvedTheme.backgroundColor.replace("#", "");
		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);
		const isDark = (r * 299 + g * 587 + b * 114) / 1000 < 128;

		const config = useConfig(
			effectiveApi,
			props.headers,
			props.skipRemoteConfig,
		);
		const effectiveDebug = debug ?? config.debug;

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
					className="ww:shrink-0 ww:flex ww:items-center ww:gap-2 ww:px-6 ww:py-3"
					style={{
						backgroundColor: resolvedTheme.headerBackgroundColor,
						color: resolvedTheme.headerTextColor,
					}}
				>
					<div className="ww:text-sm ww:font-semibold ww:truncate ww:flex-1 ww:min-w-0">
						{title}
					</div>
					<ExportSessionButton
						messages={engine.messages}
						evalEnabled={config.eval}
						api={effectiveApi}
					/>
					{enableThreadHistory && (
						<ThreadMenu
							threads={engine.threads}
							activeThreadId={engine.activeThreadId}
							onNewThread={engine.startNewThread}
							onSelectThread={(id) => {
								void engine.switchThread(id);
							}}
							onDeleteThread={(id) => {
								void engine.deleteThread(id);
							}}
						/>
					)}
				</div>

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
							resourceEndpoint={effectiveResourceEndpoint}
							chatSessionId={engine.sessionId}
							isDark={isDark}
							onFollowUp={handleWidgetMessage}
							onCallTool={handleCallTool}
							fullscreenToolCallId={fullscreenToolCallId}
							debug={effectiveDebug}
							showToolCalls={showToolCalls}
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
							<PoweredBy />
						</div>
					</div>
				</div>
			</div>
		);
	},
);
