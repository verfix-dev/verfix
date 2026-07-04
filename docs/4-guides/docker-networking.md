# Docker Networking & Browser Execution Modes

> **⚠️ Server mode only.** Since the local-first release, `verfix run` executes
> the browser **in-process on your machine by default** — there is no container
> and none of this networking applies. This guide is only relevant when using
> the opt-in Docker server runtime (`--server` / `VERFIX_RUNNER=server`). The
> hybrid "host" browser mode described below has been **removed**; server mode
> is container-only.

Verfix supports two browser execution modes to handle the networking challenge of
running Playwright workers alongside your local development server:

- **Container (default on Linux):** Workers run inside a Docker container.
  `localhost` inside the container hits the container itself, not your machine.
  Linux uses `--network=host` so the container shares the host network stack.
- **Host (default on macOS/Windows):** Workers run directly on your host
  machine. The slim server image runs in Docker with only the API, Redis, and
  SQLite. Workers connect to container Redis via a mapped port and have native
  `localhost` access to your machine.

This document explains how each mode works, how the CLI chooses between them,
and what contributors need to know when touching networking code.

---

## The Problem

```
Your machine                        Docker container
─────────────────                   ──────────────────────────────
Your app  :3002                     Playwright navigates to ???
Your Ollama :11434      vs.        AI provider connects to ???
Your Redis  :6379 (ext)            Workers connect to ???
```

`localhost` is not a shared address — it's a per-network-namespace loopback.
Each Docker container has its own. So `localhost:3002` inside a container
hits nothing.

---

## Container Mode — Linux `--network=host`

On Linux, Docker supports **host networking**: the container shares the host's
entire network namespace. `localhost` inside the container **is** the same
`localhost` as on your machine — including both:

- IPv4 loopback (`127.0.0.1`)
- IPv6 loopback (`::1`)

This means apps bound to `::1` only (common with some Node.js frameworks on
Linux) are reachable without any URL rewriting.

```bash
# What the CLI produces on Linux (container mode):
docker run -d \
  --network=host \                         # ← shares host network
  -e VERFIX_BROWSER_MODE=container \       # ← container mode
  -e VERFIX_HOST_NETWORK=1 \              # ← signals workers: no rewrite
  -v verfix-data:/var/lib/postgresql/15/main \
  -v verfix-artifacts:/app/workers/artifacts \
  -e AI_API_KEY=... \
  ghcr.io/verfix-dev/verfix-server:latest
```

> **Why not use `--network=host` on macOS/Windows?**
> Docker Desktop runs containers inside a Linux VM.
> `--network=host` gives you the VM's localhost, not your Mac/Windows
> machine's localhost. It doesn't solve the problem there.

---

## Host Mode — macOS/Windows Hybrid

On macOS/Windows, `--network=host` doesn't reach the real host (Docker Desktop
runs containers inside a Linux VM). Verfix uses a different strategy: **hybrid
browser mode** where Playwright workers run directly on the host machine.

```
                    ┌─────────────────────────────────────┐
                    │      Docker Container (slim)         │
  Your machine ──▶ │  Go API  │  Redis  │  SQLite (verfix-slim-data)  │
                    │  :3611         :6379                 │
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │      Host Machine (native)           │
  Your app  :3002 ──▶│  Playwright Workers + Chromium       │
                    │  extracts files from slim image      │
                    │  connects to container Redis         │
                    └─────────────────────────────────────┘
```

In host mode, the CLI:

1. Pulls the **slim** Docker image (`verfix-server-slim:latest`) — it contains
   only the API, Redis, and SQLite (no browser, no PostgreSQL).
2. Starts the slim container with:
   - `SKIP_WORKERS=1` — container skips starting its own workers.
   - `--network=bridge` + `--add-host=host.docker.internal:host-gateway`.
   - A bind mount from the container's artifacts directory to the host so both
     sides can share execution data.
3. Extracts the compiled worker code from the slim image to `~/.verfix/worker/`.
4. Installs Playwright Chromium on the host.
5. Spawns the worker as a local Node.js process that connects to Redis at
   `localhost:6379` (mapped through Docker port, or native if host already runs
   Redis).

