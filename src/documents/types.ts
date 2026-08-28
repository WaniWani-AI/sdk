/**
 * Structural stand-in for a Zod schema, so the package root's type graph does
 * not reference `zod`, an optional peer. Pass a real Zod schema: `extract()`
 * converts it with `z.toJSONSchema()`, which no other `parse`-shaped object
 * survives.
 */
export interface DocumentSchema<T> {
	parse(value: unknown): T;
}

export interface DocumentExtractResult<T> {
	/** The document's contents, parsed with the schema you passed. A null field is one the document did not legibly answer. */
	fields: T;
	/** Pages the vendor processed and billed */
	pageCount: number;
	/** Mean per-page OCR confidence, null when none was reported */
	pageConfidence: number | null;
	/** Handle for this extraction, valid for the 7-day retention window */
	documentId: string;
}

/** A document the visitor uploaded through the chat widget, already stored by the platform. */
export interface AttachedDocument {
	/** Pass to `documents.extract({ documentId, schema })` to read it. */
	documentId: string;
	/** Name the visitor's file had */
	filename: string;
	/** MIME type the browser declared on upload */
	mediaType: string;
}

interface DocumentExtractCommon<T> {
	/** The shape to return. Extraction runs in strict mode, so mark anything a document may not answer `.nullable()`. */
	schema: DocumentSchema<T>;
	/** Zero-based page indexes to read: `[0]` is the first page. Omit to read every page. Ignored for images. Billing is per page processed, so a narrower selection costs less. */
	pages?: number[];
	/** Conversation this document arrived in */
	sessionId?: string;
	/** Ties the extraction to one tool call */
	correlationId?: string;
}

/** Read a document the platform has never seen, by fetching it. */
export interface DocumentExtractUrlInput<T> extends DocumentExtractCommon<T> {
	/** A publicly fetchable URL; private and loopback addresses are refused */
	url: string;
	/** Name of the file, used to refuse an unsupported type before fetching it */
	filename: string;
	documentId?: never;
}

/** Read a document the platform already holds, uploaded by a visitor through the chat widget. */
export interface DocumentExtractStoredInput<T>
	extends DocumentExtractCommon<T> {
	/** From `context.waniwani.attachedDocuments`, or `readAttachedDocuments()` on your own chat route. The platform kept the filename, so there is none to pass. */
	documentId: string;
}

export type DocumentExtractInput<T> =
	| DocumentExtractUrlInput<T>
	| DocumentExtractStoredInput<T>;

export interface DocumentsClient {
	/** Read one document and get its contents shaped by `schema`. Accepts PDF, PNG, JPEG, TIFF, BMP, GIF and WEBP up to 50 MB. */
	extract<T>(input: DocumentExtractInput<T>): Promise<DocumentExtractResult<T>>;
}
