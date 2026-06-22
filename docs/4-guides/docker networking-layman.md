## The Core Problem: Two Different Worlds

Think of your machine and the Docker container as **two separate apartments in the same building**.

When someone in Apartment A (your machine) says "go to my kitchen" (`localhost`), they mean *their* kitchen. But if you pass that instruction to someone in Apartment B (the container) and say "go to localhost", they walk to *their* kitchen — which is empty. Your app isn't there.

---

## One Fix Wasn't Enough

### Our first fix: container mode

On Linux, we can make the container share the host's entire network with
`--network=host`. Then `localhost` inside the container means the host's
localhost.

On Mac/Windows, `--network=host` doesn't work — containers run inside a VM.
Our old fix there was a CLI-managed TCP proxy: the CLI starts a proxy on the
host that forwards traffic from `host.docker.internal:<port>` to your app's
`localhost:<port>`. This worked but added complexity.

### Our current fix: host mode (hybrid)

Starting in v0.2.8, on macOS and Windows Verfix uses a **hybrid approach**:

```
                    ┌─────────────────────────────────────┐
                    │     Docker Container (slim image)   │
  Your machine ──▶ │   API  │  Redis  │  SQLite + slim   │
                    │   :3611  :6379   + server image      │
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │       Host Machine (you)            │
  Your app  :3002 ──▶│  Playwright Workers + Chromium       │
                    │  talks directly to localhost         │
                    └─────────────────────────────────────┘
```

The slim Docker image contains only the API server, Redis, and SQLite — no
browser, no Playwright. The CLI extracts the compiled worker files from the
image, installs Chromium locally, and runs the worker as a regular Node.js
process on your machine.

The benefits:

- **Native localhost access** — workers reach your dev server directly, no
  URL rewriting or proxy required.
- **Faster iteration** — no Docker networking layer between the browser and
  your app.
- **Smaller image** — the slim image is significantly smaller than the full
  image with Chromium bundled.

---

## How the pieces work together

### Container mode (Linux)

```
Linux + verfix CLI:
  CLI → docker run --network=host
  → Worker in container shares host network
  → localhost = your localhost ✅
```

### Host mode (macOS/Windows)

```
macOS/Windows + verfix CLI:
  CLI → docker run --network=bridge (slim image, SKIP_WORKERS=1)
  → API + Redis + SQLite in container
  → CLI extracts worker files from image to ~/.verfix/worker/
  → CLI starts Playwright Chromium on host
  → Local worker connects to container Redis on 127.0.0.1:6379
  → Worker navigates to localhost:3002 natively ✅
```

### Dashboard submissions

The Dashboard talks directly to the API. When you type `localhost:3002` in the
dashboard UI:

- **Container mode (Linux):** Worker receives the URL, `--network=host` makes
  localhost work without rewriting.
- **Container mode (Mac/Win):** Worker sees it's on bridge mode, rewrites
  `localhost` → `host.docker.internal`.
- **Host mode (any OS):** No rewriting needed — workers run on the host and
  localhost works natively.

---

## Summary

```
                    ┌─────────────────────────────────────────────┐
                    │              Docker Container (slim)        │
                    │                                             │
  You type:           │   API → Redis → SQLite                      │
  localhost:3002  ──▶ │   (no browser, no workers)                  │
                      └─────────────────────────────────────────────┘

                    ┌─────────────────────────────────────────────┐
                    │       Host Machine (native)                 │
  Your app  :3002 ──▶│  Playwright Workers + Chromium               │
                      │  direct localhost access                     │
                      └─────────────────────────────────────────────┘

Who fixes what:

CLI          → Starts the container, extracts worker files, installs browser,
               spawns local workers, manages their lifecycle

Workers      → Run natively on the host, direct localhost access
               (no URL rewriting needed)
```