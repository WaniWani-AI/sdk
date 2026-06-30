// ============================================================================
// FloatingChat — the `mode: "floating"` embed surface.
//
// After a short appear delay (so the host page settles first) a thin **docked
// input** animates into view at the bottom of the screen — not a launcher
// button. The input mirrors the in-chat composer: a soft-rounded card, no
// decorative icon. Clicking/focusing it widens the bar and reveals the agent's
// starter suggestions (CTAs) above it — without opening the chat yet. As soon
// as the visitor sends their first message (typed or a suggestion), the full
// chat panel expands open from the input's position.
//
// The chat itself (`ChatEmbed`) is mounted eagerly but kept hidden until the
// panel opens, so the docked input can hand off the first message to it and
// the imperative API works before the panel is ever shown.
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
import type { ChatHandle } from "../@types";
import BorderGlow from "../components/border-glow";
import { Suggestions } from "../components/suggestions";
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
import { I18nProvider, useTranslation } from "../i18n";
import { ChatEmbed } from "../layouts/chat-embed";
import { cn } from "../lib/utils";
import { themeToCSSProperties } from "../theme";
import type { EmbedConfig } from "./config";
import { useRemoteEmbedConfig } from "./remote-config";
import { useVisibilityGate } from "./use-pathname";

/** Default delay before the docked input animates into view on load. */
const DEFAULT_APPEAR_DELAY_MS = 2000;

/** Beat between the bar widening and the suggestion CTAs fading in. */
const SUGGESTIONS_REVEAL_DELAY_MS = 500;

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
	focus: () => void;
	getMessages: () => UIMessage[];
	getSessionId: () => string | undefined;
}

type Phase = "input" | "expanded" | "open";

export const FloatingChat = forwardRef<FloatingChatHandle, FloatingChatProps>(
	function FloatingChat(props, ref) {
		return (
			<I18nProvider locale={props.config.locale}>
				<FloatingChatInner {...props} ref={ref} />
			</I18nProvider>
		);
	},
);

