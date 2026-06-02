"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_TYPEWRITER_MS_PER_CHAR = 5;
/**
 * If the network buffer pulls ahead of the typewriter cursor by more than
 * this many characters, jump forward to catch up. Keeps long messages from
 * lagging seconds behind once the network completes.
 */
const MAX_BUFFER_LAG_CHARS = 400;

export interface UseSmoothStreamOptions {
	/** Milliseconds per character. Lower = faster typing. Default 5ms (~200 cps). */
	msPerChar?: number;
}

/**
 * Smooth-streaming buffer for text. Pass the latest server-side text on
 * every render; the hook diff-applies new characters to an internal buffer
 * and reveals them character-by-character on a requestAnimationFrame loop.
 *
 * Decouples *network* arrival (bursty, chunk-shaped) from *visual* arrival
 * (steady, character-by-character) so the user sees a typewriter effect
 * regardless of how the model bursts tokens.
 *
 * Adapted from https://upstash.com/blog/smooth-streaming.
 *
 * @param fullText - The complete text known so far (cumulative).
 * @param isStreaming - When false, flush remaining buffer immediately.
 */
export function useSmoothStream(
	fullText: string,
	isStreaming: boolean,
	options: UseSmoothStreamOptions = {},
): string {
	const { msPerChar = DEFAULT_TYPEWRITER_MS_PER_CHAR } = options;

	const [visible, setVisible] = useState(isStreaming ? "" : fullText);
	const targetRef = useRef(fullText);
	const cursorRef = useRef(isStreaming ? 0 : fullText.length);
	const lastTimeRef = useRef(0);
	const frameRef = useRef<number | null>(null);

	// Capture target shrink (new conversation, reset) — if `fullText` no
	// longer starts with what we've already revealed, snap to it.
	if (
		fullText.length < cursorRef.current ||
		!fullText.startsWith(visible.slice(0, cursorRef.current))
	) {
		cursorRef.current = isStreaming ? 0 : fullText.length;
		// Schedule state update via the effect to avoid setState-in-render.
	}

	targetRef.current = fullText;

	useEffect(() => {
		// Not streaming → render the full text immediately.
		if (!isStreaming) {
			if (frameRef.current !== null) {
				cancelAnimationFrame(frameRef.current);
				frameRef.current = null;
			}
			cursorRef.current = fullText.length;
			setVisible(fullText);
			return;
		}

		// Skip ahead if we're too far behind.
		const ahead = targetRef.current.length - cursorRef.current;
		if (ahead > MAX_BUFFER_LAG_CHARS) {
			cursorRef.current = targetRef.current.length - MAX_BUFFER_LAG_CHARS;
		}

		if (frameRef.current !== null) {
			return;
		}

		const tick = (time: number) => {
			const target = targetRef.current;
			if (cursorRef.current >= target.length) {
				frameRef.current = null;
				return;
			}
			if (lastTimeRef.current === 0) {
				lastTimeRef.current = time;
			}
			const elapsed = time - lastTimeRef.current;
			if (elapsed >= msPerChar) {
				// Reveal as many chars as the elapsed budget allows. Catches up
				// after long frames (tab backgrounded, jank).
				const charsToAdvance = Math.min(
					Math.floor(elapsed / msPerChar),
					target.length - cursorRef.current,
				);
				cursorRef.current += charsToAdvance;
				setVisible(target.slice(0, cursorRef.current));
				lastTimeRef.current = time;
			}
			frameRef.current = requestAnimationFrame(tick);
		};

		frameRef.current = requestAnimationFrame(tick);

		return () => {
			if (frameRef.current !== null) {
				cancelAnimationFrame(frameRef.current);
				frameRef.current = null;
			}
		};
	}, [fullText, isStreaming, msPerChar]);

	return visible;
}
