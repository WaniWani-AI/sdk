// ============================================================================
// FloatingChat — the `mode: "floating"` embed surface (rose.ai-style).
//
// On load it shows only a thin **docked input** at the bottom of the screen —
// not a launcher button. After a short delay it auto-expands to reveal the
// agent's starter suggestions (CTAs) above the input, with a collapse control.
// As soon as the visitor sends their first message (typed or a suggestion),
// the full chat panel slides up from the bottom.
//
// The chat itself (`ChatEmbed`) is mounted eagerly but kept hidden until the
// panel opens, so the docked input can hand off the first message to it and
// the imperative API works before the panel is ever shown.
// ============================================================================

import type { UIMessage } from "ai";
import { ArrowRight, ArrowUp, Minus, Sparkles } from "lucide-react";
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
import { useTypingPlaceholder } from "../hooks/use-typing-placeholder";
import { I18nProvider, useTranslation } from "../i18n";
import { ChatEmbed } from "../layouts/chat-embed";
import { cn } from "../lib/utils";
import { themeToCSSProperties } from "../theme";
import type { EmbedConfig } from "./config";
import { useRemoteEmbedConfig } from "./remote-config";

/** Idle delay before the dock auto-expands to show suggestion CTAs. */
const AUTO_EXPAND_DELAY_MS = 3500;

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

		const chatRef = useRef<ChatHandle>(null);
		const composerInputRef = useRef<HTMLInputElement>(null);
		const [phase, setPhase] = useState<Phase>("input");
		const [composerText, setComposerText] = useState("");
		// Once the visitor touches the dock we stop the idle auto-expand.
		const interactedRef = useRef(false);

		const preset = config.appearance?.theme;
		const userVars = config.appearance?.variables;
		const position = config.position ?? "bottom-center";
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

		// Auto-expand to surface the CTAs once, after an idle delay — only if
		// there are suggestions, the visitor hasn't engaged, and no
		// conversation exists yet (suggestions are starter prompts; once the
		// chat has messages they no longer make sense).
		useEffect(() => {
			if (suggestions.length === 0) {
				return;
			}
			const id = setTimeout(() => {
				const hasMessages = (chatRef.current?.messages.length ?? 0) > 0;
				if (!interactedRef.current && !hasMessages) {
					setPhase((p) => (p === "input" ? "expanded" : p));
				}
			}, AUTO_EXPAND_DELAY_MS);
			return () => clearTimeout(id);
		}, [suggestions.length]);

		const openWith = useCallback((text: string) => {
			interactedRef.current = true;
			setPhase("open");
			const trimmed = text.trim();
			if (trimmed) {
				chatRef.current?.sendMessage(trimmed);
			}
		}, []);

		useImperativeHandle(
			ref,
			() => ({
				open: () => setPhase("open"),
				close: () => setPhase("input"),
				toggle: () => setPhase((p) => (p === "open" ? "input" : "open")),
				sendMessage: (text: string) => openWith(text),
				sendMessageAndWait: async (text: string) => {
					interactedRef.current = true;
					setPhase("open");
					const chat = chatRef.current;
					if (!chat) {
						return undefined;
					}
					return (await chat.sendMessageAndWait(text)) as UIMessage | undefined;
				},
				reset: () => chatRef.current?.reset(),
				focus: () => {
					if (phase === "open") {
						chatRef.current?.focus();
					} else {
						composerInputRef.current?.focus();
					}
				},
				getMessages: () => chatRef.current?.messages ?? [],
				getSessionId: () => chatRef.current?.sessionId,
			}),
			[openWith, phase],
		);

		const submitComposer = useCallback(() => {
			if (composerText.trim()) {
				openWith(composerText);
				setComposerText("");
			}
		}, [composerText, openWith]);

		const onComposerFocus = useCallback(() => {
			interactedRef.current = true;
			// Once the conversation has started, the visitor has history they
			// can't see while minimized — refocusing the dock should reopen the
			// full chat, not re-offer the starter CTAs. Move focus into the
			// chat input once the panel is visible so typing continues smoothly.
			if ((chatRef.current?.messages.length ?? 0) > 0) {
				setPhase("open");
				setTimeout(() => chatRef.current?.focus(), 0);
			} else if (suggestions.length > 0) {
				setPhase((p) => (p === "input" ? "expanded" : p));
			}
		}, [suggestions.length]);

		const body: Record<string, unknown> = {};
		if (config.mcpServerUrl) {
			body.mcpServerUrl = config.mcpServerUrl;
		}
		if (config.channelId) {
			body.channelId = config.channelId;
		}

		// Anchor classes. The dock applies them at all widths; the panel only on
		// desktop (it goes full-screen on mobile).
		const dockAlign =
			position === "bottom-left"
				? "ww:left-4 ww:right-auto"
				: position === "bottom-right"
					? "ww:right-4 ww:left-auto"
					: "ww:left-0 ww:right-0 ww:mx-auto";
		const panelAlign =
			position === "bottom-left"
				? "ww:sm:left-4 ww:sm:right-auto"
				: position === "bottom-right"
					? "ww:sm:right-4 ww:sm:left-auto"
					: "ww:sm:left-0 ww:sm:right-0 ww:sm:mx-auto";

		const closeButton = (
			<button
				type="button"
				onClick={() => setPhase("input")}
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
				{/* Docked composer — the only thing visible on load. */}
				<div
					data-waniwani-floating="dock"
					data-state={phase === "open" ? "hidden" : "shown"}
					className={cn(
						"ww:fixed ww:bottom-4 ww:z-[2147483002] ww:flex ww:flex-col ww:gap-2",
						"ww:w-[calc(100vw-2rem)] ww:max-w-[480px]",
						dockAlign,
					)}
				>
					{suggestions.length > 0 && (
						<div
							className={cn(
								"ww:flex ww:flex-col ww:gap-2 ww:origin-bottom ww:transition-all ww:duration-300 ww:ease-out",
								phase === "expanded"
									? "ww:max-h-96 ww:translate-y-0 ww:opacity-100"
									: "ww:pointer-events-none ww:max-h-0 ww:translate-y-2 ww:overflow-hidden ww:opacity-0",
							)}
						>
							<div className="ww:flex ww:justify-end">
								<button
									type="button"
									onClick={() => setPhase("input")}
									aria-label={t.launcher.minimize}
									className="ww:flex ww:size-7 ww:items-center ww:justify-center ww:rounded-full ww:bg-background/80 ww:text-muted-foreground ww:shadow ww:backdrop-blur ww:transition-colors hover:ww:text-foreground"
								>
									<Minus className="ww:size-4" />
								</button>
							</div>
							{suggestions.map((s) => (
								<button
									key={s}
									type="button"
									onClick={() => openWith(s)}
									style={{ boxShadow: cardShadow }}
									className="ww:flex ww:items-center ww:justify-between ww:gap-3 ww:rounded-full ww:bg-background ww:px-5 ww:py-3 ww:text-left ww:text-sm ww:font-medium ww:text-foreground ww:transition-colors hover:ww:bg-accent"
								>
									<span className="ww:truncate">{s}</span>
									<ArrowRight className="ww:size-4 ww:shrink-0 ww:opacity-50" />
								</button>
							))}
						</div>
					)}

					<div
						style={{ boxShadow: cardShadow }}
						className="ww:flex ww:items-center ww:gap-2 ww:rounded-full ww:border ww:border-border ww:bg-background ww:px-4 ww:py-2.5"
					>
						<Sparkles className="ww:size-4 ww:shrink-0 ww:text-muted-foreground" />
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
							className="ww:min-w-0 ww:flex-1 ww:bg-transparent ww:text-sm ww:text-foreground ww:outline-none ww:placeholder:text-muted-foreground"
						/>
						<button
							type="button"
							onClick={submitComposer}
							disabled={!composerText.trim()}
							aria-label={t.promptInput.submit}
							className="ww:flex ww:size-8 ww:shrink-0 ww:items-center ww:justify-center ww:rounded-full ww:bg-foreground ww:text-background ww:transition-opacity hover:ww:opacity-90 disabled:ww:opacity-40"
						>
							<ArrowUp className="ww:size-4" />
						</button>
					</div>
				</div>

				{/* Full chat panel — slides up from the bottom on first message.
				    Same width as the dock so opening is a clean vertical grow. */}
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
						// Desktop: anchored card (matches the dock's 480px width).
						"ww:sm:inset-auto ww:sm:bottom-4 ww:sm:h-[640px] ww:sm:max-h-[calc(100dvh-2rem)] ww:sm:w-[calc(100vw-2rem)] ww:sm:max-w-[480px] ww:sm:rounded-2xl ww:sm:border ww:sm:border-border",
						panelAlign,
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
						hideHeader={config.hideHeader}
						welcomeMessage={config.welcomeMessage}
						placeholder={config.placeholder}
						suggestions={
							config.suggestions ? { initial: config.suggestions } : undefined
						}
						enableThreadHistory={config.enableThreadHistory}
						showToolCalls={config.showToolCalls}
						locale={config.locale}
						initializing={!ready}
					/>
				</div>
			</div>
		);
	},
);
