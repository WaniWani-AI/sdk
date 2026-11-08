---
"@waniwani/cli": minor
---

`@waniwani/cli` lives in the WaniWani-AI/sdk repository, under `packages/cli`, and publishes from there. It keeps its commands and its `waniwani.json`, with these changes:

- Your login moves to `~/.config/waniwani/settings.json` (or under `XDG_CONFIG_HOME`), one login for every repo. A `.waniwani/settings.json` in a repo is moved there the first time a command reads it, so nobody has to log in again.
- In a `@waniwani/kit` app, `dev` and the kit's commands (`init`, `check`, `build`, `start`, `eject`) run through the kit the app installed.
- `connect` writes only `waniwani.json`. It does not delete `waniwani.config.ts`, and no command reads that file for a link: in a kit app it is the app's own config.
- A repo file chooses only `https://app.waniwani.ai` or `https://eu.app.waniwani.ai`: that covers `apiUrl` in `waniwani.json` and `WANIWANI_API_URL` in `.env` or `.env.local`. For another instance (staging, local), export `WANIWANI_API_URL` in your shell.
- `cloudflared` is no longer an npm dependency. A `cloudflared` on `PATH` is used; otherwise the first `dev` downloads it into `~/.cache/waniwani/bin/`.
- `--json` and `-p` are removed. Use `--port <n>`. `login` and `connect` take `--region us|eu`, and `dev` takes `--no-connect`.
