## The Core Problem: Two Different Worlds

Think of your machine and the Docker container as **two separate apartments in the same building**.

When someone in Apartment A (your machine) says "go to my kitchen" (`localhost`), they mean *their* kitchen. But if you pass that instruction to someone in Apartment B (the container) and say "go to localhost", they walk to *their* kitchen — which is empty. Your app isn't there.

---

## Why One Fix Wasn't Enough

### "Why not just fix it in the workers?" 

The worker is what actually opens the browser. So yes, the worker is the one who ultimately needs the right address. We *did* fix the worker. But the worker alone isn't enough because:

**The worker doesn't know HOW it was started.** If it's on host network (`--network=host`), localhost works fine — no rewrite needed. If it's on bridge network (Mac/Windows), it needs to rewrite to `host.docker.internal`. The worker can't figure this out by itself — someone needs to tell it. That "someone" is the CLI, which injects `VERFIX_HOST_NETWORK=1` when it starts the container.

Also: the worker is a belt-and-suspenders safety net. If someone calls the API *directly* (not via CLI) and sends `localhost`, the worker catches it as a last resort.

---

### "Why not just fix it in the Dockerfile/startup script?"

The startup script (`server-start.sh`) injects `host.docker.internal` into the container's address book (`/etc/hosts`) so the container knows where that name points. This solves the DNS problem — the name now resolves.

**But on Linux, we went a step further.** Instead of pointing `host.docker.internal` to the IPv4 gateway (`172.17.0.1`), we use `--network=host` which makes the container share your entire network. This means `localhost` inside the container *is* your localhost — including IPv6 (`::1`).

Your Vite app was bound to `[::1]:3002` (IPv6 only). The `172.17.0.1` gateway is IPv4 — it can't reach `::1`. So the startup-script-only fix wasn't enough. We needed `--network=host` to truly solve it.

But `--network=host` is a flag you pass when *starting* the container — that's a CLI responsibility, not something the image can do for itself.

---

### "So why does the CLI need changes?"

The CLI has two jobs in this fix:

**Job 1 — Start the container correctly.**  
On Linux, it adds `--network=host` to the `docker run` command. Without the CLI doing this, the container starts in the wrong mode.

**Job 2 — Rewrite the URL before sending it to the API (for Mac/Windows).**  
On Mac/Windows, the container can't use `--network=host` (it's in a VM). So the CLI intercepts your `localhost:3002` URL and rewrites it to `host.docker.internal:3002` *before* posting the job to the API. The worker then receives the already-correct address.

---

## "But if the CLI fixes the URL, why does it work from the Dashboard too?"

Here's the key insight: **the Dashboard doesn't go through the CLI at all.**

```
CLI path:     You → CLI (rewrites URL) → API → Redis → Worker → Browser
Dashboard:    You → Dashboard UI → API → Redis → Worker → Browser
```

The Dashboard talks directly to the API. If you type `localhost:3002` in the dashboard, it sends that raw to the API — no rewriting. That's why the **worker-level fix exists**: it catches any `localhost` URL regardless of who sent it, as a safety net.

But on Linux, even the worker doesn't need to rewrite — because `--network=host` means `localhost` already works. So:

- **Dashboard on Linux**: URL stays as `localhost:3002` all the way through. Worker receives it, container is on host network, browser opens it successfully. ✅
- **Dashboard on Mac/Windows**: URL stays as `localhost:3002`. Worker receives it, sees it's on bridge mode (`VERFIX_HOST_NETWORK=0`), rewrites to `host.docker.internal:3002`, browser opens it. ✅
- **CLI on Linux**: URL stays as `localhost:3002` (CLI doesn't rewrite on Linux). Worker does nothing (host network). ✅
- **CLI on Mac/Windows**: CLI rewrites to `host.docker.internal:3002`, worker receives it already correct, doesn't need to rewrite again. ✅

---

## Summary in one picture

```
                    ┌─────────────────────────────────────────────┐
                    │              Docker Container                │
                    │                                              │
You type:           │  API → Redis → Worker → Playwright           │
localhost:3002  ──▶ │                                              │
                    │  On Linux (--network=host):                  │
                    │    localhost = YOUR localhost ✅              │
                    │                                              │
                    │  On Mac/Windows (bridge):                    │
                    │    localhost = container's localhost ❌       │
                    │    host.docker.internal = your machine ✅    │
                    └─────────────────────────────────────────────┘

Who fixes what:

CLI          → Starts container with right network mode
              (also rewrites URL on Mac/Windows as belt-and-suspenders)

server-start.sh → Makes host.docker.internal resolvable in bridge mode
                  (fallback for people who run docker manually)

Workers      → Last-resort URL rewrite for URLs that arrive as localhost
              (catches direct API calls, dashboard submissions on Mac/Win)

Dockerfile   → Installs iproute2 so server-start.sh can detect the gateway IP
```

Every layer handles a different entry point or failure mode. No single file could handle all three.