This gives workers direct `localhost` access — your app is reachable without any
URL rewriting or proxy.

```bash
# What the CLI produces on macOS/Windows (host mode):
docker run -d \
  --name verfix \
  --network=bridge \
  --add-host=host.docker.internal:host-gateway \
  -p 127.0.0.1:6379:6379 \          # Redis for host workers
  -p 3611:3611 \
  -p 3610:3610 \
  -v ~/.verfix/artifacts:/app/workers/artifacts \
  -v verfix-slim-data:/app/data \   # SQLite database
  -e SKIP_WORKERS=1 \
  -e VERFIX_BROWSER_MODE=host \
  ghcr.io/verfix-dev/verfix-server-slim:latest
```

Override the mode with `VERFIX_BROWSER_MODE=container` to force the old
container-mode behavior (full image, workers inside Docker).

---

## Linux Bridge Fallback (manual `docker run`)

If someone starts the container manually on Linux without `--network=host`
(e.g. `docker run -p 3001:3001 ...`), verfix has a second layer of defence.

`scripts/server-start.sh` reads the default gateway IP from the kernel routing
table at container startup and injects it into `/etc/hosts`:

```sh
HOST_GW=$(ip route show default | awk '{print $3}' | head -1)
echo "${HOST_GW}  host.docker.internal" >> /etc/hosts
# Result: 172.17.0.1  host.docker.internal
```

This requires `iproute2` in the image (added to `Dockerfile.server`).

> **Limitation:** The host gateway IP (`172.17.0.1`) is an IPv4 address.
> If the user's app is bound to IPv6 only (`::1`), this fallback cannot reach
> it. The correct fix is to use the CLI which uses `--network=host` on Linux.

---

## The `VERFIX_BROWSER_MODE` Environment Variable

The CLI detects the OS and selects a default browser mode:

| Platform | Default Mode | Image | Workers |
|----------|-------------|-------|---------|
| Linux | `container` | `verfix-server:latest` (PostgreSQL + browser) | Inside Docker, `--network=host` |
| macOS | `host` | `verfix-server-slim:latest` (SQLite, no browser) | On the host machine |
| Windows | `host` | `verfix-server-slim:latest` (SQLite, no browser) | On the host machine |

Override with `VERFIX_BROWSER_MODE=container` or `VERFIX_BROWSER_MODE=host`.

### Container mode variables

| Variable | Values | Description |
|----------|--------|-------------|
| `VERFIX_BROWSER_MODE` | `container` | Workers run inside the Docker container. |
| `VERFIX_HOST_NETWORK` | `1` (Linux) or `0` (Mac/Win) | Signals workers whether to rewrite localhost URLs. |

### Host mode environment

When workers run on the host, the container receives:

| Variable | Value | Description |
|----------|-------|-------------|
| `VERFIX_BROWSER_MODE` | `host` | Signals container to skip its own workers |
| `SKIP_WORKERS` | `1` | Container startup script skips worker process |
| `VERFIX_HOST_NETWORK` | `0` | URL rewriting applies (for non-worker paths) |

The local worker process receives:

| Variable | Value | Description |
|----------|-------|-------------|
| `VERFIX_WORKER_MODE` | `local` | Signals worker it's running on the host |
| `REDIS_HOST` | `localhost` | Container Redis (mapped port 6379) |
| `REDIS_PORT` | `6379` (or host env) | Redis port |
| `ARTIFACTS_DIR` | `~/.verfix/artifacts` | Shared artifacts directory |

---

## URL Rewriting — Where and When

### In container mode (workers inside Docker)

**Client side (CLI):**

`cli/src/index.ts` → `resolveJobUrl(url)`:

```typescript
function resolveJobUrl(url: string): string {
  if (!url) return url;
  // On Linux the container uses --network=host: localhost IS the host.
  if (isHostNetworkMode()) return url;        // os.platform() === 'linux'
  // On Mac/Windows: rewrite so Playwright can reach the host.
  return url.replace(
    /\/\/(localhost|127\.0\.0\.1)(:\d+)?/g,
    '//host.docker.internal$2',
  );
}
```

