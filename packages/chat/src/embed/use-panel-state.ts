import { type RefObject, useEffect, useRef, useState } from "react";
import { parseCssDuration } from "../lib/css-duration";

export type PanelState = "opening" | "shown" | "closing" | "hidden";

type PanelDurationToken =
	| "--ww-panel-open-duration"
	| "--ww-panel-close-duration";

const DEFAULT_DURATION_MS: Record<PanelDurationToken, number> = {
	"--ww-panel-open-duration": 440,
	"--ww-panel-close-duration": 260,
};

function readCssDuration(
	el: HTMLElement | null,
	name: PanelDurationToken,
): number {
	const raw = el ? getComputedStyle(el).getPropertyValue(name) : "";
	return parseCssDuration(raw) ?? DEFAULT_DURATION_MS[name];
}

export function usePanelState(
	open: boolean,
	el: RefObject<HTMLElement | null>,
	options?: { readDuration?: (name: PanelDurationToken) => number },
): PanelState {
	const [state, setState] = useState<PanelState>(open ? "shown" : "hidden");
	const [previousOpen, setPreviousOpen] = useState(open);
	const readDurationRef = useRef(options?.readDuration);
	readDurationRef.current = options?.readDuration;

	if (open !== previousOpen) {
		setPreviousOpen(open);
		setState(open ? "opening" : "closing");
	}

	useEffect(() => {
		if (state !== "opening" && state !== "closing") {
			return;
		}
		const opening = state === "opening";
		const token: PanelDurationToken = opening
			? "--ww-panel-open-duration"
			: "--ww-panel-close-duration";
		const readDuration =
			readDurationRef.current ?? ((name) => readCssDuration(el.current, name));
		const id = setTimeout(
			() => setState(opening ? "shown" : "hidden"),
			readDuration(token),
		);
		return () => clearTimeout(id);
	}, [state, el]);

	return state;
}
