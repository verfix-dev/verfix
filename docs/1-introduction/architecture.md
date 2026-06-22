# Architecture

Verfix is designed as a highly scalable, event-driven, local-first execution runtime. This document outlines the system architecture, lifecycle patterns, and infrastructure components.

---

## Browser Execution Modes

Verfix supports two browser execution modes:

### Container Mode (default on Linux)

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

### Host Mode (default on macOS/Windows)

The slim image runs the API, Dashboard, Redis, and SQLite in Docker. Workers
and Playwright run natively on the host machine for direct localhost access.

```
       [ CLI / SDK / Agent ]
                |
          (HTTP API)
                |
       ┌───────────────────┐          ┌───────────────────────────┐
       │  Docker Container │          │     Host Machine           │
       │  verfix-server-   │          │                           │
       │       slim        │          │   Playwright Workers      │
       │                   │          │   + Chromium (native)     │
       │  Go API  :3611    │◀───────▶│   localhost access ✅     │
       │  Dashboard :3610  │  Redis   │                           │
       │  Redis :6379      │   mapped │                           │
       │  SQLite (data)    │          │                           │
       └───────────────────┘          └───────────────────────────┘
```

---

## Core Components

### 1. API (Go)
The ingest layer for all verification requests. It is a statically compiled Go Fiber application designed for high throughput and zero-latency job enqueueing. It acts as the gatekeeper between agents and the execution queue.

### 2. Queue Architecture (Redis + BullMQ)
We utilize BullMQ backed by Redis for robust job orchestration. 
- **Concurrency Control**: Ensures Playwright workers don't overwhelm the host system.
- **Retries**: Infrastructure-level retries for job failures (e.g., browser crashes), separate from semantic verification retries.

### 3. Browser Runtime (Node.js + Playwright)
The execution engine. It spins up isolated browser contexts, executes deterministic assertions, and manages AI-assisted semantic healing. It emits real-time timeline events (navigation, clicks, console logs, network errors) back to the API.
### 4. Database (PostgreSQL / SQLite)

Persistent storage for execution timelines, assertions, and AI reasoning logs. The full image uses PostgreSQL; the slim image uses an embedded SQLite store. Both are accessed through a common `Store` interface in the Go API. The data layer provides the observability foundation for the dashboard.

---

## Execution Lifecycle

1. **Ingest**: Agent submits a structured verification payload to the Go API.
2. **Queue**: API enqueues a Job in BullMQ.
3. **Execution**: A Node.js worker picks up the job, initializes a Playwright context, and begins the flow.
4. **Telemetry**: As the flow executes, the worker continuously pushes event timeline data to the database.
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

Verfix uses two Docker images depending on the browser execution mode:

- `ghcr.io/verfix-dev/verfix-server:latest` — Full image with PostgreSQL,
  Redis, Go API, workers, and Playwright. Used in container mode on Linux.
- `ghcr.io/verfix-dev/verfix-server-slim:latest` — Lightweight image with
  SQLite (no PostgreSQL), Redis, and Go API. Used in host mode on macOS/Windows
  where workers run natively on the host.

Both images:
- Are built using multi-stage builds.
- Use `tini` as the init process.
- Ship health checks that poll the `/api/v1/health` endpoint every 30 seconds.
- Expose port mappings for the Dashboard (`3610`) and API (`3611`).
