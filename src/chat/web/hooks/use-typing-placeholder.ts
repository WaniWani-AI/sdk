import { useEffect, useRef, useState } from "react";

const TYPE_SPEED_MS = 50;
const DELETE_SPEED_MS = 30;
const PAUSE_AFTER_TYPE_MS = 2000;
const PAUSE_AFTER_DELETE_MS = 500;

/**
 * Returns a string that animates like someone typing and deleting the placeholder text.
 * Only animates when `active` is true (i.e. the input is empty).
 */
export function useTypingPlaceholder(text: string, active = true): string {
	const [displayed, setDisplayed] = useState("");
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		if (!active) {
			// Reset so the animation restarts fresh when re-activated
			setDisplayed("");
			return;
		}

		let i = 0;
		let deleting = false;
		let disposed = false;

		const tick = () => {
			if (disposed) return;

			if (!deleting) {
				// Typing forward
				i++;
				setDisplayed(text.slice(0, i));

				if (i >= text.length) {
					// Finished typing — pause then start deleting
					deleting = true;
					timerRef.current = setTimeout(tick, PAUSE_AFTER_TYPE_MS);
				} else {
					timerRef.current = setTimeout(tick, TYPE_SPEED_MS);
				}
			} else {
				// Deleting
				i--;
				setDisplayed(text.slice(0, i));

				if (i <= 0) {
					// Finished deleting — pause then start typing again
					deleting = false;
					timerRef.current = setTimeout(tick, PAUSE_AFTER_DELETE_MS);
				} else {
					timerRef.current = setTimeout(tick, DELETE_SPEED_MS);
				}
			}
		};

		// Start after a small delay
		timerRef.current = setTimeout(tick, PAUSE_AFTER_DELETE_MS);

		return () => {
			disposed = true;
			clearTimeout(timerRef.current);
		};
	}, [text, active]);

	return displayed;
}