**Worker side:**

In container mode, the worker applies the same rewrite:

```typescript
function resolveTargetUrl(rawUrl: string): string {
  if (VERFIX_BROWSER_MODE === 'host') return rawUrl; // handled by host workers
  if (IS_HOST_NETWORK) return rawUrl;      // VERFIX_HOST_NETWORK=1
  if (!IS_DOCKER) return rawUrl;           // local dev, no container
  return rawUrl.replace(                   // bridge mode
    /\/\/(localhost|127\.0\.0\.1)(:\d+)?/g,
    '//host.docker.internal$2',
  );
}
```

### In host mode (workers on the host machine)

No URL rewriting is needed. Host-mode workers use CLI's `resolveJobUrl` and
skip container-side rewriting because workers connect directly to `localhost:PORT`.

```typescript
function resolveJobUrl(url: string): string {
  if (!url) return url;
  // Host browser mode: workers run on the host, localhost is reachable natively.
  if (getBrowserMode() === 'host') return { url, rewritten: false };
  // Rest of logic...
}
```

---

## Decision Matrix

| Scenario | How `localhost:PORT` is resolved |
|----------|----------------------------------|
| Linux + verfix CLI (container mode) | `--network=host` → real localhost (IPv4 + IPv6) ✅ |
| macOS/Windows + verfix CLI (host mode) | Workers on host → native `localhost` ✅ |
| Linux + manual `docker run` | Host gateway injection → `172.17.0.1` (IPv4 only) ⚠️ |
| Mac/Windows + manual `docker run` (container mode) | `host.docker.internal` alias → host IP ✅ |
| Local dev (no Docker) | No rewrite, localhost works normally ✅ |

---

## Ollama and Local AI Backends

The same networking rules apply to `AI_BASE_URL`. If you run Ollama locally
and set `AI_BASE_URL=http://localhost:11434/v1`, the worker applies the same
rewrite logic via `workers/src/ai/provider.ts` → `resolveBaseUrl()`.

**In `.env` / `verfix.config.json`**, always use the user-facing form:
```
AI_BASE_URL=http://localhost:11434/v1
```

Verfix rewrites it internally at runtime. Never document `host.docker.internal`
as the value users should type — it is an implementation detail.

---

## Contributor Checklist

When touching any of these files, keep the following invariants:

### `cli/src/constants.ts`

- `getBrowserMode()` must return `'host'` on macOS/Windows, `'container'` on
  Linux unless overridden by `VERFIX_BROWSER_MODE`.
- `getDockerImage()` must return the slim image for host mode, full image for
  container mode.
- `getDataVolume()` must return the correct volume per mode.

### `cli/src/docker.ts`

- `startContainer()` must set `SKIP_WORKERS=1` in host mode.
- In host mode, port mapping must detect existing host Redis on 6379 to avoid
  conflicts.
- `getDockerImage()` and `getDataVolume()` resolve image and volume per mode.
- `pullImage()` and `pullImageIfMissing()` must use the mode-correct image.

### `cli/src/index.ts`

- `resolveJobUrl()` must skip rewriting in host mode (local workers connect
  directly to localhost).
- `start`/`stop`/`run` must manage local worker lifecycle in host mode.
- `verfix status` must surface `browser_mode` and worker state in JSON output.

### `cli/src/worker-runner.ts`

- `extractWorkerFiles()` must handle image digest caching for incremental
  extraction.
- `startLocalWorker()` must write PID and headless state files for cross-process
  tracking.
- `playwright install chromium` must unset `PLAYWRIGHT_BROWSERS_PATH` to avoid
  inheriting container browser paths.

### `cli/src/init-wizard.ts`

- Must present browser mode selection to users with OS-appropriate defaults.
- Must persist `VERFIX_BROWSER_MODE` to `.verfix/.env`.

### `cli/src/init-noninteractive.ts`

