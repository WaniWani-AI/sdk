---
name: wani-code-review
description: Pre-review quality assurance for any repo in the WaniWani workspace. Run this skill BEFORE creating a PR, before claiming work is done, or when the user says "review", "QA", "check my changes", "pre-review", "ready for review", or anything suggesting they want to validate their work before sharing it. Also trigger proactively after completing a significant implementation task. This is the last line of defense before code reaches reviewers.
---

# WaniWani Code Review

Quality gate that runs before code reaches human reviewers. Catches the patterns that cause PR feedback loops — type safety violations, missing translations, architectural anti-patterns, and convention drift.

The skill works in three layers: automated tooling checks, a diff analysis against project conventions, and finally a broader code review pass via the `code-review:code-review` skill.

## Step 0: Scope Detection

Before running any checks, determine which repo you're working in:

1. Identify the repo from the user's request or from the current working directory / recent file edits
2. Find the repo root (look for `.git/`, `package.json`, `CLAUDE.md`)
3. Read the repo's own `CLAUDE.md` if one exists — it contains repo-specific conventions, commands, and rules that Layer 1 and Layer 2 checks must respect
4. If the repo happens to sit inside a larger workspace that has its own root `CLAUDE.md` above it, read that too for cross-repo rules — but don't assume one exists; many repos are standalone

The repo's CLAUDE.md is the source of truth for:
- Which package manager and commands to use (`bun lint` vs `npm run lint`)
- Which linter/formatter is configured (Biome vs ESLint)
- Repo-specific patterns (data fetching conventions, auth patterns, file structure)
- What tools exist for checking (knip, tsc, translations:build, etc.)

Adapt all Layer 1 commands and Layer 2 checks to the specific repo. The categories below use examples from a Next.js/TypeScript app, but the same principles apply to any repo — adapt to whatever conventions that repo's CLAUDE.md documents.

## When to Run

- Before creating a PR or pushing a branch
- Before claiming implementation work is complete
- When the user asks for a review, QA pass, or pre-review check
- Proactively after finishing a multi-file feature implementation

## Layer 1: Automated Checks

Run the repo's own tooling and report any failures. Adapt commands based on what the repo's CLAUDE.md documents. These are non-negotiable — fix failures before proceeding to Layer 2.

### 1.1 Type checking

Run the repo's TypeScript check command. For most repos this is `bun tsc --noEmit` but check the CLAUDE.md for the exact command (some repos use `bun run build` which includes type checking).

Report only NEW errors — compare against the base branch if needed.

### 1.2 Linter / Formatter

Run the repo's lint command (e.g., `bun lint`, `bun check:fix`). The specific linter (Biome, ESLint) and its config vary by repo — the CLAUDE.md will specify.

Must pass with zero errors.

### 1.3 Unused code detection

If the repo has a dead code checker (e.g., `bun knip`), run it. Any unused export in a file you modified is your responsibility to fix.

### 1.4 Translation sync (if applicable)

If the repo uses a translation system (check for `translations:build` in CLAUDE.md or `@translations.ts` files), verify the translation index is in sync:

```bash
bun translations:build
git diff --stat -- src/lib/translations/index.ts
```

If this produces a diff, the translation index is out of sync.

### 1.5 Type assertion scan

Search the diff for `as` type assertions:

```bash
git diff HEAD -- '*.ts' '*.tsx' | grep '^\+' | grep -v '^\+\+\+' | grep '\bas\b'
```

Filter out acceptable uses: `as const`, `as keyof typeof`, narrowing after type guards. Everything else is a violation per CLAUDE.md — use Zod `safeParse` for unknown data or typed variables for known unions.

## Layer 2: Diff Analysis

Get the full diff of changed files, then read each changed file and evaluate against the categories below. This requires understanding the code and its context — not just pattern matching.

### How to run Layer 2

1. Get the list of changed files: `git diff --name-only HEAD` (or vs the base branch)
2. Get the full diff: `git diff HEAD`
3. Read each changed file in full (not just the diff hunks — you need surrounding context)
4. Read the repo's CLAUDE.md to understand which conventions apply
5. Walk through every category below, checking each changed file
6. For each issue found, record: file path, line number, category, description, severity (blocker/warning)

### 2.1 Translations & Localization

Skip this category if the repo doesn't use a translation system.

