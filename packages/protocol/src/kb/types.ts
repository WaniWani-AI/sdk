export interface SearchResult {
	source: string;
	heading: string;
	content: string;
	score: number;
	metadata?: Record<string, string>;
}

// One kb.search() call, folded onto the tool.called event as
// properties.kbSearch. Metadata only — chunk bodies stay in the tool output.
export interface KbSearchTrace {
	query: string;
	resultCount: number;
	results: Array<Pick<SearchResult, "source" | "heading" | "score">>;
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
	 * Push markdown files into the agent's knowledge base.
	 *
	 * The push replaces only the sources named in the payload and lands in the
	 * agent's draft. Nothing goes live until someone publishes the draft in the
	 * WaniWani app. A production key reads live knowledge; any other key reads
	 * the draft while one is open.
	 */
	ingest(files: KbIngestFile[]): Promise<KbIngestResult>;

	/** Search the knowledge base for relevant chunks */
	search(query: string, options?: KbSearchOptions): Promise<SearchResult[]>;

	/** List all sources in the knowledge base */
	sources(): Promise<KbSource[]>;
}
