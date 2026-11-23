"use client";

import type { ModelContextUpdate } from "@waniwani/core/shared/model-context";
import { ArrowDownIcon } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { ChatEmbedProps, ChatHandle, WelcomeConfig } from "../@types";
import {
	PromptInput,
	PromptInputAddAttachments,
	PromptInputAttachments,
	PromptInputDropOverlay,
	PromptInputSubmit,
	PromptInputTextarea,
} from "../ai-elements/prompt-input";
import { AiDisclaimer } from "../components/ai-disclaimer";
import { Avatar, avatarFor } from "../components/avatar";
import { ChatMenu } from "../components/chat-menu";
import { ChatQueue } from "../components/chat-queue";
import { MessageList } from "../components/message-list";
import { NewThreadButton } from "../components/new-thread-button";
import { PoweredBy } from "../components/powered-by";
import { Suggestions } from "../components/suggestions";
import { ThreadMenu } from "../components/thread-menu";
import { splitPipeList } from "../embed/config";
import { useWidgetEvents } from "../embed/widget-events-context";
import { useCallTool } from "../hooks/use-call-tool";
import { useChatEngine } from "../hooks/use-chat-engine";
import { useDocumentUpload } from "../hooks/use-document-upload";
import { useMultiline } from "../hooks/use-multiline";
import { useSuggestionRow } from "../hooks/use-suggestion-row";
import { isTouchPrimary } from "../hooks/use-touch-primary";
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
import { I18nProvider, type Messages, useTranslation } from "../i18n";
import { copyText, formatTranscript } from "../lib/conversation-transcript";
import { focusWithoutScroll } from "../lib/focus-without-scroll";
import { buildResourceEndpoint } from "../lib/resource-endpoint";
import {
	bearerToken,
	sendTiming,
	type TimingTarget,
	type WidgetTimingSink,
} from "../lib/timing";
import { WidgetTimingProvider } from "../lib/timing-context";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";
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

/** Within this distance of the bottom, the thread follows new content again. */
const FOLLOW_DISTANCE_PX = 80;