- Every user-visible string in TSX/JSX must go through the translation system (e.g., `useTranslation` hook, `t.some.key`)
- This includes: button labels, headings, descriptions, empty states, error messages, toast messages, placeholder text, aria labels, loading/fallback text
- This does NOT include: CSS class names, HTML attributes, internal keys, log messages, error codes thrown to API consumers
- If a component has user-facing text, verify a co-located translation file exists with all supported languages
- For French translations: verify proper accents and cedillas. Common misses include words like "Apercu/Apercu", "Parametres/Parametres", "a/a" (preposition). Read the French entries carefully.
- Loading/fallback text is still user-visible — raw strings like `"..."` or `"Loading"` in JSX are violations

### 2.2 Data Fetching Patterns

Skip categories that don't apply to the repo's stack.

- Server components should prefetch data efficiently — if a page.tsx makes multiple sequential `fetchQuery` calls that could be combined into a single API endpoint, flag it as a waterfall
- **Client-side request waterfalls**: if a client component fetches data A, then uses the result to fetch data B, C, D in sequence (or in a loop), and these could be served by a single endpoint, flag it. The pattern to watch for: one `useQuery` whose result feeds into another `useQuery`, or a component that maps over query results and fires individual fetches per item. These should be consolidated server-side into one endpoint that returns everything the page needs.
- Client components should use the query pattern documented in the repo's CLAUDE.md (e.g., `useSuspenseQuery` with query option functions, not custom hooks wrapping `useQuery`)
- `useQuery` (non-suspense) is acceptable only in conditional/optional contexts with an `enabled` guard — and the component must handle the `undefined` data state
- Never use raw `fetch()` if the repo has API helpers — use the documented pattern (e.g., `api.GET()` with Zod schema validation)
- Check that query keys are consistent — if two components fetch the same data, they should use the same query key so the cache is shared

### 2.3 API Route Conventions

Skip if the changed files don't include API routes.

- Authentication: use the auth pattern documented in the CLAUDE.md (e.g., `authenticate()` for org-scoped, `authenticateEnvironmentDualAuth()` for environment-scoped)
- **Authorization scope**: every query that returns user data must include an `orgId` filter. If an endpoint authenticates the user but queries a resource only by its own ID (e.g., `WHERE environment_id = X` without `AND org_id = Y`), any user who knows the resource ID can access another org's data. This is a blocker-level security issue.
- Request validation: request bodies must be validated with Zod schemas, not trusted blindly
- Response format: use the repo's standard response helpers, not raw `Response` or `NextResponse.json()`
- Error handling: wrap in try/catch with the standard error handler
- Response shapes must match their Zod schemas — if a schema requires a field (not `.optional()`), every code path must include it. Check early returns and error fallbacks especially.
- **Response scope**: an endpoint should return data relevant to its domain. If a use-cases endpoint returns `hasEvents` (an SDK integration concern), or an analytics endpoint returns user profile data, flag it as a leaky abstraction — the consuming frontend will couple to unrelated concerns.

### 2.4 Database & Query Patterns

Skip if the changed files don't include database queries or API routes.

- **N+1 queries**: if a function fetches a list of items and then calls another query inside a loop (e.g., `for (const item of items) { await fetchDetails(item.id) }`), this is an N+1 pattern. The inner query should be batched — fetch all details in one query using `WHERE id IN (...)` or similar, then map results in memory. This is a blocker when the outer list can grow beyond a handful of items.
- **Raw SQL as a code smell**: if Drizzle's query builder is insufficient and you're using `sql` template literals, `sql.join`, or `sql.raw` to build queries, consider whether the data model fits the access pattern. Occasional raw SQL for JSONB operators or aggregations is fine. But if simple CRUD operations need raw SQL (e.g., `WHERE config_id IN (sql.join(...))` instead of a simple `WHERE environment_id = X`), the schema likely needs restructuring. Flag these and explain why the query builder doesn't work naturally.
- **Unnecessary joins**: if every query on table A requires joining through table B just to filter by a column that logically belongs on A, the data model has unnecessary indirection. This is a warning — it may be intentional, but it should be called out for the reviewer.
- **Missing indexes**: if a query filters on a column that doesn't have an index (check the schema definition), flag it as a warning for any table expected to grow.
- **Shared data fetched multiple times**: if the same data (e.g., events for a date range) is fetched identically in multiple places within the same request lifecycle, it should be fetched once and shared. The classic sign is multiple functions accepting the same `(environmentId, flowId, dateRange)` parameters and each making their own DB call.
- **Data model vs. access pattern mismatch**: if the primary query pattern for a feature is "get all X for environment Y" but the schema forces a join through an intermediate table to reach X, the data model doesn't match the access pattern. Ask: could the filtering column live directly on the queried table? If the intermediate table only exists to hold a foreign key, it may be unnecessary indirection. This is a warning — raise it for the reviewer to evaluate.

