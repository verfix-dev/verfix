# Verfix Server Image — Operational Guide

> **Image:** `ghcr.io/verfix-dev/verfix-server:latest`  
> **What's inside:** Go API · Next.js Dashboard · TypeScript Workers · Redis · PostgreSQL 15

---

## What's In The Box

The image bundles all runtime services so a developer needs only Docker.

| Service | Technology | Port |
|---|---|---|
| **API** | Go + Fiber (static binary) | `3001` |
| **Dashboard** | Next.js 16 standalone | `3000` |
| **Workers** | Node 20 + Playwright Chromium | _(internal)_ |
| **Redis** | redis-server (in-process) | _(internal)_ |
| **PostgreSQL** | PostgreSQL 15 | _(internal)_ |

Redis and Postgres are **internal** — not exposed by default. Expose `5432`/`6379` only when debugging.

---

## First Push to GHCR

### Step 1 — No signup needed

GHCR is part of GitHub. `github.com/orgs/verfix-dev` already has it. `GITHUB_TOKEN` (automatic in every repo) has `packages: write` — no PAT needed.

### Step 2 — Push to `main`

```bash
git add Dockerfile.server scripts/server-start.sh .github/workflows/publish-server.yml .dockerignore
git commit -m "chore: add production server image"
git push origin main
```

The GitHub Action triggers automatically. Watch it at:
`github.com/verfix-dev/verfix/actions`

### Step 3 — Make the image public (one-time)

After the first successful push:
1. `github.com/orgs/verfix-dev/packages`
2. Click **verfix-server** → **Package settings** → **Change visibility** → **Public**

```bash
docker pull ghcr.io/verfix-dev/verfix-server:latest
```

---

## Running the Image

### Quick start

```bash
docker run -d \
  --name verfix \
  -p 3001:3001 \
  -p 3000:3000 \
  -e AI_API_KEY=mykey \
  -e AI_MODEL=gpt-5.4-mini \
  ghcr.io/verfix-dev/verfix-server:latest

# Tail logs
docker logs -f verfix

# Check health
curl http://localhost:3001/api/v1/health
```

### With docker-compose (recommended)

```yaml
# docker-compose.server.yml
services:
  verfix-server:
    image: ghcr.io/verfix-dev/verfix-server:latest
    ports:
      - "3001:3001"
      - "3000:3000"
    volumes:
      - pgdata:/var/lib/postgresql/15/main
      - artifacts:/app/workers/artifacts
    environment:
      POSTGRES_PASSWORD: "change-me-in-prod"
      AI_API_KEY: "${OPENAI_API_KEY}"
      AI_MODEL: gpt-4o-mini
      MAX_CONCURRENCY: "3"
    restart: unless-stopped

volumes:
  pgdata:
  artifacts:
```

```bash
docker compose -f docker-compose.server.yml up -d
```

---

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_USER` | `verfix` | DB username |
| `POSTGRES_PASSWORD` | `verfix` | **Change in production** |
| `POSTGRES_DB` | `verifydb` | Database name |
| `DATABASE_URL` | _(auto-built)_ | Override to use an external Postgres |
| `REDIS_HOST` | `localhost` | Override to use an external Redis |
| `REDIS_PORT` | `6379` | — |
| `API_PORT` | `3611` | Go API listen port |
| `DASHBOARD_PORT` | `3610` | Next.js listen port |
| `MAX_CONCURRENCY` | `3` | Parallel Playwright browser instances |
| `AI_API_KEY` | _(unset)_ | OpenAI-compatible API key (optional) |
| `AI_MODEL` | _(unset)_ | e.g. `gpt-4o-mini`, `llama3` |
| `AI_BASE_URL` | _(unset)_ | For Ollama: `http://host:11434/v1` |

> [!IMPORTANT]
> `POSTGRES_PASSWORD` defaults to `verfix` for convenience. Always override when the container is reachable from outside localhost.

---

## Upgrade Workflow

### Any code change → push to main

```bash
git add -A && git commit -m "feat: ..."
git push origin main
# CI rebuilds → pushes :latest + :main automatically
```

