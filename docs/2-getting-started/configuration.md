# Configuration

Verfix configuration is managed via environment variables within the `.verfix/.env` file generated during initialization.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_API_KEY` | `""` | Your LLM provider API key (e.g., OpenAI). Required for Assisted/Exploratory modes. |
| `AI_MODEL` | `gpt-4o-mini` | The model used for semantic reasoning. |
| `VERFIX_BROWSER_MODE` | auto (OS-detected) | `host` (workers on host machine) or `container` (workers inside Docker). |
| `MAX_CONCURRENCY` | `3` | Maximum number of concurrent Playwright browsers. |
| `API_PORT` | `3611` | Port for the Go API. |
| `DASHBOARD_PORT` | `3610` | Port for the Next.js UI. |

## `verfix.config.json` options (selected)

Beyond flows, a few config fields shape how targets are resolved and how source
edits are governed:

| Field | Default | Description |
|---|---|---|
| `selectors` | `{}` | Alias map of logical name → real selector. Steps referencing an alias are resolved at run time, so you can retarget elements without editing project source. |
| `sourceCodePolicy` | `warn` | What happens when project source is edited during a verify loop: `warn` (report only), `block` (fail with `source_edit_blocked`), or `off`. See [Config-First Verification](../4-guides/config-first-verification.md). |

## External Dependencies

By default, the Verfix Docker runtime includes embedded instances of Redis.
- In **container mode** (Linux default), PostgreSQL is bundled inside the container.
- In **host mode** (macOS/Windows default), SQLite is used instead, embedded in the container filesystem.
