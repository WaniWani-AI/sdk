import { type RefObject, useEffect, useRef, useState } from "react";

function spansMultipleLines(field: HTMLTextAreaElement | null, text: string) {
	if (text.includes("\n")) {
		return true;
	}
	if (!field || text === "") {
		return false;
	}
	const style = getComputedStyle(field);
	const lineHeight = Number.parseFloat(style.lineHeight);
	if (!(lineHeight > 0)) {
		return false;
	}
	const padding =
		(Number.parseFloat(style.paddingTop) || 0) +
		(Number.parseFloat(style.paddingBottom) || 0);
	return field.scrollHeight - padding > lineHeight * 1.5;
}

export function useMultiline(
	container: RefObject<HTMLElement | null>,
	text: string,
): boolean {
	const [multiline, setMultiline] = useState(false);
	const lastMeasured = useRef(false);
	useEffect(() => {
		const field = container.current?.querySelector("textarea") ?? null;
		const next = spansMultipleLines(field, text);
		if (next !== lastMeasured.current) {
			lastMeasured.current = next;
			setMultiline(next);
		}
	}, [container, text]);
	return multiline;
}
