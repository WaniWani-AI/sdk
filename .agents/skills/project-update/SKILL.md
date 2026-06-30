---
name: project-update
description: Post status updates on Linear projects for non-technical teams. Use this skill when the user says "project update", "update my projects", "linear update", "status update", "update projects on linear", "post project status", or mentions updating project progress for the team. Also trigger when the user wants to sync ticket/project statuses on Linear based on recent work.
---

# Project Update

Post concise, non-technical status updates on Linear projects and keep ticket/project statuses in sync. The audience is non-technical teams (business, customer success, leadership) who need to understand where things stand without engineering jargon.

## What This Skill Does

1. Gathers recent activity from multiple sources (git, Linear, Granola meetings, user context)
2. For each active project, drafts a short product-oriented status update (1-3 sentences)
3. Detects stale ticket/project statuses and proposes corrections
4. After user validation, posts updates to Linear and applies status changes

Nothing is posted or changed without explicit user approval.

## Output Style

The team uses plain, conversational status updates. Match this tone — no bullet points, no markdown headers, no emojis. Just a few sentences that answer: what happened, where is it heading, any blockers.

**Examples that match the team's tone:**

> Still in progress, working on last UX quirks. Targeting May 15th for pushing this to prod on the client side

> The client has submitted the app for review on ChatGPT on May 8th
> Waiting on the review to be approved or rejected

> We are super blocked on this one because the client says the technical API documentation isn't ready, and the person responsible on their side is short on capacity.

Key principles:
- Product language, not engineering language ("user flow is ready for testing" not "refactored the handler and merged the PR")
- Short — 1 to 3 sentences max per project
- Mention concrete next steps or blockers when relevant
- Use real dates, client names, and feature names — be specific
- Health status: `onTrack`, `atRisk`, or `offTrack`

## WaniWani Product Repos

