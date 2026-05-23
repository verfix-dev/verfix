# Docker Runtime

Verfix operates entirely within a local-first Docker runtime. All services
(Go API, Next.js Dashboard, Playwright Workers, Redis, PostgreSQL) run inside
a single container image.

---

## Single Container Architecture

The official image `ghcr.io/verfix-dev/verfix-server:latest` bundles:

| Service | Port | Role |
|---------|------|------|
| Go API (Fiber) | `:3001` | Job ingestion, queue dispatch, result serving |
| Next.js Dashboard | `:3000` | Execution timeline observability UI |
| Playwright Workers | — | Browser execution engine (internal) |
| Redis | `:6379` | BullMQ job queue (internal) |
| PostgreSQL 15 | `:5432` | Execution result storage (internal) |

---

## Running the Container

### Recommended — use the CLI

The CLI manages the container lifecycle correctly for your platform:

```bash
npx verfix start
```

This automatically applies the right network mode (see below) and injects all
required environment variables.

### Manual `docker run` (Linux)

On Linux, use `--network=host` so the container can reach your locally running
app (dev server, Ollama, etc.):

```bash
docker run -d \
  --name verfix \
  --network=host \
  -e VERFIX_HOST_NETWORK=1 \
  -e AI_API_KEY=your_key \
  -e AI_MODEL=gpt-4o-mini \
  -v verfix-data:/var/lib/postgresql/15/main \
  -v verfix-artifacts:/app/workers/artifacts \
  ghcr.io/verfix-dev/verfix-server:latest
```

### Manual `docker run` (Mac / Windows)

On Mac/Windows Docker Desktop uses bridge networking. `host.docker.internal`
resolves to the host machine automatically:

```bash
docker run -d \
  --name verfix \
  -p 3001:3001 \
  -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e AI_API_KEY=your_key \
  -e AI_MODEL=gpt-4o-mini \
  -v verfix-data:/var/lib/postgresql/15/main \
  -v verfix-artifacts:/app/workers/artifacts \
  ghcr.io/verfix-dev/verfix-server:latest
```

> **Important:** When running manually on Mac/Windows, URLs in your
> `verfix.config.json` must use `host.docker.internal` instead of `localhost`
> (e.g. `http://host.docker.internal:3002`). The CLI rewrites these
> automatically, but manual API calls do not.

---

## Network Mode — How Localhost Access Works

Verfix needs to reach your app running on the host machine from inside the
container. The strategy differs by platform:

| Platform | Mode | How it works |
|----------|------|-------------|
| Linux (CLI) | `--network=host` | Container shares host network — `localhost` IS the host |
| Mac/Windows (CLI) | Bridge + `host.docker.internal` | Docker Desktop alias → host IP |
| Linux (manual) | Bridge + `/etc/hosts` injection | Gateway IP auto-injected at startup |

For the full technical explanation see
[`docs/4-guides/docker-networking.md`](./docker-networking.md).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_API_KEY` | No | API key for AI-assisted and exploratory modes |
| `AI_MODEL` | No | Model name (default: `gpt-4o-mini`) |
| `AI_BASE_URL` | No | Custom base URL for OpenAI-compatible APIs (e.g. Ollama) |
| `VERFIX_HOST_NETWORK` | Auto | Set to `1` by CLI on Linux; controls URL rewriting |
| `REDIS_HOST` | No | Redis hostname (default: `localhost` — internal) |
| `REDIS_PORT` | No | Redis port (default: `6379`) |
| `MAX_CONCURRENCY` | No | Playwright worker concurrency (default: `3`) |
| `POSTGRES_USER` | No | Postgres user (default: `verfix`) |
| `POSTGRES_PASSWORD` | No | Postgres password (default: `verfix`) |
| `POSTGRES_DB` | No | Postgres database name (default: `verifydb`) |

---

## Volume Mounts

Volumes persist data across container restarts and upgrades:

```bash
-v verfix-data:/var/lib/postgresql/15/main   # Execution history (Postgres)
-v verfix-artifacts:/app/workers/artifacts   # Screenshots, HAR files, traces
```

Without volumes, all execution history is lost when the container stops.

---

## Building Locally

To build the image from source (e.g. after modifying workers or the API):

```bash
git clone https://github.com/verfix-dev/verfix.git
cd verfix

docker build -f Dockerfile.server -t verfix-server:local .
```

Then run with `verfix-server:local` instead of `ghcr.io/verfix-dev/verfix-server:latest`.

---

## Health Check

The API exposes a health endpoint used by the CLI's `verfix start` command:

```bash
curl http://localhost:3001/api/v1/health
# {"status":"healthy","redis":"ok","database":"ok","queue_depth":0,"active_workers":0}
```

The container's built-in Docker `HEALTHCHECK` polls this endpoint every 30s.
