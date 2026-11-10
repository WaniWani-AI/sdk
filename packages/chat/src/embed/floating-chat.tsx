// ============================================================================
// FloatingChat — the `mode: "floating"` embed surface.
//
// After a short appear delay (so the host page settles first) a thin **docked
// input** animates into view at the bottom of the screen — not a launcher
// button. A beat after it settles the bar widens on its own, wraps itself in a
// frosted-glass card (translucent + blurred, so the host page reads through
// it), and reveals the agent's suggestion pills *inside
// that card*, above the input — without opening the chat yet. (Clicking/
// focusing the resting bar does the same thing immediately.) As soon as the
// visitor sends their first message (typed or a suggestion), the full chat
// panel expands open from the input's position.
//
// The chat itself (`ChatEmbed`) is mounted eagerly but kept hidden until the
// panel opens, so the docked input can hand off the first message to it and
// the imperative API works before the panel is ever shown.
// ============================================================================

import type { UIMessage } from "ai";
import { ArrowUp, XIcon } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ChatHandle } from "../@types";
import { Avatar, avatarFor } from "../components/avatar";
import BorderGlow from "../components/border-glow";
import { Suggestions } from "../components/suggestions";
import { useDirectTransport } from "../hooks/use-direct-transport";
import { useNarrowViewport } from "../hooks/use-narrow-viewport";
import { useSuggestionIngest } from "../hooks/use-suggestion-ingest";
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
import { I18nProvider, useTranslation } from "../i18n";
import { ChatEmbed } from "../layouts/chat-embed";
import { resolveSuggestions } from "../lib/resolve-suggestions";
import { useBootTiming } from "../lib/timing-context";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";
import { themeToCSSProperties } from "../theme";
import type { DockChipsTrigger, EmbedConfig } from "./config";
import { useEmbedWelcomeProps } from "./embed-welcome";
import { panelClassName, panelLayoutOf } from "./panel-layout";
import { useRemoteEmbedConfig } from "./remote-config";
import { type EmbedMessages, useEmbedMessages } from "./use-messages-url";
import { useNearPageBottom } from "./use-near-page-bottom";
import { usePanelHistory } from "./use-panel-history";
import { usePanelState } from "./use-panel-state";
import { usePathname, useVisibilityGate } from "./use-pathname";
import { useScrollAppearance } from "./use-scroll-appearance";
import { useScrollPause } from "./use-scroll-pause";
import { useSuggestions } from "./use-suggestions";
import { appearTriggerForPath } from "./visibility";
import { createWidgetEventEmitter } from "./widget-events";
import { WidgetEventsProvider } from "./widget-events-context";

/** Default delay before the docked input animates into view on load. */
const DEFAULT_APPEAR_DELAY_MS = 2000;

/** Tiny beat before the pills reveal — just enough for the collapsed
 *  (`grid-rows-[0fr]`) state to paint so the grow transition actually runs.
 *  Kept short so the card forming and the pills rising read as one motion. */
const SUGGESTIONS_REVEAL_DELAY_MS = 90;

/** Delay after the dock has appeared before the suggestion card auto-expands.
 *  The bar surfaces its CTAs on its own a beat after it settles, rather than
 *  waiting for the visitor to click it. */
const AUTO_EXPAND_DELAY_MS = 1000;

const DEFAULT_CHIPS_TRIGGERS: DockChipsTrigger[] = ["hover"];

/** How long the visitor must stop scrolling in a section before the chips
 *  show, with `dockChipsTrigger: "scroll"`. Longer on phones, where a pause
 *  is often just a thumb lifting between flicks. */
const SCROLL_PAUSE_MS = 1000;
const NARROW_SCROLL_PAUSE_MS = 2500;

const DOCK_FIELD_RADIUS = "var(--ww-dock-field-radius)";

export interface FloatingChatProps {
	config: EmbedConfig;
	programmatic?: Partial<EmbedConfig>;
	/** Pre-parsed `data-*` snapshot. */
	scriptConfig?: Partial<EmbedConfig>;
}