- Must detect and log the OS-appropriate default browser mode.
- Must save browser mode to `.verfix/.env` even if AI setup is skipped.

### `scripts/server-start.sh` / `scripts/server-start-slim.sh`

- The slim startup script must apply `SKIP_WORKERS=1` logic.
- The `host.docker.internal` injection must be wrapped in
  `[ "${VERFIX_BROWSER_MODE}" != "host" ]`.

### `Dockerfile.server-slim`

- Must use SQLite build tag (`-tags sqlite`) for the store.
- Must NOT include Playwright browsers or PostgreSQL.

---

## Testing the Networking Stack

### Verify container mode (Linux)

```bash
docker exec verfix cat /proc/net/dev | grep -v lo | grep eth
# Should return nothing — no eth interface in host network mode.

docker exec verfix curl -s http://localhost:3002/
# Should reach your app directly.
```

### Verify URL is NOT rewritten by CLI in container mode on Linux

```bash
# Run with verbose output and look for the rewrite log line.
# It should NOT appear on Linux:
npx verfix run --url http://localhost:3002 --output json
# No rewrite log should appear.
```

### Verify URL IS rewritten on Mac/Windows (container mode)

```bash
# The log line should appear:
# ℹ  Target URL: http://localhost:3002 → http://host.docker.internal:3002
```

### Verify host mode worker

```bash
verfix start --show-browser

# Should see:
#     API:       http://localhost:3611
#     Dashboard: http://localhost:3610
#     Browser Mode: host (hybrid)
#     Worker:      running (PID: ...)

verfix status --output json
# Should include:
#   "browser_mode": "host",
#   "worker": "running",
#   "worker_pid": 12345
```

---

## Frequently Asked Questions

**Q: Next.js shows a warning: `Cross origin request detected from host.docker.internal`**

This happens because the Playwright browser inside Docker accesses your app via `http://host.docker.internal:<port>`, but the Next.js dev server strictly expects `localhost`. 
- **Currently:** It is just a warning and does not affect Verfix or your tests.
- **In the future:** If Next.js blocks these requests, Verfix won't be able to load your CSS/JS. You will need to allow it in your `next.config.ts`/`next.config.js`:
```js
const nextConfig = {
  allowedDevOrigins: ['host.docker.internal'],
};
```

**Q: My app is running on `::1:3002` and the test fails with `ERR_CONNECTION_REFUSED`.**

You are on Linux and the container was started manually without `--network=host`.
Use the CLI (`verfix start`) instead of a raw `docker run` command — the CLI
automatically applies the correct network mode per platform.

**Q: I'm on Linux and I want to run the container manually without the CLI.**

Add `--network=host -e VERFIX_HOST_NETWORK=1` to your `docker run` command:

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

**Q: `host.docker.internal` still doesn't resolve inside the container.**

Check if you're on Linux with bridge mode. Run:
```bash
docker logs verfix | grep "host.docker.internal"
```
If the injection succeeded you'll see `✅ host.docker.internal → 172.17.0.1`.
If not, check that `iproute2` is installed in the image.

**Q: Why not tell users to bind their app to `0.0.0.0`?**

We considered it. It requires the user to change how they start their dev
server and doesn't work across all frameworks consistently. Making verfix smart
enough to not require app changes is a better developer experience.

**Q: Does this affect CI/CD?**

In CI (GitHub Actions, etc.) Docker containers use bridge networking on Linux
runners. The CLI detects Linux and uses `--network=host` in container mode, so
everything works the same as local development. See `docs/4-guides/ci-cd.md`
for CI setup.

**Q: When should I use `container` mode on macOS/Windows?**

Container mode is available via `VERFIX_BROWSER_MODE=container` if you prefer
the old behavior (full image with workers inside Docker). The CLI will use the
local TCP proxy approach for localhost URLs. Host mode is recommended for most
users.

**Q: What is the slim image?**

The `verfix-server-slim` image replaces PostgreSQL with SQLite and excludes the
Playwright browser binaries, reducing the image size and memory footprint. It is
automatically selected by the CLI when running in host mode on macOS/Windows.
