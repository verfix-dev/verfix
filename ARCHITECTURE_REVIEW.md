# Verfix — Architecture Review & Roadmap

> Principal-level review of onboarding friction, dependency weight, and cross-OS
> support. Written 2026-07-01.
>
> **Framing:** The current server infrastructure (Go API + Redis/BullMQ + pluggable
> DB + Docker images) is **not wasted work** — it is the foundation for a future
> hosted product that runs verification in CI (e.g. GitHub Actions) on every push,
> which is the monetization path once the tool has ~1–2k active users. The problem
> is not that this infrastructure *exists*; it is that the **local single-user path
> is forced to carry all of it**. This document separates the two product surfaces
> and lays out a priority-ordered plan to make the local CLI lightweight *first*,
> without throwing away the server groundwork.

---

## 1. The core insight

Verfix has (or will have) **two products** sharing one codebase:

| Surface | User | Scale | What it needs |
|---------|------|-------|---------------|
| **Local CLI** (today) | A dev / AI agent on one machine | 1 flow at a time, depth-1 queue | Node + a browser. That's it. |
| **Hosted CI runner** (future) | A team, on push | Many flows, many repos, concurrency, retries, persistence, dashboards | API + queue + DB + containers |

Today the **local CLI is forced to run the hosted product's entire control plane**: a Docker container hosting a Go HTTP API, a Redis instance, a job queue (in fact *two* queue layers — see §3), and a SQL database — just to click through one browser flow. Every friction point below is a symptom of that single coupling.

**The strategy:** make the local CLI able to run with **zero Docker, zero Redis, zero API server** — driving Playwright directly in-process — while keeping the server stack intact and opt-in for the future CI product.

---

## 2. Observations — current dependency chain

What a new user on **macOS/Windows** (default `host`/hybrid mode) must satisfy before a single flow runs:

