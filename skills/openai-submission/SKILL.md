---
name: openai-submission
description: Generate 5 positive and 5 negative test cases for OpenAI MCP submission. Analyzes the project's tools and flows to produce structured test scenarios.
user-invocable: true
allowed-tools: Read, Glob, Grep, Bash, Agent, copy
---

# Generate Test Cases for OpenAI Submission

Generate 5 positive and 5 negative test cases by analyzing the MCP server's tools and flows. Output follows the OpenAI submission format.

## Steps

### 1. Discover tools and flows

Find the MCP server's registered tools and flows:

```
# Find tool registrations
Grep for: registerTools, createTool, createFlow
Glob for: lib/**/tools/*.ts, lib/**/flows/*.ts, flows/*.ts
```

Read each tool/flow file to understand:
- Tool `id`, `title`, `description`
- Input schema fields and their descriptions
- Flow state fields and node structure
- What the tool does (handler logic)
- Knowledge base content if a KB tool exists (read the `.md` files in the knowledge directory)

### 2. Identify tool boundaries

For each tool, determine:
- **What it handles**: The specific domain/use cases from its description
- **What it does NOT handle**: Adjacent topics that are out of scope
- **Input constraints**: Required fields, enums, validation rules
- **Data sources**: What data the tool accesses (KB documents, APIs, databases)

### 3. Generate 5 positive test cases

For each positive case, produce:

| Field | Description |
|-------|-------------|
| **Scenario** | Describe the use case to test (1-2 sentences) |
| **User prompt** | The exact prompt the user would type (in quotes) |
| **Tool triggered** | Which tool(s) should be called (by `id`) |
| **Expected output** | What the MCP server should return -- be specific about content, format, and relevance |

Guidelines for positive cases:
- Cover different tools/flows (don't test the same tool 5 times)
- Include at least one flow test case if flows exist
- Include a variety of user phrasings (direct question, conversational, with context)
- Test core happy paths, not edge cases
- Make expected outputs specific to the actual data/content the tool serves

### 4. Generate 5 negative test cases

For each negative case, produce:

| Field | Description |
|-------|-------------|
| **Scenario** | Describe a scenario where the MCP server should NOT trigger (1-2 sentences) |
| **User prompt** | Example prompt that should NOT trigger any tool (in quotes) |

Guidelines for negative cases:
- Test topics adjacent to but outside the tool's domain
- Test requests for user-specific data when tools only serve public/general info
- Test requests that require actions the server cannot perform (e.g., account changes, purchases)
- Test ambiguous prompts that could be mistaken for a tool trigger but shouldn't be
- Test completely off-topic requests

### 5. Format output

Output the test cases as a single markdown block, ready to paste. Use this exact format:

```
## Positive Test Cases

### 1
**Scenario:** ...
**User prompt:** "..."
**Tool triggered:** tool_id
**Expected output:** ...

### 2
...

## Negative Test Cases

### 1
**Scenario:** ...
**User prompt:** "..."

### 2
...
```

### 6. Copy to clipboard

After generating, use the `copy` skill to copy the test cases to the clipboard.
