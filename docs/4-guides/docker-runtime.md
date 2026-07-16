# Docker Runtime (server mode — opt-in)

> **⚠️ Opt-in.** The default Verfix experience needs **no Docker**: `verfix run`
> drives the browser in-process and stores results under `.verfix/runs/`. The
> Docker runtime below is the opt-in **server mode** (`--server` /
> `VERFIX_RUNNER=server`), kept for the future hosted CI product. It is
> container-only — the old hybrid mode, where Playwright workers ran natively
> on the host machine instead of inside the container, has been removed.

Verfix's server mode runs all services inside a single Docker image.

---

## Network Modes

The container's browser workers always run inside Docker; only the network
strategy used to reach `localhost` on your machine varies by platform:

| Platform | Network Mode | How it works |
|----------|--------------|---------------|
| Linux | `--network=host` | Container shares host network — `localhost` IS the host |
| macOS/Windows | Bridge + `host.docker.internal` | Docker Desktop alias → host IP, worker rewrites the URL |

---

## The Image

The official image `ghcr.io/verfix-dev/verfix-server:latest` bundles:

| Service | Port | Role |
|---------|------|------|
| Go API (Fiber) | `:3001` (ext) / `:3611` (host) | Job ingestion, queue dispatch, result serving |
| Next.js Dashboard | `:3000` (ext) / `:3610` (host) | Execution timeline observability UI |
| Playwright Workers | — | Browser execution engine (internal) |
| Redis | `:6379` (internal) | BullMQ job queue |
| PostgreSQL 15 | `:5432` (internal) | Execution result storage |

On Linux, the CLI starts the container with `--network=host` so workers can
reach `localhost` on the host directly. On macOS/Windows, the CLI starts the
same image in bridge mode with `--add-host=host.docker.internal:host-gateway`,
and the worker rewrites `localhost` URLs to `host.docker.internal`.

---

## Running the Container

### Recommended — use the CLI

The CLI manages the container lifecycle correctly for your platform:

```bash
npx verfix start
```

### Manual `docker run` (Linux)

```bash
docker run -d \
  --name verfix \
  --network=host \
  -e VERFIX_HOST_NETWORK=1 \
  -e AI_API_KEY=your_key \
  -v verfix-data:/var/lib/postgresql/15/main \
  -v verfix-artifacts:/app/workers/artifacts \
  ghcr.io/verfix-dev/verfix-server:latest
```

### Manual `docker run` (macOS/Windows)

```bash
docker run -d \
  --name verfix \
  --network=bridge \
  --add-host=host.docker.internal:host-gateway \
  -e VERFIX_HOST_NETWORK=0 \
  -p 3611:3611 \
  -p 3610:3610 \
  -v verfix-data:/var/lib/postgresql/15/main \
  -v verfix-artifacts:/app/workers/artifacts \
  ghcr.io/verfix-dev/verfix-server:latest
```

Check the complete networking guide in [`docs/4-guides/docker-networking.md`](./docker-networking.md).

---

## Environment Variables

| Variable | Description |
|----------|--------------|
| `VERFIX_HOST_NETWORK` | `1` on Linux (host network), `0` otherwise (bridge) |
| `AI_API_KEY` | API key for AI-assisted and exploratory modes |
| `AI_MODEL` | Model name (default: `gpt-4o-mini`) |
| `AI_BASE_URL` | Custom base URL for OpenAI-compatible APIs (e.g. Ollama) |

---

## Volume Mounts

```bash
-v verfix-data:/var/lib/postgresql/15/main   # Execution history (Postgres)
-v verfix-artifacts:/app/workers/artifacts   # Screenshots, HAR files, traces
```

---

## Building Locally

To build the image from source:

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
curl http://localhost:3611/api/v1/health
# {"status":"healthy","redis":"ok","database":"ok","queue_depth":0,"active_workers":0}
```

The container's built-in Docker `HEALTHCHECK` polls this endpoint every 30s.
