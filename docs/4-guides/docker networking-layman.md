> **⚠️ Server mode only.** By default Verfix now runs the browser directly on
> your machine (no Docker), so this whole problem doesn't exist on the default
> path. This explainer only applies to the opt-in `--server` Docker runtime.

## The Core Problem: Two Different Worlds

Think of your machine and the Docker container as **two separate apartments in the same building**.

When someone in Apartment A (your machine) says "go to my kitchen" (`localhost`), they mean *their* kitchen. But if you pass that instruction to someone in Apartment B (the container) and say "go to localhost", they walk to *their* kitchen — which is empty. Your app isn't there.

---

## The fix, by platform

### Linux: share the network

On Linux, we can make the container share the host's entire network with
`--network=host`. Then `localhost` inside the container means the host's
localhost.

### macOS/Windows: an alias

On Mac/Windows, `--network=host` doesn't work — containers run inside a VM.
Instead, the CLI starts the container in bridge mode with
`--add-host=host.docker.internal:host-gateway`, and the worker (still running
inside the container, same as on Linux) rewrites `localhost` URLs to
`host.docker.internal` before navigating.

```
                    ┌─────────────────────────────────────┐
                    │           Docker Container           │
  Your machine ──▶ │   API │ Redis │ Postgres │ Workers   │
                    │   :3611  :6379            + Chromium  │
                    └─────────────────────────────────────┘
```

There is no separate host-side worker process — the browser always runs
inside the container, on every platform. Only the URL rewriting (and network
mode) differs.

---

## How the pieces work together

### Linux

```
Linux + verfix CLI:
  CLI → docker run --network=host
  → Worker in container shares host network
  → localhost = your localhost ✅
```

### macOS/Windows

```
macOS/Windows + verfix CLI:
  CLI → docker run --network=bridge --add-host=host.docker.internal:host-gateway
  → Worker in container rewrites localhost:PORT → host.docker.internal:PORT
  → Worker navigates to host.docker.internal:3002, which resolves to your machine ✅
```

### Dashboard submissions

The Dashboard talks directly to the API. When you type `localhost:3002` in the
dashboard UI:

- **Linux:** Worker receives the URL, `--network=host` makes localhost work
  without rewriting.
- **macOS/Windows:** Worker rewrites `localhost` → `host.docker.internal`.

---

## Summary

Who fixes what:

CLI     → Starts the container with the correct network mode for your platform
Worker  → Runs inside the container on every platform; rewrites `localhost`
          URLs to `host.docker.internal` on macOS/Windows only
