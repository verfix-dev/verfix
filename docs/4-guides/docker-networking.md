# Docker Networking — Reaching the Host from Inside the Container

Verfix's Playwright workers run **inside a Docker container**. This creates a
networking challenge: when you tell verfix to test `http://localhost:3002/`,
"localhost" inside the container refers to the container itself — not your
machine. This document explains exactly how verfix solves that, and what
contributors need to know when touching any networking code.

---

## The Problem

```
Your machine                        Docker container
─────────────────                   ──────────────────────────────────
Your app  :3002                     Playwright navigates to ???
Your Ollama :11434       vs.        AI provider connects to ???
Your Redis  :6379 (ext)             Workers connect to ???
```

`localhost` is not a shared address — it's a per-network-namespace loopback.
Each Docker container has its own. So `localhost:3002` inside the container
hits nothing.

---

## The Solution — Platform-Specific Network Modes

Verfix uses different strategies depending on the host OS, detected
automatically by `cli/src/docker.ts`:

### Linux — `--network=host`

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

> **Why not use `--network=host` everywhere?**
> Docker Desktop on Mac and Windows runs containers inside a Linux VM.
> `--network=host` gives you the VM's localhost, not your Mac/Windows
> machine's localhost. It doesn't solve the problem there.

---

### Mac / Windows — Bridge + `host.docker.internal`

Docker Desktop automatically injects a DNS alias `host.docker.internal` that
resolves to the host machine's IP from inside any container.

The CLI passes `--add-host=host.docker.internal:host-gateway` (a no-op on
Docker Desktop but required for plain Linux bridge mode) and rewrites all
`localhost`/`127.0.0.1` references in job URLs to `host.docker.internal`
before submitting to the API.

```bash
# What the CLI produces on Mac/Windows:
docker run -d \
  --add-host=host.docker.internal:host-gateway \
  -p 3001:3001 \
  -p 3000:3000 \
  -e VERFIX_HOST_NETWORK=0 \
  ...
```

---

### Linux Bridge Fallback (manual `docker run`)

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

The CLI injects `VERFIX_HOST_NETWORK=1` (Linux) or `VERFIX_HOST_NETWORK=0`
(Mac/Windows) when starting the container. Three places inside the container
read this variable:

| File | Behaviour when `=1` | Behaviour when `=0` |
|------|---------------------|---------------------|
| `workers/src/index.ts` | `resolveTargetUrl()` returns URL unchanged | Rewrites `localhost` → `host.docker.internal` |
| `workers/src/ai/provider.ts` | `resolveBaseUrl()` returns `AI_BASE_URL` unchanged | Rewrites `localhost` → `host.docker.internal` |
| `scripts/server-start.sh` | Skips `/etc/hosts` injection | Injects host gateway IP |

---

## URL Rewriting — Where and When

### Client side (CLI, always runs on the host machine)

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

This runs **before the job is even sent to the API**, so it works with any
image version including ones pulled from the registry.

### Worker side (runs inside the container)

`workers/src/index.ts` → `resolveTargetUrl(rawUrl)`:

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

This is a belt-and-suspenders measure. It catches URLs that arrive at the
worker already containing `localhost` (e.g. from old CLI versions or direct
API calls).

---

## Decision Matrix

| Scenario | How `localhost:PORT` is resolved |
|----------|----------------------------------|
| Linux + verfix CLI | `--network=host` → real localhost (IPv4 + IPv6) ✅ |
| Linux + manual `docker run` | Host gateway injection → `172.17.0.1` (IPv4 only) ⚠️ |
| Mac + Docker Desktop | `host.docker.internal` alias → host IP ✅ |
| Windows + Docker Desktop | `host.docker.internal` alias → host IP ✅ |
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

- `isHostNetworkMode()` must return `true` on Linux, `false` elsewhere.
- Linux path must use `--network=host` and **omit** `-p` port flags (they are
  silently ignored with host networking but are misleading).
- Always inject `VERFIX_HOST_NETWORK=1|0`.

### `cli/src/index.ts`

- `resolveJobUrl()` must only rewrite on non-Linux (bridge mode).
- The `verfix.config.json` `baseUrl` must always store the human-readable
  form (`localhost:PORT`). Never persist a rewritten URL to disk.

### `workers/src/index.ts`

- `resolveTargetUrl()` must check `IS_HOST_NETWORK` first — always.
- The `IS_DOCKER` check uses `/.dockerenv` presence as a heuristic; it is
  falsy in local dev (no container), truthy inside the container.

### `workers/src/ai/provider.ts`

- Same rules as `resolveTargetUrl` — check `IS_HOST_NETWORK_PROVIDER` first.

### `scripts/server-start.sh`

- The `host.docker.internal` injection block must be wrapped in
  `[ "${VERFIX_HOST_NETWORK}" != "1" ]` — it is irrelevant and potentially
  harmful in host network mode (no default route exists).

### `Dockerfile.server`

- `iproute2` must remain in the apt-get install list — it provides `ip route`,
  required by the Linux bridge fallback in `server-start.sh`.

---

## Testing the Networking Stack

### Verify host network mode is active (Linux)

```bash
docker exec verfix cat /proc/net/dev | grep -v lo | grep eth
# Should return nothing — no eth interface in host network mode.

docker exec verfix curl -s http://localhost:3002/
# Should reach your app directly.
```

### Verify bridge fallback injection

```bash
docker exec verfix grep host.docker.internal /etc/hosts
# Should show: 172.17.0.1  host.docker.internal
```

### Verify URL is NOT rewritten by CLI on Linux

```bash
# Run with verbose output and look for the rewrite log line.
# It should NOT appear on Linux:
npx ts-node cli/src/index.ts run --url http://localhost:3002 --output json
# "ℹ  Target URL: ..." should NOT appear in stdout.
```

### Verify URL IS rewritten on Mac/Windows

```bash
# The log line should appear:
# ℹ  Target URL: http://localhost:3002 → http://host.docker.internal:3002
```

---

## Frequently Asked Questions

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

**Q: Why not just tell users to bind their app to `0.0.0.0`?**

We considered it. It requires the user to change how they start their dev
server and doesn't work across all frameworks consistently. Making verfix smart
enough to not require app changes is a better developer experience.

**Q: Does this affect CI/CD?**

In CI (GitHub Actions, etc.) Docker containers use bridge networking on Linux
runners. The CLI detects Linux and uses `--network=host`, so everything works
the same as local development. See `docs/4-guides/ci-cd.md` for CI setup.