const FloatingChatInner = forwardRef<FloatingChatHandle, FloatingChatProps>(
	function FloatingChatInner(
		{ config: initialConfig, programmatic, scriptConfig },
		ref,
	) {
		const { t } = useTranslation();
		// Resolve remote config here so the dock can show the dashboard's
		// suggestions / placeholder; `ChatEmbed` below skips its own fetch.
		const { config, ready } = useRemoteEmbedConfig(
			initialConfig,
			programmatic,
			scriptConfig,
		);

		// Per-URL gating — the dock and panel only render on paths the channel's
		// `visibility` rules resolve to "show". The overlay host stays mounted
		// but is invisible (pointer-events:none, no background), so a gated page
		// shows nothing — no empty box, no flash before remote config resolves.
		const visible = useVisibilityGate(config.visibility, ready);

		const chatRef = useRef<ChatHandle>(null);
		const composerInputRef = useRef<HTMLInputElement>(null);
		const dockRef = useRef<HTMLDivElement>(null);
		const [phase, setPhase] = useState<Phase>("input");
		const [composerText, setComposerText] = useState("");
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

		const preset = config.appearance?.theme;
		const userVars = config.appearance?.variables;
		const cssVars = useMemo(
			() => (userVars ? themeToCSSProperties(userVars) : {}),
			[userVars],
		);

		const suggestions = config.suggestions ?? [];
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
		useEffect(() => {
			const delay = config.appearDelay ?? DEFAULT_APPEAR_DELAY_MS;
			const id = setTimeout(() => setAppeared(true), Math.max(0, delay));
			return () => clearTimeout(id);
		}, [config.appearDelay]);

		// Focus the chat input after the panel has opened. Runs post-commit, so
		// the (previously hidden) textarea is in layout and can take focus.
		// Skipped on the initial render (`focusNonce === 0`).
		useEffect(() => {
			if (focusNonce > 0 && phase === "open") {
				chatRef.current?.focus();
			}
		}, [focusNonce, phase]);

		const openPanel = useCallback(() => {
			setPhase("open");
		}, []);
		// Collapse back to the resting (narrow) input, dropping the CTAs.
		const collapse = useCallback(() => {
			setPhase("input");
		}, []);

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

		// Click-away from an expanded (but not-yet-open) bar collapses it back to
		// the resting width. `composedPath()` so the hit-test works through the
		// embed's shadow root, where `event.target` is retargeted to the host.
		useEffect(() => {
			if (phase !== "expanded") {
				return;
			}
			const onPointerDown = (event: Event) => {
				const dock = dockRef.current;
				if (dock && !event.composedPath().includes(dock)) {
					collapse();
				}
			};
			document.addEventListener("pointerdown", onPointerDown, true);
			return () =>
				document.removeEventListener("pointerdown", onPointerDown, true);
		}, [phase, collapse]);

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
			// Once a conversation exists, the visitor has history they can't see
			// while minimized — refocusing the dock reopens the full chat rather
			// than re-offering the starter CTAs. Focusing the chat input happens
			// in the focus effect, once the panel is painted.
			if ((chatRef.current?.messages.length ?? 0) > 0) {
				setPhase("open");
				setFocusNonce((n) => n + 1);
			} else {
				// First focus with no conversation: widen the bar (and reveal the
				// CTAs, if any) — but stay docked. The chat only opens on send.
				setPhase((p) => (p === "input" ? "expanded" : p));
			}
		}, []);

		const body: Record<string, unknown> = {};
		if (config.mcpServerUrl) {
			body.mcpServerUrl = config.mcpServerUrl;
		}
		if (config.channelId) {
			body.channelId = config.channelId;
		}

		const closeButton = (
			<button
				type="button"
				onClick={collapse}
				aria-label={t.launcher.close}
				className="ww:flex ww:size-7 ww:items-center ww:justify-center ww:rounded-md ww:text-muted-foreground ww:transition-colors hover:ww:bg-accent hover:ww:text-foreground"
			>
				<Minus className="ww:size-4" />
			</button>
		);

		return (
			// `display: contents` wrapper carries the theme vars (via
			// `data-waniwani-chat`) and dark class to the dock + panel.
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
							data-appeared={appeared ? "true" : "false"}
							className={cn(
								"ww:fixed ww:bottom-3 ww:sm:bottom-4 ww:left-0 ww:right-0 ww:mx-auto ww:z-[2147483002] ww:flex ww:flex-col ww:gap-1",
								"ww:w-[calc(100vw-2rem)] ww:transition-[max-width] ww:duration-300 ww:ease-out",
								phase === "input" ? "ww:max-w-[440px]" : "ww:max-w-[720px]",
							)}
						>
							{suggestions.length > 0 && (
								<div
									className={cn(
										"ww:origin-bottom ww:transition-all ww:duration-300 ww:ease-out",
										suggestionsVisible
											? "ww:max-h-96 ww:translate-y-0 ww:opacity-100"
											: "ww:pointer-events-none ww:max-h-0 ww:translate-y-2 ww:overflow-hidden ww:opacity-0",
									)}
								>
									{/* Same chips as the in-chat composer (card parity). */}
									<Suggestions
										suggestions={suggestions}
										onSelect={openWith}
										className="ww:px-1 ww:pb-1.5 ww:pt-0"
									/>
								</div>
							)}

							{/* Composer wrapped in the ReactBits border glow. Background +
							    radius are themed to match the input surface; the glow plays
							    a one-off sweep on appear. */}
							<BorderGlow
								animated={appeared}
								backgroundColor="var(--ww-color-input)"
								borderRadius={16}
								edgeSensitivity={30}
								coneSpread={25}
								colors={["#c084fc", "#f472b6", "#38bdf8"]}
								className="ww:border-border"
								style={{ boxShadow: cardShadow }}
							>
								<div className="ww:flex ww:items-center ww:gap-1 ww:pl-3.5 ww:pr-1.5 ww:py-1.5 ww:sm:pl-4 ww:sm:pr-2 ww:sm:py-2">
									{/* `text-base` (16px) on mobile is load-bearing: iOS Safari
									    auto-zooms a focused input under 16px. `sm:text-sm`
									    restores the smaller text where the zoom rule doesn't
									    apply. Do not drop the 16px mobile size. */}
									<input
										ref={composerInputRef}
										type="text"
										value={composerText}
										placeholder={animatedDockPlaceholder}
										onChange={(e) => setComposerText(e.target.value)}
										onFocus={onComposerFocus}
										onKeyDown={(e) => {
											if (e.key === "Enter" && !e.shiftKey) {
												e.preventDefault();
												submitComposer();
											}
										}}
										className="ww:min-w-0 ww:flex-1 ww:bg-transparent ww:py-1 ww:text-base ww:sm:text-sm ww:text-foreground ww:outline-none ww:placeholder:text-muted-foreground"
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
						</div>

						{/* Full chat panel — expands open from the docked input's
				    position (clip-path, see tailwind.css). Same desktop width
				    as the expanded dock so the growth reads as one motion. */}
						<div
							role="dialog"
							aria-label={config.title ?? dockPlaceholder}
							data-waniwani-floating="panel"
							data-state={phase === "open" ? "shown" : "hidden"}
							style={{ boxShadow: cardShadow }}
							className={cn(
								"ww:fixed ww:z-[2147483002] ww:flex ww:flex-col ww:overflow-hidden ww:bg-background",
								// Mobile: full-screen sheet.
								"ww:inset-0 ww:w-full ww:rounded-none",
								// Desktop: wide ChatGPT-style card. Message content + input both
								// stay capped at max-w-3xl and centered, so they share one
								// column (good input/text ratio) and the extra panel width
								// reads as balanced side padding — not a narrow Intercom panel.
								"ww:sm:inset-auto ww:sm:bottom-4 ww:sm:left-0 ww:sm:right-0 ww:sm:mx-auto ww:sm:h-[720px] ww:sm:max-h-[calc(100dvh-2rem)] ww:sm:w-[calc(100vw-2rem)] ww:sm:max-w-[1000px] ww:sm:rounded-2xl ww:sm:border ww:sm:border-border",
							)}
						>
							<ChatEmbed
								ref={chatRef}
								api={config.api ?? ""}
								headers={{ Authorization: `Bearer ${config.token}` }}
								skipRemoteConfig
								body={Object.keys(body).length > 0 ? body : undefined}
								appearance={config.appearance}
								title={config.title}
								headerActions={closeButton}
								// Force the header on in floating mode: the minimize control
								// lives in `headerActions`, so honoring `hideHeader` here would
								// leave an opened (full-screen on mobile) panel with no in-UI
								// way back to the dock. The panel is its own chrome anyway.
								hideHeader={false}
								welcomeMessage={config.welcomeMessage}
								placeholder={config.placeholder}
								suggestions={
									config.suggestions
										? { initial: config.suggestions }
										: undefined
								}
								enableThreadHistory={config.enableThreadHistory}
								showToolCalls={config.showToolCalls}
								locale={config.locale}
								initializing={!ready}
							/>
						</div>
					</>
				)}
			</div>
		);
	},
);
