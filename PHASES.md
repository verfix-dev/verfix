# AI Verification Runtime — Phases & Roadmap

> **Core thesis:** Reliable verification runtime enhanced by AI — NOT an autonomous browser agent.
>
> Reliability emerges from structured contracts, not unconstrained intelligence.

---

## 🟢 Phase 1: Core Runtime (COMPLETED)

**Goal:** Build foundational infrastructure for reliable browser execution, artifact generation, and queue-based job orchestration.
**Status:** ✅ Completed

### Outcomes
- [x] Monorepo infrastructure (Docker Compose: Redis + PostgreSQL)
- [x] Verification API (Go/Fiber) — `POST /api/v1/verify`, `GET /api/v1/executions/:id`
- [x] Browser Worker (Node.js/Playwright) — isolated headless contexts, screenshot capture
- [x] Basic Dashboard (Next.js) — submit jobs, poll status
- [x] Artifact generation — screenshots saved to filesystem

### Gaps Identified (to address in Phase 2)
- No Playwright traces or HAR recordings
- No execution metadata (duration, memory, crash info)
- No structured assertion engine
- No CLI
- Results stored in Redis only (not persisted to Postgres)

---

## 🟢 Phase 2: Deterministic Verification + CLI (COMPLETED)

**Goal:** Build the real product foundation — structured assertions, traces, CLI, and the reliability engine that makes verification trustworthy.
**Status:** ✅ Completed

### Outcomes
- [x] **Assertion Engine** — 7 assertion types: `page_loaded`, `selector_visible`, `text_visible`, `url_contains`, `title_contains`, `no_console_errors`, `network_request_success`
- [x] **Rich Artifacts** — Playwright trace `.zip`, HAR, console logs `.json`, network logs `.json`, DOM snapshot `.html`, per-assertion failure screenshots
- [x] **Flow Executor** — Structured steps via `data-testid` → `selector` → text (deterministic-first)
- [x] **Reliability Engine** — DOM-stability waits (MutationObserver) + exponential backoff retries
- [x] **CLI** — `verfix run`, `verfix status <id>`, `verfix list`, `--output json` for CI
- [x] **Postgres** — Auto-migrated schema on boot, persistent execution history
- [x] **Dashboard** — Assertions tab, console tab, network tab, artifacts tab with inline screenshots
- [x] **API v2** — Structured payload (assertions, flows, selectors, metadata, mode), `GET /executions` list

### ✅ Phase 2 Testing Instructions

**Prerequisites:** `make up && make api` (terminal 1), `make worker` (terminal 2), `make ui` (terminal 3)

#### 1. Basic smoke test via CLI
```bash
cd cli && npx ts-node src/index.ts run --url https://example.com --output pretty
```
Expected: `page_loaded` ✅, `no_console_errors` ✅, screenshot + trace saved in `workers/artifacts/`

#### 2. Test a failing assertion (selector that doesn't exist)
```bash
cd cli && npx ts-node src/index.ts run \
  --url https://example.com \
  --config /dev/stdin <<'EOF'
{
  "url": "https://example.com",
  "assertions": [
    { "type": "selector_visible", "selector": "#nonexistent-element" },
    { "type": "no_console_errors" }
  ]
}
EOF
```
Expected: `selector_visible` ❌ with failure screenshot, overall FAILED

#### 3. Test structured API payload
```bash
curl -s -X POST http://localhost:3001/api/v1/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "task": "Verify example.com loads",
    "mode": "strict",
    "assertions": [
      { "type": "page_loaded" },
      { "type": "title_contains", "value": "Example" },
      { "type": "no_console_errors" }
    ]
  }' | jq .
```
Expected: `{ executionId: "exec_...", status: "queued" }`

#### 4. Poll execution result
```bash
# Replace EXEC_ID with the id from above
curl -s http://localhost:3001/api/v1/executions/EXEC_ID | jq '.passed, .assertions[].type, .assertions[].passed'
```

#### 5. Check Postgres persistence
```bash
docker exec verifycode-postgres-1 psql -U user -d verifydb -c 'SELECT id, task, status, passed, duration_ms FROM executions ORDER BY created_at DESC LIMIT 5;'
```

