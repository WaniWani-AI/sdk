# Test Cases Page

Use this exact Notion markdown structure as content (replace `{POSITIVE_ROWS}` and `{NEGATIVE_ROWS}`):

```notionmd
This document contains all the test cases you need to enter in the ChatGPT App submission form. These have been prepared by your WaniWani developer based on your app's tools and expected behavior.
**How to use this document:** Review each test case below, then copy the values directly into the submission form. If anything doesn't match how your app works, reach out to your WaniWani point of contact before submitting.
---
## Positive Test Cases (minimum 5)
These are scenarios where your app **should** trigger and work correctly. OpenAI reviewers will run these to validate your app.
<table fit-page-width="true" header-row="true">
<tr>
<td>#</td>
<td>Scenario</td>
<td>User Prompt (paste into form)</td>
<td>Tools Triggered</td>
<td>Expected Output</td>
</tr>
{POSITIVE_ROWS}
</table>
---
## Negative Test Cases (minimum 3)
These are prompts where your app should **NOT** trigger. They help OpenAI confirm your app doesn't activate inappropriately.
<table fit-page-width="true" header-row="true">
<tr>
<td>#</td>
<td>Scenario</td>
<td>User Prompt (paste into form)</td>
<td>Why the app should NOT trigger</td>
</tr>
{NEGATIVE_ROWS}
</table>
```

## Row Templates

Each `{POSITIVE_ROWS}` entry:
```notionmd
<tr>
<td>1</td>
<td>Short scenario description</td>
<td>The actual user message to paste into the form</td>
<td>tool_1, tool_2, tool_3</td>
<td>Step-by-step description of what should happen: which widgets appear, what the agent asks, what the final output looks like</td>
</tr>
```

Each `{NEGATIVE_ROWS}` entry:
```notionmd
<tr>
<td>1</td>
<td>Short scenario description</td>
<td>The actual user message to paste into the form</td>
<td>Explanation of why this is out of scope for the app</td>
</tr>
```

## Guidelines

Include at least **5-6 positive cases** covering:
- The main happy path (full flow completion)
- Variations of the flow (different options/branches)
- Knowledge base / FAQ usage (if applicable)
- Edge cases from the flow's conditional edges (e.g., error recovery, alternate paths, boundary conditions)

Include at least **3 negative cases** covering:
- A request for a related but out-of-scope product/service
- A general question that's not actionable by the app
- A request in a completely different domain
