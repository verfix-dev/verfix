# Verfix — Target Architecture (Local no-Docker + Future Server)

> Companion to [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md). Diagrams for the
> two target surfaces and the roadmap/decisions you should know before building.
> Written 2026-07-01.

---

## Key enabling fact

The worker's `processJob` ([workers/src/index.ts:140](workers/src/index.ts#L140)) is effectively a
**pure function**: `(page, jobData) → ExecutionResult`. It acquires a browser,
navigates, and then branches on `mode`:

- **exploratory** → `runExploration(page, task)` ([workers/src/ai/exploration.ts](workers/src/ai/exploration.ts)) — AI drives.
- **strict / assisted** → `executeFlow()` + `runAssertions()` ([workers/src/browser/flow-executor.ts](workers/src/browser/flow-executor.ts)).

**All AI calls (self-healing, exploration, the provider adapters) already run
in-process inside the `workers` package and call the provider's HTTPS API
directly** ([workers/src/ai/adapters/](workers/src/ai/adapters/)). Redis, the Go API, and the
container are pure *transport* around this pure function — none of them is
required by any of the three modes. That is what makes a no-Docker local mode a
repackaging job, not a rewrite.

**Linchpin task (P1.3 in the review):** extract `browser/` + `assertions/` + `ai/`
into a single `@verfix/engine` library with one entry point:

```
runVerification(jobData, { onEvent }) → Promise<ExecutionResult>
```

Both surfaces below call the *same* engine. Only the transport differs.

---

## Surface A — Local mode (no Docker) — TARGET