#### 6. Verify artifacts were written
```bash
ls -lh workers/artifacts/ | tail -20
```
Expected: `.png`, `.har`, `_trace.zip`, `_console.json`, `_network.json`, `.html` files per execution

#### 7. Test CLI list command
```bash
cd cli && npx ts-node src/index.ts list
```

#### 8. Test JSON output for CI
```bash
cd cli && npx ts-node src/index.ts run --url https://example.com --output json; echo "Exit: $?"
```
Expected: full JSON result + exit code 0 (pass) or 1 (fail)

---

## 🟢 Phase 3: Reports + Observability + Reliability (COMPLETED)

**Goal:** Build operational excellence — execution metrics, flaky detection, browser pooling, concurrency control, multi-page dashboard.
**Status:** ✅ Completed

### Outcomes
- [x] **Metrics API** — `GET /api/v1/metrics` with pass rate, avg/p95 duration, 7-day trend, top failing URLs
- [x] **Health API** — `GET /api/v1/health` with Redis, Postgres, queue depth, active worker status
- [x] **Flaky Detection** — `GET /api/v1/flaky` detects URLs with inconsistent pass/fail results
- [x] **Execution Filtering** — `GET /api/v1/executions?status=failed&url=...&limit=20`
- [x] **DB Sync** — Worker results auto-synced from Redis → Postgres on read
- [x] **Browser Pool** — Single reusable browser with isolated contexts per job (no cold-start per job)
- [x] **Concurrency Control** — `MAX_CONCURRENCY` env var controls parallel job limit
- [x] **Browser Crash Recovery** — Auto-relaunch on disconnect
- [x] **Graceful Shutdown** — SIGTERM/SIGINT closes pool cleanly
- [x] **Metrics Dashboard** — `/metrics` page: 8 KPI cards, 7-day bar chart, top failing URLs
- [x] **Flaky Dashboard** — `/flaky` page: inconsistent URLs with flake rate visualization
- [x] **Nav Bar** — Multi-page routing: Dashboard / Metrics / Flaky
- [x] **DB Indexes** — `status`, `url`, `created_at` indexed for query performance

### ✅ Phase 3 Testing Instructions

**Prerequisites:** `make up && make api` (terminal 1), `make worker` (terminal 2), `make ui` (terminal 3)

#### 1. Health check
```bash
curl -s http://localhost:3001/api/v1/health | jq .
```
Expected: `status: "healthy"`, Redis and database both `ok`

#### 2. Run several jobs to populate metrics
```bash
# Pass
curl -s -X POST http://localhost:3001/api/v1/verify \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","task":"Pass run"}' | jq .executionId

# Fail (bad selector)
curl -s -X POST http://localhost:3001/api/v1/verify \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","task":"Fail run","assertions":[{"type":"selector_visible","selector":"#does-not-exist"}]}' | jq .executionId
```

#### 3. Check metrics API
```bash
curl -s http://localhost:3001/api/v1/metrics | jq '{pass_rate: .metrics.pass_rate, total: .metrics.total_executions, flaky: .metrics.flaky_url_count, trend: .daily_trend}'
```

#### 4. Filter executions by status
```bash
curl -s 'http://localhost:3001/api/v1/executions?status=failed&limit=5' | jq '.executions[].task'
curl -s 'http://localhost:3001/api/v1/executions?status=completed' | jq '.total'
```

#### 5. Check Postgres has indexes
```bash
docker exec verifycode-postgres-1 psql -U user -d verifydb -c '\d executions'
```
Expected: indexes on `status`, `url`, `created_at`

#### 6. Test concurrent jobs (browser pool)
```bash
# Submit 3 jobs simultaneously
for i in 1 2 3; do
  curl -s -X POST http://localhost:3001/api/v1/verify \
    -H 'Content-Type: application/json' \
    -d "{\"url\":\"https://example.com\",\"task\":\"Concurrent job $i\"}" &
done
wait
```
Expected: Worker logs show all 3 run concurrently, browser NOT relaunched between jobs

#### 7. Flaky detection (run same URL with both pass and fail assertions)
```bash
# Run pass first
curl -s -X POST http://localhost:3001/api/v1/verify \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","assertions":[{"type":"page_loaded"}]}' > /dev/null

# Run fail on same URL
curl -s -X POST http://localhost:3001/api/v1/verify \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","assertions":[{"type":"selector_visible","selector":"#fake"}]}' > /dev/null

# Wait ~10s for both to complete, then:
sleep 10 && curl -s http://localhost:3001/api/v1/flaky | jq '.flaky[] | {url, flake_rate, pass_count, fail_count}'
```
Expected: `example.com` appears with `flake_rate: 50`

