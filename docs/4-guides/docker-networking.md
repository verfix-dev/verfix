# Docker Networking (server mode)

> **⚠️ Server mode only.** Since the local-first release, `verfix run` executes
> the browser **in-process on your machine by default** — there is no container
> and none of this networking applies. This guide is only relevant when using
> the opt-in Docker server runtime (`--server` / `VERFIX_RUNNER=server`).
> Server mode is **container-only** — the old hybrid mode, where Playwright
> workers ran natively on the host machine instead of inside the container,
> has been removed.

Verfix's server mode ships a single Docker image (workers and Playwright run
inside it on every platform). The only thing that varies per OS is how the
container reaches services on `localhost` on your machine:

- **Linux:** `--network=host` — the container shares the host's network
  namespace, so `localhost` inside the container **is** your machine's
  `localhost`.
- **macOS/Windows:** bridge networking + the `host.docker.internal` alias,
  since Docker Desktop runs containers inside a VM and `--network=host`
  doesn't reach the real host there.

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

## Linux — `--network=host`

On Linux, Docker supports **host networking**: the container shares the host's
entire network namespace. `localhost` inside the container **is** the same
`localhost` as on your machine — including both:

- IPv4 loopback (`127.0.0.1`)
- IPv6 loopback (`::1`)

This means apps bound to `::1` only (common with some Node.js frameworks on
Linux) are reachable without any URL rewriting.

```bash
# What the CLI produces on Linux:
docker run -d \
  --network=host \                         # ← shares host network
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

## macOS/Windows — bridge + `host.docker.internal`

On macOS/Windows, `--network=host` doesn't reach the real host (Docker Desktop
runs containers inside a Linux VM). Verfix instead runs the same container
image in bridge mode with `--add-host=host.docker.internal:host-gateway`, and
the worker (still running inside the container) rewrites `localhost` URLs to
`host.docker.internal` before navigating.

```bash
# What the CLI produces on macOS/Windows:
docker run -d \
  --name verfix \
  --network=bridge \
  --add-host=host.docker.internal:host-gateway \
  -e VERFIX_HOST_NETWORK=0 \
  -p 3611:3611 \
  -p 3610:3610 \
  -v verfix-data:/var/lib/postgresql/15/main \
  -v verfix-artifacts:/app/workers/artifacts \
  -e AI_API_KEY=... \
  ghcr.io/verfix-dev/verfix-server:latest
```

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

## The `VERFIX_HOST_NETWORK` Environment Variable

The CLI detects the OS and passes `VERFIX_HOST_NETWORK` to signal the worker
inside the container whether URL rewriting is needed:

| Variable | Value | Description |
|----------|-------|--------------|
| `VERFIX_HOST_NETWORK` | `1` on Linux, `0` on Mac/Windows | Whether the worker should skip rewriting `localhost` URLs. |

---

## URL Rewriting — Where and When

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

The worker (always running inside the container) applies the same rewrite:

```typescript
function resolveTargetUrl(rawUrl: string): string {
  if (IS_HOST_NETWORK) return rawUrl;      // VERFIX_HOST_NETWORK=1
  if (!IS_DOCKER) return rawUrl;           // local dev, no container
  return rawUrl.replace(                   // bridge mode
    /\/\/(localhost|127\.0\.0\.1)(:\d+)?/g,
    '//host.docker.internal$2',
  );
}
```

---

## Decision Matrix

| Scenario | How `localhost:PORT` is resolved |
|----------|----------------------------------|
| Linux + verfix CLI | `--network=host` → real localhost (IPv4 + IPv6) ✅ |
| macOS/Windows + verfix CLI | bridge + `host.docker.internal` rewrite → host IP ✅ |
| Linux + manual `docker run` | Host gateway injection → `172.17.0.1` (IPv4 only) ⚠️ |
| Mac/Windows + manual `docker run` | `host.docker.internal` alias → host IP ✅ |
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

### `cli/src/docker.ts`

- `isHostNetworkMode()` must return `true` on Linux, `false` on macOS/Windows.
- `startContainer()` must use `--network=host` on Linux and bridge +
  `--add-host=host.docker.internal:host-gateway` (with port mappings) on
  macOS/Windows.

### `cli/src/index.ts`

- `resolveJobUrl()` must skip rewriting on Linux and rewrite
  `localhost`/`127.0.0.1` → `host.docker.internal` on macOS/Windows.
- `verfix status` must surface health/network state in JSON output.

### `scripts/server-start.sh`

- Must keep the `/etc/hosts` gateway-IP injection for the manual
  `docker run` fallback on Linux.

---

## Testing the Networking Stack

### Verify host-network mode (Linux)

```bash
docker exec verfix cat /proc/net/dev | grep -v lo | grep eth
# Should return nothing — no eth interface in host network mode.

docker exec verfix curl -s http://localhost:3002/
# Should reach your app directly.
```

### Verify URL is NOT rewritten by CLI on Linux

```bash
# Run with verbose output and look for the rewrite log line.
# It should NOT appear on Linux (--base-url works too, as an alias for --url):
npx verfix run --url http://localhost:3002 --output json
# No rewrite log should appear.
```

### Verify URL IS rewritten on Mac/Windows

```bash
# The log line should appear:
# ℹ  Target URL: http://localhost:3002 → http://host.docker.internal:3002
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
