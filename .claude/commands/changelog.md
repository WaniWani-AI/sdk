---
description: Generate a changelog summary for a Linear project and copy to clipboard
argument-hint: <project-name>
skill: copy
---

Generate a changelog summary for the Linear project specified in $ARGUMENTS.

## Steps

1. **Fetch project details** using `mcp__linear__get_project` with the project name from $ARGUMENTS
2. **Fetch all project issues** using `mcp__linear__list_issues` filtered by the project
3. **Generate changelog** with:
   - Project name and status
   - Summary of what was delivered (based on project description and completed issues)
   - List of completed issues
   - Business value / impact section
4. **Copy to clipboard** using the `copy` skill:
   - On macOS: pipe content to `pbcopy`
   - On Linux: pipe content to `xclip -selection clipboard`
5. **Confirm** to the user that the changelog was copied to their clipboard

## Changelog Format

Generate the changelog in this markdown format:

```markdown
# [Project Name] - Changelog

**Status:** [Completed/In Progress/etc.]
**Date:** [Current Date]

## Summary

[Brief description of what the project achieved based on project description]

## What Was Delivered

- [Key deliverable 1]
- [Key deliverable 2]
  ...

## Completed Issues

| ID     | Title       |
| ------ | ----------- |
| WAN-XX | Issue title |

...

## Business Value

[Summarize the impact and value delivered based on the project scope and deliverables]
```

## Copy to Clipboard

After generating the changelog, copy it to the clipboard:

**macOS:**

```bash
cat <<'EOF' | pbcopy
[changelog content]
EOF
```

**Linux:**

```bash
cat <<'EOF' | xclip -selection clipboard
[changelog content]
EOF
```

Then confirm: "Changelog copied to clipboard!"

## Example Usage

```
/changelog-linear Conversation Monitoring
```