#### 8. Dashboard pages
- **Dashboard:** http://localhost:3000 — Submit jobs, watch live results
- **Metrics:** http://localhost:3000/metrics — KPI cards + 7-day chart
- **Flaky:** http://localhost:3000/flaky — Inconsistent URL list

#### 9. Verify browser pool reuse (check worker logs)
Expected: `🌐 Browser pool: browser launched` appears **once**, NOT before every job.

---

## 🟡 Phase 4: AI-Assisted Exploration & Recovery (NEXT)

**Goal:** Add AI as an **async augmentation layer** and build a separate **Exploration Runtime** — without coupling correctness to LLM reliability.
**Status:** ⏳ In Progress

> **Architectural principle:** AI enhances and discovers. It never owns the source of truth. Deterministic assertions + raw artifacts are always canonical. AI summaries are convenience layers.

### Dual-Runtime Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    VerifyCode Runtime                        │
│                                                              │
│  ┌─────────────────────────┐  ┌──────────────────────────┐  │
│  │   VERIFICATION RUNTIME  │  │   EXPLORATION RUNTIME    │  │
│  │   (strict / assisted)   │  │   (exploratory mode)     │  │
│  │                         │  │                          │  │
│  │  • Deterministic        │  │  • Natural language      │  │
│  │  • Structured contracts │  │  • LLM step planning     │  │
│  │  • Assertion-driven     │  │  • Adaptive navigation   │  │
│  │  • Repeatable           │  │  • Discovery-optimized   │  │
│  │  • CI/CD safe           │  │  • NOT production-grade  │  │
│  └────────┬────────────────┘  └───────────┬──────────────┘  │
│           │                               │                  │
│           └───────────┬───────────────────┘                  │
│                       ▼                                      │
│         ┌──────────────────────────┐                         │
│         │  CANONICAL OUTPUT        │                         │
│         │  (Layer 1 — always)      │                         │
│         │  assertions + artifacts  │                         │
│         │  + traces + logs         │                         │
│         └──────────┬───────────────┘                         │
│                    ▼                                         │
│         ┌──────────────────────────┐                         │
│         │  AI INTERPRETATION       │                         │
│         │  (Layer 2 — optional)    │                         │
│         │  failure summaries       │                         │
│         │  root cause analysis     │                         │
│         │  retry suggestions       │                         │
│         └──────────────────────────┘                         │
└──────────────────────────────────────────────────────────────┘
```

### 4A — Async Failure Summarization (Layer 2)

Runs AFTER execution completes. Never blocks canonical results.

- [ ] LLM analyzes console logs + network logs + DOM snapshot + screenshots
- [ ] Produces human-readable root cause explanation
- [ ] Stored as `ai_summary` field alongside (not replacing) raw data
- [ ] API: `GET /api/v1/executions/:id` includes `ai_summary` when available
- [ ] Dashboard: "AI Analysis" tab shows summary with confidence indicator
- [ ] Provider-agnostic: works with OpenAI, local Ollama, or any compatible API

Example output:
```json
{
  "ai_summary": {
    "likely_root_cause": "React hydration mismatch after SSR — server rendered login form but client-side auth redirect fired before hydration completed",
    "evidence": [
      "Console error: 'Hydration failed because the server rendered HTML...'",
      "Network: 302 redirect to /dashboard at 240ms, before DOMContentLoaded at 380ms"
    ],
    "suggested_fix": "Add Suspense boundary around auth-dependent components or defer redirect until after hydration",
    "confidence": 0.82
  }
}
```

### 4B — Self-Healing Selectors (Assisted Mode Enhancement)

When a deterministic selector fails in `assisted` mode, try recovery before declaring failure.

```
Attempt 1 — Exact selector (data-testid, CSS)
  ↓ fails
Attempt 2 — Semantic discovery (aria-label, role, text content)
  ↓ fails
Attempt 3 — AI fallback (LLM analyzes page DOM, suggests alternative)
  ↓ fails
