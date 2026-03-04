import { cosineSimilarity, embed } from "ai";
import type { EmbeddingsFile, KnowledgeBase, SearchResult } from "./types";

/**
 * Create a knowledge base instance from pre-loaded embeddings data.
 *
 * ```typescript
 * import embeddings from "./embeddings.json";
 * const kb = loadKnowledgeBase(embeddings);
 * ```
 */
export function loadKnowledgeBase(source: EmbeddingsFile): KnowledgeBase {
	function getEmbeddings(): EmbeddingsFile {
		return source;
	}

	return {
		get chunkCount() {
			return getEmbeddings().chunks.length;
		},

		async search(query: string, topK = 5): Promise<SearchResult[]> {
			const { model, dimensions, chunks } = getEmbeddings();

			const { embedding: queryEmbedding } = await embed({
				model,
				value: query,
				...(dimensions && {
					providerOptions: { openai: { dimensions } },
				}),
			});

			const scored = chunks.map((chunk) => ({
				source: chunk.source,
				heading: chunk.heading,
				content: chunk.content,
				score: cosineSimilarity(queryEmbedding, chunk.embedding),
			}));

			return scored.sort((a, b) => b.score - a.score).slice(0, topK);
		},
	};
}
