"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type { WidgetMode } from "../embed/widget-events";
import {
	markBoot,
	reportBoot,
	type TimingTarget,
	type WidgetTimingSink,
} from "./timing";

// Default is an inert sink, so an `McpAppFrame` mounted outside a chat (the
// WebMCP overlay, a bare `ChatEmbed`) reports nothing.
const WidgetTimingContext = createContext<WidgetTimingSink>(() => {});

/** Where this frame's timing report goes; inert without a provider. */
export function useWidgetTimingSink(): WidgetTimingSink {
	return useContext(WidgetTimingContext);
}

export const WidgetTimingProvider = WidgetTimingContext.Provider;

export interface BootTimingOptions extends TimingTarget {
	mode: WidgetMode;
	/** `launcherPainted` where a launcher appears first, `chatVisible` where the chat itself does. */
	paintMark: "launcherPainted" | "chatVisible";
	/** Whether the surface is on screen with its config resolved. */
	painted: boolean;
}

function onIdle(run: () => void): void {
	const idle = (
		window as Window & {
			requestIdleCallback?: (callback: () => void) => number;
		}
	).requestIdleCallback;
	if (typeof idle === "function") {
		idle(run);
	} else {
		setTimeout(run, 500);
	}
}

/** Stamps the paint mark on the next frame and reports the page's boot timings once per mount. */
export function useBootTiming(options: BootTimingOptions): void {
	const latest = useRef(options);
	latest.current = options;
	const sent = useRef(false);

	useEffect(() => {
		if (!options.painted || sent.current) {
			return;
		}
		sent.current = true;
		const frame = requestAnimationFrame(() => {
			const current = latest.current;
			markBoot(current.paintMark);
			onIdle(() => reportBoot(current));
		});
		return () => cancelAnimationFrame(frame);
	}, [options.painted]);
}
