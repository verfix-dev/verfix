# Architecture

Verfix is designed as a highly scalable, event-driven, local-first execution runtime. This document outlines the system architecture, lifecycle patterns, and infrastructure components.

---

## System Diagram

```text
      [ CLI / SDK / Agent ]
               |
         (HTTP API)
               |
      +-------------------+
      |    Verfix API     |  (Go / Fiber)
      +-------------------+
               |
       (Redis / BullMQ)
               |
      +-------------------+
      |  Verfix Workers   |  (Node.js / Playwright)
      +-------------------+
               |
    [ Chromium Headless ]
               |
      +-------------------+
      | PostgreSQL DB     |  (Execution History & Metadata)
      +-------------------+
               |
      +-------------------+
      | Verfix Dashboard  |  (Next.js)
      +-------------------+
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

### 4. Database (PostgreSQL)
Persistent storage for execution timelines, assertions, and AI reasoning logs. Provides the data foundation for the observability dashboard.

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

The entire runtime is bundled into a single, production-grade Docker image (`ghcr.io/verfix-dev/verfix-server`). 

- Built using multi-stage builds.
- Contains Go API, Next.js standalone server, compiled TS workers, Redis, and PostgreSQL.
- Uses `tini` as the init process.
- Volumes are used to persist PostgreSQL data and Playwright artifacts (screenshots, traces).