### Pull the updated image

```bash
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d
# Container is recreated; volumes survive — no data loss
```

### Versioned releases

Create a GitHub Release tagged `v1.2.0`. The action pushes:
`:1.2.0` · `:1.2` · `:1` · `:latest`

Teams can pin:
```yaml
image: ghcr.io/verfix-dev/verfix-server:1.2.0
```

---

## Volume Management

| Volume | Container path | Contains |
|---|---|---|
| `pgdata` | `/var/lib/postgresql/15/main` | All execution history |
| `artifacts` | `/app/workers/artifacts` | Screenshots, HAR, Playwright traces |

> [!WARNING]
> Never delete `pgdata` unless you want to wipe all execution history. The `artifacts` volume can be cleared freely — Redis results expire after 24h anyway.

### Backup Postgres

```bash
docker exec verfix su -s /bin/sh postgres -c \
  "pg_dump verifydb" > verifydb_$(date +%Y%m%d).sql
```

### Restore

```bash
cat verifydb_YYYYMMDD.sql | docker exec -i verfix \
  su -s /bin/sh postgres -c "psql verifydb"
```

---

## Build Stages Explained

```
Stage 1: api-builder (golang:1.22-alpine)
  → CGO_ENABLED=0, -ldflags="-s -w", -trimpath
  → Static binary ~8MB, zero runtime libc dependency

Stage 2: dashboard-builder (node:20-alpine)
  → Patches next.config.ts to add output:'standalone' (single-line JS, safe from Docker parser)
  → next build emits .next/standalone/server.js — no npm start at runtime
  → NEXT_TELEMETRY_DISABLED=1

Stage 3: workers-builder (node:20-alpine)
  → Patches tsconfig.json: outDir='./dist', rootDir='.'
  → npx tsc --skipLibCheck
  → src/index.ts → dist/src/index.js  ← verified path
  → Only compiled JS ships; ts-node NOT in final image

Stage 4: final (node:20-slim = Debian bookworm-slim)
  → postgresql-15 from Debian default repos (bookworm has pg15, no PGDG repo needed)
  → redis-server, tini, curl from Debian default repos
  → Playwright Chromium + OS deps via: npx playwright install chromium --with-deps
  → Postgres cluster initialised at image build time (fast container start)
  → tini as PID 1 for correct signal handling
```

> [!TIP]
> The Playwright Chromium layer takes 3–5 min and downloads ~300MB **on the first build only**. After that, `cache-from: type=gha` in the workflow keeps it cached. Subsequent builds that only touch Go or Next.js finish in ~2 min.

---

## Container Startup Sequence

`server-start.sh` starts services in this order:

1. **PostgreSQL** — starts the pre-initialised cluster (re-initialises if volume is empty/new).
2. **Redis** — daemonised, no persistence (`--save ""`), memory-only job queue.
3. **Go API** — waits for `/api/v1/health` to respond on `:3001` before proceeding.
4. **Workers** — `node dist/src/index.js` from `/app/workers` (BullMQ + Playwright pool).
5. **Dashboard** — `node /app/dashboard/server.js` (Next.js standalone), port `3000`.
6. **Monitor loop** — checks API + Workers PIDs every 5s; kills container if either dies.

---

## Ports Reference

| Port | Service | Expose? |
|---|---|---|
| `3001` | Go API | ✅ Yes — CLI + SDK connect here |
| `3000` | Dashboard | ✅ Yes — browser UI |
| `6379` | Redis | ⛔ Internal only |
| `5432` | PostgreSQL | ⛔ Internal only |

---

## Known Gotchas

