// ============================================================================
// ComposerChat — the `mode: "composer"` embed surface.
//
// A single composer that sits **in the page flow** (inside the host's
// `[data-waniwani-embed]` element), sized by the host's own CSS: a hero search
// box, a card in a support page, a row under a pricing table. It renders the
// input and the agent's suggestion pills, nothing else. As soon as the visitor
// sends their first message (typed or a pill) the full chat panel opens over
// the page and takes the conversation from there — the same panel `mode:
// "floating"` opens, reusing its clip-path expand.
//
// Two mounts, one React tree. The composer renders where the host placed it;
// the panel is portaled into a body-level overlay container (created by
// `embed.ts`, passed in as `panelContainer`) because a `position: fixed` panel
// rendered inside the host's own subtree would resolve against the nearest
// ancestor with a `transform`/`filter`/`contain` and land in the wrong place.
// A portal keeps the panel out of the host's containing-block chain while
// leaving the composer and the panel in one component, sharing one `ChatEmbed`
// and one event emitter.
//
// The chat itself (`ChatEmbed`) is mounted eagerly but kept hidden until the
// panel opens, so the composer can hand off the first message to it and the
// imperative API works before the panel is ever shown.
// ============================================================================

import type { UIMessage } from "ai";
import { ArrowUp, Minus } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import type { ChatHandle } from "../@types";
import BorderGlow from "../components/border-glow";
import { Suggestions } from "../components/suggestions";
import { useSuggestionIngest } from "../hooks/use-suggestion-ingest";
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
import { I18nProvider, useTranslation } from "../i18n";
import { ChatEmbed } from "../layouts/chat-embed";
import { resolveSuggestions } from "../lib/resolve-suggestions";
import { cn } from "../lib/utils";
import { themeToCSSProperties } from "../theme";
import type { EmbedConfig } from "./config";
import { useRemoteEmbedConfig } from "./remote-config";
import { useVisibilityGate } from "./use-pathname";
import { useSuggestions } from "./use-suggestions";
import { createWidgetEventEmitter } from "./widget-events";
import { WidgetEventsProvider } from "./widget-events-context";

export interface ComposerChatProps {
	config: EmbedConfig;
	programmatic?: Partial<EmbedConfig>;
	/** Pre-parsed `data-*` snapshot. */
	scriptConfig?: Partial<EmbedConfig>;
	/**
	 * Body-level node the chat panel portals into. Owned by `embed.ts` (its own
	 * shadow root, styles injected), so the fixed panel escapes any transformed
	 * ancestor in the host's markup.
	 */
	panelContainer: Element;
	/**
	 * Called whenever per-URL `visibility` gating flips. `embed.ts` uses it to
	 * collapse the `[data-waniwani-embed]` container (which it owns, outside
	 * React) so a gated page shows no empty box. The chat stays mounted while
	 * hidden, so conversation state survives an SPA route change away and back.
	 */
	onVisibilityChange?: (visible: boolean) => void;
}

export interface ComposerChatHandle {
	/** Open the full chat panel. */
	open: () => void;
	/** Close the panel, back to the in-flow composer. */
	close: () => void;
	/** Toggle the full chat panel. */
	toggle: () => void;
	sendMessage: (text: string) => void;
	sendMessageAndWait: (text: string) => Promise<UIMessage | undefined>;
	reset: () => void;
	focus: () => void;
	getMessages: () => UIMessage[];
	getSessionId: () => string | undefined;
}

export const ComposerChat = forwardRef<ComposerChatHandle, ComposerChatProps>(
	function ComposerChat(props, ref) {
		return (
			<I18nProvider locale={props.config.locale}>
				<ComposerChatInner {...props} ref={ref} />
			</I18nProvider>
		);
	},
);

