/**
 * The platform puts the machine-readable code on `message` and the human reason
 * on `detail`, so a refusal reads as "UNSUPPORTED_DOCUMENT_TYPE: photo.heic is
 * not one of ...". The raw body is the fallback.
 */
export function refusalMessage(
	body: string,
	status: number,
	label: string,
): string {
	try {
		const parsed: unknown = JSON.parse(body);
		if (parsed !== null && typeof parsed === "object") {
			const code =
				"message" in parsed && typeof parsed.message === "string"
					? parsed.message
					: "";
			const detail =
				"detail" in parsed && typeof parsed.detail === "string"
					? parsed.detail
					: "";
			if (code && detail) {
				return `${code}: ${detail}`;
			}
			if (code) {
				return code;
			}
			if (detail) {
				return detail;
			}
		}
	} catch {
		// A non-JSON body is surfaced as-is below.
	}
	return body || `${label} error: HTTP ${status}`;
}
