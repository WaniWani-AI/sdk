import { readFileSync } from "node:fs";
import { cosineSimilarity, embed } from "ai";
import type { EmbeddingsFile, KnowledgeBase, SearchResult } from "./types";

export function loadKnowledgeBase(embeddingsPath: string): KnowledgeBase {
	let cached: EmbeddingsFile | null = null;

	function getEmbeddings(): EmbeddingsFile {
		if (cached) return cached;
		cached = JSON.parse(
			readFileSync(embeddingsPath, "utf-8"),
		) as EmbeddingsFile;
		return cached;
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
