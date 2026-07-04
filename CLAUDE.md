# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Verfix is

Verfix is a local-first browser verification runtime for AI coding agents: deterministic browser flows, typed assertions, structured JSON results, and recorded Playwright traces (`verfix show`). It is explicitly **not** a generic AI wrapper — the core philosophy (see CONTRIBUTING.md) is "deterministic first": never reach for an LLM when a selector, assertion, or retry can solve the problem. AI (self-healing selectors, exploratory mode) is a fallback for resilience, not a substitute.

**Two runners** (`VERFIX_RUNNER=local|server`, `--server` CLI flag; **local is the default**):
- **Local (default):** the CLI calls `@verfix/engine` (the `workers/` package) in-process — no Docker, no Redis, no API. Results + trace zips persist to `<project>/.verfix/runs/` (newest 20 kept). Strict mode needs no AI key. JSON contract: `timeline_url` present but `null`, plus `trace_path` and `show_command`.
- **Server (opt-in, future hosted CI product):** today's container stack below. Container-only — the old hybrid host-worker mode was removed.

## Monorepo layout

| Package | Language | Role |
|---|---|---|
| `cli/` | TypeScript | npm package `verfix` — flow runner (local + server), init wizard, agent-instruction generation, `verfix show` |
| `api/` | Go (Fiber) | HTTP API (`:3611`, server mode) — job ingestion, queue dispatch, execution state (`main.go`, `store*.go`) |
| `workers/` | TypeScript (Playwright) | npm package `@verfix/engine` — browser execution engine (flows, assertions, AI healing) exposed as `runVerification()`; `src/index.ts` is a thin BullMQ adapter for server mode |
| `dashboard/` | Next.js | Execution timeline dashboard (`:3610`, server mode only) |
| `sdk/` | TypeScript (`@verifyruntime/sdk`) | Thin programmatic wrapper around the CLI JSON contract |
| `docs/` | — | User-facing documentation |

Data flow (local, default): `CLI → @verfix/engine in-process (Playwright) → .verfix/runs/<id>.json + trace zip → CLI output`.
Data flow (server, `--server`): `CLI → API (Go/Fiber) → Redis (BullMQ queue) → Workers (Playwright) → Postgres → API → CLI output`, with `Dashboard` reading execution state via the API.

### Networking modes (server mode only — read before touching networking code)

Local mode has no Docker networking at all (the browser runs in the CLI process). In server mode, workers run inside Docker (container-only; the hybrid host-worker mode was removed):

- Linux: `--network=host`
- macOS/Windows: bridge + `host.docker.internal`
- Linux (manual run): `/etc/hosts` injection via `ip route` at container startup

Before touching any of `cli/src/docker.ts`, `cli/src/index.ts` (`resolveJobUrl`), `scripts/server-start*.sh`, or `Dockerfile.server*`, read `docs/4-guides/docker-networking.md`.

## CLI internals (`cli/src/`)

