import type { ZodType } from "zod";

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

export interface DocumentExtractInput<T> {
	/** A publicly fetchable URL; private and loopback addresses are refused */
	url: string;
	/** Name of the file, used to refuse an unsupported type before fetching it */
	filename: string;
	/** The shape to return. Extraction runs in strict mode, so mark anything a document may not answer `.nullable()`. */
	schema: ZodType<T>;
	/** Conversation this document arrived in */
	sessionId?: string;
	/** Ties the extraction to one tool call */
	correlationId?: string;
}

export interface DocumentsClient {
	/** Read one document and get its contents shaped by `schema`. Accepts PDF, PNG, JPEG, TIFF, BMP, GIF and WEBP up to 50 MB. */
	extract<T>(input: DocumentExtractInput<T>): Promise<DocumentExtractResult<T>>;
}
