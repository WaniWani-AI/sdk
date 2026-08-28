import type { AttachedDocument } from "./types.js";

const DOCUMENT_ID_KEYS = ["documentId", "document_id"] as const;
const FILENAME_KEYS = ["filename", "file_name", "fileName", "name"] as const;
const MEDIA_TYPE_KEYS = [
	"mediaType",
	"media_type",
	"mimeType",
	"mime_type",
	"contentType",
	"content_type",
] as const;

const UNNAMED_FILENAME = "document";
const UNKNOWN_MEDIA_TYPE = "application/octet-stream";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickFirst(
	source: Record<string, unknown>,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const value = source[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

/** Only the id is load-bearing: it is what `extract()` needs, so an entry missing the descriptive two is still usable. */
function toAttachedDocument(entry: unknown): AttachedDocument | undefined {
	if (!isRecord(entry)) {
		return undefined;
	}

	const documentId = pickFirst(entry, DOCUMENT_ID_KEYS);
	if (!documentId) {
		return undefined;
	}

	return {
		documentId,
		filename: pickFirst(entry, FILENAME_KEYS) ?? UNNAMED_FILENAME,
		mediaType: pickFirst(entry, MEDIA_TYPE_KEYS) ?? UNKNOWN_MEDIA_TYPE,
	};
}

function collect(candidate: unknown): AttachedDocument[] {
	const documents: AttachedDocument[] = [];
	const seen = new Set<string>();

	for (const entry of Array.isArray(candidate) ? candidate : [candidate]) {
		const document = toAttachedDocument(entry);
		if (document && !seen.has(document.documentId)) {
			seen.add(document.documentId);
			documents.push(document);
		}
	}

	return documents;
}

function fromLatestUserTurn(messages: unknown): AttachedDocument[] {
	if (!Array.isArray(messages)) {
		return [];
	}

	const latest = [...messages]
		.reverse()
		.find((message) => isRecord(message) && message.role === "user");
	if (!isRecord(latest) || !Array.isArray(latest.parts)) {
		return [];
	}

	return collect(
		latest.parts.flatMap((part: unknown) =>
			isRecord(part) && isRecord(part.data) ? [part, part.data] : [part],
		),
	);
}

/**
 * The documents a visitor attached on the latest user turn, for a chat route you
 * run yourself. Pass the parsed request body: the widget sends them in a
 * top-level `documents` field, outside `messages`, so the bytes stay out of the
 * transcript that is reposted on every later turn.
 *
 * ```ts
 * const body = await request.json();
 * for (const { documentId } of readAttachedDocuments(body)) {
 *   const { fields } = await wani.documents.extract({ documentId, schema });
 * }
 * ```
 *
 * Also accepts the `documents` array alone, or a `messages` array whose latest
 * user message carries the ids in its parts. Unparseable input yields an empty
 * array; repeated ids collapse to one.
 */
export function readAttachedDocuments(input: unknown): AttachedDocument[] {
	const body = isRecord(input) ? input : undefined;

	const declared = collect(body ? body.documents : input);
	if (declared.length > 0) {
		return declared;
	}

	return fromLatestUserTurn(body ? body.messages : input);
}
