---
"@waniwani/kit": minor
---

The kit's `waniwani` CLI answers the platform commands of `@waniwani/cli`, which it now depends on: `login`, `logout`, `switch [org]` and `connect`. In a kit app whose `waniwani.json` names an agent, `waniwani dev` also opens the agent's tunnel on the dev server's port, registers a dev session and opens the hosted playground. `--no-connect` turns that off, `--connect` links an app that has no `waniwani.json` yet, and `--port <n>` and `--region us|eu` are new.

An app needs no change. An app that has `@waniwani/cli` in its own dependencies can keep it or drop it: both packages install a `waniwani` binary, and both answer every command the same way.
