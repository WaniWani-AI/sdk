/**
 * Structural stand-in for a Zod schema. Declared structurally so the package
 * root's type graph does not reference `zod`, which is an optional peer: a
 * consumer using only tracking would otherwise get TS2307 without skipLibCheck.
 * Any Zod schema satisfies it.
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

export interface DocumentExtractInput<T> {
	/** A publicly fetchable URL; private and loopback addresses are refused */
	url: string;
	/** Name of the file, used to refuse an unsupported type before fetching it */
	filename: string;
	/** The shape to return. Extraction runs in strict mode, so mark anything a document may not answer `.nullable()`. */
	schema: DocumentSchema<T>;
	/** Zero-based page indexes to read: `[0]` is the first page. Omit to read every page. Ignored for images. Billing is per page processed, so a narrower selection costs less. */
	pages?: number[];
	/** Conversation this document arrived in */
	sessionId?: string;
	/** Ties the extraction to one tool call */
	correlationId?: string;
}

export interface DocumentsClient {
	/** Read one document and get its contents shaped by `schema`. Accepts PDF, PNG, JPEG, TIFF, BMP, GIF and WEBP up to 50 MB. */
	extract<T>(input: DocumentExtractInput<T>): Promise<DocumentExtractResult<T>>;
}
