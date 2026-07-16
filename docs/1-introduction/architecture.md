# Architecture

Verfix is designed as a local-first execution runtime. This document outlines the system architecture, lifecycle patterns, and infrastructure components.

---

## Local Mode (the default)

`verfix run` executes the verification engine (`@verfix/engine`) **in-process**
— no Docker, no queue, no API server:

```
       [ CLI / SDK / Agent ]
                |
        (in-process call)
                |
       ┌────────────────────┐
       │  @verfix/engine    │  Playwright + Chromium on the host
       │  (Node.js)         │
       └────────────────────┘
                |
       .verfix/runs/<id>.json + trace zip   →   verfix show <id>
```

Everything below this line describes the **opt-in Docker server runtime**
(`--server` / `VERFIX_RUNNER=server`), kept for the future hosted CI product.
Server mode is container-only — the old hybrid host-worker mode was removed.

---

## Server Mode — Browser Execution

### Container Mode (server mode)

Workers and Playwright run inside a single Docker image alongside the API, Dashboard, Redis, and PostgreSQL.

```
       [ CLI / SDK / Agent ]
                |
          (HTTP API)
                |
       ┌───────────────────┐
       │   Docker Image    │  verfix-server:latest
       │                   │
       │  Go API  :3611    │
       │  Dashboard :3610  │
       │  Workers +        │
       │  Playwright       │
       │  Redis :6379      │
       │  PostgreSQL       │
       └───────────────────┘
```

On Linux, the container uses `--network=host` so `localhost` inside the
container is the host's `localhost`. On macOS/Windows (Docker Desktop runs
containers inside a VM), the container instead uses bridge networking plus
the `host.docker.internal` alias — workers still run inside the same Docker
image, there is no separate host-side worker process.

---

## Core Components

### 1. API (Go)
The ingest layer for all verification requests. It is a statically compiled Go Fiber application designed for high throughput and zero-latency job enqueueing. It acts as the gatekeeper between agents and the execution queue.

### 2. Queue Architecture (Redis + BullMQ)
We utilize BullMQ backed by Redis for robust job orchestration. 
- **Concurrency Control**: Ensures Playwright workers don't overwhelm the host system.
- **Retries**: Infrastructure-level retries for job failures (e.g., browser crashes), separate from semantic verification retries.

### 3. Browser Runtime (Node.js + Playwright)
The execution engine. It spins up isolated browser contexts, executes deterministic assertions, and manages AI-assisted semantic healing. It records timeline events (navigation, clicks, console logs, network errors) and syncs the completed result back to the API for the dashboard to poll — there is no live/streaming push (see ROADMAP's non-goals).
### 4. Database (PostgreSQL)

Persistent storage for execution timelines, assertions, and AI reasoning logs, accessed through a `Store` interface in the Go API. The default build uses PostgreSQL; a SQLite-backed store still exists behind the `-tags sqlite` Go build tag for embedded use. The data layer provides the observability foundation for the dashboard.

---

## Execution Lifecycle

1. **Ingest**: Agent submits a structured verification payload to the Go API.
2. **Queue**: API enqueues a Job in BullMQ.
3. **Execution**: A Node.js worker picks up the job, initializes a Playwright context, and begins the flow.
4. **Telemetry**: As the flow executes, the worker records event timeline data; the completed result (including timeline) is synced to the database once the job finishes.
5. **Resolution**: 
   - If strict assertions fail, the worker may trigger **semantic healing** (Assisted Mode).
   - If healing fails, the job is marked as failed.
6. **Artifact Collection**: Traces, HAR files, and final state screenshots are persisted to the volume mount.
7. **Finalization**: The agent polls or receives a webhook with the structured JSON result.

---

## Deterministic vs Exploratory Runtimes

Verfix enforces a strict separation between deterministic execution and exploratory execution.

- **Deterministic Pipeline**: Executes pre-defined selectors and assertions. Highly optimized, extremely fast, zero AI latency.
- **Exploratory Pipeline**: When deterministic steps fail (or when running in exploratory mode), the runtime pauses, extracts the DOM state, interfaces with the LLM for reasoning, and synthesizes a new execution path. 

This hybrid approach guarantees that AI is only invoked when necessary, preserving the speed and reliability of traditional automated testing while providing the resilience of an autonomous agent.

---

## Docker Orchestration

Server mode ships a single Docker image, `ghcr.io/verfix-dev/verfix-server:latest`,
bundling the Go API, Dashboard, workers, Playwright, Redis, and PostgreSQL —
the same image is used on every platform, with the network mode (host vs.
bridge) selected per-OS as described above. The image:

- Is built using multi-stage builds.
- Uses `tini` as the init process.
- Ships a health check that polls the `/api/v1/health` endpoint every 30 seconds.
- Exposes port mappings for the Dashboard (`3610`) and API (`3611`).
