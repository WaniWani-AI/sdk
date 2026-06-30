---
name: pull-request
description: Ensure a Linear ticket exists, then create and push a GitHub pull request for the latest commit — assigned to the author and linked so Linear auto-closes it. Use when the user runs /pull-request or asks to open a PR, create a pull request, push their branch as a PR, or "PR this".
---

# Create a Pull Request

Create a GitHub pull request immediately using the following rules:

## Step 1: Ensure a Linear ticket exists (do this BEFORE pushing)

1. Check whether a Linear ticket is already associated with this work. Look for a ticket identifier (e.g. `WAN-123`) in the current branch name and in the latest commit message(s).
2. If a ticket identifier is found, reuse it - no need to create a new one.
3. If NO ticket is found, create one with the Linear MCP:
   - Do NOT hardcode an email. The Linear MCP is authenticated as the person running this skill, so assign the issue with `assignee: "me"` - this is the reliable team-safe way to assign to the current user. (Git/GitHub email may differ from the Linear email, so matching by email is unreliable; only fall back to `list_users` matching if `"me"` is unavailable.) Use `list_teams` to resolve the team.
   - Create the issue with a concise title derived from the latest commit message, assigned to `"me"`.
   - Set its state to "In Progress".
   - Capture the returned ticket identifier (e.g. `WAN-123`) and its URL.
   - Verify the assignment took effect (the created issue's `assignee` should be the current user); if it didn't, retry the assignment explicitly with `save_issue`.

## Step 2: Create the PR

4. Push any uncommitted changes first if needed. If there are uncommitted changes, commit them first before creating the PR.
5. Ensure we're on the correct branch (not main/master).
6. Use `gh pr create --assignee @me` to create the PR and auto-assign it to the user.
7. Use the latest commit message as the PR title.
8. Make sure the Linear ticket is referenced so Linear links and auto-closes the PR: include the ticket identifier (e.g. `WAN-123`) either in the branch name or in the PR description body. If the ticket identifier is NOT already in the branch name, the PR body MUST contain a line `Closes WAN-123` (using the real identifier). If it is already in the branch name, leave the body empty.

Important:

- Keep the PR title simple - just use the commit message as-is.
- Do not add extra formatting or emoji to the title.
- The Linear ticket check/creation MUST happen before pushing.
