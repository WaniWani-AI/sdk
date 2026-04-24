# Knowledge Base (`@waniwani/sdk/kb`)

The KB client is available as `client.kb` on the WaniWani client. It calls the server-side KB API -- no local embeddings or `ai` dependency needed.

## Setup

```typescript
import { waniwani } from "@waniwani/sdk";

const client = waniwani(); // uses WANIWANI_API_KEY env var
```

## `client.kb.search(query, options?)`

Search the knowledge base for relevant chunks.

```typescript
const results = await client.kb.search("How does pricing work?", { topK: 3, minScore: 0.3 });
// Returns: SearchResult[] -- { source, heading, content, score, metadata? }

// Filter by metadata (exact match on all provided key-value pairs)
const results = await client.kb.search("pricing", { metadata: { category: "pricing" } });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `topK` | `number` | `5` | Number of results (1-20) |
| `minScore` | `number` | `0.3` | Minimum similarity score (0-1) |
| `metadata` | `Record<string, string>` | -- | Filter by exact metadata key-value match |

## `client.kb.ingest(files)`

Ingest markdown files into the knowledge base. **Destructive** -- deletes all existing chunks for the environment before ingesting.

```typescript
const result = await client.kb.ingest([
  { filename: "faq.md", content: "# FAQ\n\n## Pricing\n..." },
  { filename: "guide.md", content: "# Guide\n\n## Setup\n...", metadata: { category: "guides" } },
]);
// Returns: { chunksIngested: number, filesProcessed: number }
```

Files are chunked by H2 headings server-side. Max 100 files, 500KB each. Optional `metadata` (key-value pairs) is attached to all chunks from that file.

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

You can push markdown files to the knowledge base from any TypeScript script — it doesn't need to run inside an MCP server.

Create `scripts/kb-ingest.ts`:

```typescript
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { waniwani } from "@waniwani/sdk";

const client = waniwani(); // uses WANIWANI_API_KEY env var

const knowledgeDir = join(import.meta.dirname, "../knowledge");
const files = await readdir(knowledgeDir);
const mdFiles = files.filter((f) => f.endsWith(".md"));

console.log(`Ingesting ${mdFiles.length} files from ${knowledgeDir}`);

const docs = await Promise.all(
  mdFiles.map(async (filename) => ({
    filename,
    content: await readFile(join(knowledgeDir, filename), "utf-8"),
  })),
);

const result = await client.kb.ingest(docs);
console.log(`Done: ${result.chunksIngested} chunks from ${result.filesProcessed} files`);
```

Run it with `npx tsx scripts/kb-ingest.ts` or add to `package.json` scripts: `"kb:ingest": "npx tsx scripts/kb-ingest.ts"`

## Types

```typescript
interface SearchResult {
  source: string;
  heading: string;
  content: string;
  score: number;
  metadata?: Record<string, string>;
}

interface KbIngestFile {
  filename: string;
  content: string;
  metadata?: Record<string, string>;
}

interface KbIngestResult {
  chunksIngested: number;
  filesProcessed: number;
}

interface KbSearchOptions {
  topK?: number;
  minScore?: number;
  metadata?: Record<string, string>;
}

interface KbSource {
  source: string;
  chunkCount: number;
  createdAt: string;
}
```