1. **Node.js 20+** — reasonable, unavoidable. ✅
2. **Docker Desktop installed *and running*** — hard failure otherwise. `verfix init` throws at [cli/src/init-wizard.ts:348](cli/src/init-wizard.ts#L348); `verfix doctor` counts it as a failure at [cli/src/index.ts:441](cli/src/index.ts#L441). ❌ **No non-Docker path exists on any OS.**
3. **AI API key** — prompted as Step 2/4 of the wizard ([init-wizard.ts:355](cli/src/init-wizard.ts#L355)), *before* the user sees any value — even though **strict mode (the CI-recommended mode) uses no AI at all**.
4. **Docker image pull** — slim ~500MB, full ~2GB. ~2 min on first run.
5. **~400MB Chromium download** on the host via `npx playwright install chromium` ([worker-runner.ts:167](cli/src/worker-runner.ts#L167)).
6. **A second `npm ci` on the host** to rebuild worker `node_modules` after `docker cp`-ing compiled JS out of the image ([worker-runner.ts:135](cli/src/worker-runner.ts#L135)) — ~150MB.

**Net first-run cost on Mac/Windows:** ~500MB image pull **plus** ~550MB host-side download (~1GB total), four independent failure points (Docker daemon, image registry, npm registry, Playwright CDN), and an API key the user may not need — all before flow #1.

### Weight summary (confirmed)

| Dependency | Size | Required for local `run`? | Notes |
|---|---|---|---|
| Docker daemon | system | **Yes (today)** | Core blocker. No native path. |
| Docker image | 500MB–2GB | **Yes (today)** | slim vs full by mode |
| Chromium | ~400MB | Yes | Playwright-only, no fallback engine |
| Worker `node_modules` | ~150MB | Yes (host mode) | rebuilt on host via `npm ci` |
| Redis (in image) | ~50MB | **Yes (today)** | queue + result cache |
| Go API (in image) | ~30MB | **Yes (today)** | HTTP round-trip for one local job |
| PostgreSQL (full image) | ~100MB | container mode only | swappable to SQLite |

---

## 3. Observations — architectural coupling

### 3.1 A distributed job pipeline with steady-state depth of one
A single local `verfix run` travels:

```
CLI → HTTP POST /api/v1/verify   (Go API, api/main.go:120)
    → Redis RPUSH "verify_jobs"  (plain Redis list, api/main.go:149)
    → worker BLPOP "verify_jobs" (adapter loop, workers/src/index.ts:113)
    → re-enqueue into BullMQ     (second queue layer, for retries/backoff)
    → worker runs Playwright
    → Redis SET "exec_result_<id>" (24h TTL)
    → CLI polls GET /executions/<id> every 2s
```

There are **two queue layers** (a raw Redis list *and* BullMQ) between a single producer and a single consumer. This is correct architecture for a multi-tenant CI service; it is pure overhead for a local one-shot CLI.

### 3.2 Hybrid mode is a workaround for putting the browser in Docker
The entire host/container split — worker file extraction ([worker-runner.ts](cli/src/worker-runner.ts)), `localhost` → `host.docker.internal` URL rewriting, Redis port-6379 detection/mapping ([docker.ts:224-271](cli/src/docker.ts#L224)), artifact bind-mounts, PID tracking — exists **only because the browser was placed inside Docker**. Hybrid mode already runs the browser natively on the host; it just still requires the container for the API/Redis/DB it doesn't actually need for the verify loop.

### 3.3 Two images, two DBs, two network modes
`getBrowserMode()` ([constants.ts:48](cli/src/constants.ts#L48)) branches into: slim image (SQLite) vs full image (Postgres + Chromium), `--network=host` (Linux) vs bridge (Mac/Win). Double the CI, double the bug surface. The Postgres path (`initdb` at build, `/var/lib/postgresql/15/main` volume) is heavyweight for a single-user embedded tool.

---

## 4. What is genuinely good (keep, do not touch)

- **The structured JSON contract** — `passed`, `failures[]`, `fix_hint`, typed failure classes ([constants.ts:115](cli/src/constants.ts#L115)). This is the actual product value.
- **Config-first source guard** — the two-layer design (instructions + deterministic git baseline gate) is well-reasoned.
- **AGENTS.md stub + `.verfix/INSTRUCTIONS.md` reference split** — correct call, keeps host projects un-bloated.
- **Deterministic strict mode** as the reliability foundation.
- **Port auto-resolution & PID/state tracking** — solid.
- **The server/queue/DB stack** — keep it; it is the future CI product. Just decouple it from local (§P1).

---

## 5. Task roadmap — priority order

### P0 — Remove first-run gates (days, low risk, high visibility)
Do these regardless of the bigger refactor; they help immediately.

- [ ] **P0.1 — Make the AI key optional and lazy.** Default the wizard to strict mode. Only prompt for a provider/key when the user selects `assisted`/`exploratory`. `verfix init` must complete and produce a runnable strict flow with **zero credentials**.
  - Files: [cli/src/init-wizard.ts:355](cli/src/init-wizard.ts#L355) (move `runProviderFlow` behind a mode check), [cli/src/init-noninteractive.ts].
- [ ] **P0.2 — Reorder init for time-to-value.** Detect app URL → scaffold a working flow → show success, *then* offer optional AI/agent-file setup. Value before credentials/Docker prompts.
- [ ] **P0.3 — Soften `doctor` and `init` when Docker is absent** (prep for P1): report Docker as an *optional* check tied to the chosen mode rather than a hard failure. Files: [cli/src/index.ts:441-464](cli/src/index.ts#L441), [init-wizard.ts:348](cli/src/init-wizard.ts#L348).

### P1 — The big win: embedded, no-Docker local mode
The strategic centerpiece. Lets the local CLI run with just Node + Chromium.

- [ ] **P1.1 — Add a `local` execution mode** where `verfix run` drives Playwright **directly** (in-process, or one spawned worker child) with **no API, no Redis, no container**. Persist results to a local SQLite file or plain JSON under `.verfix/`.
- [ ] **P1.2 — Ship Playwright as a first-class CLI dependency** so `npx playwright install chromium` is a normal, cached step — deleting the `docker cp` + host `npm ci` extraction dance (~150 lines of the most fragile, network-dependent code, [worker-runner.ts](cli/src/worker-runner.ts)).
- [ ] **P1.3 — Extract the flow-execution engine into a shared library** (`workers/src/browser/*`, assertions) callable both (a) in-process by the local CLI and (b) by the BullMQ worker in the server. One engine, two entry points — this is what lets the server product reuse the work without forcing it on local.
- [ ] **P1.4 — Make Docker/server mode explicitly opt-in** (`--server` / `VERFIX_MODE=server`) for users who want the dashboard/timeline UI or are prototyping the CI product. Local mode becomes the default.

**Acceptance:** on a clean machine with only Node installed, `npx verfix init && verfix run --flow x` works in strict mode with no Docker, no API key, and a single Chromium download.

### P2 — Reduce weight & maintenance surface
- [ ] **P2.1 — Standardize on SQLite; retire the Postgres/full image** for the shipped product (keep Postgres only if/when the hosted multi-tenant server genuinely needs it — that's a server-side deployment detail, not something in the local image). Collapses most mode-branching.
- [ ] **P2.2 — Confine Redis/BullMQ to server mode.** Local mode needs neither. If local ever needs concurrency, use an in-process queue or a SQLite job table.
- [ ] **P2.3 — Collapse the double queue layer** (raw Redis list + BullMQ) in the server into a single BullMQ ingestion path. Have the Go API enqueue to BullMQ directly (or have the worker own ingestion) — [api/main.go:149](api/main.go#L149), [workers/src/index.ts:113](workers/src/index.ts#L113).

### P3 — Server product groundwork (defer until traction)
Do **not** build ahead of demand. Capture the intent so P1/P2 don't accidentally close the door on it.

- [ ] **P3.1 — Keep the API/queue/DB contract stable** so the same flow engine (P1.3) powers a hosted runner.
- [ ] **P3.2 — GitHub Action** that runs `verfix run` on push (can ship early using *local mode* — no server needed yet; this is a great wedge before the hosted backend exists).
- [ ] **P3.3 — Multi-tenant concerns** (auth, per-repo isolation, result storage, billing) — only once local adoption justifies it (~1–2k active users, per current plan).

---

## 6. Suggested sequencing

1. **P0.1 + P0.2** first — a few hours each, immediately removes the most-cited friction (AI key, time-to-value).
2. **P1.3** (extract the engine) — the enabling refactor; unblocks both P1.1 and the future server.
3. **P1.1 + P1.2** — the no-Docker local mode.
4. **P0.3 + P1.4** — flip defaults so local/no-Docker is the happy path, Docker is opt-in.
5. **P2** — trim images/DB/queue once local mode is proven and Docker is no longer the default.
6. **P3.2** (GitHub Action on local mode) — early monetization wedge that needs no backend.

**One-line north star:** local users should need only Node + a browser; Docker, Redis, the API, the AI key, and Postgres should all be opt-in behind either `assisted` mode or `--server` mode.