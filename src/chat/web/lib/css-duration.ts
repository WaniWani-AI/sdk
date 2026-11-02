const CSS_DURATION = /^(\d*\.?\d+)(ms|s)$/;

/** `"250ms"` → 250, `"1.5s"` → 1500, `"0s"` → 0; anything else is `undefined`. */
export function parseCssDuration(raw: string): number | undefined {
	const match = CSS_DURATION.exec(raw.trim());
	if (!match) {
		return undefined;
	}
	const amount = Number(match[1]);
	return match[2] === "s" ? amount * 1000 : amount;
}
