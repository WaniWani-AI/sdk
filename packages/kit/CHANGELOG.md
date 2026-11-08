# @waniwani/kit

## 1.0.0

### Major Changes

- [`4672a13`](https://github.com/WaniWani-AI/sdk/commit/4672a132a865493e4a4d7aa1103f0dbbb02ca056) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - First stable release. The kit follows semver from 1.0.0, so a breaking change to the `waniwani` CLI or to the runtime API ships only in a major release.
  
  Changes since 0.8.0:
  
  - The `@waniwani/sdk` peer range is `>=0.25.0` (it was `>=0.24.0`), and SDK 1.x is inside it. An app on SDK 0.24.x upgrades the SDK first, with the `migrate-waniwani-sdk-0.24-to-0.25` skill: `npx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-0.24-to-0.25`.
  - A Vercel build passes when a dependency imports an optional peer that the app does not install. posthog-node 5.56.1 and later import `@opentelemetry/api` this way, and every kit app without it failed to build.
  - The kit publishes from the WaniWani-AI/sdk repository, under `packages/kit`.
  
  An app already on `@waniwani/sdk` 0.25.0 or later upgrades with no code change.

### Minor Changes

- [#184](https://github.com/WaniWani-AI/sdk/pull/184) [`3efe2f8`](https://github.com/WaniWani-AI/sdk/commit/3efe2f8f4b8a648c161b41cd2dadaeca91c302e6) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - The kit's `waniwani` CLI answers the platform commands of `@waniwani/cli`, which it now depends on: `login`, `logout`, `switch [org]` and `connect`. In a kit app whose `waniwani.json` names an agent, `waniwani dev` also opens the agent's tunnel on the dev server's port, registers a dev session and opens the hosted playground. `--no-connect` turns that off, `--connect` links an app that has no `waniwani.json` yet, and `--port <n>` and `--region us|eu` are new.
  
  An app needs no change. An app that has `@waniwani/cli` in its own dependencies can keep it or drop it: both packages install a `waniwani` binary, and both answer every command the same way.

### Patch Changes

- Updated dependencies [[`3efe2f8`](https://github.com/WaniWani-AI/sdk/commit/3efe2f8f4b8a648c161b41cd2dadaeca91c302e6)]:
  - @waniwani/cli@0.2.0
