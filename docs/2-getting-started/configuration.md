# Configuration

Verfix configuration is managed via environment variables within the `.verfix/.env` file generated during initialization.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` / provider key (e.g. `OPENAI_API_KEY`) | `""` | Your LLM provider + API key. Required only for Assisted/Exploratory modes — strict mode needs no key. |
| `AI_MODEL` | provider default | The model used for semantic reasoning. |
| `VERFIX_RUNNER` | `local` | `local` (in-process engine, no Docker) or `server` (Docker runtime). The `--server` CLI flag sets this per-invocation. |
| `MAX_CONCURRENCY` | `3` | Maximum number of concurrent Playwright browsers (server mode). |
| `API_PORT` | `3611` | Port for the Go API (server mode). |
| `DASHBOARD_PORT` | `3610` | Port for the Next.js UI (server mode). |

## `verfix.config.json` options (selected)

Beyond flows, a few config fields shape how targets are resolved and how source
edits are governed:

| Field | Default | Description |
|---|---|---|
| `selectors` | `{}` | Alias map of logical name → real selector. Steps referencing an alias are resolved at run time, so you can retarget elements without editing project source. |
| `sourceCodePolicy` | `warn` | What happens when project source is edited during a verify loop: `warn` (report only), `block` (fail with `source_edit_blocked`), or `off`. See [Config-First Verification](../4-guides/config-first-verification.md). |
| `browser` | `{}` | Local-mode browser options: `{ "channel": "chrome" }` reuses your installed Chrome (skips the Chromium download); `{ "headless": false }` shows the browser window. |

## External Dependencies

Local mode (the default) has none — results are plain files under
`.verfix/runs/`. The opt-in server runtime (`--server`) bundles Redis and
PostgreSQL inside its Docker container.
