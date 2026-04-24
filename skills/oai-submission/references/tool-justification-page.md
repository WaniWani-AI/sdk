# Tool Justification Page

Use this exact markdown structure as page content (replace `{TOOL_ROWS}`, `{CSP_ROWS}`, and `{MCP_SERVER_URL}`):

```md
This document lists every tool exposed by your MCP server along with the annotation values and justification descriptions you need to enter in the ChatGPT App submission form.
**How to use this document:** Copy the values from the table below directly into the submission form. Each row corresponds to one tool. The annotation columns tell you what you should see after the tools are scanned (Yes/No). The justification column gives you the exact text to paste.
<callout icon="ℹ️">
	This was prepared by your WaniWani developer. If anything looks incorrect or doesn't match your app's behavior, reach out to your point of contact before submitting.
</callout>
---
## Tool Annotations
<table fit-page-width="true" header-row="true">
<tr>
<td>Tool Name</td>
<td>Read Only</td>
<td>Read Only Justification</td>
<td>Open World</td>
<td>Open World Justification</td>
<td>Destructive</td>
<td>Destructive Justification</td>
</tr>
{TOOL_ROWS}
</table>
---
## CSP Metadata
Domains that the MCP server and its widgets interact with.
<table fit-page-width="true" header-row="true">
<tr>
<td>Tool Name</td>
<td>Connect Domains</td>
<td>Resource Domains</td>
<td>Redirect Domains</td>
</tr>
{CSP_ROWS}
</table>
---
## Quick Reference — What the annotations mean
Outlined here, providing more context than the actual specification: [Tool Annotations blog post](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)
<table fit-page-width="true" header-row="true">
<tr>
<td>Annotation</td>
<td>Meaning</td>
<td>Set to Yes when…</td>
<td>Set to No when…</td>
</tr>
<tr>
<td>**Read Only**</td>
<td>Does this tool only read data without modifying anything?</td>
<td>The tool only fetches/displays data. No records are created, updated, or deleted.</td>
<td>The tool creates, updates, or deletes any data.</td>
</tr>
<tr>
<td>**Open World**</td>
<td>Does the tool interact with an open world of external entities, or is its domain closed?</td>
<td>The tool makes HTTP calls to *any* backend, API, or third-party service that the user defines, e.g. doing a web search or similar</td>
<td>The tool only operates on local data, renders UI with no external calls, or uses pre-approved internal APIs that are under our complete control.</td>
</tr>
<tr>
<td>**Destructive**</td>
<td>Can this tool delete, overwrite, or irreversibly modify data?</td>
<td>The tool can delete records, overwrite existing data, or cause irreversible changes.</td>
<td>The tool only reads or creates new data without modifying/deleting existing records.</td>
</tr>
</table>
```

## Row Templates

Each `{TOOL_ROWS}` entry is one `<tr>` block per tool:
```md
<tr>
<td>`tool_name`</td>
<td>Yes or No</td>
<td>Specific justification explaining what the tool does and why it is/isn't read-only</td>
<td>Yes or No</td>
<td>Specific justification — name the APIs it calls or state it renders local UI</td>
<td>Yes or No</td>
<td>Specific justification — explain if it creates/deletes/overwrites data</td>
</tr>
```

Each `{CSP_ROWS}` entry:
```md
<tr>
<td>`tool_name`</td>
<td>[{MCP_SERVER_URL}]({MCP_SERVER_URL}) or —</td>
<td>[{MCP_SERVER_URL}]({MCP_SERVER_URL}) or —</td>
<td>[customer-site.com](https://customer-site.com) or —</td>
</tr>
```

## Justification Guidelines

- Write concise but specific justifications — explain what the tool actually does
- Don't write generic text like "read only so non-destructive" — describe the actual behavior
- For Open World, name the specific APIs called or state "renders a local React component with no external calls"
