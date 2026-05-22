"use client";

import {
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { WidgetClientContext } from "../../../../mcp/react/context";
import type { SendFollowUpOptions } from "./use-send-follow-up";

const ADVANCED_KEY_PREFIX = "waniwani:send-follow-up:advanced:";
const ADVANCED_WINDOW_MS = 10_000;

type AdvancedRecord = { at: number; byMountId: string };

function advancedKeyFor(viewUUID: string | undefined): string {
	return `${ADVANCED_KEY_PREFIX}${viewUUID ?? "default"}`;
}

function readAdvanced(viewUUID: string | undefined): AdvancedRecord | null {
	try {
		const raw = globalThis.localStorage?.getItem(advancedKeyFor(viewUUID));
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as AdvancedRecord;
		if (
			typeof parsed?.at !== "number" ||
			typeof parsed?.byMountId !== "string"
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function markAdvanced(viewUUID: string | undefined, byMountId: string): void {
	try {
		globalThis.localStorage?.setItem(
			advancedKeyFor(viewUUID),
			JSON.stringify({ at: Date.now(), byMountId } satisfies AdvancedRecord),
		);
	} catch {
		// quota / security errors — best effort
	}
}

/**
 * Same heuristic the legacy `InitializeNextJsInIframe` helper uses
 * (`typeof window.openai !== "undefined"`), but evaluated at call time so
 * it works in any iframe ChatGPT loads — we can't depend on
 * `useIsChatGptApp` because that reads `window.__isChatGptApp`, which is
 * only set by the Next.js helper. Widgets built directly on skybridge
 * never get that flag.
 */
function isChatGptHost(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	// biome-ignore lint/suspicious/noExplicitAny: ChatGPT injects `window.openai`
	return typeof (window as any).openai === "object";
}

interface ChatGPTHostBridge {
	toolResponseMetadata?: { viewUUID?: unknown } | null;
}

function getChatGptHostBridge(): ChatGPTHostBridge | null {
	if (!isChatGptHost()) {
		return null;
	}
	// biome-ignore lint/suspicious/noExplicitAny: ChatGPT injects `window.openai`
	return (window as any).openai as ChatGPTHostBridge;
}

/**
 * Collapses the iframe document to 0×0 with a transparent background by
 * overriding `<html>` and `<body>` inline styles. The host's auto-resize
 * (ResizeObserver on documentElement/body) then notifies ChatGPT that the
 * iframe should shrink — without this, ChatGPT keeps the iframe at its
 * default size with whatever background the widget's CSS paints.
 */
function GhostSuppressor(): null {
	useLayoutEffect(() => {
		const html = document.documentElement;
		const body = document.body;
		const prevHtmlStyle = html.getAttribute("style");
		const prevBodyStyle = body.getAttribute("style");
		const zero =
			"margin:0!important;padding:0!important;border:0!important;background:transparent!important;background-color:transparent!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;";
		html.setAttribute("style", zero);
		body.setAttribute("style", zero);
		return () => {
			if (prevHtmlStyle === null) {
				html.removeAttribute("style");
			} else {
				html.setAttribute("style", prevHtmlStyle);
			}
			if (prevBodyStyle === null) {
				body.removeAttribute("style");
			} else {
				body.setAttribute("style", prevBodyStyle);
			}
		};
	}, []);
	return null;
}

export interface UnstableSendFollowUpWithGhostGuardResult {
	/** Wrapped `sendFollowUp`. Same signature as the one you passed in. */
	sendFollowUp: (prompt: string, options?: SendFollowUpOptions) => void;
	/**
	 * Wrap your widget's root render with this so the suppression can take
	 * effect. On non-ChatGPT hosts it is a transparent pass-through.
	 */
	Guard: (props: { children: ReactNode }) => JSX.Element | null;
}

/**
 * ⚠️ EXPERIMENTAL — DO NOT USE UNLESS YOU UNDERSTAND THE TRADE-OFFS ⚠️
 *
 * Wraps an existing `sendFollowUp` with ghost-guard suppression specific
 * to ChatGPT. ChatGPT renders the source widget a SECOND time alongside
 * the new user message a widget emits via `sendFollowUpMessage`. The
 * second iframe is a brand-new React tree with no link to the original;
 * skybridge's `useViewState` persistence does not survive across them.
 * The result is a visible duplicate widget for ~1s before ChatGPT
 * collapses one of them.
 *
 * On ChatGPT the hook adds a per-`viewUUID` `localStorage` write before
 * each `sendFollowUp` call, and the returned `Guard` checks that record
 * on mount — if it sees a record set by a different `mountId` within
 * `ADVANCED_WINDOW_MS`, it collapses the iframe to 0×0.
 *
 * On every other host (WaniWani embed, MCP Apps, etc.) the hook is a
 * pure pass-through: `sendFollowUp` is your function unchanged and
 * `Guard` is a transparent fragment.
 *
 * The hook does NOT require `WidgetProvider`. It reads the widget's
 * `viewUUID` from `WidgetClientContext` when one is available and falls
 * back to `window.openai.toolResponseMetadata.viewUUID` otherwise.
 *
 * Caveats:
 *  - Relies on ChatGPT's widget iframes sharing a single `localStorage`
 *    scope — verified at the time of writing but not guaranteed.
 *  - 10s suppression window per `viewUUID`. Two unrelated `sendFollowUp`
 *    calls inside 10s with the same viewUUID could mistakenly suppress one.
 *  - The `Guard` MUST wrap the widget's root render. If you forget it,
 *    the localStorage write happens but nothing is suppressed.
 *
 * @param sendFollowUp - The underlying `sendFollowUp` to wrap. On ChatGPT the
 *   hook adds the per-`viewUUID` localStorage write before delegating; on any
 *   other host the hook is a pure pass-through. Typically the value of
 *   `useSendFollowUpMessage()` from `skybridge/web` or `useSendFollowUp()`
 *   from this module.
 *
 * @example
 *   function MyWidget() {
 *     const sendFollowUpMessage = useSendFollowUpMessage(); // skybridge/web
 *     const { sendFollowUp, Guard } =
 *       unstable_useSendFollowUpWithGhostGuard(sendFollowUpMessage);
 *
 *     // The Guard MUST wrap the widget's root render, otherwise the ghost
 *     // iframe will not be suppressed.
 *     return (
 *       <Guard>
 *         <div className="my-widget">
 *           <button onClick={() => sendFollowUp("I uploaded my bill")}>
 *             Continue
 *           </button>
 *         </div>
 *       </Guard>
 *     );
 *   }
 *
 * @experimental Subject to change or removal without notice.
 */
export function unstable_useSendFollowUpWithGhostGuard(
	sendFollowUp: (prompt: string) => void | Promise<void>,
): UnstableSendFollowUpWithGhostGuardResult {
	const client = useContext(WidgetClientContext);
	const innerRef = useRef(sendFollowUp);
	innerRef.current = sendFollowUp;

	// Read viewUUID from whichever source is available: the widget client
	// (when wrapped in WidgetProvider) or the raw ChatGPT host global.
	const clientMetadata = client?.getToolResponseMetadata?.() ?? null;
	const hostMetadata = getChatGptHostBridge()?.toolResponseMetadata ?? null;
	const metadata = clientMetadata ?? hostMetadata;
	const viewUUID =
		metadata &&
		typeof (metadata as { viewUUID?: unknown }).viewUUID === "string"
			? (metadata as { viewUUID: string }).viewUUID
			: undefined;

	const mountIdRef = useRef<string>("");
	if (mountIdRef.current === "") {
		mountIdRef.current = crypto.randomUUID();
	}

	const wrappedSendFollowUp = useCallback(
		(prompt: string, _options?: SendFollowUpOptions) => {
			if (isChatGptHost()) {
				markAdvanced(viewUUID, mountIdRef.current);
			}
			try {
				void Promise.resolve(innerRef.current(prompt)).catch((err) => {
					console.error("[unstable_useSendFollowUpWithGhostGuard]", err);
				});
			} catch (err) {
				console.error("[unstable_useSendFollowUpWithGhostGuard]", err);
			}
		},
		[viewUUID],
	);

	const Guard = useMemo(() => {
		const mountId = mountIdRef.current;
		return function Guard({
			children,
		}: {
			children: ReactNode;
		}): JSX.Element | null {
			if (!isChatGptHost()) {
				return <>{children}</>;
			}
			const advanced = readAdvanced(viewUUID);
			if (
				advanced &&
				advanced.byMountId !== mountId &&
				Date.now() - advanced.at < ADVANCED_WINDOW_MS
			) {
				return <GhostSuppressor />;
			}
			return <>{children}</>;
		};
	}, [viewUUID]);

	return { sendFollowUp: wrappedSendFollowUp, Guard };
}
