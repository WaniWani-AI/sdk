---
name: knowledge-base
description: Set up a knowledge base with search for an MCP project. Creates FAQ tool and ingestion script using the WaniWani KB API via @waniwani/sdk.
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Set Up Knowledge Base

Add semantic search over markdown documents to an MCP project using the WaniWani KB API (`client.kb`).

## Prerequisites

- Project must already be initialized (no `{{MCP_NAME}}` placeholders)
- `@waniwani/sdk` must be installed
- `WANIWANI_API_KEY` must be set in the environment

## Steps

### 1. Detect MCP name

Look in `lib/` for the directory that isn't `shared` — that's the MCP name. Store as `{MCP_NAME}`.

### 2. Create knowledge directory

Create `lib/{MCP_NAME}/knowledge-base/knowledge/` directory.

Ask the user: "Do you have .md files to add to the knowledge base, or should I create an example file?"

If no files provided, create `lib/{MCP_NAME}/knowledge-base/knowledge/example.md`:

```markdown
# Example Knowledge Base

## What is this?

This is an example knowledge base entry. Replace this file with your own .md files containing information you want your AI assistant to be able to search through.

## How does it work?

Each .md file is split into chunks by H2 headings. The H1 title provides context for each chunk. Run `bun run kb:ingest` to upload your knowledge files to the WaniWani API.
```

### 3. Create the ingestion script

Create `scripts/kb-ingest.ts` (create `scripts/` directory if it doesn't exist):

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

console.log("Ingesting files into knowledge base...");
console.log("⚠️  This will replace all existing KB chunks for this environment.");

const result = await client.kb.ingest(files);
console.log(`Done: ${result.chunksIngested} chunks from ${result.filesProcessed} files`);
```

### 4. Add ingest script to package.json

Add to `scripts`:
```json
"kb:ingest": "bun run scripts/kb-ingest.ts"
```

### 5. Create the FAQ tool

Create `lib/{MCP_NAME}/tools/faq.ts`:

```typescript
import { waniwani } from "@waniwani/sdk";
import { createTool } from "@waniwani/sdk/mcp";
import { z } from "zod";

const client = waniwani();

export const faqTool = createTool(
  {
    id: "faq",
    title: "FAQ",
    description:
      "Answer frequently asked questions. Use this when users ask general questions about the product or service.",
    inputSchema: {
      question: z.string().describe("The user's question"),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  async ({ question }) => {
    const results = await client.kb.search(question, { topK: 5 });

    if (results.length === 0) {
      return {
        text: "I don't have a specific answer for that question.",
      };
    }

    const text = results
      .map((r) => `**${r.heading}**\n${r.content}`)
      .join("\n\n---\n\n");

    return { text };
  },
);
```

### 6. Register the FAQ tool

Export from `lib/{MCP_NAME}/tools/index.ts`:

```typescript
export { faqTool } from "./faq";
```

Import and register in `app/mcp/route.ts`:

```typescript
import { faqTool } from "@/lib/{MCP_NAME}/tools";
// ...
await registerTools(server, [faqTool]);
```

### 7. Ingest knowledge files

```bash
bun run kb:ingest
```

This requires `WANIWANI_API_KEY` to be set in the environment.

### 8. Verify

```bash
bun run build
```

### 9. Print summary

Tell the user:

- Knowledge files go in: `lib/{MCP_NAME}/knowledge-base/knowledge/`
- Run `bun run kb:ingest` after adding or updating .md files
- `WANIWANI_API_KEY` must be set in the environment
- Markdown files should use `# Title` (H1) and `## Section` (H2) structure
- Ingestion is destructive — it replaces all existing chunks for the environment