FAIL — report all three attempts in assertion result
```

- [ ] `SemanticResolver` — finds elements by accessibility tree + text
- [ ] `AIResolver` — LLM analyzes DOM snapshot and suggests selector
- [ ] Each attempt is logged with timing in assertion `details`
- [ ] Healing only activates in `assisted` mode (never in `strict`)

### 4C — Exploration Runtime (Separate Execution Path)

A fundamentally different system optimizing for **discovery and flexibility** rather than production reliability.

- [ ] Accepts natural language task: `"Find the settings page and check dark mode toggle works"`
- [ ] LLM generates step-by-step plan from page context
- [ ] Adaptive: re-plans if steps fail, tries alternatives
- [ ] Captures same canonical artifacts as verification runtime
- [ ] Results are clearly marked as `mode: "exploratory"` — not CI-grade
- [ ] Separate API endpoint or mode flag to prevent accidental misuse

### 4D — AI-Suggested Assertions

After navigating to a URL, LLM analyzes the page and suggests what to verify.

- [ ] `POST /api/v1/suggest-assertions` — given URL, returns suggested assertion schema
- [ ] Dashboard: "Suggest" button auto-populates assertions
- [ ] Suggestions ranked by reliability (deterministic selectors first)

### Mode Definitions (Formalized)

| Mode | Selector Strategy | AI Usage | Reliability | Best For |
|------|------------------|----------|-------------|----------|
| **strict** | testId → CSS only | None | ★★★★★ | CI/CD, regression |
| **assisted** | testId → semantic → AI fallback | Recovery only | ★★★★☆ | Semi-structured apps |
| **exploratory** | AI-planned | Core driver | ★★☆☆☆ | Discovery, ad-hoc QA |

---

## ⚪ Phase 5: CI/CD + Agent Integrations

**Goal:** Integrate the verification runtime into developer and AI agent workflows — becoming core infrastructure.
**Status:** ⚪ Planned

### Outcomes

#### CI/CD
- [ ] GitHub Action for PR verification
- [ ] GitLab CI integration
- [ ] Webhook notifications on pass/fail

#### Agent SDKs
- [ ] JavaScript SDK: `await verify({ url, assertions })`
- [ ] Agent framework integrations (LangGraph, CrewAI, OpenAI Agents)
- [ ] Cursor / Claude Code integration patterns

#### Application Instrumentation (Future Moat)
- [ ] `npm install @verify/runtime` for app developers
- [ ] `<VerifyTarget id="login-submit">` component for React
- [ ] AI-friendly UI instrumentation that makes verification reliable
- [ ] Verification contracts — apps expose structured flow definitions

---

## Reliability Stack (Cross-Cutting)

This is the **core technical problem** of the company. Not a minor detail.

```
1. Stable identifiers (data-testid, aria-label)
2. Deterministic assertions (structured schema)
3. Semantic element resolution (accessibility tree)
4. Smart retries & wait strategies
5. AI fallback reasoning (only when needed)
```

### Real-World Challenges This Must Handle
- Brittle selectors & dynamic UIs
- Hydration timing & React rerenders
- Shadow DOM & Web Components
- Animations & transitions
- Infinite loading states & streaming UI
- Virtualized lists
- Suspense boundaries & async hydration

### API Philosophy: Declarative > Imperative

**Bad (imperative):**
```json
{ "task": "click login, type email, click submit" }
```

**Good (declarative):**
```json
{
  "goal": "user successfully logs in",
  "url": "http://localhost:3000/login",
  "flows": [
    {
      "name": "login",
      "steps": [
        { "action": "type", "target": { "testId": "email-input" }, "value": "test@example.com" },
        { "action": "type", "target": { "testId": "password-input" }, "value": "password123" },
        { "action": "click", "target": { "testId": "login-submit" } }
      ]
    }
  ],
  "assertions": [
    { "type": "url_contains", "value": "/dashboard" },
    { "type": "selector_visible", "selector": "[data-testid='dashboard-root']" },
    { "type": "no_console_errors" }
  ],
  "metadata": {
    "framework": "nextjs",
    "authProvider": "clerk"
  },
  "mode": "strict"
}
```

The engine decides execution strategy. The caller provides structured context.

> **Reliability comes from structured contracts, not unconstrained intelligence.**
