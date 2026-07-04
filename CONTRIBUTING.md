# Contributing to Verfix

Thank you for your interest in contributing! Verfix is actively developed and welcomes contributions of all sizes — from fixing a typo in docs to building new assertion types or CLI commands.

**Before opening a PR**, please read this guide once. It will save you time and help us review faster.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Architecture Overview](#architecture-overview)
- [Core Philosophy](#core-philosophy)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
  - [Full Stack (all services)](#full-stack-all-services)
  - [CLI Only (most common)](#cli-only-most-common)
- [Contributing to the CLI](#contributing-to-the-cli)
- [Project Structure](#project-structure)
- [Good First Issues](#good-first-issues)
- [Failure Taxonomy](#failure-taxonomy)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Issue Labels](#issue-labels)

---

## Code of Conduct

Be respectful. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Harassment, discrimination, or hostile behaviour toward contributors will not be tolerated.

---

## Architecture Overview

Understanding how the pieces fit will make any contribution faster:

```
Local mode (the default — what `verfix run` does):
  CLI (npm: verfix)
    └── calls in-process →
          @verfix/engine (workers/ package, Playwright)
            └── writes results + trace to →
                  <project>/.verfix/runs/   →   CLI output (verfix show <id>)

Server mode (opt-in via --server, future hosted CI product):
  CLI → API (Go + Fiber, :3611) → Redis (BullMQ) → Workers (container)
        → PostgreSQL → API → CLI output + Dashboard (Next.js, :3610)
```

### Networking Layer (server mode only)

Local mode has no Docker networking: the browser runs in the CLI process and
reaches `localhost` natively. In server mode, workers run inside the container
(container-only — the old hybrid host-worker mode was removed):

| Platform | Strategy |
|----------|----------|
| **Linux** | `--network=host` — container shares host network namespace (IPv4 + IPv6) |
| **macOS/Windows** | Bridge + `host.docker.internal` alias provided by Docker Desktop |
| **Linux (manual run)** | `/etc/hosts` injection via `ip route` at container startup |

See [`docs/4-guides/docker-networking.md`](docs/4-guides/docker-networking.md)
for the full technical breakdown. **Read it before touching any of:**
`cli/src/docker.ts`, `cli/src/index.ts` (resolveJobUrl),
`scripts/server-start.sh`, `scripts/server-start-slim.sh`, `Dockerfile.server`,
`Dockerfile.server-slim`.

| Package | Language | Role |
|---------|----------|------|
| `cli/` | TypeScript | npm package `verfix` — flow runner (local + server), init wizard, `verfix show` |
| `api/` | Go (Fiber) | HTTP API — job ingestion, queue dispatch, execution state (server mode) |
| `workers/` | TypeScript (Playwright) | npm package `@verfix/engine` — browser execution engine (flows, assertions, AI healing); `src/index.ts` is the BullMQ adapter for server mode |
| `dashboard/` | Next.js | Execution timeline observability UI (server mode) |
| `sdk/` | TypeScript | Thin programmatic wrapper around the CLI JSON contract |

---

## Core Philosophy

**Deterministic first.** Never reach for an LLM when a selector, assertion, or retry can solve the problem. AI is a fallback for resilience, not a substitute for good engineering.

**Observability is a feature.** If an execution fails silently or emits a generic error, that is a bug. Every failure must have a stable `type` from the failure taxonomy and a useful `fix_hint`.

**Local first.** The entire stack must run on a developer's laptop with a single command. Nothing in the critical path requires a cloud service.

**Agent-compatible output.** CLI JSON outputs must be parseable and stable. Agents depend on field names never changing without a major version bump.

---

## Prerequisites

- Node.js 20+
- [Docker Desktop](https://docs.docker.com/get-docker/) *(only needed for server-mode changes — the default local path needs no Docker)*
- Go 1.22+ *(only needed for `api/` changes)*
- `make` *(optional, convenience targets in Makefile)*

---

## Local Development Setup

### Full Stack (all services)

Use this if you're working on `api/`, `workers/`, or `dashboard/`:

```bash
git clone https://github.com/verfix-dev/verfix.git
cd verfix

# Install Node.js dependencies for the workspace packages (cli, workers, sdk).
# npm workspaces live-links @verfix/engine (workers) into the cli automatically.
npm install
# Dashboard is kept outside the workspace set — install it separately.
npm install --prefix dashboard

# Start Postgres + Redis via Docker Compose
make up
# or: docker compose up -d postgres redis

# Start each service in a separate terminal
make api        # Go API server on :3611
make workers    # Playwright workers (connects to Redis)
make dashboard  # Next.js dashboard on :3610
```

Verify the full stack is working:

```bash
cd cli
npx ts-node src/index.ts run \
  --config ../testbed/verfix.config.json \
  --flow login \
  --output json
```

`"passed": true` with a `timeline_url` means everything is connected.

> **Networking note:** The CLI automatically uses `--network=host` on Linux
> and bridge mode on Mac/Windows. If tests fail with connection errors, see
> [`docs/4-guides/docker-networking.md`](docs/4-guides/docker-networking.md).

### CLI Only (most common)

If you're only working on the CLI (commands, init wizard, output formatting), you can use the pre-built Docker image instead of running the full stack locally:

```bash
git clone https://github.com/verfix-dev/verfix.git
cd verfix

# Installs cli + workers + sdk and live-links the local @verfix/engine into the cli.
npm install

cd cli
npx ts-node src/index.ts init
npx ts-node src/index.ts --help
npx ts-node src/index.ts flows
npx ts-node src/index.ts run --flow <id> --output json
```

Build and type-check:

```bash
npx tsc -p tsconfig.json   # type check
npm run build              # compile to dist/
```

---

## Contributing to the CLI

The CLI (`cli/`) is the main entry point for end users and AI coding agents. It is the most impactful place to contribute.

### Key files

| File | Purpose |
|------|---------|
| `src/index.ts` | All CLI commands (`init`, `run`, `flows`, `start`, `stop`, `status`, `logs`, `doctor`, `update`). Also contains `resolveJobUrl()` — rewrites localhost URLs for Docker networking |
| `src/init-wizard.ts` | Interactive setup wizard + `AGENTS.md` generator |
| `src/docker.ts` | Docker container lifecycle. Contains `isHostNetworkMode()` which determines `--network=host` (Linux) vs bridge (Mac/Windows) |
| `src/constants.ts` | Shared constants — ports, config filename, AI model list, scaffold flows |
| `src/health.ts` | Health check polling logic |

### Adding a new command

1. Add it to `src/index.ts` using `program.command('name')`
2. Follow the existing pattern: `--output json` support, spinner for long ops, chalk for pretty output
3. Update `cli/README.md` with usage examples
4. If it calls the API, add the route check to `src/constants.ts`

### Editing the agent instructions

Agent instructions are split across two generators in `src/agents-md.ts`:

- `generateAgentsSection()` produces the **full reference** (schema, workflow, failure
  table, flow-writing guide). It is written to the standalone `.verfix/INSTRUCTIONS.md`,
  which Verfix owns and overwrites cleanly.
- `generateAgentsStub()` produces the **short stub** injected into the project's
  `AGENTS.md` (and the platform files) — identity, the config-first rule, core commands,
  and a pointer to `.verfix/INSTRUCTIONS.md`. This keeps a project's existing `AGENTS.md`
  from being bloated by the full reference.

When editing:

- Keep the stub small — only always-in-context essentials belong there; everything else
  goes in the full reference.
- Keep examples **generic** (never hardcode flow names like `login` or `checkout`)
- Add a warning comment if adding anything that could cause agent hallucination
- Test by running `npx ts-node src/index.ts init` in a clean directory

### Init wizard step order

The wizard must collect AI keys **before** starting the container, so they are injected as Docker env vars:

```
Step 1: Check Docker
Step 2: Collect AI API key + model (prompts user)
Step 3: Pull image + start container (injects AI_API_KEY, AI_MODEL)
Step 4: Detect/ask base URL
Step 5: Select mode
Step 6: Scaffold flows
Step 7: Write verfix.config.json
Step 8: Write/update AGENTS.md
```

---

## Project Structure

```
verfix/
├── api/                  # Go Fiber API server
│   ├── main.go
│   └── handlers/
├── workers/              # Node.js Playwright execution engine
│   └── src/
│       ├── ai/           # AI provider, exploration, self-healing
│       ├── assertions/   # Assertion runners + type definitions
│       ├── artifacts/    # Event tracker, screenshot, trace capture
│       └── reliability/  # Retry, DOM stability utilities
├── dashboard/            # Next.js observability dashboard
├── cli/                  # npm package 'verfix'
│   └── src/
│       ├── index.ts      # All CLI commands
│       ├── init-wizard.ts # Setup wizard + AGENTS.md generator
│       ├── docker.ts     # Container lifecycle
│       ├── constants.ts  # Shared constants
│       └── health.ts     # Health polling
├── sdk/                  # TypeScript SDK
├── docs/                 # Documentation
└── testbed/              # Test fixtures for local dev
```

---

## Good First Issues

Look for issues tagged [`good first issue`](https://github.com/verfix-dev/verfix/labels/good%20first%20issue) on GitHub. Some good areas right now:

- **New assertion types** — add to `workers/src/assertions/` and register the type in `workers/src/assertions/types.ts`. Each type needs a stable `fix_hint` template.
- **CLI UX improvements** — better error messages, `verfix doctor` diagnostics, `verfix update` improvements
- **More scaffold flows** — add common app patterns to `SCAFFOLD_FLOWS` in `cli/src/constants.ts`
- **Event tracking** — wire more browser events through `workers/src/artifacts/event-tracker.ts`
- **Documentation** — fix unclear or missing content in `docs/`

If you're unsure whether something is in scope, **open a Discussion first**. A short conversation saves everyone time.

---

## Failure Taxonomy

Every assertion failure must map to one of these stable types. Do not add new types without a GitHub Discussion — agents pattern-match on these strings:

```typescript
type FailureType =
  | "selector_not_found"      // Element doesn't match any DOM node
  | "selector_not_visible"    // Element exists but is hidden
  | "text_mismatch"           // Expected text not found on page
  | "url_mismatch"            // Navigation didn't land on expected URL
  | "console_error"           // JavaScript error in browser console
  | "network_failure"         // API request returned non-2xx
  | "timeout"                 // Operation exceeded time limit
  | "assertion_failed"        // Generic fallback — avoid if possible
```

---

## Coding Standards

### TypeScript (CLI, Workers, SDK)

- Strict mode — no implicit `any`
- Run `npx tsc --noEmit` before committing
- No silent error swallowing — always log with context
- Prefer `spawnSync` with `stdio: 'pipe'` over `execSync` for Docker commands (easier to test and capture output)

### Go (API)

- Standard `gofmt` formatting — run `gofmt -w .` before committing
- Wrap errors with context: `fmt.Errorf("creating job: %w", err)`
- No global mutable state outside of the initialized service instances

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(cli): add verfix watch command
fix(workers): handle null DOM snapshot in event tracker
docs: update AGENTS.md generator with per-flow mode docs
chore(deps): bump playwright to 1.44
```

Keep commits focused — one logical change per commit. Squash fix-up commits before opening a PR.

---

## Verification Steps

Every contributor must run these steps before opening a PR. They are ordered
from cheapest (type check) to most thorough (full Docker end-to-end). Stop at
the level that covers your change — you don't need Docker for a docs-only fix.

---

### Step 1 — Type Check (required for all TypeScript changes)

Run this for any change in `cli/`, `workers/`, or `sdk/`:

```bash
# CLI
cd cli && npx tsc --noEmit
cd cli && npx tsc --noEmit && echo "✅ CLI types clean"

# Workers
cd workers && npx tsc --noEmit --skipLibCheck
cd workers && npx tsc --noEmit --skipLibCheck && echo "✅ Workers types clean"

# Both in one shot (from repo root)
(cd cli && npx tsc --noEmit) && (cd workers && npx tsc --noEmit --skipLibCheck) && echo "✅ All types clean"
```

**Expected:** zero errors. Any error is a blocker.

---

### Step 2 — Build (required before Docker or CLI smoke tests)

Compile both packages so the dist/ output is current:

```bash
# CLI
cd cli && npm run build && echo "✅ CLI built"

# Workers
cd workers && npx tsc --skipLibCheck && echo "✅ Workers built"

# Both in one shot (from repo root)
(cd cli && npm run build) && (cd workers && npx tsc --skipLibCheck) && echo "✅ All packages built"
```

---

### Step 3 — API type check (required for Go changes)

```bash
cd api && go build ./... && echo "✅ API builds"
cd api && go test ./...  && echo "✅ API tests pass"
cd api && gofmt -l .     # should print nothing (no unformatted files)
```

---

### Step 4 — Local CLI Smoke Test (required for CLI or engine changes; no Docker)

This exercises the default local path end-to-end: real Chromium, in-process
engine, persisted trace. Requires a local web app on any port (or use the
`cli/test/local-run.test.ts` script, which spins up its own).

```bash
# From the cli/ directory:

# 1. Run doctor (must exit 0 — Docker is informational only in local mode)
npx ts-node src/index.ts doctor
# Expected: "All checks passed!" (warnings are OK)

# 2. Run a quick verification against a real URL
npx ts-node src/index.ts run \
  --url http://localhost:<YOUR_APP_PORT> \
  --output json
# Expected: "passed": true, "timeline_url": null, "trace_path": ".../.verfix/runs/..."

# 3. Open the recorded trace
npx ts-node src/index.ts show
# Expected: Playwright trace viewer opens

# 4. Run the automated e2e + JSON-purity suites
npx ts-node test/local-run.test.ts
cd .. && bash cli/test/json-purity.sh   # from repo root, after `cd cli && npm run build`
```

For **server-mode changes**, additionally smoke the container path:

```bash
# From the cli/ directory (Docker running):
npx ts-node src/index.ts start --server
npx ts-node src/index.ts status --server
npx ts-node src/index.ts run --server --url http://localhost:<YOUR_APP_PORT> --output json
npx ts-node src/index.ts logs --server --tail 30
npx ts-node src/index.ts stop --server
```

---

### Step 5 — Build and Test the Docker Image (required for changes in `workers/`, `scripts/`, or `Dockerfile.server`)

This validates that the compiled workers and startup script work inside the
actual container.

```bash
# From repo root:

# 1. Build the image
docker build -f Dockerfile.server -t verfix-server:local .
# Expected: "Successfully built ..." with exit code 0

# 2. Start container (Linux — uses --network=host automatically via CLI)
#    Or manually:
docker run -d \
  --name verfix \
  --network=host \
  -e VERFIX_HOST_NETWORK=1 \
  -e AI_API_KEY=<your_key_or_any_string> \
  -e AI_MODEL=gpt-4o-mini \
  -v verfix-data:/var/lib/postgresql/15/main \
  -v verfix-artifacts:/app/workers/artifacts \
  verfix-server:local

# 3. Wait for boot (~30–40s) then check health
sleep 35
curl -sf http://localhost:3001/api/v1/health | python3 -m json.tool
# Expected: {"status":"healthy","redis":"ok","database":"ok",...}

# 4. Check startup log — networking must be configured correctly
docker logs verfix 2>&1 | head -20
# Expected on Linux:  "✅ Network mode: host — localhost resolves directly to the host"
# Expected on bridge: "✅ host.docker.internal → 172.17.0.1 (injected into /etc/hosts)"

# 5. Submit a real verification job
curl -s -X POST http://localhost:3001/api/v1/verify \
  -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:<YOUR_APP_PORT>/","task":"page loads","mode":"strict","assertions":[{"type":"page_loaded"},{"type":"no_console_errors"}]}' \
  | python3 -m json.tool
# Expected: {"executionId":"exec_...","status":"queued"}

# 6. Poll result (replace <EXEC_ID> with the value from step 5)
sleep 15 && curl -s http://localhost:3001/api/v1/executions/<EXEC_ID> \
  | python3 -m json.tool | grep -E '"passed"|"status"'
# Expected: "passed": true,  "status": "completed"

# 7. Clean up
docker stop verfix && docker rm verfix
```

---

### Step 6 — Dashboard Verification (required for `dashboard/` changes or full E2E)

```bash
# 1. Start the runtime (using the local image)
docker run -d --name verfix --network=host \
  -e VERFIX_HOST_NETWORK=1 \
  -v verfix-data:/var/lib/postgresql/15/main \
  -v verfix-artifacts:/app/workers/artifacts \
  verfix-server:local

# 2. Wait for boot
sleep 35

# 3. Run a verification job via CLI and grab the timeline URL
cd cli
npx ts-node src/index.ts run \
  --url http://localhost:<YOUR_APP_PORT> \
  --output json | python3 -m json.tool | grep timeline_url

# 4. Open the dashboard URL from step 3 in a browser
#    http://localhost:3000/?executionId=exec_...
#
# Verify:
# ✅ Timeline loads with events (navigation, assertions)
# ✅ Screenshots appear in the Artifacts panel
# ✅ Console log and network log tabs show data
# ✅ All events have correct timestamps and categories

# 5. Clean up
docker stop verfix && docker rm verfix
```

---

### Step 7 — Networking Verification (required for changes in `docker.ts`, `server-start.sh`, or `workers/src/index.ts`)

```bash
# ── Verify host network mode is active (Linux) ─────────────────────────────
docker exec verfix cat /proc/net/dev | awk 'NR>2 && $1!~/lo:/ {print "interface found:", $1}'
# Expected: NO output (no extra network interfaces in host network mode)

# ── Verify /etc/hosts injection (bridge mode only) ──────────────────────────
docker exec verfix grep host.docker.internal /etc/hosts
# Expected: "172.17.0.1  host.docker.internal"

# ── Verify VERFIX_HOST_NETWORK is set correctly ─────────────────────────────
docker exec verfix printenv VERFIX_HOST_NETWORK
# Expected: "1" on Linux, "0" on Mac/Windows

# ── Verify URL is NOT rewritten by CLI on Linux ────────────────────────────
cd cli && npx ts-node src/index.ts run \
  --url http://localhost:3002 --output json 2>&1 | grep "Target URL"
# Expected: NO output (no rewrite on Linux)

# ── Test that IPv6-bound apps are reachable ─────────────────────────────────
# Start a server bound to IPv6 loopback only:
python3 -c "
import http.server, socket
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self, *a): pass
s = http.server.HTTPServer(('::1', 19876), H); s.serve_forever()
" &
TEST_PID=$!
sleep 1

# Verify it's IPv6-only:
ss -tlnp | grep 19876
# Expected: "[::1]:19876"

# Submit a job — must pass on Linux (host network sees ::1)
curl -s -X POST http://localhost:3001/api/v1/verify \
  -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:19876/","task":"IPv6 test","mode":"strict"}' \
  | python3 -m json.tool
sleep 15
curl -s http://localhost:3001/api/v1/executions/<EXEC_ID> | python3 -m json.tool | grep '"passed"'
# Expected: "passed": true

kill $TEST_PID 2>/dev/null
```

---

### Quick Reference — What to run per change type

| Changed area | Minimum steps required |
|---|---|
| Docs only (`docs/`, `*.md`) | None (but proofread!) |
| `cli/src/constants.ts`, `cli/src/health.ts` | Step 1 + Step 4 |
| `cli/src/index.ts` (commands, output) | Step 1 + Step 2 + Step 4 |
| `cli/src/docker.ts` | Step 1 + Step 2 + Step 4 + Step 7 |
| `workers/src/` (assertions, AI, browser) | Step 1 + Step 2 + Step 5 |
| `workers/src/index.ts` (URL resolution) | Step 1 + Step 2 + Step 5 + Step 7 |
| `scripts/server-start.sh` | Step 5 + Step 7 |
| `Dockerfile.server` | Step 5 (full image rebuild) |
| `api/` (Go) | Step 3 + Step 5 |
| `dashboard/` | Step 1 + Step 6 |
| Networking (`docker.ts` + `index.ts` + `server-start.sh`) | Steps 1–2 + 5 + 7 |

---

## Pull Request Process

1. **Fork** the repo and create a branch:
   - Features: `feat/your-feature-name`
   - Bug fixes: `fix/what-it-fixes`
   - Docs: `docs/what-you-changed`

2. **Run verification steps** from the table above for your change type.
   At minimum, type check must pass (`Step 1`). For anything touching Docker
   or execution flow, `Step 5` is required.

3. **Update documentation** — if you changed a command, flag, config shape, or
   networking behaviour:
   - `cli/README.md` — CLI command reference
   - `docs/4-guides/docker-runtime.md` — if Docker run args changed
   - `docs/4-guides/docker-networking.md` — if networking logic changed
   - `CONTRIBUTING.md` — if the verification steps themselves changed

4. **Open a PR** with:
   - What problem it solves
   - Which verification steps you ran (paste the output)
   - Screenshots or JSON output if it changes visible behaviour

5. **One maintainer review** required before merge.

> Keep PRs small. A focused 200-line PR gets reviewed the same day.
> A sprawling 1,000-line PR sits for a week.


---

## Issue Labels

| Label | Meaning |
|-------|---------|
| `bug` | Something produces wrong output or crashes |
| `reliability` | Flaky execution, selector healing, retry logic |
| `assertion` | New assertion types or fixes to existing ones |
| `observability` | Event tracking, timeline UI, artifact capture |
| `dx` | CLI, SDK, init flow, developer experience |
| `docs` | Documentation gaps or errors |
| `good first issue` | Well-scoped, beginner-friendly |
| `needs discussion` | Requires design decision before implementation |