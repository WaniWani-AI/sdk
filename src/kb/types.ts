export interface Chunk {
	id: string;
	source: string;
	heading: string;
	content: string;
	embedding: number[];
}

export interface EmbeddingsFile {
	model: string;
	dimensions?: number;
	generatedAt: string;
	chunks: Chunk[];
}

export interface SearchResult {
	source: string;
	heading: string;
	content: string;
	score: number;
}

export interface GenerateEmbeddingsOptions {
	/** Directory containing .md files to embed */
	knowledgeDir: string;
	/** Output path for embeddings.json */
	outputPath: string;
	/** Embedding model string (default: "openai/text-embedding-3-small") */
	model?: string;
	/** Embedding dimensions (default: 512) */
	dimensions?: number;
}

export interface KnowledgeBase {
	/** Search the knowledge base for relevant chunks */
	search(query: string, topK?: number): Promise<SearchResult[]>;
	/** Number of chunks in the knowledge base */
	readonly chunkCount: number;
}
