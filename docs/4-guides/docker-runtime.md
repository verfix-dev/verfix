# Docker Runtime

Verfix operates entirely within a local-first Docker runtime.

## Single Container Architecture

The official image `ghcr.io/verfix-dev/verfix-server:latest` bundles:
- Go API
- Next.js Dashboard
- Compiled TypeScript Workers
- PostgreSQL 15
- Redis

## Running the Container

The CLI handles this automatically via `verfix start`, but you can orchestrate it manually:

```bash
docker run -d   --name verfix   -p 3001:3001   -p 3000:3000   -e AI_API_KEY=your_key   verfix-server:latest
```

## Volume Mounts (Optional for Persistence)

If you wish to persist execution history across container restarts:
```bash
  -v verfix_pgdata:/var/lib/postgresql/15/main   -v verfix_artifacts:/app/workers/artifacts ```
