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
import { AiDisclaimer } from "../components/ai-disclaimer";
import { ChatQueue } from "../components/chat-queue";
import { MessageList } from "../components/message-list";
import { PoweredBy } from "../components/powered-by";
import { Suggestions } from "../components/suggestions";
import { ThreadMenu } from "../components/thread-menu";
import { useCallTool } from "../hooks/use-call-tool";
import { useChatEngine } from "../hooks/use-chat-engine";
import { useSuggestions } from "../hooks/use-suggestions";
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
import { I18nProvider, useTranslation } from "../i18n";
import { buildResourceEndpoint } from "../lib/resource-endpoint";
import { cn } from "../lib/utils";
import { themeToCSSProperties } from "../theme";
import { Button } from "../ui/button";

/**
 * **Bare-bones, bring-your-own-backend chat primitive.** Most apps want
 * `WaniwaniChat` (the hosted version) — `ChatEmbed` is the unmanaged
 * escape hatch with no token, no remote config, no defaults, and no
 * built-in MCP resource endpoint. You wire up `api`, `headers`, `body`,
 * theme, and (optionally) `mcp` yourself.
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
		const { locale, messages } = props;
		return (
			<I18nProvider locale={locale} messages={messages}>
				<ChatEmbedInner {...props} ref={ref} />
			</I18nProvider>
		);
	},
);

const ChatEmbedInner = forwardRef<ChatHandle, ChatEmbedProps>(
	function ChatEmbedInner(props, ref) {
		const { t, ready: localeReady } = useTranslation();
		const {
			appearance,
			className,
			allowAttachments = false,
			welcomeMessage,
			welcome,
			placeholder = t.promptInput.placeholder,
			triggerEvent = "triggerDemoRequest",
			api,
			mcp,
			debug = false,
			readOnly = false,
			title,
			headerActions,
			hideHeader = false,
			enableThreadHistory = false,
			showToolCalls = true,
			initializing = false,
			disclaimer,
		} = props;

		// Preset → base theme. `light` and the unset case let the CSS
		// defaults in tailwind.css drive the look (no inline vars needed).
		// `dark` switches via the `.dark` class on the wrapper, which flips
		// the CSS-var fallbacks. `auto` switches via `data-color-scheme`
		// and a `prefers-color-scheme` media query in tailwind.css.
		const preset = appearance?.theme;
		const userVars = appearance?.variables;

		// `preset: dark` doesn't need its full DARK_THEME table emitted as
		// inline vars — the `.dark [data-waniwani-chat]` rule handles the
		// fallback chain. We only emit the customer's overrides on top.
		const cssVars = userVars ? themeToCSSProperties(userVars) : {};

		// `isDark` drives the legacy `data-waniwani-dark` attribute (read
		// by message components and the iframe theme handshake). For
		// `auto` we track the system preference at runtime so iframe
		// widgets receive the right theme.
		//
		// Initial state must be deterministic across server and client to
		// avoid hydration mismatches on `data-waniwani-dark` — reading
		// `matchMedia` in the initializer would render `true` on a
		// dark-OS client against the server's `false`. The effect below
		// syncs the real value immediately after mount and subscribes to
		// future changes.
		const [autoIsDark, setAutoIsDark] = useState(false);
		useEffect(() => {
			if (preset !== "auto" || typeof window === "undefined") {
				return;
			}
			const mq = window.matchMedia("(prefers-color-scheme: dark)");
			setAutoIsDark(mq.matches);
			const onChange = () => setAutoIsDark(mq.matches);
			mq.addEventListener("change", onChange);
			return () => mq.removeEventListener("change", onChange);
		}, [preset]);
		const isDark = preset === "dark" || (preset === "auto" && autoIsDark);

		const engine = useChatEngine({ ...props, api });
		const handleCallTool = useCallTool({
			...props,
			api,
			sessionId: engine.sessionId,
			onCallTool: mcp?.onCallTool,
		});

		// Fall back to deriving the resource endpoint from `api` + the bearer
		// token so callers (including the IIFE embed) get widget rendering
		// without having to pass an `mcp` config. Mirrors ChatCard.
		const resourceEndpoint =
			mcp?.resourceEndpoint ?? buildResourceEndpoint(api, props.headers);

		const animatedPlaceholder = useTypingPlaceholder(placeholder, !engine.text);

		const [fullscreenToolCallId, setFullscreenToolCallId] = useState<
			string | null
		>(null);
		// A fullscreen widget renders `position:absolute; inset:0`, and the
		// message list hides everything else. In a parent with a definite height
		// the scroll area still spans it, so the widget fills it. But when the
		// embed is left to grow with its content (the standalone default, an
		// unbounded parent), hiding everything collapses the scroll area to
		// nothing and the widget shrinks to a sliver. Freezing the embed to the
		// height it was rendering at the instant fullscreen is requested gives the
		// widget a definite area to fill in that case; it's a no-op when the
		// parent already bounds the height. Captured pre-collapse in the handler.
		const [frozenHeight, setFrozenHeight] = useState<number | null>(null);
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
		// Track the previous scrollHeight *and* clientHeight so we can
		// decide whether the user was at the bottom *before* this resize.
		// `atBottom` from the IntersectionObserver is racy here: when an
		// iframe suddenly grows, the bottom sentinel flicks out of view
		// and the IO fires before the RO callback, leaving
		// `atBottomRef.current = false` even though the user was clearly
		// stuck to the bottom moments earlier. Both dimensions need the
		// pre-resize value: e.g. when the host shrinks (its mirrored
		// max-height settling), clientHeight drops while scrollHeight is
		// unchanged, and using the post-resize clientHeight against the
		// pre-resize scrollHeight would miss the at-bottom case.
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
			let prevClientHeight = scroller?.clientHeight ?? 0;
			const observer = new ResizeObserver(() => {
				const s = scrollRef.current;
				if (!s) {
					return;
				}
				const wasAtBottom =
					s.scrollTop + prevClientHeight >= prevScrollHeight - 5;
				prevScrollHeight = s.scrollHeight;
				prevClientHeight = s.clientHeight;
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
				get sessionId() {
					return engine.sessionId;
				},
			}),
			[
				engine.handleSubmit,
				engine.sendMessageAndWait,
				engine.reset,
				engine.messages,
				engine.sessionId,
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

		const showHeader =
			!hideHeader && Boolean(title || enableThreadHistory || headerActions);

		// Hold opacity 0 until both the remote-config (caller-driven
		// `initializing`) and the i18n auto-detect effect have settled.
		// Prevents a one-frame flash of English chrome before the catalog
		// swaps to the visitor's locale on SSR pages.
		const masked = initializing || !localeReady;

		return (
			<div
				ref={rootRef}
				style={{
					...cssVars,
					maxHeight: "inherit",
					// Pin the height while a widget is fullscreen so the absolutely
					// positioned widget has a definite area to fill even when the
					// parent doesn't bound the height (see `frozenHeight`).
					...(fullscreenToolCallId && frozenHeight
						? { height: frozenHeight }
						: {}),
					opacity: masked ? 0 : 1,
					transition: "opacity 220ms ease-out",
				}}
				data-waniwani-chat=""
				data-waniwani-layout="embed"
				data-color-scheme={preset === "auto" ? "auto" : undefined}
				{...(masked ? { "data-waniwani-initializing": "" } : {})}
				{...(isDark ? { "data-waniwani-dark": "" } : {})}
				className={cn(
					"ww:relative ww:w-full ww:h-full ww:flex ww:flex-col ww:bg-background ww:text-foreground ww:font-[family-name:var(--ww-font)] ww:overflow-hidden",
					preset === "dark" && "dark",
					className,
				)}
			>
				{showHeader && (
					<div
						className="ww:shrink-0 ww:flex ww:items-center ww:gap-2 ww:pl-4 ww:pr-3 ww:py-3 ww:border-b ww:border-border"
						style={{
							backgroundColor: "var(--ww-color-card-header)",
							color: "var(--ww-color-card-header-foreground)",
						}}
					>
						{title && (
							<div className="ww:text-sm ww:font-semibold ww:truncate ww:flex-1 ww:min-w-0">
								{title}
							</div>
						)}
						{!title && <div className="ww:flex-1" />}
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
						{/* Rendered last so embed-host actions (e.g. the floating
						    minimize button) sit at the far right of the header. */}
						{headerActions}
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
							showToolCalls={showToolCalls}
							toolDefinitions={engine.toolDefinitions}
							onWidgetDisplayModeChange={(mode, widget) => {
								if (mode === "fullscreen") {
									// Read the height while the embed is still laid out inline
									// (before this state change collapses an unbounded parent).
									const h =
										rootRef.current?.getBoundingClientRect().height ?? 0;
									setFrozenHeight(h > 0 ? h : null);
									setFullscreenToolCallId(widget.toolCallId);
								} else {
									setFrozenHeight(null);
									setFullscreenToolCallId(null);
								}
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
						<div className="ww:px-4 ww:pb-2 ww:pt-2">
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
								<div className="ww:pt-2 ww:pb-1 ww:flex ww:flex-nowrap ww:justify-center ww:items-center ww:gap-1.5">
									<PoweredBy />
									<AiDisclaimer text={disclaimer} />
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		);
	},
);
