# Verfix Local-First: What We Did, In Plain Words

This document explains the local-first refactor (branch `feat/architecture`) in
simple terms: **what it was before, what it is now, and why**. It's the
companion to `ARCHITECTURE_REVIEW.md` (the problems) and
`ARCHITECTURE_TARGET.md` (the goal).

---

## The one-sentence summary

**Before**, running one browser check required Docker, a Go API server, Redis,
a queue, a database, and a dashboard. **Now**, `verfix run` just opens a browser
on your machine, checks your app, and writes the result to a file — all it
needs is Node.js.

---

## Before vs. After

### What happened when you ran `verfix run`

**Before (0.2.x):**

```
verfix run
  → CLI sends an HTTP request to the Go API (in Docker, port 3611)
  → API pushes the job into a Redis queue (in Docker)
  → A worker process picks up the job from the queue
  → The worker launches Playwright and runs your flow
  → The result is written to Postgres/SQLite (in Docker)
  → The CLI polls the API every 2 seconds until the result appears
  → You open the dashboard (port 3610) to see what happened
```

Seven moving parts to click one button. If Docker wasn't running, nothing
worked. On macOS/Windows there was an extra "hybrid mode" where workers ran on
your machine but talked to Redis in the container — a whole class of networking
bugs existed just to make `localhost` work.

**Now (0.3.0):**

```
verfix run
  → CLI calls the verification engine directly, in the same process
  → The engine launches Playwright and runs your flow
  → Result + a full trace recording are saved to .verfix/runs/
  → The CLI prints the JSON result
```

One process. No Docker, no Redis, no API, no polling, no networking layer.

### Setting up a new project

**Before:**

```bash
npx verfix init
# 1. asks for an AI API key (even if you never use AI)   ← blocker #1
# 2. requires Docker running                              ← blocker #2
# 3. pulls a ~1GB Docker image (~2 min)                   ← blocker #3
# 4. starts the container, waits for health checks
# 5. finally writes your config
```

**Now:**

```bash
npx verfix init
# 1. detects your app's URL
# 2. asks for the mode — default "strict" needs NO AI key
# 3. downloads Chromium once if you don't have it (~130MB, cached forever)
# 4. writes your config + agent instructions. Done.
```

And non-interactively, this now works on a completely clean machine with zero
credentials:

```bash
npx verfix init --yes && npx verfix run --flow login --output json
```

### Seeing what the browser did

**Before:** every result had a `timeline_url` pointing at the Next.js dashboard
(`http://localhost:3610/...`) — which only worked while the container was up.

**Now:** every run records a **Playwright trace** (screenshots of every step,
every network request, every console message). Open it any time, even weeks
later:

```bash
verfix show                 # newest run
verfix show exec_abc123     # a specific run
verfix list                 # see recent runs
```

A hosted dashboard (create an account, connect the CLI, see all runs in the
cloud) is a **future product** — that's why the dashboard was removed from the
local path rather than kept half-alive.

### The JSON output agents read

**Before:**

```json
{
  "passed": false,
  "failures": [{ "type": "selector_not_found", "fix_hint": "..." }],
  "timeline_url": "http://localhost:3610/?executionId=exec_abc123",
  "exit_code": 1,
  "execution_id": "exec_abc123"
}
```

**Now (local mode — note nothing was renamed, only added):**

```json
{
  "passed": false,
  "failures": [{ "type": "selector_not_found", "fix_hint": "..." }],
  "timeline_url": null,
  "trace_path": "/your/project/.verfix/runs/exec_abc123_trace.zip",
  "show_command": "verfix show exec_abc123",
  "exit_code": 1,
  "execution_id": "exec_abc123"
}
```

`timeline_url` stays in the contract (so nothing that parses the output breaks)
but is `null` locally. Two new fields point at the recorded trace. Existing
`verfix.config.json` files need **zero changes**.

---

## Why we did it

From `ARCHITECTURE_REVIEW.md`, the core finding was: **the local CLI forced
every user through the future hosted product's control plane.** Concretely:

1. **Adoption friction.** "Install Docker, keep it running, pull 1GB, and give
   me an OpenAI key" is a lot to ask before the tool has proven any value.
   Strict mode never even calls AI — demanding a key for it was pure friction.
