# Upgrading `@waniwani/sdk`

The SDK is `0.x`, so **minor bumps can contain breaking changes**. Whenever you raise the `@waniwani/sdk` version in a project — bumping `package.json`, running `bun add @waniwani/sdk@latest`, or resolving a failed build after an upgrade — treat it as a migration, not a no-op.

## Procedure (run on every minor bump)

1. **Find the version delta.** Note the version you are coming from (the one in the lockfile / `package.json` before the bump) and the version you are moving to.
2. **Read the changelog.** Open [docs.waniwani.ai/sdk/changelog](https://docs.waniwani.ai/sdk/changelog) (source: `sdk/changelog.mdx` in the docs repo). Start at the **Breaking changes at a glance** table, then read every `## <version>:` section whose version is **greater than your old version and less than or equal to your new version**.
3. **Apply each breaking-change migration.** Every breaking change in the changelog ships with a before/after and a mechanical migration (often a codemod recipe). Apply them in version order. They are designed to be auto-applied by an agent in a single pass — do so without asking, then report what you changed.
4. **Verify.** Run the project's checks:
   ```bash
   bun run typecheck
   bun test
   ```
   The type errors after a bump are the migration's to-do list — each one points at a call site the new API rejects.
5. **Report.** Summarize which breaking changes applied to this codebase and which did not (e.g. "no `addConditionalEdge` call sites, nothing to do").

Deprecations (struck-through signatures, `@deprecated` JSDoc) are **not** breaking — the old shape keeps working until the removal version listed in the notice. Migrate them opportunistically, but a build does not require it.

## Currently auto-fixable breaking changes

This list mirrors the changelog so you can apply migrations without a network fetch. Always cross-check against the live changelog for anything newer than this file.

### 0.14.0 — `addConditionalEdge(from, condition)` → `addConditionalEdge(from, to, condition)`

The reachable nodes are now declared explicitly as the second argument; the condition's return type is constrained to that list.

**Auto-fix:** for every two-argument `.addConditionalEdge(` call, read the condition body, collect every node name (string literal or `END`) it can return, and insert that deduplicated list as a new second argument. Leave the condition as the third argument.

```ts
// Before
.addConditionalEdge("route_country", (state) => {
  if (state.country === "FR") return "fr_path";
  if (state.country === "DE") return "de_path";
  return "default_path";
})

// After
.addConditionalEdge(
  "route_country",
  ["fr_path", "de_path", "default_path"],
  (state) => {
    if (state.country === "FR") return "fr_path";
    if (state.country === "DE") return "de_path";
    return "default_path";
  },
)
```

After applying, run `bun run typecheck`. The compiler now checks each condition's return value against `to`, so any missing target surfaces as `Type '"x"' is not assignable to type '"a" | "b"'` — add the missing node to `to`. Over-declaring is harmless.