const ChatEmbedInner = forwardRef<ChatHandle, ChatEmbedProps>(
	function ChatEmbedInner(props, ref) {
		const { t, locale: activeLocale, ready: localeReady } = useTranslation();
		const {
			appearance,
			className,
			classNames,
			allowAttachments = false,
			documentUpload,
			welcomeMessage,
			welcome,
			welcomeVariant = "cards",
			suggestionsLayout = "wrap",
			suggestionsPosition = "above-input",
			sendIcon = "up",
			showTableToolbar = true,
			avatar,
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
			toolLabels,
			initializing = false,
			onScreen = true,
			mode,
			disclaimer,
			hidePoweredBy = false,
			menu,
			restartConfirm = false,
		} = props;

		// Preset → base theme. `light` and the unset case let the CSS
		// defaults in tailwind.css drive the look (no inline vars needed).
		// `dark` switches via the `.dark` class on the wrapper, which flips
		// the CSS-var fallbacks. `auto` switches via `data-color-scheme`
		// and a `prefers-color-scheme` media query in tailwind.css.
		const preset = appearance?.theme;
		const userVars = appearance?.variables;
		const assistantBubble = appearance?.assistantBubble ?? false;

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
		const widgetEvents = useWidgetEvents();
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

		// Read through a ref so the sink identity stays stable as the session id
		// lands, which would otherwise re-render every mounted widget frame.
		const timingTargetRef = useRef<TimingTarget>({});
		timingTargetRef.current = {
			api,
			token: bearerToken(props.headers),
			channelId:
				typeof props.body?.channelId === "string"
					? props.body.channelId
					: undefined,
			sessionId: engine.sessionId,
		};
		const widgetTiming = useCallback<WidgetTimingSink>((report) => {
			sendTiming(
				"widget",
				timingTargetRef.current,
				{ widget: report.widget, outcome: report.outcome },
				report.metrics,
			);
		}, []);

		const animatedPlaceholder = useTypingPlaceholder(placeholder, !engine.text);
		const fieldRowRef = useRef<HTMLDivElement>(null);
		const multiline = useMultiline(fieldRowRef, engine.text);

		const uploads = useDocumentUpload({
			api,
			headers: props.headers,
			uploadHeaders: props.uploadHeaders,
			sessionId: engine.sessionId,
			documentUpload,
			allowAttachments,
		});

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
		// Whether the view follows new content to the bottom. Set when the
		// visitor sends or comes back to the bottom; cleared as soon as they
		// scroll up, so an answer streaming in never drags them away from what
		// they are reading.
		const followRef = useRef(true);

		const focusInput = useCallback(() => {
			const container = rootRef.current;
			if (!container) {
				return;
			}
			const textarea = container.querySelector("textarea");
			if (!textarea) {
				return;
			}
			// On a touch screen this focus raises the keyboard, and Safari
			// would scroll the page to the field first (see
			// `lib/focus-without-scroll.ts`).
			if (isTouchPrimary()) {
				focusWithoutScroll(textarea);
			} else {
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

		// Delegated click listener on the messages scroller: reports every anchor click
		// inside the conversation (markdown-rendered links) to the widget event
		// emitter without customizing the markdown pipeline.
		useEffect(() => {
			const scroller = scrollRef.current;
			if (!scroller) {
				return;
			}
			const onClick = (e: MouseEvent) => {
				const target = e.target instanceof Element ? e.target : null;
				const anchor = target?.closest("a");
				if (anchor?.href) {
					widgetEvents.emit({
						name: "link.clicked",
						properties: { url: anchor.href },
					});
				}
			};
			scroller.addEventListener("click", onClick);
			return () => scroller.removeEventListener("click", onClick);
		}, [widgetEvents]);

		// A message the visitor just sent always comes into view, with a smooth
		// scroll so the jump reads as motion. Everything after that (the answer
		// streaming in, widget iframes growing) moves the view through the
		// ResizeObserver below, with instant scrolls: a smooth scroll restarted
		// on every token stutters, and on iOS it also kills the visitor's own
		// momentum scroll.
		// biome-ignore lint/correctness/useExhaustiveDependencies: runs when a message is added or removed
		useEffect(() => {
			const last = engine.messages[engine.messages.length - 1];
			if (last?.role === "user") {
				followRef.current = true;
				scrollToBottom("smooth");
			} else if (followRef.current) {
				scrollToBottom("auto");
			}
		}, [engine.messages.length]);

		// Follow or stop following from the visitor's own scrolling. Any move
		// up stops it, checked first: a scroll up starts inside the "near the
		// bottom" band, and the next streamed token would pull the visitor
		// back before they ever left it. Coming back within reach of the bottom
		// starts it again. Content that shrinks also moves `scrollTop` up (the
		// browser clamps it), so only a move up while the content kept its
		// height or grew counts.
		useEffect(() => {
			const scroller = scrollRef.current;
			if (!scroller) {
				return;
			}
			let lastTop = scroller.scrollTop;
			let lastHeight = scroller.scrollHeight;
			const onScroll = () => {
				const top = scroller.scrollTop;
				const height = scroller.scrollHeight;
				const distance = height - top - scroller.clientHeight;
				if (top < lastTop - 1 && height >= lastHeight) {
					followRef.current = false;
				} else if (distance <= FOLLOW_DISTANCE_PX) {
					followRef.current = true;
				}
				lastTop = top;
				lastHeight = height;
			};
			scroller.addEventListener("scroll", onScroll, { passive: true });
			return () => scroller.removeEventListener("scroll", onScroll);
		}, []);

		useEffect(() => {
			scrollToBottom("auto");
		}, [scrollToBottom]);

		// Keep the view pinned to the bottom while it follows, whenever the
		// scroll container or its content changes size:
		//   - streamed tokens and MCP App iframes that grow after their
		//     handshake make the content taller without a new message;
		//   - the soft keyboard and the embed host settling its height make the
		//     container shorter.
		// Instant on purpose (see the message effect above).
		useEffect(() => {
			if (typeof ResizeObserver === "undefined") {
				return;
			}
			const scroller = scrollRef.current;
			const content = scrollContentRef.current;
			if (!scroller && !content) {
				return;
			}
			const observer = new ResizeObserver(() => {
				if (followRef.current) {
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

		const suggestionsState = useSuggestionRow({
			messages: engine.messages,
			status: engine.status,
			suggestions: props.suggestions,
		});

		const shownWelcome =
			welcomeVariant === "pills"
				? resolvePillsWelcome(welcome, t, avatar, suggestionsState.suggestions)
				: welcome;
		const rowInWelcome =
			welcomeVariant === "pills" &&
			Boolean(shownWelcome) &&
			engine.messages.length === 0;
		const lastMessage = engine.messages[engine.messages.length - 1];
		const rowAfterMessage =
			suggestionsPosition === "after-message" && engine.messages.length > 0;
		const rowShown =
			rowInWelcome ||
			!rowAfterMessage ||
			(lastMessage?.role === "assistant" && engine.status === "ready");

		// Announce every pill set the visitor actually saw, once per set — keyed
		// on the array identity `useSuggestionRow` returns (a new array per
		// config load / streamed turn), so re-renders of the same set stay
		// silent. The embed hosts subscribe and log one impression per set.
		//
		// `onScreen` holds the announcement rather than dropping it: a hidden
		// mount that becomes visible with the same row still owes its
		// impression, so the effect re-runs and reports it then.
		const announcedSuggestionsRef = useRef<string[] | null>(null);
		useEffect(() => {
			const current = suggestionsState.suggestions;
			if (
				!onScreen ||
				!rowShown ||
				current.length === 0 ||
				announcedSuggestionsRef.current === current
			) {
				return;
			}
			announcedSuggestionsRef.current = current;
			widgetEvents.emit({
				name: "suggestions.shown",
				properties: { texts: current, origin: suggestionsState.source },
			});
		}, [
			suggestionsState.suggestions,
			suggestionsState.source,
			widgetEvents,
			onScreen,
			rowShown,
		]);

		// Welcome-screen cards are a second, separately-rendered set of pills:
		// they live in the message area rather than the row above the input, and
		// `MessageList` shows them while the conversation is empty. Announced
		// here so a card that earns a click has a matching impression — the
		// click already reports itself through `handleSuggestionSelect`.
		const welcomeSuggestions = welcome?.suggestions;
		const announcedWelcomeRef = useRef<string[] | null>(null);
		useEffect(() => {
			if (
				!onScreen ||
				engine.messages.length > 0 ||
				!welcomeSuggestions?.length ||
				announcedWelcomeRef.current === welcomeSuggestions
			) {
				return;
			}
			announcedWelcomeRef.current = welcomeSuggestions;
			widgetEvents.emit({
				name: "suggestions.shown",
				// Welcome cards are always operator-authored channel prompts, the
				// same origin `handleSuggestionSelect` reports for their clicks.
				properties: { texts: welcomeSuggestions, origin: "channel" },
			});
		}, [welcomeSuggestions, engine.messages.length, widgetEvents, onScreen]);

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
				const dynamicIndex = suggestionsState.suggestions.indexOf(suggestion);
				const index =
					dynamicIndex >= 0
						? dynamicIndex
						: (welcome?.suggestions?.indexOf(suggestion) ?? -1);
				// Welcome-screen cards are always operator-authored channel prompts;
				// only the live pill row can carry another origin.
				const origin = dynamicIndex >= 0 ? suggestionsState.source : "channel";
				widgetEvents.emit({
					name: "suggestion.clicked",
					properties: { text: suggestion, index, origin },
				});
				suggestionsState.clear();
				engine.handleSubmit({ text: suggestion, files: [] });
			},
			[
				suggestionsState.suggestions,
				suggestionsState.source,
				suggestionsState.clear,
				engine.handleSubmit,
				welcome,
				widgetEvents,
			],
		);

		const composerEmpty = engine.text.trim().length === 0;
		const suggestionRow = (
			<Suggestions
				suggestions={suggestionsState.suggestions}
				isLoading={suggestionsState.isLoading}
				origin={suggestionsState.source}
				layout={suggestionsLayout}
				onSelect={handleSuggestionSelect}
			/>
		);

		const restart = useCallback(() => {
			if (enableThreadHistory) {
				engine.startNewThread();
			} else {
				engine.reset();
			}
			widgetEvents.emit({ name: "conversation.restarted" });
		}, [
			enableThreadHistory,
			engine.startNewThread,
			engine.reset,
			widgetEvents,
		]);

		const copyConversation = useCallback(async () => {
			const date = new Intl.DateTimeFormat(activeLocale, {
				dateStyle: "long",
			}).format(new Date());
			const transcript = formatTranscript(engine.messages, {
				header: t.transcript.header(window.location.hostname, date),
				you: t.transcript.you,
				assistant: t.transcript.assistant,
			});
			const copied = await copyText(transcript);
			if (copied) {
				widgetEvents.emit({ name: "conversation.copied" });
			}
			return copied;
		}, [engine.messages, activeLocale, t, widgetEvents]);

		useImperativeHandle(
			ref,
			() => ({
				sendMessage: (text: string) => {
					engine.handleSubmit({ text, files: [] });
					focusInput();
				},
				sendMessageAndWait: (text: string) => engine.sendMessageAndWait(text),
				reset: engine.reset,
				restart,
				copyConversation,
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
				restart,
				copyConversation,
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

		const menuActions = menu?.length ? menu : undefined;
		const showHeader =
			!hideHeader &&
			Boolean(
				title ||
					enableThreadHistory ||
					engine.keepsSession ||
					headerActions ||
					menuActions,
			);

		const headerAvatar = avatarFor(avatar, "header");
		const composerAvatar = avatarFor(avatar, "composer");

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
				data-mode={mode}
				data-assistant-bubble={assistantBubble ? "true" : undefined}
				data-color-scheme={preset === "auto" ? "auto" : undefined}
				{...(masked ? { "data-waniwani-initializing": "" } : {})}
				{...(isDark ? { "data-waniwani-dark": "" } : {})}
				className={cn(
					PARTS.root,
					"ww:relative ww:w-full ww:h-full ww:flex ww:flex-col ww:bg-background ww:text-foreground ww:font-[family-name:var(--ww-font)] ww:overflow-hidden",
					preset === "dark" && "dark",
					className,
					classNames?.root,
				)}
			>
				{showHeader && (
					<div
						className={cn(
							PARTS.header,
							"ww:shrink-0 ww:h-[var(--ww-header-height)] ww:flex ww:items-center ww:gap-2 ww:pl-4 ww:pr-3 ww:py-3 ww:border-b ww:border-border",
							classNames?.header,
						)}
						style={{
							backgroundColor: "var(--ww-color-card-header)",
							color: "var(--ww-color-card-header-foreground)",
						}}
					>
						{headerAvatar && (
							<Avatar
								src={headerAvatar}
								slot="header"
								intro={avatar?.intro}
								visible={onScreen}
							/>
						)}
						{title && (
							<div
								className={cn(
									PARTS.headerTitle,
									"ww:text-sm ww:font-semibold ww:truncate ww:flex-1 ww:min-w-0",
								)}
							>
								{title}
							</div>
						)}
						{!title && <div className="ww:flex-1" />}
						{menuActions && (
							<ChatMenu
								actions={menuActions}
								restartConfirm={restartConfirm}
								onNewChat={
									enableThreadHistory ? engine.startNewThread : engine.reset
								}
								onRestart={restart}
								onCopy={copyConversation}
								threads={engine.threads}
								activeThreadId={engine.activeThreadId}
								onSelectThread={(id) => {
									void engine.switchThread(id);
								}}
								onDeleteThread={(id) => {
									void engine.deleteThread(id);
								}}
							/>
						)}
						{!menuActions && !enableThreadHistory && engine.keepsSession && (
							<NewThreadButton onClick={engine.reset} />
						)}
						{!menuActions && enableThreadHistory && (
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
						    close button) sit at the far right of the header. */}
						{headerActions && (
							<div className={cn(PARTS.headerActions, "ww:contents")}>
								{headerActions}
							</div>
						)}
					</div>
				)}

				<div
					ref={scrollRef}
					className={cn(
						PARTS.thread,
						// `overscroll-contain`: a swipe past either end of the thread
						// stops there instead of scrolling the page behind the chat.
						"ww:relative ww:flex-1 ww:min-h-0 ww:overscroll-contain",
						fullscreenToolCallId ? "ww:overflow-hidden" : "ww:overflow-y-auto",
					)}
				>
					<div
						ref={scrollContentRef}
						className={cn(
							PARTS.content,
							"ww:mx-auto ww:w-full ww:max-w-[var(--ww-content-max-width)] ww:px-4 ww:py-6 ww:flex ww:flex-col ww:gap-6",
							fullscreenToolCallId && "ww:!py-0",
						)}
					>
						<WidgetTimingProvider value={widgetTiming}>
							<MessageList
								messages={engine.messages}
								status={engine.status}
								welcomeMessage={welcomeMessage}
								welcome={shownWelcome}
								welcomeVariant={welcomeVariant}
								welcomeAppeared={onScreen}
								messageAvatar={avatarFor(avatar, "message")}
								welcomeAvatarIntro={avatar?.intro}
								trailing={rowAfterMessage ? suggestionRow : undefined}
								onSuggestionSelect={handleSuggestionSelect}
								resourceEndpoint={resourceEndpoint}
								chatSessionId={engine.sessionId}
								isDark={isDark}
								onFollowUp={handleWidgetMessage}
								onCallTool={handleCallTool}
								fullscreenToolCallId={fullscreenToolCallId}
								debug={debug}
								showToolCalls={showToolCalls}
								toolLabels={toolLabels}
								showTableToolbar={showTableToolbar}
								toolDefinitions={engine.toolDefinitions}
								messageClassNames={{
									message: classNames?.message,
									userBubble: classNames?.userBubble,
									assistantBubble: classNames?.assistantBubble,
								}}
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
						</WidgetTimingProvider>
						<div ref={bottomRef} aria-hidden style={{ height: 1 }} />
					</div>
					{!atBottom && !fullscreenToolCallId && (
						<div className="ww:sticky ww:bottom-2 ww:flex ww:justify-center ww:pointer-events-none">
							<Button
								type="button"
								onClick={() => {
									followRef.current = true;
									scrollToBottom("smooth");
								}}
								size="icon"
								variant="outline"
								className={cn(
									PARTS.scrollLatest,
									"ww:rounded-full ww:shadow ww:pointer-events-auto",
								)}
								aria-label={t.thread.scrollToLatest}
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
						{!rowInWelcome && !rowAfterMessage && suggestionRow}
						<ChatQueue
							queuedMessages={engine.queuedMessages}
							onRemove={engine.removeQueuedMessage}
						/>
						<div className="ww:px-4 ww:pb-2 ww:pt-2">
							<div
								className={cn(
									PARTS.content,
									"ww:mx-auto ww:w-full ww:max-w-[var(--ww-content-max-width)]",
								)}
							>
								<PromptInput
									status={engine.status}
									empty={composerEmpty}
									data-multiline={multiline ? "true" : "false"}
									onSubmit={engine.handleSubmit}
									attachmentsEnabled={uploads.enabled}
									globalDrop={uploads.enabled}
									multiple={uploads.enabled}
									accept={uploads.accept}
									maxFileSize={uploads.maxFileSize}
									maxPdfPages={uploads.maxPdfPages}
									maxFiles={uploads.maxFiles}
									upload={uploads.upload}
									onDiscard={uploads.onDiscard}
									onError={uploads.reportError}
									className={cn(PARTS.input, "ww:bg-input", classNames?.input)}
								>
									<PromptInputDropOverlay enabled={uploads.enabled} />
									{uploads.enabled && (
										<PromptInputAttachments className="ww:px-4 ww:pt-3" />
									)}
									<div
										ref={fieldRowRef}
										className={cn(
											PARTS.inputRow,
											"ww:flex ww:items-center ww:gap-1 ww:pl-4 ww:pr-3 ww:py-2.5",
										)}
									>
										{composerAvatar && (
											<Avatar
												src={composerAvatar}
												slot="composer"
												intro={avatar?.intro}
												visible={onScreen}
											/>
										)}
										{uploads.enabled && <PromptInputAddAttachments />}
										<PromptInputTextarea
											onChange={engine.handleTextChange}
											value={engine.text}
											placeholder={animatedPlaceholder}
											className="ww:min-h-0 ww:py-1 ww:px-0"
										/>
										<PromptInputSubmit
											status={engine.status}
											empty={composerEmpty}
											icon={sendIcon}
											disabled={engine.queueFull}
											onStop={engine.stop}
										/>
									</div>
								</PromptInput>
								{uploads.error && (
									<output
										className={cn(
											PARTS.error,
											"ww:block ww:pt-1.5 ww:text-center ww:text-destructive ww:text-xs",
										)}
									>
										{uploads.error.message}
									</output>
								)}
								<div
									className={cn(
										PARTS.footer,
										"ww:pt-2 ww:pb-1 ww:flex ww:flex-nowrap ww:justify-center ww:items-center ww:gap-1.5",
									)}
								>
									{!hidePoweredBy && <PoweredBy />}
									<AiDisclaimer text={disclaimer} standalone={hidePoweredBy} />
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		);
	},
);

/** So a bare `data-avatar="bot.png"` still reads as an image URL to the welcome icon. */
function absoluteUrl(src: string | undefined): string | undefined {
	if (!src || typeof document === "undefined") {
		return src;
	}
	try {
		return new URL(src, document.baseURI).href;
	} catch {
		return src;
	}
}

/**
 * `data-welcome-*` first, `messages.welcome` for what they leave unset. Its
 * chips are the pre-chat pill row, so they never show twice.
 */
function resolvePillsWelcome(
	welcome: WelcomeConfig | undefined,
	t: Messages,
	avatar: ChatEmbedProps["avatar"],
	rowSuggestions: string[],
): WelcomeConfig | undefined {
	const title = welcome?.title || t.welcome.title;
	if (!title) {
		return undefined;
	}
	const subtitles = welcome?.subtitles ?? splitPipeList(t.welcome.subtitle);
	return {
		...welcome,
		title,
		description: welcome?.description ?? subtitles[0],
		subtitles,
		icon: welcome?.icon ?? absoluteUrl(avatarFor(avatar, "welcome")),
		suggestions: welcome?.suggestions ?? rowSuggestions,
	};
}
