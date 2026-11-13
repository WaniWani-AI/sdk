# @waniwani/cli

## 0.2.1

### Patch Changes

- [#195](https://github.com/WaniWani-AI/sdk/pull/195) [`b18cd1b`](https://github.com/WaniWani-AI/sdk/commit/b18cd1b9cb4ade881365fc3051f5b6cde892964f) Thanks [@reztin](https://github.com/reztin)! - `npx @waniwani/kit init` in an empty folder no longer runs forever. npx links this package's `waniwani` binary, whose `init` fetched the kit through npx again; it now runs the kit installed beside it, and stops with an error if npx ever leads back to it.

## 0.2.0

### Minor Changes

- [#184](https://github.com/WaniWani-AI/sdk/pull/184) [`3efe2f8`](https://github.com/WaniWani-AI/sdk/commit/3efe2f8f4b8a648c161b41cd2dadaeca91c302e6) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - `@waniwani/cli` lives in the WaniWani-AI/sdk repository, under `packages/cli`, and publishes from there. It keeps its commands and its `waniwani.json`, with these changes:
  
  - The login lives in `~/.config/waniwani/settings.json` (or under `XDG_CONFIG_HOME`), one login for every repo. A `.waniwani/settings.json` left in a repo is ignored, because a cloned repo could carry someone else's session in one: run `waniwani login` once, then delete the old file.
  - In a `@waniwani/kit` app, `dev` and the kit's commands (`init`, `check`, `build`, `start`, `eject`) run through the kit the app installed.
  - `connect` writes only `waniwani.json`. It does not delete `waniwani.config.ts`, and no command reads that file for a link: in a kit app it is the app's own config.
  - A repo file chooses only `https://app.waniwani.ai` or `https://eu.app.waniwani.ai`: that covers `apiUrl` in `waniwani.json` and `WANIWANI_API_URL` in `.env` or `.env.local`. For another instance (staging, local), export `WANIWANI_API_URL` in your shell.
  - `cloudflared` is no longer an npm dependency. A `cloudflared` on `PATH` is used; otherwise the first `dev` downloads it into `~/.cache/waniwani/bin/`.
  - `--json` and `-p` are removed. Use `--port <n>`. `login` and `connect` take `--region us|eu`, and `dev` takes `--no-connect`.