Everything is one Node process. No container, no Redis, no HTTP API, no Postgres.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Developer machine (macOS / Windows / Linux) — one `verfix run` process     │
│                                                                            │
│   verfix run --flow login                                                  │
│        │                                                                   │
│        ▼                                                                   │
│   ┌─────────────┐     reads      ┌────────────────────┐                    │
│   │  CLI (TS)   │───────────────▶│ verfix.config.json │                    │
│   │  commander  │                └────────────────────┘                    │
│   └─────┬───────┘                                                          │
│         │ in-process call: runVerification(jobData, {onEvent})             │
│         ▼                                                                   │
│   ┌─────────────────────────────  @verfix/engine  ─────────────────────┐   │
│   │                                                                     │   │
│   │   Playwright (host Chromium)  ──drives──▶  ┌──────────────────┐     │   │
│   │        ▲                                    │  YOUR APP        │     │   │
│   │        │  navigate / click / type / assert  │  localhost:3000  │◀────┼───┼── native
│   │        │                                    └──────────────────┘     │   │   localhost
│   │        │                                                             │   │   (no URL
│   │   ┌────┴───────── mode branch ───────────────┐                       │   │   rewrite,
│   │   │ strict     assisted        exploratory    │                       │   │   no proxy)
│   │   │  │           │                  │         │                       │   │
│   │   │  │ deterministic  │ heal on miss    │ AI plans+acts             │   │
│   │   │  │ selectors      │ (aria/role/text │ each step                 │   │
│   │   │  ▼                ▼   → AI fallback)▼                            │   │
│   │   │  (no AI)      ┌───────────────────────────┐                     │   │
│   │   │               │  AI adapter (in-process)  │──HTTPS──▶ OpenAI /   │   │
│   │   │               │  ai/adapters/*, self-heal │           Anthropic/│   │
│   │   │               └───────────────────────────┘           Gemini    │   │
│   │   └───────────────────────────────────────────┘                     │   │
│   └─────────────────────────────┬───────────────────────────────────────┘   │
│                                  │ ExecutionResult + events + trace           │
│                                  ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────┐    │
│   │  Local artifacts:  .verfix/runs/<id>.json   (structured result)      │    │
│   │                    .verfix/runs/<id>.zip    (Playwright trace)       │    │
│   └────────────────────────────────────────────────────────────────────┘    │
│                                  │                                            │
│                                  ▼  stdout (JSON contract) → the AI agent      │
│   { "passed": true, "failures": [], "fix_hint": "...", "exit_code": 0 }        │
└──────────────────────────────────────────────────────────────────────────┘

Dependencies for this whole picture:  Node 20+  ·  one Chromium download.
No Docker · no Redis · no Postgres · no Go binary · AI key only for assisted/exploratory.
```

### How each mode behaves in local mode

| Mode | AI key? | Network out | What runs |
|------|---------|-------------|-----------|
| **strict** | ❌ none | none (fully offline except your app) | Deterministic selectors + assertions. This is the CI default. |
| **assisted** | ✅ required | provider HTTPS only on selector miss | Deterministic first; if a selector fails to resolve, heal via accessibility tree (aria/role/text), then AI as last resort. |
| **exploratory** | ✅ required | provider HTTPS per reasoning step | AI navigates and verifies from a natural-language task. |

**Design consequence:** the AI key must be lazy (review P0.1). A strict-only user
never provides one and the tool is fully functional offline.

### Timeline / observability in local mode
You do **not** need the Next.js dashboard for local. Playwright already produces a
trace; ship `verfix show <id>` that shells out to the built-in
**`playwright show-trace <id>.zip`** viewer. That deletes the entire dashboard
container from the local path while giving a *richer* timeline than the current
custom UI. (Keep the Next.js dashboard for the hosted product in Surface B.)

---

## Surface B — Server mode (future hosted CI product)

Same `@verfix/engine`, wrapped in the multi-tenant transport you have already built.
This is where the current Docker/Redis/API/Postgres stack lives — kept, not deleted.

```
   Developer pushes code
          │
          ▼
   ┌─────────────────────┐        ┌──────────────────────────────────────────────┐
   │ GitHub Action /      │  HTTPS │              Verfix Cloud (hosted)            │
   │ verfix run --server  │───────▶│                                              │
   │ (thin client)        │  auth  │  ┌────────────┐   enqueue   ┌──────────────┐ │
   └─────────────────────┘  token  │  │ Go API     │────────────▶│ Redis /      │ │
                                    │  │ (Fiber)    │             │ BullMQ queue │ │
                                    │  │ multi-     │◀────────────│              │ │
                                    │  │ tenant     │   status    └──────┬───────┘ │
                                    │  └─────┬──────┘                    │ pull    │
                                    │        │ persist                   ▼         │
                                    │        ▼               ┌───────────────────┐ │
                                    │  ┌──────────┐          │ Worker pool        │ │
                                    │  │ Postgres │◀─────────│ (containers, each  │ │
                                    │  │ (multi-  │  results │  runs @verfix/     │ │
                                    │  │  tenant) │          │  engine + Chromium)│ │
                                    │  └────┬─────┘          └─────────┬─────────┘ │
                                    │       │                          │ drives    │
                                    │       ▼                          ▼           │
                                    │  ┌──────────────┐    ┌────────────────────┐  │
                                    │  │ Next.js      │    │ Preview / staging   │  │
                                    │  │ dashboard    │    │ deploy of the PR    │  │
                                    │  │ (timelines)  │    └────────────────────┘  │
                                    │  └──────────────┘                            │
                                    │  + auth · billing · per-repo isolation · RBAC│
                                    └──────────────────────────────────────────────┘

This is exactly today's docker-slim/full architecture, promoted to multi-tenant
and hosted. The double queue layer (raw Redis list + BullMQ) should collapse to
one BullMQ path here (review P2.3).
```

### Why today's `host` (docker-slim) mode is the closest bridge
You're right that docker-slim is the nearest ancestor of local mode. In slim mode
the browser already runs natively on the host; the container only carries
API+Redis+SQLite+dashboard. Local mode = **slim mode with the container removed and
the API replaced by an in-process function call.** The migration is subtractive:

```
docker-slim (today)                    local (target)
─────────────────────                  ─────────────────
host Chromium worker        ─keep─▶     host Chromium (in-process engine)
container: Go API           ─drop─▶     in-process runVerification()
container: Redis + BullMQ   ─drop─▶     direct function call (no queue)
container: SQLite           ─drop─▶     .verfix/runs/*.json (or local SQLite)
container: Next dashboard   ─swap─▶     playwright show-trace
docker cp + host npm ci     ─drop─▶     Playwright as a direct CLI dependency
localhost→host.docker.internal ─drop─▶  native localhost (no rewrite)
```

Every arrow marked `drop` is a deletion of friction, not a feature loss — because
none of it is used by the pure verification function.

---

## Roadmap / things you should know

### Sequencing (from the review, with the engine split made explicit)
1. **P0.1 lazy AI key + P0.2 reorder init** — hours; removes the loudest friction now.
2. **P1.3 extract `@verfix/engine`** — the enabling refactor. Do this before P1.1;
   both surfaces depend on it. Keep the engine transport-agnostic (no Redis/env
   assumptions; take `jobData` in, emit events via a callback).
3. **P1.1 + P1.2 local mode** — call the engine in-process; Playwright as a direct
   dep; results to `.verfix/runs/`.
4. **P0.3 + P1.4 flip defaults** — local/no-Docker is the happy path; `--server`
   (or `VERFIX_MODE=server`) opts into the container/hosted stack.
5. **P2 trim** — SQLite-only local, Redis/BullMQ server-only, collapse double queue.
6. **P3.2 GitHub Action on local mode** — early monetization wedge that needs *no*
   backend: the Action just runs `verfix run` in strict mode and posts results.

### Decisions to make deliberately
- **Chromium distribution.** Default to Playwright's managed Chromium download
  (~120–170MB, cached in `~/.cache/ms-playwright`). Offer `channel: 'chrome'` in
  config to reuse an already-installed Chrome and skip the download entirely — a
  meaningful friction cut for many users.
- **Where the engine lives.** Publish `@verfix/engine` as its own package (or a
  clearly-bounded internal module) so the CLI can `import` it without the current
  `docker cp` extraction. This deletes the most fragile ~150 lines in the repo
  ([cli/src/worker-runner.ts](cli/src/worker-runner.ts)).
- **Local result store.** Plain JSON files under `.verfix/runs/` are enough to
  start. Only add local SQLite if you want `verfix history`/querying. Don't couple
  local to a DB engine.
- **In-process vs child process.** Run the engine in-process for simplicity. Only
  spawn a child worker if you later need parallel flows locally; even then a simple
  worker-thread pool beats reintroducing Redis.
- **Concurrency.** Local mode runs one flow at a time by default — that matches the
  agent's edit→verify loop. Batch/parallel is a server-mode concern.
- **Backwards compatibility.** Keep `verfix.config.json` byte-for-byte compatible
  across local and server so a project can graduate from local to CI with no config
  change. This is a selling point of the eventual paid product.
- **Telemetry & offline.** Strict local mode should make zero outbound calls except
  to the user's app. Make sure telemetry ([cli/src/telemetry.ts](cli/src/telemetry.ts)) stays
  opt-out and never blocks a run — critical for air-gapped/CI trust.

### Risks / watch-items
- **The engine still imports `ioredis`/`bullmq` transitively** ([workers/src/index.ts](workers/src/index.ts)).
  The extraction must cut those imports out of the engine module, or local mode
  drags Redis client code (and connection attempts) back in. Verify the engine
  builds and runs with **no Redis env vars set**.
- **Artifact paths & `resolveTargetUrl`** assume container/bind-mount conventions
  ([workers/src/index.ts:210](workers/src/index.ts#L210)). Local mode must skip the
  `host.docker.internal` rewrite entirely.
- **`Date.now()`/timers** and headful `--show-browser` behavior should be re-tested
  natively on Windows specifically (the current path was shaped by Docker quirks).
- **Don't build Surface B ahead of demand.** Ship the GitHub Action on local mode
  first; only stand up the hosted multi-tenant backend when adoption (~1–2k active
  users, per plan) justifies the operational cost.

### North star
> Local users need only **Node + a browser**. Docker, Redis, the Go API, Postgres,
> the Next.js dashboard, and even the AI key are all opt-in — behind `assisted`
> mode or `--server` mode. The same `@verfix/engine` powers both the free local CLI
> and the future paid CI runner.
