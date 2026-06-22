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

## External Dependencies

By default, the Verfix Docker runtime includes embedded instances of Redis.
- In **container mode** (Linux default), PostgreSQL is bundled inside the container.
- In **host mode** (macOS/Windows default), SQLite is used instead, embedded in the container filesystem.
