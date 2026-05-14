"use client";

import { ArrowDownIcon } from "lucide-react";
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
	PromptInput,
	PromptInputAddAttachments,
	PromptInputSubmit,
	PromptInputTextarea,
} from "../ai-elements/prompt-input";
import { ChatQueue } from "../components/chat-queue";
import { MessageList } from "../components/message-list";
import { Suggestions } from "../components/suggestions";
import { ThreadMenu } from "../components/thread-menu";
import { useCallTool } from "../hooks/use-call-tool";
import { useChatEngine } from "../hooks/use-chat-engine";
import { useSuggestions } from "../hooks/use-suggestions";
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
import { buildResourceEndpoint } from "../lib/resource-endpoint";
import { cn } from "../lib/utils";
import { isDarkTheme, mergeTheme, themeToCSSProperties } from "../theme";
import { Button } from "../ui/button";

/**
 * Bring-your-own-backend chat with internal scroll.
 *
 * Sizes off its parent via two complementary mechanisms applied by the
 * embed host: a `height: 100%; max-height: inherit` chain for
 * definite-height parents, and `flex: 1 1 auto; min-height: 0` so the
 * chat also fills a flex-column parent bounded only by `max-height`.
 * Both work across the shadow boundary. When the parent is truly
 * unbounded the chat grows with content; bound it by setting `height`,
 * `max-height`, or a flex/grid track on the parent. Internally a flex
 * column: header and input pinned, messages scrolling between them.
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
			title,
			headerActions,
			enableThreadHistory = false,
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

		// Fall back to deriving the resource endpoint from `api` + the bearer
		// token so callers (including the IIFE embed) get widget rendering
		// without having to pass an `mcp` config. Mirrors ChatBar/ChatCard.
		const resourceEndpoint =
			mcp?.resourceEndpoint ?? buildResourceEndpoint(api, props.headers);

		const animatedPlaceholder = useTypingPlaceholder(placeholder, !engine.text);

		const [fullscreenToolCallId, setFullscreenToolCallId] = useState<
			string | null
		>(null);
		const rootRef = useRef<HTMLDivElement>(null);
		const scrollRef = useRef<HTMLDivElement>(null);
		const scrollContentRef = useRef<HTMLDivElement>(null);
		const bottomRef = useRef<HTMLDivElement>(null);
		const [atBottom, setAtBottom] = useState(true);
		const atBottomRef = useRef(atBottom);
		atBottomRef.current = atBottom;

		const focusInput = useCallback(() => {
			const container = rootRef.current;
			if (!container) {
				return;
			}
			const textarea = container.querySelector("textarea");
			if (textarea) {
				textarea.focus();
			}
		}, []);

		// Confine to the messages scroll container — `scrollIntoView` would
		// also scroll ancestor scroll boxes (page, customer wrappers),
		// jerking the layout every time a streamed token arrives.
		const scrollToBottom = useCallback(
			(behavior: ScrollBehavior = "smooth") => {
				const scroller = scrollRef.current;
				if (!scroller) {
					return;
				}
				scroller.scrollTo({ top: scroller.scrollHeight, behavior });
			},
			[],
		);

		// Track whether the bottom sentinel is visible inside the scroll
		// container. Only auto-stick when true so reading older messages
		// isn't yanked away by streaming.
		useEffect(() => {
			const el = bottomRef.current;
			const scroller = scrollRef.current;
			if (!el || !scroller) {
				return;
			}
			const observer = new IntersectionObserver(
				([entry]) => setAtBottom(entry.isIntersecting),
				{ root: scroller, rootMargin: "0px 0px 200px 0px", threshold: 0 },
			);
			observer.observe(el);
			return () => observer.disconnect();
		}, []);

		// Auto-scroll on new messages / streaming tokens. When the user
		// just sent a message we always jump to the bottom — they expect
		// to see what they typed and the response forming below it. For
		// streaming assistant tokens we only stick if the user is already
		// at the bottom, so reading older messages mid-stream isn't yanked
		// away. Forcing the scroll on user submit also flips `atBottom`
		// back to true, so widget iframes growing afterward (via the
		// content ResizeObserver below) re-stick the view too.
		// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on length + last-message identity changes
		useEffect(() => {
			const last = engine.messages[engine.messages.length - 1];
			if (last?.role === "user" || atBottomRef.current) {
				scrollToBottom("smooth");
			}
		}, [engine.messages.length, engine.messages[engine.messages.length - 1]]);

		useEffect(() => {
			scrollToBottom("auto");
		}, [scrollToBottom]);

		// Keep the view pinned to the bottom whenever either the scroll
		// container or its inner content resizes. Two reasons:
		//   - The embed host can settle asynchronously (`ResizeObserver`
		//     mirroring the parent's max-height runs after the first paint)
		//     which shrinks the scroll container.
		//   - MCP App widgets render in iframes that grow once their
		//     handshake completes and the host reports its content height;
		//     the React `messages` array doesn't change, so the
		//     length/identity effect above can't catch it.
		//
		// Track the previous scrollHeight so we can decide whether the user
		// was at the bottom *before* this resize. `atBottom` from the
		// IntersectionObserver is racy here: when an iframe suddenly grows,
		// the bottom sentinel flicks out of view and the IO fires before
		// the RO callback, leaving `atBottomRef.current = false` even
		// though the user was clearly stuck to the bottom moments earlier.
		useEffect(() => {
			if (typeof ResizeObserver === "undefined") {
				return;
			}
			const scroller = scrollRef.current;
			const content = scrollContentRef.current;
			if (!scroller && !content) {
				return;
			}
			let prevScrollHeight = scroller?.scrollHeight ?? 0;
			const observer = new ResizeObserver(() => {
				const s = scrollRef.current;
				if (!s) {
					return;
				}
				const wasAtBottom =
					s.scrollTop + s.clientHeight >= prevScrollHeight - 5;
				prevScrollHeight = s.scrollHeight;
				if (wasAtBottom) {
					scrollToBottom("auto");
				}
			});
			if (scroller) {
				observer.observe(scroller);
			}
			if (content) {
				observer.observe(content);
			}
			return () => observer.disconnect();
		}, [scrollToBottom]);

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

		const showHeader = Boolean(title || enableThreadHistory || headerActions);

		return (
			<div
				ref={rootRef}
				style={{ ...cssVars, maxHeight: "inherit" }}
				data-waniwani-chat=""
				data-waniwani-layout="embed"
				{...(isDark ? { "data-waniwani-dark": "" } : {})}
				className={cn(
					"ww:relative ww:w-full ww:h-full ww:flex ww:flex-col ww:bg-background ww:text-foreground ww:font-[family-name:var(--ww-font)] ww:overflow-hidden",
					className,
				)}
			>
				{showHeader && (
					<div
						className="ww:shrink-0 ww:flex ww:items-center ww:gap-2 ww:px-6 ww:py-3 ww:bg-background ww:border-b ww:border-border"
						style={{
							backgroundColor: resolvedTheme.headerBackgroundColor,
							color: resolvedTheme.headerTextColor,
						}}
					>
						{title && (
							<div className="ww:text-sm ww:font-semibold ww:truncate ww:flex-1 ww:min-w-0">
								{title}
							</div>
						)}
						{!title && <div className="ww:flex-1" />}
						{headerActions}
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
				)}

				<div
					ref={scrollRef}
					className={cn(
						"ww:relative ww:flex-1 ww:min-h-0",
						fullscreenToolCallId ? "ww:overflow-hidden" : "ww:overflow-y-auto",
					)}
				>
					<div
						ref={scrollContentRef}
						className={cn(
							"ww:mx-auto ww:w-full ww:max-w-3xl ww:px-4 ww:py-6 ww:flex ww:flex-col ww:gap-6",
							fullscreenToolCallId && "ww:!py-0",
						)}
					>
						<MessageList
							messages={engine.messages}
							status={engine.status}
							welcomeMessage={welcomeMessage}
							welcome={welcome}
							onSuggestionSelect={handleSuggestionSelect}
							resourceEndpoint={resourceEndpoint}
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
						<div ref={bottomRef} aria-hidden style={{ height: 1 }} />
					</div>
					{!atBottom && !fullscreenToolCallId && (
						<div className="ww:sticky ww:bottom-2 ww:flex ww:justify-center ww:pointer-events-none">
							<Button
								type="button"
								onClick={() => scrollToBottom("smooth")}
								size="icon"
								variant="outline"
								className="ww:rounded-full ww:shadow ww:pointer-events-auto"
								aria-label="Scroll to latest"
							>
								<ArrowDownIcon className="ww:size-4" />
							</Button>
						</div>
					)}
				</div>

				{!readOnly && (
					<div
						className="ww:shrink-0 ww:bg-background"
						style={fullscreenToolCallId ? { display: "none" } : undefined}
					>
						<Suggestions
							suggestions={suggestionsState.suggestions}
							isLoading={suggestionsState.isLoading}
							onSelect={handleSuggestionSelect}
						/>
						<ChatQueue
							queuedMessages={engine.queuedMessages}
							onRemove={engine.removeQueuedMessage}
						/>
						<div className="ww:px-4 ww:pb-4 ww:pt-2">
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
