# Architecture Overview

Verfix relies on a deterministic-first engine. The runtime is packaged as a single unified Docker container orchestrating the API, Queue, Playwright Workers, and Dashboard.

## Core Services

### 1. The API Layer (Go)
High-throughput ingestion layer. Accepts JSON payloads from agents/CLI and enqueues them into BullMQ.

### 2. The Worker Pool (Node.js + Playwright)
Executes jobs pulled from BullMQ. Runs headless Chromium contexts, performs DOM assertions, and executes AI healing logic when strict selectors fail.

### 3. The Observability UI (Next.js)
Reads the event timeline from PostgreSQL and serves a human-readable execution dashboard, rendering screenshots, network logs, and AI reasoning.

## Execution Flow

1. Agent sends a structured task to the Go API.
2. Go API enqueues the job.
3. Node Worker executes the browser flow deterministically.
4. If a step fails and `mode=assisted`, Worker halts, captures DOM state, queries LLM for a fallback selector, and resumes.
5. Worker finalizes the timeline, takes a snapshot, and updates PostgreSQL.
