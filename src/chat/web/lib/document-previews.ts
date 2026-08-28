/** Object URLs for attached images. Memory only: message metadata is persisted, and a `blob:` URL does not survive a reload. */

const MAX_PREVIEWS = 20;

const previews = new Map<string, string>();

export function rememberDocumentPreview(documentId: string, url: string): void {
	if (previews.has(documentId)) {
		URL.revokeObjectURL(url);
		return;
	}

	previews.set(documentId, url);

	while (previews.size > MAX_PREVIEWS) {
		const oldest = previews.keys().next();
		if (oldest.done) {
			return;
		}
		const stale = previews.get(oldest.value);
		previews.delete(oldest.value);
		if (stale) {
			URL.revokeObjectURL(stale);
		}
	}
}

export function documentPreviewUrl(documentId: string): string | undefined {
	return previews.get(documentId);
}

export function forgetDocumentPreview(documentId: string): void {
	const url = previews.get(documentId);
	if (url) {
		previews.delete(documentId);
		URL.revokeObjectURL(url);
	}
}
