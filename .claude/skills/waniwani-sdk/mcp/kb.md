# Knowledge Base Client (`@waniwani/sdk/kb`)

The KB client is available as `client.kb` on the WaniWani client. It calls the server-side KB API — no local embeddings or `ai` dependency needed.

## Setup

```typescript
import { waniwani } from "@waniwani/sdk";

const client = waniwani(); // uses WANIWANI_API_KEY env var
```

## `client.kb.search(query, options?)`

Search the knowledge base for relevant chunks.

```typescript
const results = await client.kb.search("How does pricing work?", { topK: 3, minScore: 0.3 });
// Returns: SearchResult[] — { source, heading, content, score }
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `topK` | `number` | `5` | Number of results (1-20) |
| `minScore` | `number` | `0.3` | Minimum similarity score (0-1) |

## `client.kb.ingest(files)`

Ingest markdown files into the knowledge base. **Destructive** — deletes all existing chunks for the environment before ingesting.

```typescript
const result = await client.kb.ingest([
  { filename: "faq.md", content: "# FAQ\n\n## Pricing\n..." },
  { filename: "guide.md", content: "# Guide\n\n## Setup\n..." },
]);
// Returns: { chunksIngested: number, filesProcessed: number }
```

Files are chunked by H2 headings server-side. Max 100 files, 500KB each.

## `client.kb.sources()`

List all sources in the knowledge base.

```typescript
const sources = await client.kb.sources();
// Returns: { source: string, chunkCount: number, createdAt: string }[]
```

## Example: FAQ Tool

```typescript
import { waniwani } from "@waniwani/sdk";
import { createTool } from "@waniwani/sdk/mcp";
import { z } from "zod";

const client = waniwani();

export const faqTool = createTool(
  {
    id: "faq",
    title: "FAQ",
    description: "Answer frequently asked questions.",
    inputSchema: { question: z.string().describe("The user's question") },
    annotations: { readOnlyHint: true },
  },
  async ({ question }) => {
    const results = await client.kb.search(question, { topK: 5 });

    if (results.length === 0) {
      return { text: "I don't have a specific answer for that question." };
    }

    const text = results
      .map((r) => `**${r.heading}**\n${r.content}`)
      .join("\n\n---\n\n");

    return { text };
  },
);
```

## Example: Ingestion Script

Create `scripts/kb-ingest.ts`:

```typescript
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { waniwani } from "@waniwani/sdk";

const knowledgeDir = join(import.meta.dirname, "../lib/{MCP_NAME}/knowledge-base/knowledge");

const mdFiles = (await readdir(knowledgeDir)).filter((f) => f.endsWith(".md"));
console.log(`Found ${mdFiles.length} knowledge file(s)`);

const files = await Promise.all(
  mdFiles.map(async (filename) => ({
    filename,
    content: await readFile(join(knowledgeDir, filename), "utf-8"),
  })),
);

const client = waniwani();
const result = await client.kb.ingest(files);
console.log(`Done: ${result.chunksIngested} chunks from ${result.filesProcessed} files`);
```

Add to `package.json` scripts: `"kb:ingest": "bun run scripts/kb-ingest.ts"`

## Types

```typescript
interface SearchResult {
  source: string;
  heading: string;
  content: string;
  score: number;
}

interface KbIngestFile {
  filename: string;
  content: string;
}

interface KbIngestResult {
  chunksIngested: number;
  filesProcessed: number;
}

interface KbSearchOptions {
  topK?: number;
  minScore?: number;
}

interface KbSource {
  source: string;
  chunkCount: number;
  createdAt: string;
}
```
