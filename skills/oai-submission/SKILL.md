---
name: oai-submission
description: Generate OpenAI/ChatGPT App submission documents (Tool Justification + Test Cases) in Notion by analyzing the MCP server's tools, flows, and widgets
user-invocable: true
---

# OpenAI App Submission Documents

Generate the two Notion documents required for the ChatGPT App Store submission:
1. **Tool Justification** — annotations (Read Only, Open World, Destructive) with justifications for every tool
2. **Test Cases** — positive and negative test scenarios for OpenAI reviewers

## Steps

### 1. Gather information from the user

Ask the user for:
- **Parent page URL**: The page under which both documents will be created (e.g., the customer's page under MCP Servicing)
- **MCP server production URL**: The Vercel deployment URL (e.g., `https://v1.sidecare.mcp.waniwani.run`)

### 2. Analyze the MCP server codebase

Read the following files to build a complete inventory of all tools:

1. **`app/mcp/route.ts`** — entry point, shows all registered tools, flows, and resources
2. **Flow files** (e.g., `lib/{MCP_NAME}/flow/index.ts` or `lib/{MCP_NAME}/flows/*.ts`) — flow definitions with nodes, edges, and state. Flows register as a single tool.
3. **Display tools / widget tools** (e.g., `lib/{MCP_NAME}/flow/display-tools.ts`) — tools that render widgets
4. **Standalone tools** (e.g., `lib/{MCP_NAME}/tools/*.ts`) — non-flow tools like KB search
5. **API clients / data files** (e.g., `lib/{MCP_NAME}/data/*.ts`) — to understand what external APIs are called and from which domains
6. **Widget components** (e.g., `lib/{MCP_NAME}/widgets/`) — to understand if widgets contain redirect links

For each tool, determine annotations and CSP metadata. See [references/tool-annotations.md](references/tool-annotations.md) for rules and common patterns by tool type.

### 3. Create the Tool Justification page

Create a Notion page under the parent page using the Notion `create-pages` tool with `parent: { page_id: "<parent_page_id>" }`.

**Title**: `{Company Name} - Tool Justification`

See [references/tool-justification-page.md](references/tool-justification-page.md) for the exact Notion markdown structure and row templates.

### 4. Create the Test Cases page

Create a second Notion page under the same parent page.

**Title**: `{Company Name} - Test Cases`

See [references/test-cases-page.md](references/test-cases-page.md) for the exact Notion markdown structure, row templates, and guidelines.

### 5. Write test prompts in the MCP's primary language

If the MCP's user-facing text is in a specific language (e.g., French, Spanish), write the user prompts in that language. Mix in 1-2 English prompts to show the app handles both.

## References

| Topic | Reference |
|-------|-----------|
| Annotation rules + common patterns by tool type | [tool-annotations.md](references/tool-annotations.md) |
| Tool Justification page structure + templates | [tool-justification-page.md](references/tool-justification-page.md) |
| Test Cases page structure + guidelines | [test-cases-page.md](references/test-cases-page.md) |
