---
description: Create and push a GitHub pull request with the latest commit
---

Create a GitHub pull request immediately using the following rules:

1. Use `gh pr create --assignee @me` to create the PR and auto-assign it to the user
2. Use the latest commit message as the PR title
3. Leave the PR description/body empty initially
4. Push any uncommitted changes first if needed
5. Ensure we're on the correct branch (not main/master)

Important:
- Keep the PR title simple - just use the commit message as-is
- Do not add extra formatting or emoji to the title
- If there are uncommitted changes, commit them first before creating the PR
