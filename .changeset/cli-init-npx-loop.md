---
"@waniwani/cli": patch
---

`npx @waniwani/kit init` in an empty folder no longer runs forever. npx links this package's `waniwani` binary, whose `init` fetched the kit through npx again; it now runs the kit installed beside it, and stops with an error if npx ever leads back to it.
