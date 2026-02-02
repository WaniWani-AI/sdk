---
description: Create a production deployment PR from main to deploy/prod with auto-versioning
---

Create a production deployment pull request following these steps:

## Pre-flight Checks

1. **Check working directory is clean**
   ```bash
   git status --porcelain
   ```
   If not clean, warn the user and stop.

2. **Fetch latest from origin**
   ```bash
   git fetch origin
   ```

3. **Check if main is up to date with origin/main**
   ```bash
   git rev-parse main
   git rev-parse origin/main
   ```
   If they differ, warn the user that local main is not up to date.

4. **Check if there are changes to deploy**
   ```bash
   git log origin/deploy/prod..origin/main --oneline
   ```
   If no commits, inform the user there's nothing new to deploy.

## Determine Version

1. **Get today's date** in format `YYYY-MM-DD`

2. **Check existing tags for today**
   ```bash
   git tag -l "YYYY-MM-DD-r*"
   ```

3. **Calculate next release number**
   - If no tags for today exist, use `r1`
   - If `YYYY-MM-DD-r1` exists, use `r2`, etc.

4. **Format version**: `YYYY-MM-DD-r{N}` (e.g., `2026-01-19-r1`)

5. **Get latest release tag** for the compare link
   ```bash
   git tag -l "*-r*" --sort=-version:refname | head -1
   ```

## Gather Changes for PR Description

1. **Get commits between deploy/prod and main**
   ```bash
   git log origin/deploy/prod..origin/main --oneline
   ```

2. **Filter to only include commits with GitHub PR links**
   - Only include commits that contain a PR reference like `(#123)` or `(https://github.com/.../pull/123)`
   - Exclude commits without PR links (these are likely bad merges that should have been squashed)
   - Format each included commit as a bullet point with the PR link

   Example of what to include:
   ```
   - feat: add user dashboard (#142)
   - fix: resolve authentication bug (#138)
   ```

   Example of what to EXCLUDE (no PR link):
   ```
   - fix typo
   - refactor: clean up code
   - Merge branch 'feature-x'
   ```

## Create Pull Request

1. **Create PR from main to deploy/prod**
   - Use the **latest release tag** (from step 5 above) in the compare link, e.g., `https://github.com/{REPO}/compare/{LATEST_TAG}...main`
   - In the "Changes included" section, only list commits that have a GitHub PR link
   ```bash
   gh pr create \
     --base deploy/prod \
     --head main \
     --title "deploy: {VERSION}" \
     --body "$(cat <<'EOF'
   ## Production Release: {VERSION}

   ### Changes included
   {LIST_OF_COMMITS_WITH_PR_LINKS_ONLY}

   ### Compare
   https://github.com/{REPO}/compare/{LATEST_TAG}...main

   ---
   *After merging, a git tag `{VERSION}` will be automatically created.*
   EOF
   )"
   ```

2. **Show the PR URL** to the user

## Important Notes

- The PR title MUST follow the format `deploy: YYYY-MM-DD-r{N}` for the auto-tagging workflow to work
- Do not modify the version format
- The tag will be automatically created by a GitHub Action after the PR is merged
