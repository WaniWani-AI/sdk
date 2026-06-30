---
name: linear-oneshot
description: 'Find one-shottable WaniWani Linear tickets and scope them for autonomous execution. Use when the user says "triage one-shots", "find easy tickets", "find simple tickets", "one-shot triage", "qualify WAN-123", "scope WAN-123", "is this ticket one-shottable", or wants to label simple Linear tickets an agent can implement in a single run.'
---

# Linear One-Shot

Surfaces **one-shottable** Linear tickets — small, well-defined, safe for an AI agent to implement in a single autonomous run — and **scopes** them into an executable brief so anyone can pick one up and run an agent on it.

Two operations:

- **Triage** — scan a backlog, classify each ticket (candidate / needs-qualify / reject), report. *"triage one-shots", "find easy tickets in repo_app".*
- **Qualify** — take one ticket, read its code, produce a scoped brief + a ready / needs-human verdict. *"qualify WAN-326".*

A third stage, **execute**, is a documented hand-off (see the end) — this skill does not write code.

**Default posture is read-only.** Triage and qualify report in chat. Every Linear write (labels, comments) is opt-in and only happens after you explicitly confirm a shown draft — never silently.

## Step 0 — Preflight

- **Linear MCP — required.** You need Linear tools (`list_issues`, `get_issue`, `list_issue_labels`, and for writes `save_issue` / `save_comment` / `create_issue_label`). If they are not available, STOP and tell the user: "This skill needs the Linear connector, which isn't available in this session. Add it in your Claude connectors / MCP setup (Settings → Connectors → Linear, or `claude mcp add` the Linear server), then re-run." Do not proceed without it.
- **GitHub CLI (`gh`) — optional.** Only used by qualify to read a ticket's files when you are *not* inside a checkout of that ticket's repo. If `gh auth status` fails, qualify still works from inside the relevant repo; out-of-repo it degrades to "I can't read the code — run me from inside the repo, or authenticate `gh`."

Then route by intent: a backlog/triage request → **Operation A**; a single ticket id ("qualify WAN-123") → **Operation B**.

## Operation A — Triage

1. **Pick one repo.** The executor that will eventually implement these tickets runs in a single repo, so triage is per-repo. Default to `repo_app` (label) unless the user names another (`repo_sdk`, `repo_cli`, `repo_website`). Confirm the repo if ambiguous.
2. **List the backlog.** `list_issues` with `team: Product`, `state: backlog` (and/or `unstarted`), the chosen `repo_*` label, `includeArchived: false`. Page through if needed. Large lists may exceed the tool's output budget — if so, classify in batches.
3. **Read enough to judge.** Linear truncates long descriptions in list results. For any ticket that looks like a plausible candidate, fetch the full description with `get_issue` before deciding — a hidden line ("needs a migration", "new copy") flips the verdict. Do not green-light a ticket whose description you only half-read.
4. **Score every ticket with the Rubric (below).** Bucket into ✅ candidate / 🟡 needs-qualify / ❌ reject. **Bias hard toward reject** — a missed candidate costs nothing; a false candidate burns an agent run and erodes trust.
5. **Report** in chat: a one-line summary with counts, then three grouped tables (ticket id, title, one-line rationale citing the specific flag, confidence). It is a completely valid and honest result for a backlog to return **zero** candidates — say so plainly; never manufacture candidates to fill the table.
6. **(Optional) Apply — only on explicit request, e.g. "tag the candidates".** Show the exact labels/comments you will write and ask: "Apply these to Linear? (`oneshot:candidate` + a one-line rationale comment on each)". On approval: ensure the label group exists (see *Writes*), then `save_issue` to add `oneshot:candidate` and `save_comment` for the rationale. Confirm each as it lands. Nothing is written before approval.

## Operation B — Qualify

The high-value stage. Its job is to turn a thin ticket into a brief a fresh agent can execute safely — and to catch what the ticket got wrong.

1. **Read the full ticket.** `get_issue WAN-xxx` (description, project, labels, `gitBranchName`).
2. **Get to the code — the ticket text is a hint, not the truth.** Tickets are frequently wrong about file paths and silent about side effects, so verify everything against the actual code:
   - If the current working directory is a checkout of the ticket's `repo_*` repo (check `git remote get-url origin`), read the named files locally and do an **exhaustive reference check** for every symbol being removed/changed.
   - Otherwise, read the named files via `gh api repos/WaniWani-AI/<repo>/contents/<path>` (and `gh search code` for references). You cannot grep exhaustively this way — **flag the residual uncertainty** in the brief.
   - Never assume sibling repos are checked out (no `../app`). Operate on the repo you are in, or via `gh`.
   - For reference checks prefer the editor's file-search / code tools or `gh search code`; if you fall back to shell `grep`/`rg`, sanity-check the count by reading the importing files (a shell alias or proxy can distort raw output).