| | Details |
|---|---|
| **API is on :3611** | `api/ports.ts` → `DEFAULT_API_PORT = 3611`. CLI (`cli/src/runtime.ts`) correctly defaults to `localhost:3611`. |
| **Workers entry is `dist/src/index.js`** | With `rootDir='.'` and `outDir='./dist'`, tsc maps `src/index.ts` → `dist/src/index.js`. Confirmed by local tsc run. |
| **Artifact path is shared** | API serves `/artifacts/*` from `../workers/artifacts` (relative to `/app/api/`). The startup script sets `cd /app/api` before launching the binary. |
| **Chromium is always headless** | `workers/src/index.ts` uses the browser pool which runs headless. The `headless: false` in the old root `workers/index.ts` only applies to local dev. |
| **Redis is non-persistent** | `--save ""` means no AOF/RDB files. Job queue is ephemeral. Durable state lives in Postgres (via `syncExecutionFromRedis`). |
| **ts-node is not in the image** | Workers are compiled at image-build time. If you add a new `.ts` file, rebuild the image. |
| **`node -e` must be single-line** | Docker's parser reads each new line as a potential instruction. Multiline `node -e "..."` blocks will cause `ERROR: unknown instruction: const`. Both JS patches in the Dockerfile are single-line for this reason. |

---

## Troubleshooting

### Container exits immediately
```bash
docker logs verfix
```
Look for the ❌ line — usually Postgres or Redis failed.

### `"database":"down"` in health response
```bash
docker exec verfix su -s /bin/sh postgres -c "pg_isready"
```
If unhealthy, check if the pgdata volume is mounted correctly.

### Workers not draining the queue
```bash
docker exec verfix redis-cli llen verify_jobs
# If growing without draining, worker process died
docker restart verfix
```

### Dashboard blank / 500
The `output:'standalone'` patch didn't apply to `next.config.ts`. Fix: manually add it and commit:
```ts
const nextConfig: NextConfig = {
  output: 'standalone',  // add this
  productionBrowserSourceMaps: false,
};
```

### Playwright `Executable doesn't exist`
Playwright version in `workers/package.json` changed since the image was built. Rebuild:
```bash
git commit --allow-empty -m "chore: trigger image rebuild"
git push
```

### First build hangs for 5+ minutes
Normal — that's the Playwright Chromium download (~300MB). After this layer is cached in GitHub Actions, subsequent builds skip it entirely.

## Local Testing

### Build
```bash
# Full build (first time: ~5min for Playwright download)
docker build -f Dockerfile.server -t verfix-server:local .

# Rebuild after code changes (fast — all layers cached except changed ones)
docker build -f Dockerfile.server -t verfix-server:local .

# Test only the workers TypeScript compile (fastest feedback loop, ~30s)
docker build -f Dockerfile.server --target workers-builder -t test-workers .
```

---

### Run — `docker run` (quick one-liner)
```bash
docker run -d \
  --name verfix \
  -p 3001:3001 \
  -p 3000:3000 \
  -e AI_API_KEY=mykey \
  -e AI_MODEL=gpt-5.4-mini \
  verfix-server:local

# Tail logs
docker logs -f verfix

# Verify health
curl http://localhost:3001/api/v1/health
```

---

### Run — docker-compose (recommended, saves retyping)
```bash
# Start (uses docker-compose.local.yml created earlier)
docker compose -f docker-compose.local.yml up -d

# Tail logs
docker compose -f docker-compose.local.yml logs -f

# Stop (keeps volumes/data)
docker compose -f docker-compose.local.yml down

# Stop AND wipe all data (fresh start)
docker compose -f docker-compose.local.yml down -v
```

---

### Cleanup
```bash
# Remove container
docker rm -f verfix

# Remove image
docker rmi verfix-server:local

# Remove leftover test images from failed stages
docker rmi test-workers verfix-workers-check 2>/dev/null || true
```

---

### Test Execution
```bash
# Restart container with environment variables
docker rm -f verfix
docker run -d \
  --name verfix \
  -p 3001:3001 \
  -p 3000:3000 \
  -e AI_API_KEY=mykey \
  -e AI_MODEL=gpt-5.4-mini \
  verfix-server:local

# Wait for services to start, then submit a test job
sleep 20
curl -s -X POST http://localhost:3001/api/v1/verify \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","task":"check page opens","assertions":[{"type":"url_contains","value":"example"}]}' | python3 -m json.tool
```