2. **Reliability.** Every extra service is something that can be down. Most
   Verfix bug reports were networking/Docker issues (hence the whole
   `docker-networking.md` guide and hybrid mode's "troubleshooting history").
3. **Weight.** ~1GB image + Postgres + Redis + two queue layers to run a
   15-second browser check that a single process can do.
4. **The dashboard's real future is hosted.** Keeping a local Next.js app alive
   just to view timelines wasn't worth the runtime cost; Playwright's trace
   viewer is better for local debugging anyway (it's the industry-standard tool
   and shows more detail).

The enabling discovery: the verification engine was already ~90% independent —
all the Redis/queue code lived in one file. So we could repackage it instead of
rewriting it.

---

## What we actually built (the 5 phases)

### Phase 0 — Strict by default, AI key only when needed
`verfix init` now defaults to **strict** mode and only asks for an AI
provider/key if you pick assisted or exploratory. `init --yes` completes with
zero credentials.

### Phase 1 — Extracted the engine as `@verfix/engine`
The `workers/` package got a clean entry point:

```ts
import { runVerification, shutdownEngine } from '@verfix/engine';
const result = await runVerification(payload, { artifactsDir, headless: true });
```

It imports **zero** transport code (no Redis, no BullMQ) — a test enforces
this. The old worker (`workers/src/index.ts`) became a thin queue adapter that
calls the same function, so server mode behaves exactly as before.

### Phase 2 — The local runner
`cli/src/local-runner.ts` calls the engine in-process, saves results and traces
to `.verfix/runs/` (newest 20 runs kept), and mirrors the server's retry rules
(crashes retry, assertion failures don't). Added `verfix show` to open traces.
Subtle but important: the CLI resolves Playwright *through the engine's own
dependency*, so the browser we check for and the browser the engine launches
can never be different versions.

### Phase 3 — Flipped the default
`VERFIX_RUNNER` now defaults to `local`. Every runtime command grew a
`--server` flag that restores the old Docker behavior. In local mode:

| Command | Before (0.2.x) | Now (local default) |
|---|---|---|
| `verfix run` | submit to API + poll | run in-process |
| `verfix start` / `stop` | manage the container | "local mode needs no runtime" (use `--server`) |
| `verfix status` | Docker/API/dashboard health | config + Chromium + last run |
| `verfix logs` | container logs | points at `.verfix/runs/` |
| `verfix doctor` | **failed without Docker** | passes on a Docker-less machine; Docker is a gray "optional" line |
| `verfix update` | pull new image | npm update hint |
| `verfix show` | — (didn't exist) | opens the Playwright trace viewer |

The generated agent instructions (`AGENTS.md` / `.verfix/INSTRUCTIONS.md`) were
updated to teach agents `verfix show` and `timeline_url: null`. Upgrading users
with an old container get a one-time notice telling them
`verfix stop --server` reclaims it.

### Phase 4 — Deleted the hybrid mode
`cli/src/worker-runner.ts` (368 lines that extracted worker code from the
container, managed a PID file, and juggled `VERFIX_BROWSER_MODE`) is **gone**,
along with every host/container branch. Local mode does natively what hybrid
mode was invented to approximate: run the browser on your machine so
`localhost` just works. Server mode is now container-only and simpler.

---

## What did NOT change

- **`verfix.config.json`** — byte-identical across local/CI/server. No migration.
- **The failure taxonomy** (`selector_not_found`, `console_error`, …) and
  `fix_hint`s — agents' pattern-matching keeps working.
- **Server mode itself** — the Go API, Redis queue, workers container, and
  dashboard all still work, opt-in via `--server`. This is the seed of the
  future hosted CI product.
- **The philosophy** — deterministic first; AI is a fallback, never the default.

## New things you can use

```bash
# Optional: reuse your installed Chrome instead of downloading Chromium
# (in verfix.config.json)
{ "browser": { "channel": "chrome" } }

# Force a specific runner without flags (e.g. in CI or .verfix/.env)
VERFIX_RUNNER=server verfix run --output json
```

---

## Still to do before release

1. ✅ Done — `@verfix/engine@0.1.0` is published; the CLI now depends on
   `^0.1.0`, and the repo uses npm workspaces so local dev still live-links the
   `workers/` package. (The published tarball carries `^0.1.0`, not `file:`.)
2. Bump the CLI to `0.3.0` (the `timeline_url: null` behavior change warrants
   the minor bump + changelog).
3. Re-verify the server Docker image builds (`docker build -f
   Dockerfile.server-slim .`) since the workers package layout changed.
