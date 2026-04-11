# Internal Engineering Docs

> **This folder is for WaniWani team members.** Public product documentation lives at the root of `docs/` and is rendered by [Mintlify](https://mintlify.com) at our public docs site. Nothing in here is shipped to users.

These documents capture design decisions, migration plans, manual verification procedures, and contracts that are only relevant to people working on the SDK itself.

## Contents

- [`architecture-chat-agent.md`](./architecture-chat-agent.md) — BFF proxy pattern for the chat widget and WaniWani platform agent architecture.
- [`events-api-v2-contract.md`](./events-api-v2-contract.md) — Events API V2 request/response contract.
- [`events-table-v2-schema.md`](./events-table-v2-schema.md) — V2 events table schema proposal.
- [`migration-v2-release-plan.md`](./migration-v2-release-plan.md) — Migration and release plan for the V2 tracking rollout.
- [`playground-v2-manual-verification.md`](./playground-v2-manual-verification.md) — Manual verification checklist for the V2 playground.
- [`waniwani-app-widget-tokens-plan.md`](./waniwani-app-widget-tokens-plan.md) — Widget token plan for the WaniWani app.

## Contributing

- Put **user-facing** documentation in `docs/` (Mintlify MDX).
- Put **team-facing** engineering notes here.
- When in doubt, ask in `#sdk`.
