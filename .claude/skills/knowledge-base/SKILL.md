---
name: knowledge-base
description: Set up a semantic knowledge base with search for an MCP project. Creates knowledge directory, embed script, search module, and FAQ tool using @waniwani/sdk/kb.
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Set Up Knowledge Base

Add semantic search over markdown documents to an MCP project using `@waniwani/sdk/kb`.

## Prerequisites

- Project must already be initialized (no `{{MCP_NAME}}` placeholders)
- `@waniwani/sdk` must be installed

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

Each .md file is split into chunks by H2 headings. The H1 title provides context for each chunk. Run `bun run embed` to generate embeddings after adding or updating your knowledge files.
```

### 3. Create the search module

Create `lib/{MCP_NAME}/knowledge-base/search.ts`:

```typescript
import { loadKnowledgeBase } from "@waniwani/sdk/kb";
import embeddings from "./embeddings.json";

const kb = loadKnowledgeBase(embeddings);

export const search = kb.search;
```

Note: We import the JSON directly instead of using a file path because `import.meta.dirname` is undefined in Next.js's bundled environment.

### 4. Create the embed script

Create `scripts/embed.ts` (create `scripts/` directory if it doesn't exist):

```typescript
import { join } from "node:path";
import { generateEmbeddings } from "@waniwani/sdk/kb";

await generateEmbeddings({
  knowledgeDir: join(import.meta.dirname, "../lib/{MCP_NAME}/knowledge-base/knowledge"),
  outputPath: join(import.meta.dirname, "../lib/{MCP_NAME}/knowledge-base/embeddings.json"),
});
```

### 5. Add embed script to package.json

Add to `scripts`:
```json
"embed": "bun run scripts/embed.ts"
```

### 6. Install @ai-sdk/openai

```bash
bun add @ai-sdk/openai
```

### 7. Create the FAQ tool

Create `lib/{MCP_NAME}/tools/faq.ts`:

```typescript
import { createTool } from "@waniwani/sdk/mcp";
import { z } from "zod";
import { search } from "../knowledge-base/search";

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
    const results = await search(question, 5);

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

### 8. Register the FAQ tool

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

### 9. Generate initial embeddings

```bash
bun run embed
```

This requires `OPENAI_API_KEY` to be set in the environment.

### 10. Verify

```bash
bun run build
```

### 11. Print summary

Tell the user:

- Knowledge files go in: `lib/{MCP_NAME}/knowledge-base/knowledge/`
- Run `bun run embed` after adding or updating .md files
- `OPENAI_API_KEY` must be set in the environment for embedding
- The `embeddings.json` file should be committed to git
- Markdown files should use `# Title` (H1) and `## Section` (H2) structure
