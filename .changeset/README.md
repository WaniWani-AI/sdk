# Changesets

A changeset is a small Markdown file in this folder. It names the packages a PR releases, the semver bump for each, and the line that goes into each package's `CHANGELOG.md`. Add one in any PR that changes what users of `@waniwani/sdk`, `@waniwani/chat` or `@waniwani/kit` get:

```bash
bun changeset
```

Commit the file it writes. A PR never edits a `version` field or a `CHANGELOG.md`, because the release workflow does both in the Version Packages PR.

Pick the bump by semver: `patch` for a fix, `minor` for a feature, `major` for any breaking change to the public API. A major release also ships its migration (see "Releasing" in `CLAUDE.md`). `packages/core` is never published on its own; tsup inlines it into both packages, so a change there names `@waniwani/sdk`, `@waniwani/chat`, or both.

Write the summary for someone upgrading: what changed for them, and what they have to do, if anything. Tests, CI and repo docs release nothing and need no changeset.

## Releasing

Every changeset that lands on `main` updates one PR, "chore(release): version packages". Merging it is the release. The release workflow builds and packs each bumped package, runs the flow eval when the release contains the SDK, then publishes to npm, tags each package (`@waniwani/sdk@1.2.3`) and creates its GitHub release. A flow eval regression publishes nothing, the other packages included.

## Betas

For a beta line, use the `beta` branch in pre mode. Its releases count up (`1.3.0-beta.0`, `1.3.0-beta.1`) under the `beta` dist-tag:

1. Release what is pending on `main` first, or its changesets go into the first beta.
2. Create `beta` from `main`. On it, set `"baseBranch": "beta"` in `config.json`, run `bun changeset pre enter beta`, and commit both.
3. Open PRs against `beta` with changesets as usual. The release workflow keeps a "version packages (beta)" PR open against `beta`, and merging it publishes the next beta.
4. To go stable, set `baseBranch` back to `main` on `beta`, run `bun changeset pre exit`, commit, and merge `beta` into `main`. The next Version Packages PR on `main` releases the stable versions.

For a one-off build of any branch, run the Release workflow by hand on that branch (Actions → Release → Run workflow) and pick `beta` or `alpha`. The branch needs a changeset. The run publishes a snapshot such as `1.3.0-beta-20261105101500` under that dist-tag and leaves `latest` alone. Only admins can run it, and snapshots skip the flow eval.