export interface FloatingChatHandle {
	/** Expand the full chat panel. */
	open: () => void;
	/** Collapse back to the docked input. */
	close: () => void;
	/** Toggle the full chat panel. */
	toggle: () => void;
	sendMessage: (text: string) => void;
	sendMessageAndWait: (text: string) => Promise<UIMessage | undefined>;
	reset: () => void;
	restart: () => void;
	copyConversation: () => Promise<boolean>;
	focus: () => void;
	getMessages: () => UIMessage[];
	getSessionId: () => string | undefined;
}

type Phase = "input" | "expanded" | "open";

export const FloatingChat = forwardRef<FloatingChatHandle, FloatingChatProps>(
	function FloatingChat(props, ref) {
		const embedMessages = useEmbedMessages(props.config);
		return (
			<I18nProvider
				locale={props.config.locale}
				messages={embedMessages.messages}
			>
				<FloatingChatInner {...props} embedMessages={embedMessages} ref={ref} />
			</I18nProvider>
		);
	},
);

type InnerProps = FloatingChatProps & { embedMessages: EmbedMessages };

const FloatingChatInner = forwardRef<FloatingChatHandle, InnerProps>(
	function FloatingChatInner(
		{ config: initialConfig, programmatic, scriptConfig, embedMessages },
		ref,
	) {
		const { t } = useTranslation();
		// Resolve remote config here so the dock can show the dashboard's
		// suggestions / placeholder; `ChatEmbed` below skips its own fetch.
		const { config, ready: configReady } = useRemoteEmbedConfig(
			initialConfig,
			programmatic,
			scriptConfig,
		);
		const ready = configReady && embedMessages.ready;

		// Per-URL gating — the dock and panel only render on paths the channel's
		// `visibility` rules resolve to "show". The overlay host stays mounted
		// but is invisible (pointer-events:none, no background), so a gated page
		// shows nothing — no empty box, no flash before remote config resolves.
		const visible = useVisibilityGate(config.visibility, ready);

		// Per-URL "appear after" trigger. On paths with a matching rule the dock
		// holds back until the visitor scrolls past the configured element,
		// replacing the timer below; `null` (no rule / hidden page) keeps the
		// timer. Resolved from the same `visibility` config as the gate.
		const pathname = usePathname();
		const appearAfter = visible
			? appearTriggerForPath(config.visibility, pathname)
			: null;
		const scrolledPast = useScrollAppearance(appearAfter);

		// The dock slides away once the page's footer scrolls into view, so it
		// doesn't cover it. On by default; `hideAtBottom: false` opts out and a
		// number swaps footer detection for a fixed distance from the end of the
		// page. Kept apart from `appeared` so the entrance timer and the
		// auto-expand don't replay on every return.
		const hideAtBottom = config.hideAtBottom;
		const nearBottom = useNearPageBottom(
			!visible || hideAtBottom === false
				? null
				: typeof hideAtBottom === "number"
					? hideAtBottom
					: "footer",
		);

		const chatRef = useRef<ChatHandle>(null);
		// One emitter per mount. The session id getter reads through the chat
		// handle so events pick up the session id as soon as it exists.
		const widgetEvents = useMemo(
			() =>
				createWidgetEventEmitter({
					mode: "floating",
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
		const composerInputRef = useRef<HTMLInputElement>(null);
		const dockRef = useRef<HTMLDivElement>(null);
		const panelRef = useRef<HTMLDivElement>(null);
		// Set when the visitor manually collapses the expanded card (close button)
		// so a still-pending auto-expand timer won't immediately reopen it. Cleared
		// when they click/focus the docked bar again to ask for the CTAs back.
		const userDismissed = useRef(false);
		const [phase, setPhase] = useState<Phase>("input");
		const [composerText, setComposerText] = useState("");
		const [dockHovered, setDockHovered] = useState(false);
		// Gates the dock's entrance: it stays out of view until the appear
		// delay elapses, then animates in (see the `data-appeared` CSS).
		const [appeared, setAppeared] = useState(false);
		// The CTAs fade in a beat after the bar widens, so the widen reads first.
		const [suggestionsVisible, setSuggestionsVisible] = useState(false);
		// Bumped to request focusing the chat input once the panel has opened.
		// A textarea inside a still-hidden panel can't take focus, and React
		// commits the open state after our handlers return, so we focus from an
		// effect (below) rather than synchronously / via rAF.
		const [focusNonce, setFocusNonce] = useState(0);

		const narrow = useNarrowViewport();
		const chipsTriggers = config.dockChipsTrigger ?? DEFAULT_CHIPS_TRIGGERS;
		const chipsAlways = chipsTriggers.includes("always");
		const chipsOnScroll = chipsTriggers.includes("scroll");
		const chipsOnTimer = chipsTriggers.includes("hover") || chipsAlways;
		const pointerVars = config.dockPointerVars === true;
		const dockReadOnly = narrow && config.dockReadonlyMobile === true;
		const dockClickOpens = config.dockClick === "open";

		const preset = config.appearance?.theme;
		const userVars = config.appearance?.variables;
		const cssVars = useMemo(
			() => (userVars ? themeToCSSProperties(userVars) : {}),
			[userVars],
		);

		// The page and channel rungs for this URL; ids ride along for click
		// attribution. Memoized inside the hook — the pill row keys an effect
		// on this object's identity.
		const [sectionKey, setSectionKey] = useState<string | null>(null);
		const suggestions = useSuggestions(config, sectionKey);
		const welcomeProps = useEmbedWelcomeProps(config);
		const dockAvatar = avatarFor(welcomeProps.avatar, "dock");
		// The dock renders the same pre-chat row the panel would, resolved through
		// the same hierarchy so its impression event carries the exact origin. No
		// turn has happened yet at the dock, so the two turn-derived rungs are
		// absent by construction.
		const dockRow = useMemo(
			() => resolveSuggestions({ flow: null, followup: null, ...suggestions }),
			[suggestions],
		);
		const dockTexts = useMemo(
			() => dockRow?.suggestions.map((s) => s.text) ?? [],
			[dockRow],
		);

		// Record every suggestion click and every rendered pill set server-side,
		// attributed to the authored prompts involved. Covers both the dock's
		// CTAs and the panel's own pills.
		useSuggestionIngest({
			widgetEvents,
			api: config.api,
			token: config.token,
			channelId: config.channelId,
			source: config.source,
			mode: "floating",
			pagePrompts: suggestions.page,
			getSessionId: () => chatRef.current?.sessionId,
		});

		// One impression per revealed dock row, keyed on the resolved row's
		// identity — a new fetch (SPA navigation) is a new object and counts
		// again; re-renders and collapse/expand cycles of the same row don't.
		const shownSuggestionsRef = useRef<typeof dockRow>(null);
		useEffect(() => {
			if (!suggestionsVisible || !dockRow) {
				return;
			}
			if (shownSuggestionsRef.current === dockRow) {
				return;
			}
			shownSuggestionsRef.current = dockRow;
			widgetEvents.emit({
				name: "suggestions.shown",
				properties: { texts: dockTexts, origin: dockRow.origin },
			});
		}, [suggestionsVisible, dockRow, dockTexts, widgetEvents]);
		// The dock is the chat's entry point, so it shows the configured input
		// placeholder by default (`data-launcher-text` overrides it for a
		// dock-specific prompt). Typed out like the in-chat input.
		const dockPlaceholder =
			config.launcherText ?? config.placeholder ?? t.launcher.prompt;
		const animatedDockPlaceholder = useTypingPlaceholder(
			dockPlaceholder,
			composerText.length === 0,
		);

		// Card shadow shared by the dock, suggestion chips, and the expanded
		// panel — matches the inline embed's default (themeable via --ww-shadow).
		const cardShadow = "var(--ww-shadow, 0 10px 30px rgba(0, 0, 0, 0.08))";

		// Hold the dock back until the host page has settled, then let it
		// animate in. `appearDelay: 0` shows it on the next tick (still a
		// transition, so it fades/slides rather than popping). The CTAs are no
		// longer auto-surfaced — the visitor reveals them by clicking the bar.
		//
		// Gated on `visible` so the entrance replays per appearance: a page the
		// channel's `visibility` rules hide keeps `appeared` false, and when the
		// visitor navigates (SPA route change) to a page that shows the dock, the
		// delay runs again and the bar slides in — rather than popping in already
		// "appeared" from an earlier page.
		//
		// When an "appear after" rule matches this path, the scroll trigger owns
		// `appeared` instead of the timer: the bar tracks `scrolledPast`
		// reactively (revealed once past the element, hidden again on scroll up).
		useEffect(() => {
			if (!visible) {
				setAppeared(false);
				return;
			}
			if (appearAfter) {
				setAppeared(scrolledPast);
				return;
			}
			const delay = config.appearDelay ?? DEFAULT_APPEAR_DELAY_MS;
			const id = setTimeout(() => setAppeared(true), Math.max(0, delay));
			return () => clearTimeout(id);
		}, [visible, config.appearDelay, appearAfter, scrolledPast]);

		// Once the dock has appeared, surface the suggestion card on its own a
		// beat later — the visitor no longer has to click the bar to reveal the
		// CTAs. Only fires when there are suggestions to show and the bar is still
		// at rest (`input`); if the visitor has already interacted (widened it,
		// opened the chat), we leave their state alone. Firing off `appeared`
		// means a collapse back to `input` (via the close button) won't
		// re-trigger it.
		//
		// `dockChipsTrigger` lists the triggers: `hover` is the timer above,
		// `always` expands as soon as the dock appears, `scroll` adds a pause
		// after scrolling down into a new section. Listed together they all
		// run and the first to fire wins. All honor a manual dismiss until the
		// visitor focuses the bar again.
		const expandChips = useCallback(() => {
			if (userDismissed.current) {
				return;
			}
			setPhase((p) => (p === "input" ? "expanded" : p));
		}, []);
		useEffect(() => {
			if (!appeared || dockTexts.length === 0 || !chipsOnTimer) {
				return;
			}
			const id = setTimeout(
				expandChips,
				chipsAlways ? 0 : AUTO_EXPAND_DELAY_MS,
			);
			return () => clearTimeout(id);
		}, [appeared, dockTexts.length, chipsOnTimer, chipsAlways, expandChips]);
		useScrollPause(
			chipsOnScroll && appeared && dockTexts.length > 0,
			narrow ? NARROW_SCROLL_PAUSE_MS : SCROLL_PAUSE_MS,
			(key) => {
				setSectionKey(key);
				expandChips();
			},
		);

		useEffect(() => {
			const dock = dockRef.current;
			if (!pointerVars || !visible || !dock) {
				return;
			}
			const onPointerMove = (event: PointerEvent) => {
				const rect = dock.getBoundingClientRect();
				dock.style.setProperty(
					"--ww-pointer-x",
					`${event.clientX - rect.left}px`,
				);
				dock.style.setProperty(
					"--ww-pointer-y",
					`${event.clientY - rect.top}px`,
				);
			};
			const clearPointerVars = () => {
				dock.style.removeProperty("--ww-pointer-x");
				dock.style.removeProperty("--ww-pointer-y");
			};
			dock.addEventListener("pointermove", onPointerMove);
			dock.addEventListener("pointerleave", clearPointerVars);
			return () => {
				dock.removeEventListener("pointermove", onPointerMove);
				dock.removeEventListener("pointerleave", clearPointerVars);
				clearPointerVars();
			};
		}, [pointerVars, visible]);

		// Focus the chat input after the panel has opened. Runs post-commit, so
		// the (previously hidden) textarea is in layout and can take focus.
		// Skipped on the initial render (`focusNonce === 0`).
		useEffect(() => {
			if (focusNonce > 0 && phase === "open") {
				chatRef.current?.focus();
			}
		}, [focusNonce, phase]);

		// `chat.ready` once the remote config has resolved.
		const readyEmittedRef = useRef(false);
		useEffect(() => {
			if (ready && !readyEmittedRef.current) {
				readyEmittedRef.current = true;
				widgetEvents.emit({ name: "chat.ready" });
			}
		}, [ready, widgetEvents]);

		useBootTiming({
			api: config.api,
			token: config.token,
			channelId: config.channelId,
			mode: "floating",
			paintMark: "launcherPainted",
			painted: ready && visible,
		});

		// Open/close transitions. Watching `phase` covers every path that opens
		// or closes the panel: dock focus, suggestion click, the imperative API,
		// the header collapse button. The docked and expanded-dock states both
		// count as "closed"; only the full panel is "open". `visible` folds the
		// per-URL gate in, so a panel hidden by an SPA route change reports
		// `chat.closed` — events reflect what is on screen. No event on mount.
		const wasOpenRef = useRef(false);
		useEffect(() => {
			const isOpen = visible && phase === "open";
			if (isOpen === wasOpenRef.current) {
				return;
			}
			wasOpenRef.current = isOpen;
			widgetEvents.emit({ name: isOpen ? "chat.opened" : "chat.closed" });
		}, [visible, phase, widgetEvents]);

		const openPanel = useCallback(() => {
			setPhase("open");
		}, []);
		// Collapse back to the resting (narrow) input, dropping the CTAs. Marks the
		// collapse as deliberate so the auto-expand doesn't reopen the card behind
		// the visitor's back — they get the CTAs again by clicking the bar.
		const collapse = useCallback(() => {
			userDismissed.current = true;
			setPhase("input");
		}, []);

		// On phones the panel is a full-screen sheet, so with `panelHistory` the
		// back gesture closes it rather than leaving the page.
		usePanelHistory(
			config.panelHistory === true && narrow && visible && phase === "open",
			collapse,
		);

		// Reveal the CTAs a beat after the bar has widened. Reset whenever we
		// leave the expanded phase so re-expanding replays the staggered entrance.
		useEffect(() => {
			if (phase !== "expanded") {
				setSuggestionsVisible(false);
				return;
			}
			const id = setTimeout(
				() => setSuggestionsVisible(true),
				SUGGESTIONS_REVEAL_DELAY_MS,
			);
			return () => clearTimeout(id);
		}, [phase]);

		const openWith = useCallback(
			(text: string) => {
				openPanel();
				const trimmed = text.trim();
				if (trimmed) {
					chatRef.current?.sendMessage(trimmed);
				}
			},
			[openPanel],
		);

		useImperativeHandle(
			ref,
			() => ({
				open: () => openPanel(),
				close: () => collapse(),
				toggle: () => {
					setPhase((p) => (p === "open" ? "input" : "open"));
				},
				sendMessage: (text: string) => openWith(text),
				sendMessageAndWait: async (text: string) => {
					openPanel();
					const chat = chatRef.current;
					if (!chat) {
						return undefined;
					}
					return (await chat.sendMessageAndWait(text)) as UIMessage | undefined;
				},
				reset: () => chatRef.current?.reset(),
				restart: () => chatRef.current?.restart(),
				copyConversation: async () =>
					(await chatRef.current?.copyConversation()) ?? false,
				focus: () => {
					// Docs contract: in floating mode `focus()` opens the panel (like
					// `sendMessage`). The focus effect lands the chat input once the
					// panel has committed/painted.
					openPanel();
					setFocusNonce((n) => n + 1);
				},
				getMessages: () => chatRef.current?.messages ?? [],
				getSessionId: () => chatRef.current?.sessionId,
			}),
			[openWith, openPanel, collapse],
		);

		const submitComposer = useCallback(() => {
			if (composerText.trim()) {
				openWith(composerText);
				setComposerText("");
			}
		}, [composerText, openWith]);

		const onComposerFocus = useCallback(() => {
			// A read-only dock (phones) is a button in disguise: open the panel
			// without raising the keyboard, and let go of focus so the next tap
			// focuses (and opens) again.
			if (dockReadOnly) {
				composerInputRef.current?.blur();
				setPhase("open");
				return;
			}
			// Once a conversation exists, the visitor has history they can't see
			// while minimized — refocusing the dock reopens the full chat rather
			// than re-offering the suggestion pills. Focusing the chat input happens
			// in the focus effect, once the panel is painted.
			if (dockClickOpens || (chatRef.current?.messages.length ?? 0) > 0) {
				setPhase("open");
				setFocusNonce((n) => n + 1);
			} else {
				// First focus with no conversation: widen the bar (and reveal the
				// CTAs, if any) — but stay docked. The chat only opens on send.
				// Clicking back on the bar clears any prior dismiss.
				userDismissed.current = false;
				setPhase((p) => (p === "input" ? "expanded" : p));
			}
		}, [dockReadOnly, dockClickOpens]);

		// `mode` tags every chat request with the embed surface so server-logged
		// chat events carry it in `properties.mode`, matching `page.viewed`.
		const body: Record<string, unknown> = { mode: "floating" };
		const transport = useDirectTransport(config.sessionApi);
		if (config.mcpServerUrl) {
			body.mcpServerUrl = config.mcpServerUrl;
		}
		if (config.channelId) {
			body.channelId = config.channelId;
		}

		// The frosted card only exists to hold the suggestion pills, so it only
		// materializes once the bar is expanded *and* there are suggestions. With
		// none, focusing leaves the plain input bar (no empty card, no widen).
		const showCard = dockTexts.length > 0 && phase !== "input";

		// Never pull the bar out from under a visitor who is mid-sentence.
		const dockShown = appeared && !(nearBottom && composerText.length === 0);

		const panelState = usePanelState(phase === "open", panelRef);
		const panelLayout = panelLayoutOf(config.panelLayout);

		const dockComposerRow = (
			<div className="ww:flex ww:items-center ww:gap-1 ww:pl-3.5 ww:pr-1.5 ww:py-1.5 ww:sm:pl-4 ww:sm:pr-2 ww:sm:py-2">
				{/* `text-base` (16px) on mobile is load-bearing: iOS Safari
				    auto-zooms a focused input under 16px. `sm:text-sm`
				    restores the smaller text where the zoom rule doesn't
				    apply. Do not drop the 16px mobile size. */}
				{dockAvatar && (
					<Avatar
						src={dockAvatar}
						slot="dock"
						intro={welcomeProps.avatar?.intro}
						visible={dockShown && phase !== "open"}
					/>
				)}
				<input
					ref={composerInputRef}
					type="text"
					value={composerText}
					placeholder={animatedDockPlaceholder}
					onChange={(e) => setComposerText(e.target.value)}
					onFocus={onComposerFocus}
					onClick={dockClickOpens ? onComposerFocus : undefined}
					readOnly={dockReadOnly}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							submitComposer();
						}
					}}
					className={cn(
						PARTS.dockInput,
						"ww:min-w-0 ww:flex-1 ww:bg-transparent ww:py-1 ww:text-base ww:sm:text-sm ww:text-foreground ww:outline-none ww:placeholder:text-muted-foreground",
					)}
				/>
				<button
					type="button"
					onClick={submitComposer}
					disabled={!composerText.trim()}
					aria-label={t.promptInput.submit}
					className={cn(
						PARTS.dockSend,
						"ww:relative ww:flex ww:size-8 ww:shrink-0 ww:items-center ww:justify-center ww:rounded-full ww:bg-foreground ww:text-background ww:transition-opacity hover:ww:opacity-90 disabled:ww:opacity-40",
					)}
				>
					<ArrowUp className="ww:size-4" />
				</button>
			</div>
		);

		const closeButton = (
			<button
				type="button"
				onClick={collapse}
				aria-label={t.launcher.close}
				className={cn(
					PARTS.close,
					"ww:flex ww:size-7 ww:items-center ww:justify-center ww:rounded-md ww:text-muted-foreground ww:transition-colors hover:ww:bg-accent hover:ww:text-foreground ww:cursor-pointer",
				)}
			>
				<XIcon className="ww:size-4" />
			</button>
		);

		return (
			// `display: contents` wrapper carries the theme vars (via
			// `data-waniwani-chat`) and dark class to the dock + panel.
			<WidgetEventsProvider value={widgetEvents}>
				<div
					data-waniwani-chat=""
					data-color-scheme={preset === "auto" ? "auto" : undefined}
					className={cn(
						"ww:contents ww:font-[family-name:var(--ww-font-sans)]",
						preset === "dark" && "dark",
					)}
					style={cssVars}
				>
					{visible && (
						<>
							{/* Docked composer — animates in after the appear delay. Narrow
						    at rest; widens (and reveals the CTAs) once clicked. */}
							<div
								ref={dockRef}
								data-waniwani-floating="dock"
								data-state={phase === "open" ? "hidden" : "shown"}
								data-appeared={dockShown ? "true" : "false"}
								data-expanded={showCard ? "true" : "false"}
								data-has-text={composerText.trim() !== "" ? "true" : "false"}
								data-hover={dockHovered ? "true" : "false"}
								onPointerEnter={() => setDockHovered(true)}
								onPointerLeave={() => setDockHovered(false)}
								className={cn(
									PARTS.dock,
									"ww:fixed ww:bottom-3 ww:sm:bottom-4 ww:left-0 ww:right-0 ww:mx-auto ww:z-[var(--ww-z-index)] ww:flex ww:flex-col",
									"ww:w-[calc(100vw-2rem)] ww:transition-[max-width] ww:duration-300 ww:ease-out",
									showCard
										? "ww:max-w-[var(--ww-dock-width-expanded)]"
										: "ww:max-w-[var(--ww-dock-width)]",
								)}
							>
								{/* Frosted-glass card around the input. It only materializes
							    once the dock is expanded/open (the visitor clicked the bar);
							    at rest the wrapper is invisible (no fill/border/padding) so
							    the input looks exactly like the standalone bar. The tint is
							    the theme's brand color at low alpha — not white — so it reads
							    as intentional glass and the host page shows through it. */}
								<div
									data-expanded={showCard ? "true" : "false"}
									className={cn(
										PARTS.dockCard,
										"ww:relative ww:flex ww:flex-col ww:rounded-[var(--ww-dock-radius)] ww:border ww:transition-all ww:duration-300 ww:ease-out",
										showCard
											? "ww:p-2 ww:backdrop-blur-xl ww:backdrop-saturate-150"
											: "ww:border-transparent ww:p-0",
									)}
									style={
										showCard
											? {
													boxShadow: cardShadow,
													backgroundColor: "var(--ww-dock-bg)",
													borderColor: "var(--ww-dock-border)",
												}
											: undefined
									}
								>
									{/* Close (X) in the card's top-right — collapses the expanded
								    card back to just the docked input, so the visitor can read
								    only their own text. Clicking the bar again brings the CTAs
								    back. Only while expanded; the open panel has its own header
								    collapse control (`closeButton` via `headerActions`). */}
									{showCard && phase !== "open" && (
										<button
											type="button"
											onClick={collapse}
											aria-label={t.launcher.close}
											className={cn(
												PARTS.dockClose,
												"ww:absolute ww:right-2 ww:top-2 ww:z-10 ww:flex ww:size-7 ww:items-center ww:justify-center ww:rounded-md ww:text-muted-foreground ww:transition-colors hover:ww:bg-accent hover:ww:text-foreground ww:cursor-pointer",
											)}
										>
											<XIcon className="ww:size-4" />
										</button>
									)}

									{dockTexts.length > 0 && (
										// The card grows straight up to reveal the pills: a
										// `grid-rows` 0fr → 1fr height animation (eases to the pills'
										// real height — no `max-h` guessing, no scale, so it rises
										// vertically rather than diagonally) plus a fade. Anchored at
										// the bottom of the screen, so the growth pushes upward.
										<div
											className={cn(
												PARTS.dockSuggestions,
												"ww:grid ww:transition-all ww:duration-300 ww:ease-out",
												suggestionsVisible
													? "ww:grid-rows-[1fr] ww:opacity-100"
													: "ww:pointer-events-none ww:grid-rows-[0fr] ww:opacity-0",
											)}
										>
											<div className="ww:overflow-hidden">
												<Suggestions
													suggestions={dockTexts}
													origin="dock"
													onSelect={(text) => {
														widgetEvents.emit({
															name: "suggestion.clicked",
															properties: {
																text,
																index: dockTexts.indexOf(text),
																origin: dockRow?.origin ?? "channel",
															},
														});
														openWith(text);
													}}
													// Right padding keeps the top row of pills clear of the
													// absolutely-positioned close button in the corner.
													className="ww:pl-1 ww:pr-9 ww:pt-1 ww:pb-2.5"
												/>
											</div>
										</div>
									)}

									{/* Composer wrapped in the ReactBits border glow. Background +
								    radius are themed to match the input surface; the glow plays
								    a one-off sweep on appear. `dockGlow: false` keeps the same
								    surface without the glow. */}
									{config.dockGlow === false ? (
										<div
											className={cn(
												PARTS.dockField,
												"ww:relative ww:grid ww:isolate",
											)}
											style={{
												background: "var(--ww-color-input)",
												borderRadius: DOCK_FIELD_RADIUS,
												boxShadow: cardShadow,
											}}
										>
											<div className="ww:flex ww:flex-col ww:relative ww:overflow-auto ww:z-[1]">
												{dockComposerRow}
											</div>
										</div>
									) : (
										<BorderGlow
											animated={appeared}
											backgroundColor="var(--ww-color-input)"
											borderRadius={DOCK_FIELD_RADIUS}
											edgeSensitivity={30}
											coneSpread={25}
											colors={["#c084fc", "#f472b6", "#38bdf8"]}
											className={PARTS.dockField}
											style={{ boxShadow: cardShadow }}
										>
											{dockComposerRow}
										</BorderGlow>
									)}
								</div>
							</div>

							{/* Full chat panel — expands open from the docked input's
				    position (clip-path, see tailwind.css). Same desktop width
				    as the expanded dock so the growth reads as one motion. */}
							<div
								ref={panelRef}
								role="dialog"
								aria-label={config.title ?? dockPlaceholder}
								data-waniwani-floating="panel"
								data-state={panelState}
								data-layout={panelLayout}
								style={{ boxShadow: cardShadow }}
								className={cn(PARTS.panel, panelClassName(panelLayout))}
							>
								<ChatEmbed
									transport={transport}
									ref={chatRef}
									mode="floating"
									api={config.api ?? ""}
									headers={{ Authorization: `Bearer ${config.token}` }}
									skipRemoteConfig
									body={body}
									appearance={config.appearance}
									title={config.title}
									headerActions={closeButton}
									// Force the header on in floating mode: the close control
									// lives in `headerActions`, so honoring `hideHeader` here would
									// leave an opened (full-screen on mobile) panel with no in-UI
									// way back to the dock. The panel is its own chrome anyway.
									hideHeader={false}
									// Mounted eagerly behind the dock, so without this the
									// panel's own pill row reports impressions for pills no
									// visitor has seen, and double-counts the pre-chat row
									// the dock already announced.
									onScreen={phase === "open"}
									welcomeMessage={config.welcomeMessage}
									{...welcomeProps}
									placeholder={config.placeholder}
									suggestions={suggestions}
									enableThreadHistory={config.enableThreadHistory}
									documentUpload={config.documentUpload}
									showToolCalls={config.showToolCalls}
									disclaimer={config.disclaimer}
									suggestionsLayout={config.suggestionsLayout}
									suggestionsPosition={config.suggestionsPosition}
									sendIcon={config.sendIcon}
									showTableToolbar={config.showTableToolbar}
									menu={config.menu}
									restartConfirm={config.restartConfirm}
									hidePoweredBy={config.hidePoweredBy}
									locale={config.locale}
									messages={embedMessages.messages}
									initializing={!ready}
								/>
							</div>
						</>
					)}
				</div>
			</WidgetEventsProvider>
		);
	},
);