3. **Resolve vs. escalate — this is the whole skill.** Sort every open question into one of two kinds:
   - **Implementation question** an agent can answer by reading the code (which file, "delete vs simplify", which API) → *resolve it yourself* and write the answer into the brief.
   - **Product / ops question** the code cannot answer (drop support for old clients? what should the copy say? is this rename intended?) → *escalate it* — the verdict becomes `needs-human` with that single question stated crisply.
4. **Produce the Brief (template below)** and a **verdict**: `ready` (every question resolved) or `needs-human` (one or more product/ops gates).
5. **(Optional) Post — only on explicit request.** Show the brief as a draft Linear comment and the label change (`oneshot:ready` or `oneshot:needs-human`) and ask before writing. On approval, `save_comment` + `save_issue`.

### Worked calibration (what good looks like)

On **WAN-326** ("Remove V1 stream compatibility"): the ticket pointed at `@stream-compat.ts` but the file was actually under `@helpers/`; "simplify `getStreamProtocol`" was really "delete it"; and removing the layer is a **breaking change** for old-SDK clients (they crash on `strictObject`) — which the ticket never mentioned. Qualify resolved the path and the delete-vs-simplify itself, and escalated exactly one gate ("OK to drop protocol-v1 client support?") → verdict `needs-human`. That is the bar: correct the ticket from the code, and surface the one decision a human owns.

## The Rubric

> Default to **reject**. Only tickets that are high-confidence AND have zero red flags become candidates.

**Green flags (toward candidate):** root cause / fix already written in the ticket · names specific files or symbols · `Bug` or small `Improvement` · single concern with an obvious "done" · scoped to one repo · small surface.

**Red flags (any one → reject or `needs-human`, and name it):**

- 🚩 **Touches a Drizzle migration / new table / schema change** (hard stop — migrations need explicit human approval).
- 🚩 **Breaking wire / API change** — alters a response shape, header, protocol, or removes a compat path clients may still use.
- New user-facing copy (requires translations + a build step).
- Touches auth, billing, signup / onboarding, or PII paths.
- An unresolved product / UX / tone / naming decision.
- Cross-repo, or a `Plan:` / umbrella issue.
- Vague framing ("investigate", "figure out", "improve X") with no concrete target.

**Calibration anchors:** **WAN-359** ("Fix TSX/JSX highlighting" — names the component + root cause, one file, no decision) is the *ideal* candidate. **WAN-415** ("Send a thank-you email" — sounds tiny, but implies email infra + new copy + a signup-flow trigger + a tone decision) is the *trap* — reject it. The thing that makes a ticket one-shottable is that **someone already did the thinking and wrote it down**.

## The One-Shot Brief (template)

```
Acceptance criteria:  what "done" means — doubles as the executor's definition-of-done and the reviewer's checklist
Files to touch:       concrete paths, verified against the code (correct the ticket if it's wrong)
Approach:             ≤3 bullets
Out of scope:         what NOT to do — stops scope creep
Open questions:       implementation ones already answered above; only product/ops gates remain
Verdict:              ready  |  needs-human (+ the one decision a human must make)
```

## Execute — hand-off (not run here)

A `ready` ticket carries its brief and the Linear-generated branch name on the ticket (`<assignee>/wan-xxx-...`). To implement it, from inside a checkout of the target repo, run an agent on the brief — or use the **`run-track`** skill for an autonomous multi-phase run. The acceptance criteria in the brief are the agent's definition-of-done. PRs still go through normal human review; a one-shot is never auto-merged. (Future versions may wrap this directly.)

## Writes & confirmation

- **Read-only by default.** Reports and briefs are chat output. Writes happen only when the user explicitly asks, and only after they approve a shown draft. Zero writes without approval.
- **Label group (the coordination spine).** Writes use a mutually-exclusive label group `oneshot`, mirroring the existing `repositories` group: children `candidate` → `qualifying` → `ready` → `needs-human` (reserve `wip` for execute). Before the first write, check it exists via `list_issue_labels`; if not, show the user what you'll create and, on approval, create it with `create_issue_label` (group + children). The labels are the queue — teammates pick up `oneshot:ready` tickets.

## Portability

Company-wide skill — runs for any teammate, anywhere. No personal names, machine paths, or accounts baked in. Gather through the Linear MCP and `gh` against the canonical repos (`WaniWani-AI/app | sdk | website | cli`); deepen with local tools only when the current directory *is* the target repo. Never assume a sibling checkout exists.

## Growing this skill

- Tighten the Rubric when triage misjudges a ticket — add the missed signal as a named flag.
- Keep the calibration anchors current (swap in a fresh ideal/trap from your own backlog).
- v2 candidates: wrap execute via `run-track`; a scheduled cloud run; "scope-at-creation" that qualifies small tickets as they're filed.
