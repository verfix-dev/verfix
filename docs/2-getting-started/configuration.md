# Configuration

Verfix configuration is managed via environment variables within the `.verfix/.env` file generated during initialization.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_API_KEY` | `""` | Your LLM provider API key (e.g., OpenAI). Required for Assisted/Exploratory modes. |
| `AI_MODEL` | `gpt-4o-mini` | The model used for semantic reasoning. |
| `MAX_CONCURRENCY` | `3` | Maximum number of concurrent Playwright browsers. |
| `API_PORT` | `3001` | Port for the Go API. |
| `DASHBOARD_PORT` | `3000` | Port for the Next.js UI. |

## External Dependencies
By default, the Verfix Docker runtime includes embedded instances of PostgreSQL and Redis. If you prefer to use external instances, override these variables:
- `DATABASE_URL`
- `REDIS_HOST`
- `REDIS_PORT`