### 2.5 Module Structure & Imports

- Verify imports follow the conventions documented in the CLAUDE.md — schemas, types, and query functions should live where the CLAUDE.md says they should
- Check for imports from paths that don't match the project's established structure (e.g., importing from an internal subdirectory when the parent module re-exports everything)
- Check for duplicate definitions — if a Zod schema or type already exists elsewhere, don't redefine it

### 2.6 Component Architecture

Skip categories that don't apply to the repo's stack.

- One component per file — if a file defines multiple exported components, they should be split
- Event handlers with business logic must be extracted to named functions, not inlined in `onClick`
- Loading states should use the pattern documented in the CLAUDE.md (e.g., Skeleton components, not spinners)
- Check that the repo's UI conventions are followed (layout patterns, empty states, confirmation dialogs)

### 2.7 Code Quality

- No reinventing existing helpers — before writing utility code, search the codebase for existing implementations. Date math, response formatting, auth checks, and common operations almost always have existing helpers.
- No deprecated patterns — if the codebase has moved away from a pattern (check git history and CLAUDE.md for guidance), new code must use the modern replacement
- Functions with 2+ parameters should use object input `{ field1, field2 }`, not positional arguments (if the CLAUDE.md specifies this convention)
- No temporal references in comments ("now", "previously", "was", "switched from") — comments describe current behavior, git handles history
- Code should be self-documenting — don't add comments explaining what code does unless the logic is genuinely non-obvious
- **Naming coherence**: when a feature introduces a domain concept (e.g., "use case", "flow config"), the naming should be consistent across the schema, API routes, query functions, frontend components, and URL paths. If the schema calls it `funnels` but the UI says "use cases" and the API path is `/analytics/funnel`, flag the inconsistency — it creates cognitive overhead for every developer who touches the feature.

### 2.8 Styling & Design Consistency

Skip if the changed files don't include UI components.

- Colors and styling should use the design token system (CSS variables, Tailwind tokens), not hardcoded hex values. Exception: SVG charts or third-party library configurations where CSS variables can't be applied may use design token hex values.
- Follow the repo's documented UI patterns for page structure, spacing, and component usage

## Layer 3: Code Review Pass

After completing Layer 1 and Layer 2, invoke the `code-review:code-review` skill on the same scope. This adds a broader second pass that catches issues outside the project-specific patterns above — logic bugs, git history context, and cross-cutting concerns.

`code-review:code-review` is **Anthropic's official `code-review` skill — a separate plugin, not bundled with this skill.** If it isn't installed, don't fail: report that Layer 3 was skipped because the `code-review` skill isn't available (Layers 1 and 2 still ran), and suggest installing the official `code-review` plugin to enable it.

Determine the right scope argument based on context:
- For uncommitted changes: "review the diff between HEAD and the current uncommitted changes in {repo}/"
- For a feature branch: "review the diff between main and HEAD in {repo}/"
- For a specific PR: "review PR #{number} on {owner}/{repo}"

## Reporting

Present findings in this format:

```
## WaniWani Code Review Report — {repo}

### Layer 1: Automated Checks
- TypeScript: PASS / FAIL (N new errors)
- Lint: PASS / FAIL
- Unused code: PASS / FAIL (N unused exports)
- Translations: PASS / FAIL / N/A
- Type assertions: PASS / FAIL (N violations)

### Layer 2: Diff Analysis
[List issues grouped by severity]

BLOCKERS (must fix before review):
1. [file:line] Category — description

WARNINGS (should fix, reviewer will likely flag):
1. [file:line] Category — description

### Layer 3: Code Review
[Results from code-review:code-review skill]
```

## Growing This Skill

This skill is a living document. When a PR reviewer catches something that the skill should have caught, add it:

1. If it's a deterministic check (can be linted/grepped), add it to Layer 1
2. If it requires reading code and understanding context, add it to the appropriate Layer 2 category
3. If it's a new category entirely, create a new `2.N` section

The goal: every piece of PR feedback should only happen once. After that, this skill catches it automatically.