const ComposerChatInner = forwardRef<ComposerChatHandle, ComposerChatProps>(
	function ComposerChatInner(
		{
			config: initialConfig,
			programmatic,
			scriptConfig,
			panelContainer,
			onVisibilityChange,
		},
		ref,
	) {
		const { t } = useTranslation();
		// Resolve remote config here so the composer can show the dashboard's
		// suggestions / placeholder; `ChatEmbed` below skips its own fetch.
		const { config, ready } = useRemoteEmbedConfig(
			initialConfig,
			programmatic,
			scriptConfig,
		);

		// Per-URL gating, same contract as the inline mount: report the decision
		// up so `embed.ts` collapses the host container, rather than leaving a
		// composer on a page the channel's rules hide.
		const visible = useVisibilityGate(config.visibility, ready);
		useEffect(() => {
			onVisibilityChange?.(visible);
		}, [visible, onVisibilityChange]);

		const chatRef = useRef<ChatHandle>(null);
		// One emitter per mount. The session id getter reads through the chat
		// handle so events pick up the session id as soon as it exists.
		const widgetEvents = useMemo(
			() =>
				createWidgetEventEmitter({
					mode: "composer",
					getSessionId: () => chatRef.current?.sessionId,
				}),
			[],
		);
		const onEvent = config.onEvent;
		useEffect(() => {
			if (!onEvent) {
				return;
			}
			return widgetEvents.subscribe(onEvent);
		}, [onEvent, widgetEvents]);

		const textareaRef = useRef<HTMLTextAreaElement>(null);
		const [open, setOpen] = useState(false);
		const [composerText, setComposerText] = useState("");
		// Bumped to request focusing the chat input once the panel has opened.
		// A textarea inside a still-hidden panel can't take focus, and React
		// commits the open state after our handlers return, so we focus from an
		// effect (below) rather than synchronously / via rAF.
		const [focusNonce, setFocusNonce] = useState(0);

		const preset = config.appearance?.theme;
		const userVars = config.appearance?.variables;
		const cssVars = useMemo(
			() => (userVars ? themeToCSSProperties(userVars) : {}),
			[userVars],
		);

		// The page and channel rungs for this URL; ids ride along for click
		// attribution. Memoized inside the hook — the pill row keys an effect
		// on this object's identity.
		const suggestions = useSuggestions(config);
		// The composer renders the same pre-chat row the panel would, resolved
		// through the same hierarchy so its impression event carries the exact
		// origin. No turn has happened yet, so the two turn-derived rungs are
		// absent by construction.
		const composerRow = useMemo(
			() => resolveSuggestions({ flow: null, followup: null, ...suggestions }),
			[suggestions],
		);
		const composerTexts = useMemo(
			() => composerRow?.suggestions.map((s) => s.text) ?? [],
			[composerRow],
		);

		// Record every suggestion click and every rendered pill set server-side,
		// attributed to the authored prompts involved. Covers both the composer's
		// pills and the panel's own.
		useSuggestionIngest({
			widgetEvents,
			api: config.api,
			token: config.token,
			channelId: config.channelId,
			source: config.source,
			mode: "composer",
			pagePrompts: suggestions.page,
			getSessionId: () => chatRef.current?.sessionId,
		});

		// One impression per rendered row, keyed on the resolved row's identity —
		// a new fetch (SPA navigation) is a new object and counts again;
		// re-renders of the same row don't. Unlike the floating dock there is no
		// reveal gesture: the pills are on screen as soon as the row resolves.
		const shownSuggestionsRef = useRef<typeof composerRow>(null);
		useEffect(() => {
			if (!visible || !composerRow) {
				return;
			}
			if (shownSuggestionsRef.current === composerRow) {
				return;
			}
			shownSuggestionsRef.current = composerRow;
			widgetEvents.emit({
				name: "suggestions.shown",
				properties: { texts: composerTexts, origin: composerRow.origin },
			});
		}, [visible, composerRow, composerTexts, widgetEvents]);

		// The composer is the chat's entry point, so it shows the configured input
		// placeholder by default (`data-launcher-text` overrides it for an
		// entry-specific prompt). Typed out like the in-chat input.
		const composerPlaceholder =
			config.launcherText ?? config.placeholder ?? t.launcher.prompt;
		const animatedPlaceholder = useTypingPlaceholder(
			composerPlaceholder,
			composerText.length === 0,
		);

		// Card shadow shared by the composer and the panel — matches the inline
		// embed's default (themeable via --ww-shadow).
		const cardShadow = "var(--ww-shadow, 0 10px 30px rgba(0, 0, 0, 0.08))";

		// Grow the textarea with its content, up to the max height set in CSS
		// (past that it scrolls). Driven by the *value* only: measuring while
		// empty would make a placeholder long enough to wrap grow and shrink the
		// box on every frame of the typing animation, so an empty composer stays
		// at its natural single row.
		useEffect(() => {
			const el = textareaRef.current;
			if (!el) {
				return;
			}
			if (!composerText) {
				el.style.height = "";
				return;
			}
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		}, [composerText]);

		// Focus the chat input after the panel has opened. Runs post-commit, so
		// the panel's textarea is in layout and can take focus. Skipped on the
		// initial render (`focusNonce === 0`).
		useEffect(() => {
			if (focusNonce > 0 && open) {
				chatRef.current?.focus();
			}
		}, [focusNonce, open]);

		// `chat.ready` once the remote config has resolved.
		const readyEmittedRef = useRef(false);
		useEffect(() => {
			if (ready && !readyEmittedRef.current) {
				readyEmittedRef.current = true;
				widgetEvents.emit({ name: "chat.ready" });
			}
		}, [ready, widgetEvents]);

		// Open/close transitions. `visible` folds the per-URL gate in, so a panel
		// hidden by an SPA route change reports `chat.closed` — events reflect
		// what is on screen. No event on mount.
		const wasOpenRef = useRef(false);
		useEffect(() => {
			const isOpen = visible && open;
			if (isOpen === wasOpenRef.current) {
				return;
			}
			wasOpenRef.current = isOpen;
			widgetEvents.emit({ name: isOpen ? "chat.opened" : "chat.closed" });
		}, [visible, open, widgetEvents]);

		const openWith = useCallback((text: string) => {
			setOpen(true);
			// Hand focus to the panel's own input. The in-flow composer is page
			// content and stays visible behind the panel, so without this the
			// caret sits in a box the visitor can no longer see and their next
			// keystrokes land there. (The floating dock gets this for free: it
			// goes `visibility: hidden` when the panel opens, which drops focus.)
			setFocusNonce((n) => n + 1);
			const trimmed = text.trim();
			if (trimmed) {
				chatRef.current?.sendMessage(trimmed);
			}
		}, []);

		useImperativeHandle(
			ref,
			() => ({
				open: () => setOpen(true),
				close: () => setOpen(false),
				toggle: () => setOpen((o) => !o),
				sendMessage: (text: string) => openWith(text),
				sendMessageAndWait: async (text: string) => {
					setOpen(true);
					const chat = chatRef.current;
					if (!chat) {
						return undefined;
					}
					return (await chat.sendMessageAndWait(text)) as UIMessage | undefined;
				},
				reset: () => chatRef.current?.reset(),
				focus: () => {
					// Docs contract: in composer mode `focus()` lands on the in-flow
					// input while the panel is closed (that is the visible field), and
					// on the chat input once it is open.
					if (open) {
						setFocusNonce((n) => n + 1);
					} else {
						textareaRef.current?.focus();
					}
				},
				getMessages: () => chatRef.current?.messages ?? [],
				getSessionId: () => chatRef.current?.sessionId,
			}),
			[openWith, open],
		);

		const submitComposer = useCallback(() => {
			if (composerText.trim()) {
				openWith(composerText);
				setComposerText("");
			}
		}, [composerText, openWith]);

		const onComposerFocus = useCallback(() => {
			// Once a conversation exists, the visitor has history they can't see
			// from the in-flow box — clicking back into it reopens the panel rather
			// than starting a second, parallel composer. Focusing the chat input
			// happens in the focus effect, once the panel is painted.
			if ((chatRef.current?.messages.length ?? 0) > 0) {
				setOpen(true);
				setFocusNonce((n) => n + 1);
			}
		}, []);

		// `mode` tags every chat request with the embed surface so server-logged
		// chat events carry it in `properties.mode`, matching `page.viewed`.
		const body: Record<string, unknown> = { mode: "composer" };
		if (config.mcpServerUrl) {
			body.mcpServerUrl = config.mcpServerUrl;
		}
		if (config.channelId) {
			body.channelId = config.channelId;
		}

		const closeButton = (
			<button
				type="button"
				onClick={() => setOpen(false)}
				aria-label={t.launcher.close}
				className="ww:flex ww:size-7 ww:items-center ww:justify-center ww:rounded-md ww:text-muted-foreground ww:transition-colors hover:ww:bg-accent hover:ww:text-foreground ww:cursor-pointer"
			>
				<Minus className="ww:size-4" />
			</button>
		);

		// The in-flow composer. Fills the host's container so the host's own CSS
		// decides how wide it is; height is content-driven (no `data-height`).
		const composer = (
			<div
				data-waniwani-chat=""
				data-color-scheme={preset === "auto" ? "auto" : undefined}
				data-waniwani-composer="input"
				// While the panel is open the composer is content behind an
				// overlay: keep it in layout (removing it would shift the page)
				// but inert, so tabbing inside the panel can't walk into the box
				// underneath it and screen readers don't announce it. One
				// attribute covers focus, pointer events and the a11y tree;
				// browsers without `inert` support simply keep today's behavior.
				inert={open}
				className={cn(
					"ww:w-full ww:font-[family-name:var(--ww-font-sans)]",
					preset === "dark" && "dark",
				)}
				style={cssVars}
			>
				{/* Composer wrapped in the ReactBits border glow. Background + radius
				    are themed to match the input surface; the glow plays a one-off
				    sweep once the config has resolved. */}
				<BorderGlow
					animated={ready}
					backgroundColor="var(--ww-color-input)"
					borderRadius={16}
					edgeSensitivity={30}
					coneSpread={25}
					colors={["#c084fc", "#f472b6", "#38bdf8"]}
					className="ww:border-border"
					style={{ boxShadow: cardShadow }}
				>
					<div className="ww:flex ww:items-end ww:gap-1 ww:pl-3.5 ww:pr-1.5 ww:py-1.5 ww:sm:pl-4 ww:sm:pr-2 ww:sm:py-2">
						{/* `text-base` (16px) on mobile is load-bearing: iOS Safari
						    auto-zooms a focused input under 16px. `sm:text-sm` restores
						    the smaller text where the zoom rule doesn't apply. Do not
						    drop the 16px mobile size. */}
						<textarea
							ref={textareaRef}
							rows={1}
							value={composerText}
							placeholder={animatedPlaceholder}
							onChange={(e) => setComposerText(e.target.value)}
							onFocus={onComposerFocus}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									submitComposer();
								}
							}}
							className="ww:min-w-0 ww:flex-1 ww:resize-none ww:bg-transparent ww:py-1.5 ww:max-h-36 ww:text-base ww:sm:text-sm ww:text-foreground ww:outline-none ww:placeholder:text-muted-foreground"
						/>
						<button
							type="button"
							onClick={submitComposer}
							disabled={!composerText.trim()}
							aria-label={t.promptInput.submit}
							className="ww:relative ww:flex ww:size-8 ww:shrink-0 ww:items-center ww:justify-center ww:rounded-full ww:bg-foreground ww:text-background ww:transition-opacity hover:ww:opacity-90 disabled:ww:opacity-40"
						>
							<ArrowUp className="ww:size-4" />
						</button>
					</div>
				</BorderGlow>

				{composerTexts.length > 0 && (
					<Suggestions
						suggestions={composerTexts}
						onSelect={(text) => {
							widgetEvents.emit({
								name: "suggestion.clicked",
								properties: {
									text,
									index: composerTexts.indexOf(text),
									origin: composerRow?.origin ?? "channel",
								},
							});
							openWith(text);
						}}
						// In-flow pills sit under the box, so they only need the
						// horizontal alignment of the input's own padding.
						className="ww:px-0.5 ww:pt-2.5 ww:pb-0"
					/>
				)}
			</div>
		);

		// The panel, portaled to the body-level overlay. It carries its own theme
		// wrapper: CSS vars are set on the composer's wrapper above, which is not
		// an ancestor of the portal target, so they cannot inherit across.
		//
		// `data-waniwani-floating="panel"` is deliberate — the presentation and
		// the clip-path expand are the floating panel's, and sharing the attribute
		// keeps one animation to maintain instead of a near-copy per surface.
		const panel = (
			<div
				data-waniwani-chat=""
				data-color-scheme={preset === "auto" ? "auto" : undefined}
				className={cn(
					"ww:contents ww:font-[family-name:var(--ww-font-sans)]",
					preset === "dark" && "dark",
				)}
				style={cssVars}
			>
				<div
					role="dialog"
					aria-label={config.title ?? composerPlaceholder}
					data-waniwani-floating="panel"
					data-state={visible && open ? "shown" : "hidden"}
					style={{ boxShadow: cardShadow }}
					className={cn(
						"ww:fixed ww:z-[2147483002] ww:flex ww:flex-col ww:overflow-hidden ww:bg-background",
						// Mobile: full-screen sheet.
						"ww:inset-0 ww:w-full ww:rounded-none",
						// Desktop: wide ChatGPT-style card, matching floating mode.
						"ww:sm:inset-auto ww:sm:bottom-4 ww:sm:left-0 ww:sm:right-0 ww:sm:mx-auto ww:sm:h-[720px] ww:sm:max-h-[calc(100dvh-2rem)] ww:sm:w-[calc(100vw-2rem)] ww:sm:max-w-[1000px] ww:sm:rounded-2xl ww:sm:border ww:sm:border-border",
					)}
				>
					<ChatEmbed
						ref={chatRef}
						api={config.api ?? ""}
						headers={{ Authorization: `Bearer ${config.token}` }}
						skipRemoteConfig
						body={body}
						appearance={config.appearance}
						title={config.title}
						headerActions={closeButton}
						// Force the header on: the close control lives in
						// `headerActions`, so honoring `hideHeader` would leave an
						// opened (full-screen on mobile) panel with no way back to the
						// page. The panel is its own chrome anyway.
						hideHeader={false}
						// Mounted eagerly behind the page, so without this the panel's
						// own pill row reports impressions for pills no visitor has
						// seen, and double-counts the pre-chat row the composer already
						// announced.
						onScreen={open}
						welcomeMessage={config.welcomeMessage}
						placeholder={config.placeholder}
						suggestions={suggestions}
						enableThreadHistory={config.enableThreadHistory}
						documentUpload={config.documentUpload}
						showToolCalls={config.showToolCalls}
						locale={config.locale}
						initializing={!ready}
					/>
				</div>
			</div>
		);

		return (
			<WidgetEventsProvider value={widgetEvents}>
				{composer}
				{createPortal(panel, panelContainer)}
			</WidgetEventsProvider>
		);
	},
);
