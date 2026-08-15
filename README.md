# dsh-codex-oauth

[English](README.md) | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **bundle
plugin** that keeps the harness credential `CODEX_OAUTH_TOKEN` fresh from your
local **OpenAI Codex CLI** session (`~/.codex/auth.json`), so the `llm-pi-ai`
`openai-codex` route can authenticate with the rotating ChatGPT OAuth access
token. The Codex CLI refreshes that token itself; this plugin only watches the
file and mirrors the current token into the managed credentials document, then
warns loudly when the session is missing, malformed, or about to expire.

## Requirements — log in with the Codex CLI first

The plugin has **no token of its own**: it mirrors whatever the local Codex CLI
session holds, so the CLI must be installed and logged in.

1. **Install the Codex CLI** (any official channel works):

   ```sh
   npm install -g @openai/codex
   # or the official installer: https://developers.openai.com/codex/cli
   ```

2. **Log in with your ChatGPT account** — the OAuth device flow opens a
   browser and authorizes the CLI:

   ```sh
   codex login
   ```

   On success the CLI writes `~/.codex/auth.json` (containing
   `tokens.access_token`, its JWT `exp`, and `last_refresh`). The plugin
   watches that file, so **no token needs to be copied anywhere** — a
   `codex login` refresh is picked up automatically.

3. **A ChatGPT Plus or Pro subscription is required.** The token is a
   subscription-scope OAuth credential for the ChatGPT `backend-api`; the free
   tier and API-key-only accounts do not carry the Codex quota this route
   consumes.

4. **No OpenAI API key is involved.** The route talks to
   `https://chatgpt.com/backend-api` (the `openai-codex-responses` protocol),
   not `api.openai.com`; an API key with `api.responses.write` is neither
   needed nor used.

5. **Account and region caveats.** The credential is bound to the ChatGPT
   account and to OpenAI's terms for automated use: expect subscription rate
   limits, and know that unsupported regions fail at the backend with a
   permission error, not with a local diagnostic.

6. **Token lifecycle.** The CLI auto-refreshes the session roughly every 8
   days; the plugin follows each rotation within its watch debounce. If the
   token ever expires anyway, the plugin logs an error naming the repair —
   re-run `codex login`.

Verify the session exists (never print its contents):

```sh
test -f ~/.codex/auth.json && echo "Codex OAuth session present"
```

## Install

The package is a **bundle** (official DSH plugin packaging): it declares
`dsh.bundle` and ships its own `cordis.patch.yml`, so installing it into a
profile activates the plugin row automatically. `lib/` is committed, so a git
install works **without any build permission**.

### From GitHub (recommended)

```sh
dsh plugin --profile web add github:knight-arturia/dsh-codex-oauth
```

Pin a commit for supply-chain safety:

```sh
dsh plugin --profile web add github:knight-arturia/dsh-codex-oauth#<commit-sha>
```

### From a local checkout

```sh
git clone https://github.com/knight-arturia/dsh-codex-oauth
dsh plugin --profile web add ./dsh-codex-oauth
```

### From a tarball

```sh
cd dsh-codex-oauth && npm pack   # produces dsh-codex-oauth-0.1.0.tgz
dsh plugin --profile web add ./dsh-codex-oauth-0.1.0.tgz
```

### From npm (once published)

```sh
dsh plugin --profile web add @deepseek-ai/dsh-codex-oauth
```

### Then configure the route (required in every mode)

In `$DSH_HOME/settings.yaml`, give `llm-pi-ai` the route — a bundle patch
cannot touch `settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: CODEX_OAUTH_TOKEN
```

Verify the layer without booting:

```sh
dsh --profile web --dump-config   # should show a "# == dsh-codex-oauth" layer
```

The route keeps pi-ai's catalog endpoint (`https://chatgpt.com/backend-api`,
`openai-codex-responses` protocol) and models (e.g. `gpt-5.6-luna`). No
`baseURL` is needed. Then pick `openai-codex` / `gpt-5.6-luna` in the GUI's
Models page and start a session.

## Why a mirror, not a provider

The credentials seam (`ctx.credentials`) is a single-registration service, so
a second provider cannot mount beside `dsh-credentials-local` without
replacing it. Mirroring into the managed document keeps the shipped local
provider (env > `.credentials.yaml` > `.env` precedence, hot reload, atomic
0600 writes) intact while the consuming adapter keeps its documented
**per-request resolve**: `llm-pi-ai` re-resolves `apiKeyEnv` once per stream
call, so a rotated token reaches the next request without a restart.

## Config

The plugin exports a Schemastery schema; defaults live on the schema fields.

| Key | Default | Meaning |
|---|---|---|
| `authFile` | `$CODEX_AUTH_FILE` or `~/.codex/auth.json` | Codex CLI auth document. |
| `watch` | `true` | Watch the auth file for Codex-side refresh. |
| `debounceMs` | `100` | Watcher write-settle window. |
| `warnSkewMinutes` | `30` | Warn when the token has fewer than this many minutes until JWT `exp`. |

## Behavior

- On load and on every auth-file change: parse `tokens.access_token`, decode
  the JWT `exp`, and push the token into the managed credentials document as
  `CODEX_OAUTH_TOKEN` (only when the value changed).
- Expired or missing token: logs an error/warning naming the `codex login`
  repair and removes the stored reference; the route then fails with
  `MISSING_CREDENTIAL` instead of sending a dead token.
- The environment still wins: if `CODEX_OAUTH_TOKEN` is set in the launching
  environment, resolution returns it and the mirror's `set` is refused by the
  seam (shadowed) — the plugin logs the refusal and leaves the env value in
  force.

## Limitations

- **No refresh is performed by this plugin** — it never writes
  `~/.codex/auth.json` (that file is owned by the Codex CLI). When the token
  expires and the CLI has not refreshed it, re-run `codex login`.
- **Plan scope**: the token is a ChatGPT-subscription OAuth credential; usage
  against the Codex backend is subject to the subscription's rate limits and
  to OpenAI's terms for automated use.
- The token is mirrored into `$DSH_HOME/.credentials.yaml` (0600), which the
  harness's own tool processes can read like any other file the user owns.

## Development

```sh
npm install
npm run build   # tsc → lib/types + flat ESM entries in lib/
```

## License

[MIT](LICENSE)
