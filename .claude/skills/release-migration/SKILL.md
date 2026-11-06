---
name: release-migration
description: Cut a @waniwani/sdk version bump that ships its own migration path so users can upgrade automatically. Use when bumping the SDK version, releasing a breaking change, editing the changelog for a release, or when the user says "cut a release", "version bump", "ship a breaking change", or "prepare a migration".
allowed-tools: Read, Glob, Grep, Edit, Write, Bash
---

# Release migration

Both packages follow semver from 1.0.0, so **a breaking change to the public API needs a major bump**. The principle behind this skill: a version bump is not finished until a user (or their agent) can upgrade to it without reading the source. Every breaking change ships with a mechanical, agent-applicable migration. This holds at every version boundary — 0.15, 1.0, and 15.0 alike.

Inspired by how the AI SDK ships `migrate-*` skills for each major: we keep the equivalent baked into the SDK's own docs so upgrading is a one-pass, auto-applied operation.

The repo publishes two packages, each with its own version: `@waniwani/sdk` (`packages/sdk`) and `@waniwani/chat` (`packages/chat`). Both follow semver from 1.0.0. The rule below applies to a breaking change in either one. The docs changelog and the `migrate-waniwani-sdk-*` skills cover both, because SDK users reach the chat through the same docs.

## When to run

- Adding a `major` changeset for `@waniwani/sdk` or `@waniwani/chat`, or releasing a Version Packages PR that carries one
- Landing any change to the **public API tiers** (see [CLAUDE.md](../../../CLAUDE.md) — OSS / Free tier / Legacy surfaces)
- Preparing changelog / release notes
- Deprecating or removing an exported symbol

If the change is purely internal (no exported symbol, type, or documented behavior changes), no migration is needed — say so and stop.

## The rule

**A release that breaks the public API must ship all three of these before it is done:**

1. **Changelog entry** — a `## <version>:` section in the docs changelog (`sdk/changelog.mdx` in the docs repo, published at [docs.waniwani.ai/sdk/changelog](https://docs.waniwani.ai/sdk/changelog)) with:
   - a **before/after** code snippet, and
   - a **mechanical migration** an agent can apply without judgment (a codemod recipe, not "update your calls").
   - Also add a row to the **Breaking changes at a glance** table.
   - **A `<Tip>` at the top of the section linking the version-specific migration skill** (deliverable 2): `npx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-<from>-to-<to>`, so a reader can run the migration, not just read it.
2. **A version-specific migration skill** — a self-contained sibling skill `skills/migrate-waniwani-sdk-<from>-to-<to>/SKILL.md` covering exactly this hop (one skill per version boundary, the way Vercel ships a `migrate-*` skill per major). It restates every breaking change of the release as a numbered, apply-without-judgment recipe, ends with `bun run typecheck && bun test` as the completion check, and does **not** try to handle other version deltas. Copy the newest existing `migrate-waniwani-sdk-*` skill as the template. Add a one-line pointer to it from `skills/waniwani-sdk/SKILL.md`'s upgrade section.
3. **Deprecation shim (where feasible)** — keep the old signature/export working behind a `@deprecated` JSDoc that names the removal version. This turns a hard break into a soft one; users get warnings before errors. Not always possible (a surface that never worked is deleted outright, not shimmed).

## Steps

1. **Identify the breaking changes.** Diff the public surface against the last release:
   ```bash
   git diff @waniwani/sdk@<last-sdk-version>..HEAD -- packages/sdk/src packages/core/src | grep -E '^\-.*export'
   git diff @waniwani/chat@<last-chat-version>..HEAD -- packages/chat/src packages/core/src | grep -E '^\-.*export'
   ```
   Releases up to 1.0.0 carry the older tags `v<version>` (SDK) and `chat-v<version>` (chat).
   Cross-check against the tiers in [CLAUDE.md](../../../CLAUDE.md). A renamed/removed/re-typed export, a changed function signature, a moved entry point, or a changed default is breaking. A new optional export is not.

2. **For each breaking change, write the migration.** Prefer a codemod recipe precise enough to auto-apply: what to match, what to rewrite it to, and how the type checker confirms success. The newest `skills/migrate-waniwani-sdk-*/SKILL.md` sets the quality bar: it tells an agent exactly what to collect and where to insert it.

3. **Add the deprecation shim** if the old shape can coexist. Example:
   ```ts
   /** @deprecated Use `newName`. Removed in 0.16.0. */
   export const oldName = newName;
   ```

4. **Write the changelog section and the migration skill** (deliverables 1 and 2). Keep them in sync: the skill is the applyable form of what the changelog describes.

5. **Release through a changeset**, never by editing `version` by hand. In the PR that carries the breaking change, add a `major` changeset whose summary links the migration skill:
   ```bash
   bun changeset --major @waniwani/sdk -m "Removes oldName. Migrate with \`npx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-<from>-to-<to>\`."
   ```
   Use `--major @waniwani/chat` for the chat, and `--minor` or `--patch` for changes that break nothing. Once the PR merges, the Version Packages PR shows the new version. Land the changelog entry and the migration skill before you merge that PR, because merging it publishes (after the flow eval passes). One Version Packages PR publishes both packages in the same run, so a change that spans both needs no release order. To test a beta first, see "Betas" in `.changeset/README.md`.

6. **Verify.** The migration must survive its own checks:
   ```bash
   bun run typecheck
   bun test
   bun run build
   ```
   Then dry-run the migration against a call site in-repo (or a scratch snippet) to confirm the recipe actually compiles after applying.

7. **Report.** List each breaking change, its migration recipe, and whether a deprecation shim covers it.

## Definition of done

- [ ] A `major` changeset names each package that breaks, and its summary links the migration skill
- [ ] Every breaking change has a changelog `## <version>:` section with before/after + codemod recipe
- [ ] Changelog section links its `migrate-waniwani-sdk-<from>-to-<to>` skill in a `<Tip>`
- [ ] "Breaking changes at a glance" table updated
- [ ] `skills/migrate-waniwani-sdk-<from>-to-<to>/SKILL.md` created for this hop, self-contained, and linked from `skills/waniwani-sdk/SKILL.md`'s upgrade section
- [ ] `@deprecated` shim added wherever the old shape can coexist, naming the removal version
- [ ] `bun run typecheck && bun test && bun run build` pass
- [ ] Migration recipe dry-run compiles

If any box is unchecked, the release is not done.
