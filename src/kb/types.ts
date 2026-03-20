export interface SearchResult {
	source: string;
	heading: string;
	content: string;
	score: number;
	metadata?: Record<string, string>;
}

/** A file to ingest into the knowledge base */
export interface KbIngestFile {
	/** Filename (used as chunk source identifier) */
	filename: string;
	/** Markdown content of the file */
	content: string;
	/** Arbitrary key-value metadata attached to all chunks from this file */
	metadata?: Record<string, string>;
}

/** Response from the ingest endpoint */
export interface KbIngestResult {
	/** Number of chunks created from the ingested files */
	chunksIngested: number;
	/** Number of files successfully processed */
	filesProcessed: number;
}

/** Options for the search method */
export interface KbSearchOptions {
	/** Number of results to return (1-20, default 5) */
	topK?: number;
	/** Minimum similarity score threshold (0-1, default 0.3) */
	minScore?: number;
	/** Filter results to chunks whose metadata contains all these key-value pairs (exact match) */
	metadata?: Record<string, string>;
}

/** A source entry in the knowledge base */
export interface KbSource {
	/** Source filename */
	source: string;
	/** Number of chunks from this source */
	chunkCount: number;
	/** ISO timestamp of when the source was first ingested */
	createdAt: string;
}

/** KB client for server-side knowledge base operations */
export interface KbClient {
	/**
	 * Ingest files into the knowledge base.
	 *
	 * **Warning**: This is destructive — it deletes ALL existing chunks
	 * for the environment before ingesting the new files.
	 */
	ingest(files: KbIngestFile[]): Promise<KbIngestResult>;

	/** Search the knowledge base for relevant chunks */
	search(query: string, options?: KbSearchOptions): Promise<SearchResult[]>;

	/** List all sources in the knowledge base */
	sources(): Promise<KbSource[]>;
}
