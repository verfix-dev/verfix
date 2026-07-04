# Docker Runtime (server mode — opt-in)

> **⚠️ Opt-in.** The default Verfix experience needs **no Docker**: `verfix run`
> drives the browser in-process and stores results under `.verfix/runs/`. The
> Docker runtime below is the opt-in **server mode** (`--server` /
> `VERFIX_RUNNER=server`), kept for the future hosted CI product. It is
> container-only — the hybrid host-worker mode has been removed.

Verfix's server mode runs all services inside Docker.

---

## Browser Execution Modes

Verfix has two docker runtime variants, selected automatically by platform:

| Mode | Default Platform | Docker Image | Workers | Database | Ports |
|------|-----------------|---------------|---------|----------|-------|
| **Container** | Linux | `verfix-server:latest` | Inside Docker (`--network=host`) | PostgreSQL | 3610/3611 |
| **Host** | macOS/Windows | `verfix-server-slim:latest` | On the host machine | SQLite | 3610/3611 |

The mode can be overridden with the `VERFIX_BROWSER_MODE` environment variable
(`host` or `container`).

---

## Container Mode — Single Full Image (Linux)

The official image `ghcr.io/verfix-dev/verfix-server:latest` bundles:

| Service | Port | Role |
|---------|------|------|
| Go API (Fiber) | `:3001` (ext) / `:3611` (host) | Job ingestion, queue dispatch, result serving |
| Next.js Dashboard | `:3000` (ext) / `:3610` (host) | Execution timeline observability UI |
| Playwright Workers | — | Browser execution engine (internal) |
| Redis | `:6379` (internal) | BullMQ job queue |
| PostgreSQL 15 | `:5432` (internal) | Execution result storage |

On Linux, the CLI starts the container with `--network=host` so workers can
reach `localhost` on the host directly.

---

## Host Mode — Slim Image + Local Workers (macOS/Windows)

The slim server image `ghcr.io/verfix-dev/verfix-server-slim:latest` was
introduced in v0.2.8 specifically for host browser mode. It replaces
Playwright and PostgreSQL with SQLite to reduce size and resource usage.

| Service | Port | Role |
|---------|------|------|
| Go API (Fiber) | `:3611` | Job ingestion, queue dispatch, result serving |
| Next.js Dashboard | `:3610` | Execution timeline observability UI |
| Redis | `:6379` | BullMQ job queue (bridge mode) |
| SQLite | `~/.verfix/data` | Execution result storage (embedded) |

The CLI starts the slim container with:
- `--network=bridge` + `--add-host=host.docker.internal:host-gateway`
- `SKIP_WORKERS=1` so the container skips its own browser workers.
- Redis port mapped to `127.0.0.1:6379` (skipped if host Redis is detected).

On the host machine, the CLI then:
1. Extracts compiled worker JS and node_modules from the slim image into
   `~/.verfix/worker/`.
2. Runs `npx playwright install chromium` to ensure Chromium is available on
   the host.
3. Spawns a local Node.js worker that connects to container Redis and uses
   native `localhost` access for browser execution.

---

## Running the Container

### Recommended — use the CLI

The CLI manages the container lifecycle correctly for your platform and mode:

```bash
npx verfix start
```

### Manual `docker run` (Container mode — Linux)

```bash
docker run -d \
  --name verfix \
  --network=host \
  -e VERFIX_BROWSER_MODE=container \
  -e VERFIX_HOST_NETWORK=1 \
  -e AI_API_KEY=your_key \
  -v verfix-data:/var/lib/postgresql/15/main \
  -v verfix-artifacts:/app/workers/artifacts \
  ghcr.io/verfix-dev/verfix-server:latest
```

### Manual `docker run` (Host mode — Mac/Windows)

```bash
docker run -d \
  --name verfix \
  --network=bridge \
  --add-host=host.docker.internal:host-gateway \
  -p 127.0.0.1:6379:6379 \
  -p 3611:3611 \
  -p 3610:3610 \
  -v ~/.verfix/artifacts:/app/workers/artifacts \
  -v verfix-slim-data:/app/data \
  -e SKIP_WORKERS=1 \
  -e VERFIX_BROWSER_MODE=host \
  ghcr.io/verfix-dev/verfix-server-slim:latest
```

Check the complete host-mode guide in [`docs/4-guides/docker-networking.md`](./docker-networking.md).

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

| Variable | Mode | Description |
|----------|------|-------------|
| `VERFIX_BROWSER_MODE` | Both | `host` or `container` — selects browser execution mode |
| `VERFIX_HOST_NETWORK` | Container | `1` on Linux (host network), `0` otherwise (bridge) |
| `SKIP_WORKERS` | Host | `1` tells container to skip starting workers |
| `VERFIX_WORKER_MODE` | Host | `local` for host-side worker processes |
| `REDIS_HOST` | Host | Redis hostname (default: `localhost`) |
| `REDIS_PORT` | Host | Redis port (default: `6379`) |
| `ARTIFACTS_DIR` | Host | Shared artifacts directory path |
| `AI_API_KEY` | Both | API key for AI-assisted and exploratory modes |
| `AI_MODEL` | Both | Model name (default: `gpt-4o-mini`) |
| `AI_BASE_URL` | Both | Custom base URL for OpenAI-compatible APIs (e.g. Ollama) |

---

## Volume Mounts

### Container mode

```bash
-v verfix-data:/var/lib/postgresql/15/main   # Execution history (Postgres)
-v verfix-artifacts:/app/workers/artifacts   # Screenshots, HAR files, traces
```

### Host mode

```bash
-v ~/.verfix/artifacts:/app/workers/artifacts  # Shared artifacts (bind mount)
-v verfix-slim-data:/app/data                  # SQLite database in container
```

---

## Building Locally

To build the full image from source:

```bash
git clone https://github.com/verfix-dev/verfix.git
cd verfix

docker build -f Dockerfile.server -t verfix-server:local .
```

Then run with `verfix-server:local` instead of `ghcr.io/verfix-dev/verfix-server:latest`.

To build the slim image (SQLite, no browser) for host mode development:

```bash
docker build -f Dockerfile.server-slim -t verfix-server-slim:local .
```

Then run with `verfix-server-slim:local`.

---

## Health Check

The API exposes a health endpoint used by the CLI's `verfix start` command:

```bash
curl http://localhost:3611/api/v1/health
# {"status":"healthy","redis":"ok","database":"ok","queue_depth":0,"active_workers":0}
```

The container's built-in Docker `HEALTHCHECK` polls this endpoint every 30s.
