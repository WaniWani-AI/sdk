/**
 * When a `Retry-After` header says the next request may go out, as epoch
 * milliseconds. The header is either a number of seconds or an HTTP date.
 * Anything else, a missing header included, gives `undefined`.
 */
export function parseRetryAfter(
	value: string | null,
	now: number,
): number | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}
	if (/^\d+$/.test(trimmed)) {
		return now + Number(trimmed) * 1000;
	}
	const date = Date.parse(trimmed);
	return Number.isNaN(date) ? undefined : date;
}
