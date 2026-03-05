export interface SearchResult {
	source: string;
	heading: string;
	content: string;
	score: number;
}

/** A file to ingest into the knowledge base */
export interface KbIngestFile {
	/** Filename (used as chunk source identifier) */
	filename: string;
	/** Markdown content of the file */
	content: string;
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
