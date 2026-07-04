# Architecture Overview

Verfix relies on a deterministic-first engine. By default it runs **locally in
a single Node.js process**: the CLI calls the verification engine
(`@verfix/engine`, Playwright-based) in-process and persists results + trace
recordings to `.verfix/runs/`. An opt-in Docker **server runtime** (`--server`)
packages the API, queue, workers, and dashboard for the future hosted CI
product.

## Local mode (default)

### 1. The CLI (Node.js)
Loads `verfix.config.json`, selects the flow, and calls the engine directly —
no services, no queue, no polling.

### 2. The Engine (`@verfix/engine`, Node.js + Playwright)
Runs headless Chromium, executes flow steps deterministically, performs DOM
assertions, and executes AI healing logic when strict selectors fail (assisted
mode only). Records a full Playwright trace for every run.

### 3. Observability
Every run writes `<id>.json` plus a trace zip (screenshots, network, console)
to `.verfix/runs/`. `verfix show <id>` opens it in the Playwright trace viewer.

## Server mode (opt-in, `--server`)

### 1. The API Layer (Go)
High-throughput ingestion layer. Accepts JSON payloads from agents/CLI and enqueues them into BullMQ.

### 2. The Worker Pool (Node.js + Playwright)
A thin BullMQ adapter around the same `@verfix/engine` — identical execution semantics as local mode.

### 3. The Observability UI (Next.js)
Reads the event timeline from PostgreSQL and serves a human-readable execution dashboard, rendering screenshots, network logs, and AI reasoning.

## Execution Flow (local, default)

1. Agent runs `verfix run --flow <id> --output json`.
2. The CLI calls `runVerification()` in-process.
3. The engine executes the browser flow deterministically.
4. If a step fails and `mode=assisted`, the engine halts, captures DOM state, queries the LLM for a fallback selector, and resumes.
5. The result + trace are written to `.verfix/runs/` and the JSON contract is printed to stdout.
