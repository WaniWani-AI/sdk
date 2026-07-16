---
name: release-migration
description: Cut a @waniwani/sdk version bump that ships its own migration path so users can upgrade automatically. Use when bumping the SDK version, releasing a breaking change, editing the changelog for a release, or when the user says "cut a release", "version bump", "ship a breaking change", or "prepare a migration".
allowed-tools: Read, Glob, Grep, Edit, Write, Bash
---

# Release migration

`@waniwani/sdk` is `0.x`, so **minor bumps can break the public API**. The principle behind this skill: a version bump is not finished until a user (or their agent) can upgrade to it without reading the source. Every breaking change ships with a mechanical, agent-applicable migration. This holds at every version boundary — 0.15, 1.0, and 15.0 alike.

Inspired by how the AI SDK ships `migrate-*` skills for each major: we keep the equivalent baked into the SDK's own docs so upgrading is a one-pass, auto-applied operation.

## When to run

- Bumping the version in `package.json`
- Landing any change to the **public API tiers** (see [CLAUDE.md](../../../CLAUDE.md) — OSS / Free tier / Legacy surfaces)
- Preparing changelog / release notes
- Deprecating or removing an exported symbol

If the change is purely internal (no exported symbol, type, or documented behavior changes), no migration is needed — say so and stop.

## The rule

**Every breaking change in a release must ship all three of these before the release is done:**

1. **Changelog entry** — a `## <version>:` section in the docs changelog (`sdk/changelog.mdx` in the docs repo, published at [docs.waniwani.ai/sdk/changelog](https://docs.waniwani.ai/sdk/changelog)) with:
   - a **before/after** code snippet, and
   - a **mechanical migration** an agent can apply without judgment (a codemod recipe, not "update your calls").
   - Also add a row to the **Breaking changes at a glance** table.
2. **`upgrading.md` entry** — mirror the changelog into `skills/waniwani-sdk/references/upgrading.md` under **"Currently auto-fixable breaking changes"**, so an agent can migrate a user's codebase without a network fetch. Match the existing `### <version> — <one-line summary>` format.
3. **Deprecation shim (where feasible)** — keep the old signature/export working behind a `@deprecated` JSDoc that names the removal version. This turns a hard break into a soft one; users get warnings before errors.

## Steps

1. **Identify the breaking changes.** Diff the public surface against the last release:
   ```bash
   git diff <last-tag>..HEAD -- src/ | grep -E '^\-.*export'
   ```
   Cross-check against the tiers in [CLAUDE.md](../../../CLAUDE.md). A renamed/removed/re-typed export, a changed function signature, a moved entry point, or a changed default is breaking. A new optional export is not.

2. **For each breaking change, write the migration.** Prefer a codemod recipe precise enough to auto-apply: what to match, what to rewrite it to, and how the type checker confirms success. See the `0.14.0` `addConditionalEdge` entry in [upgrading.md](../../../skills/waniwani-sdk/references/upgrading.md) for the target quality — it tells an agent exactly what to collect and where to insert it.

3. **Add the deprecation shim** if the old shape can coexist. Example:
   ```ts
   /** @deprecated Use `newName`. Removed in 0.16.0. */
   export const oldName = newName;
   ```

4. **Update the changelog and `upgrading.md`** with entries 1 and 2 above. Keep the two in sync — `upgrading.md` explicitly mirrors the changelog.

5. **Bump the version** in `package.json` (and commit as `<version>` per the repo's tagging convention — see recent `git log`).

6. **Verify.** The migration must survive its own checks:
   ```bash
   bun run typecheck
   bun test
   bun run build
   ```
   Then dry-run the migration against a call site in-repo (or a scratch snippet) to confirm the recipe actually compiles after applying.

7. **Report.** List each breaking change, its migration recipe, and whether a deprecation shim covers it.

## Definition of done

- [ ] Every breaking change has a changelog `## <version>:` section with before/after + codemod recipe
- [ ] "Breaking changes at a glance" table updated
- [ ] `skills/waniwani-sdk/references/upgrading.md` mirrors each entry under "Currently auto-fixable breaking changes"
- [ ] `@deprecated` shim added wherever the old shape can coexist, naming the removal version
- [ ] `bun run typecheck && bun test && bun run build` pass
- [ ] Migration recipe dry-run compiles

If any box is unchecked, the release is not done.
