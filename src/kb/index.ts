export { createKbClient } from "./client";

export { chunkMarkdown, generateEmbeddings } from "./embed";

export { loadKnowledgeBase } from "./search";
export type {
	Chunk,
	EmbeddingsFile,
	GenerateEmbeddingsOptions,
	KbClient,
	KbIngestFile,
	KbIngestResult,
	KbSearchOptions,
	KbSource,
	KnowledgeBase,
	SearchResult,
} from "./types";
