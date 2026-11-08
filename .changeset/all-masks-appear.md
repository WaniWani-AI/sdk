---
"@waniwani/kit": major
---

First stable release. The kit follows semver from 1.0.0, so a breaking change to the `waniwani` CLI or to the runtime API ships only in a major release.

Changes since 0.8.0:

- The `@waniwani/sdk` peer range is `>=0.25.0` (it was `>=0.24.0`), and SDK 1.x is inside it. An app on SDK 0.24.x upgrades the SDK first, with the `migrate-waniwani-sdk-0.24-to-0.25` skill: `npx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-0.24-to-0.25`.
- A Vercel build passes when a dependency imports an optional peer that the app does not install. posthog-node 5.56.1 and later import `@opentelemetry/api` this way, and every kit app without it failed to build.
- The kit publishes from the WaniWani-AI/sdk repository, under `packages/kit`.

An app already on `@waniwani/sdk` 0.25.0 or later upgrades with no code change.
