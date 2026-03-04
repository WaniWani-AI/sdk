import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { embedMany } from "ai";
import type { Chunk, EmbeddingsFile, GenerateEmbeddingsOptions } from "./types";

const DEFAULT_MODEL = "openai/text-embedding-3-small";
const DEFAULT_DIMENSIONS = 512;

export function chunkMarkdown(
	filename: string,
	content: string,
): Omit<Chunk, "embedding">[] {
	const lines = content.split("\n");
	const chunks: Omit<Chunk, "embedding">[] = [];

	const h1Match = content.match(/^# (.+)$/m);
	const title = h1Match?.[1] ?? filename.replace(".md", "");

	let currentHeading = title;
	let currentContent: string[] = [];
	let chunkIndex = 0;

	for (const line of lines) {
		if (line.match(/^# /)) continue;

		const h2Match = line.match(/^## (.+)$/);
		if (h2Match) {
			if (currentContent.length > 0) {
				const text = currentContent.join("\n").trim();
				if (text) {
					chunks.push({
						id: `${filename.replace(".md", "")}#${chunkIndex}`,
						source: filename,
						heading: currentHeading,
						content: `${title}: ${currentHeading}\n\n${text}`,
					});
					chunkIndex++;
				}
			}
			currentHeading = h2Match[1];
			currentContent = [];
		} else {
			currentContent.push(line);
		}
	}

	const text = currentContent.join("\n").trim();
	if (text) {
		chunks.push({
			id: `${filename.replace(".md", "")}#${chunkIndex}`,
			source: filename,
			heading: currentHeading,
			content: `${title}: ${currentHeading}\n\n${text}`,
		});
	}

	return chunks;
}

export async function generateEmbeddings(
	options: GenerateEmbeddingsOptions,
): Promise<void> {
	const {
		knowledgeDir,
		outputPath,
		model = DEFAULT_MODEL,
		dimensions = DEFAULT_DIMENSIONS,
	} = options;

	const files = (await readdir(knowledgeDir)).filter((f) => f.endsWith(".md"));
	console.log(`Found ${files.length} knowledge files`);

	const allChunks: Omit<Chunk, "embedding">[] = [];
	for (const file of files) {
		const content = await readFile(join(knowledgeDir, file), "utf-8");
		const chunks = chunkMarkdown(file, content);
		allChunks.push(...chunks);
		console.log(`  ${file}: ${chunks.length} chunk(s)`);
	}

	console.log(`\nTotal chunks: ${allChunks.length}`);
	console.log(`Generating embeddings with ${model}...`);

	const { embeddings } = await embedMany({
		model,
		values: allChunks.map((c) => c.content),
		providerOptions: { openai: { dimensions } },
	});

	const chunks: Chunk[] = allChunks.map((chunk, i) => ({
		...chunk,
		embedding: embeddings[i],
	}));

	const output: EmbeddingsFile = {
		model,
		dimensions,
		generatedAt: new Date().toISOString(),
		chunks,
	};

	await writeFile(outputPath, JSON.stringify(output));
	console.log(`\nWritten ${outputPath} (${chunks.length} chunks)`);
}