- `index.ts` — all CLI commands (`init`, `run`, `show`, `list`, `flows`, `start`, `stop`, `status`, `logs`, `doctor`, `update`); also `resolveJobUrl()`, which rewrites localhost URLs for Docker networking (server mode). Most commands take `--server`; local-mode `start/stop/logs/update` print a friendly no-runtime message.
- `local-runner.ts` — local mode: `runLocal()` drives `@verfix/engine` in-process (retry semantics mirror BullMQ: only crashes retry, assertion failures don't), `ensureChromium()`/`isChromiumInstalled()` (Playwright resolved THROUGH the engine to avoid version skew), `findTraceZip()`/`readLocalResult()`/`listLocalResults()`, prune to newest 20 runs. Console is swapped to stderr during engine runs so `--output json` stays pure (guarded by `cli/test/json-purity.sh`).
- `init-wizard.ts` / `init-noninteractive.ts` — interactive and `--yes`/env-var setup flows
- `docker.ts` — server-mode container lifecycle; `isHostNetworkMode()` picks `--network=host` (Linux) vs bridge (Mac/Windows)
- `constants.ts` — shared constants: ports, config filename, AI model list, scaffold flows (`SCAFFOLD_FLOWS`), `getRunnerMode()` (`VERFIX_RUNNER`, defaults `local`)
- `health.ts` — health check polling
- `source-guard.ts` — deterministic guard that detects project-source edits made *during* a verify → fix loop (vs. legitimate config/selector edits), so agents get a typed signal instead of relying on prompt discipline alone. Baseline is snapshotted per verify-cycle in `.verfix/verify-baseline.json` and cleared on a passing run or new commit.
- `agents-md.ts` — generates agent-facing instructions, split in two:
  - `generateAgentsSection()` — full reference (schema, workflow, failure table, flow-writing guide) written to `.verfix/INSTRUCTIONS.md` (owned/overwritten by Verfix)
  - `generateAgentsStub()` — short stub injected into the project's own `AGENTS.md` (identity, config-first rule, core commands, pointer to `.verfix/INSTRUCTIONS.md`)
  - When editing either: keep the stub minimal, keep examples generic (never hardcode flow names like `login`/`checkout`), and test by running `npx ts-node src/index.ts init` in a clean directory.

Init wizard step order: detect/ask base URL → select mode (default `strict`) → collect AI key/model only when mode ≠ strict → runtime setup (local: ensure Chromium; `--server`: check Docker → pull image → start container with AI keys as env vars) → write `verfix.config.json` → write/update `AGENTS.md`.

## The flow config contract (`verfix.config.json`)

A flow library: each flow has `id`, `steps`, `assertions`, and an optional per-flow `mode` override (`strict` | `assisted` | `exploratory`) against the global `mode`. CLI JSON output (`passed`, `failures[]`, `fix_hint`, `timeline_url` — `null` in local mode — plus local-mode `trace_path`/`show_command`) is a stable agent-facing contract — field names must not change without a major version bump.

### Failure taxonomy (`workers/src/assertions/types.ts`)

Every assertion failure maps to one stable `type` string that agents pattern-match on. **Do not add new types without a GitHub Discussion first**:
`selector_not_found`, `selector_not_visible`, `text_mismatch`, `url_mismatch`, `console_error`, `network_failure`, `timeout`, `assertion_failed` (generic fallback, avoid).

New assertion types go in `workers/src/assertions/` (with validators in `workers/src/assertions/validators/`) and must be registered in `types.ts`; each needs a stable `fix_hint` template.

## Build, lint, test

No repo-wide build/test command — each package is independent.

```bash
# Type check (required for any cli/, workers/, or sdk/ change)
(cd cli && npx tsc --noEmit) && (cd workers && npx tsc --noEmit --skipLibCheck) && echo "✅ All types clean"

# Build
(cd cli && npm run build) && (cd workers && npx tsc --skipLibCheck)

# CLI tests (each is a standalone ts-node script, not a test runner)
cd cli && npm test                       # runs all four below
cd cli && npx ts-node test/providers.test.ts
cd cli && npx ts-node test/config-migration.test.ts
cd cli && npx ts-node test/noninteractive.test.ts
cd cli && npx ts-node test/local-run.test.ts   # e2e: real Chromium, local runner
bash cli/test/json-purity.sh             # from repo root, needs `cd cli && npm run build` first

# Workers tests (same pattern — standalone ts-node scripts)
cd workers && npm test
cd workers && npx ts-node test/ai/adapters/registry.test.ts
cd workers && npx ts-node test/assertions/engine-flow-tagging.test.ts
cd workers && npx ts-node test/engine/transport-free.test.ts  # engine loads no ioredis/bullmq

# Go API
cd api && go build ./... && go test ./...
cd api && gofmt -l .        # must print nothing

# Dashboard
cd dashboard && npm run lint
```

To run a single CLI/workers test, just invoke that file directly with `ts-node` (there's no test-name filtering flag — each `*.test.ts` is its own script, not a suite).

`make up` / `make down` — Postgres + Redis via docker-compose. `make api` / `make worker` / `make ui` / `make cli` — run each service directly (see `Makefile`).

### Local smoke test (no services needed)

```bash
cd cli && npx ts-node src/index.ts run --config ../testbed/verfix.config.json --flow login --output json
```
Local mode is the default — this runs the engine in-process. `"passed": true` with `timeline_url: null` and a `trace_path` on disk confirms the local path works.

### Full server stack (server-mode changes only)

```bash
npm ci --prefix cli && npm ci --prefix workers && npm ci --prefix dashboard && npm ci --prefix sdk
make up
make api        # :3611
make workers    # :3611
make dashboard  # :3610
```

Smoke-test the server stack:
```bash
cd cli && npx ts-node src/index.ts run --server --config ../testbed/verfix.config.json --flow login --output json
```
`"passed": true` with a non-null `timeline_url` confirms the server path is wired up. See CONTRIBUTING.md's "Verification Steps" section for the full staged checklist, ordered cheapest-first (local smoke test is step 1).

## Coding standards

- TypeScript (cli/workers/sdk): strict mode, no implicit `any`; no silent error swallowing — always log with context; prefer `spawnSync` with `stdio: 'pipe'` over `execSync` for Docker commands.
- Go (api): standard `gofmt`; wrap errors with context (`fmt.Errorf("creating job: %w", err)`); no global mutable state outside initialized service instances.
- Commits: Conventional Commits (`feat(cli): ...`, `fix(workers): ...`), one logical change per commit.

## Ponytail mode (`.clinerules/ponytail.md`)

This repo's contributor guidelines encode a "lazy senior dev" philosophy that applies broadly here: before writing code, climb the ladder — is it needed at all (YAGNI) → does it already exist in this codebase → does the standard library cover it → can it be one line → only then write the minimum. Bug fixes should address the root cause across all callers, not just the path a report names. No unrequested abstractions, dependencies, or boilerplate; deletion over addition. Mark intentional shortcuts with a `ponytail:` comment naming the shortcut's ceiling and upgrade path. Not lazy about: input validation at trust boundaries, error handling that prevents data loss, security, accessibility, and anything explicitly requested.