When matching project work to git, activity is read entirely through `gh` against these repos on GitHub ([github.com/WaniWani-AI](https://github.com/orgs/WaniWani-AI/repositories)) — never from local clones:

| GitHub repo | What it is |
| --- | --- |
| [WaniWani-AI/app](https://github.com/WaniWani-AI/app) | Main application |
| [WaniWani-AI/sdk](https://github.com/WaniWani-AI/sdk) | `@waniwani/sdk` |
| [WaniWani-AI/website](https://github.com/WaniWani-AI/website) | Marketing site |
| [WaniWani-AI/cli](https://github.com/WaniWani-AI/cli) | `@waniwani/cli` |

Linear is the source of truth for which projects exist; the org has other repos (demos, templates, experiments, archived) that aren't core product work. When a project's work lives outside these repos, rely on Linear plus the user's context.

## Step-by-step Flow

### Step 0 — Preflight: required connectors

This skill posts to Linear, reads from Granola, and gathers git activity through GitHub (`gh`). Before gathering anything, confirm all three are available. If any is missing, STOP and guide setup — do not silently skip a source.

- **GitHub CLI** — run `gh auth status`. If it fails, stop and tell the user: "This skill reads your git activity through the GitHub CLI, which isn't authenticated here. Run `gh auth login` (with access to the WaniWani-AI org), then re-run."
- **Linear** — you need Linear MCP tools (list projects/issues, post status updates, save issues). If no Linear tools are available, stop and tell the user: "This skill needs the Linear connector, which isn't available in this session. Add it in your Claude connectors / MCP setup (Settings → Connectors → Linear, or `claude mcp add` the Linear server), then re-run."
- **Granola** — you need Granola MCP tools (meeting context). If Granola isn't available, stop and tell the user: "This skill uses Granola for project context, which isn't available in this session. Add the Granola connector in your Claude connectors / MCP setup, then re-run."

### Step 1 — Identify target projects

Using your Linear tools, fetch your active projects (you as lead or member, `member: me`, `limit: 20`).

Filter to projects with status type `started` or `planned` (skip `completed`, `canceled`, `backlog`/`idea` unless the user asks).

Present the list and ask: "These are your active projects — should I update all of them, or just specific ones?"

### Step 2 — Gather activity per project

For each target project, gather data from all sources in parallel.

**2a. Linear tickets** — using your Linear tools, fetch recent activity on the project's issues (`project: <project-name>`, `updatedAt: -P7D`, `orderBy: updatedAt`, `limit: 20`).

Pay attention to:
- Tickets recently moved to Done/In Review
- Tickets still In Progress
- Blocked tickets
- New tickets created this week

**2b. GitHub activity** — Read your recent commits and PRs across the product repos through `gh` (no local clones), then match them to the project:

```bash
ME=$(gh api user --jq .login)
SINCE=$(date -v-7d '+%Y-%m-%dT00:00:00%z')   # Linux: date -d '7 days ago 00:00' '+%Y-%m-%dT%H:%M:%S%z'
SINCE_DAY=$(date -v-7d +%Y-%m-%d)             # Linux: date -d '7 days ago' +%Y-%m-%d
for repo in WaniWani-AI/app WaniWani-AI/sdk WaniWani-AI/website WaniWani-AI/cli; do
  commits=$(gh api "repos/$repo/commits?author=$ME&since=$SINCE" --jq '.[] | .commit.message | split("\n")[0]' 2>/dev/null)
  [ -n "$commits" ] && { echo "=== $repo commits ==="; echo "$commits"; }
  prs=$(gh pr list --repo "$repo" --author @me --state all --search "updated:>=$SINCE_DAY" --json title,state,url --limit 20 2>/dev/null)
  [ -n "$prs" ] && [ "$prs" != "[]" ] && { echo "=== $repo PRs ==="; echo "$prs"; }
done
```

Match commits/PRs to the relevant Linear project by their content. If a project's work lives outside these four repos, rely on Linear plus the user's context instead — and ask the user about activity GitHub didn't capture.

**2c. Previous status update** — using your Linear tools, fetch the last status update for the project (`type: project`, `project: <project-name>`, `limit: 1`) to avoid repeating and to show progression.

**2d. Granola meetings** — using your Granola tools, look for project-related decisions or client context from this week for `<project-name>`.

### Step 3 — Detect status inconsistencies

While analyzing the data, look for tickets or projects whose status doesn't match reality:

- **Ticket has merged PR but still "In Progress"** → suggest moving to "Done" or "In Review"
- **Ticket marked "In Progress" but no commits or updates in 2+ weeks** → flag as potentially stale
- **All project tickets are done but project is still "In Progress"** → suggest completing the project
- **Blocked tickets** without the "blocked" label or status → suggest updating
- **Project health** mismatch — if there are blockers or overdue items, suggest `atRisk`

Build a list of proposed changes but do NOT execute them yet.

### Step 4 — Draft and present everything

Present a clear summary for each project, structured like this:

```
═══ BPI MCP ═══
Status update:
  "Working on funnel UX fixes and ChatGPT integration refinements. Targeting end of week for client-facing testing."
  Health: onTrack

Suggested ticket changes:
  • WAN-142 "Setup BPI flow" → move from "In Progress" to "Done" (all commits merged)
  • WAN-156 "ChatGPT submission" → move from "Todo" to "In Progress" (work started)

═══ Custom funnel logic MCP ═══
Status update:
  "Funnel use case detail page is built. Now refining the sync mechanism between SDK and app. Next: UX polish pass."
  Health: onTrack

No ticket changes needed.
```

Then ask: "Look good? Edit anything, or I'll post them all."

The user might:
- Approve everything as-is
- Edit specific update text
- Skip certain projects
- Reject certain ticket changes
- Change health status

### Step 5 — Execute approved changes

Only after explicit approval, use your Linear tools to execute in this order:

**5a. Ticket status changes** (if approved) — save each issue with its new state (`id: <ticket-id>`, `state: <new-state>`).

**5b. Project status updates** — post the approved update for each project (`type: project`, `project: <project-name>`, `body: <approved-text>`, `health: <approved-health>`).

**5c. Project status changes** (if approved, e.g., moving a project to Completed) — save the project with its new state (`id: <project-id>`, `state: <new-state>`).

Confirm each action as it completes: "Posted update on BPI MCP. Updated WAN-142 to Done."

## Edge Cases

- **No recent activity on a project**: Ask the user what's going on rather than guessing. Maybe it's paused, maybe work happened outside GitHub/Linear.
- **User is not the lead**: Still allow updates — team members can post status updates too.
- **Granola or GitHub CLI unavailable**: Covered by the Step 0 preflight (stop and guide setup).
- **Project's work lives outside the product repos**: That's fine — rely on Linear plus the user's context, and ask about work GitHub didn't see.
- **User wants to update a single project**: Skip the project selection step and go straight to gathering + drafting.
