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
CLI (npm: verfix)
  └── sends jobs to →
        API (Go + Fiber, :3001)
          └── queues jobs in →
                Redis (BullMQ)
                  └── consumed by →
                        Workers (Node.js + Playwright)
                          └── writes results to →
                                Postgres
                                  └── served by →
                                        API → CLI output
                                        Dashboard (Next.js, :3000)
```

| Package | Language | Role |
|---------|----------|------|
| `cli/` | TypeScript | npm package `verfix` — runtime lifecycle, flow runner, init wizard |
| `api/` | Go (Fiber) | HTTP API — job ingestion, queue dispatch, execution state |
| `workers/` | TypeScript (Playwright) | Browser execution engine — flows, assertions, AI healing |
| `dashboard/` | Next.js | Execution timeline observability UI |
| `sdk/` | TypeScript | Thin programmatic wrapper around the CLI JSON contract |

---

## Core Philosophy

**Deterministic first.** Never reach for an LLM when a selector, assertion, or retry can solve the problem. AI is a fallback for resilience, not a substitute for good engineering.

**Observability is a feature.** If an execution fails silently or emits a generic error, that is a bug. Every failure must have a stable `type` from the failure taxonomy and a useful `fix_hint`.

**Local first.** The entire stack must run on a developer's laptop with a single command. Nothing in the critical path requires a cloud service.

**Agent-compatible output.** CLI JSON outputs must be parseable and stable. Agents depend on field names never changing without a major version bump.

---

## Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) (running)
- Node.js 20+
- Go 1.22+ *(only needed for `api/` changes)*
- `make` *(optional, convenience targets in Makefile)*

---

## Local Development Setup

### Full Stack (all services)

Use this if you're working on `api/`, `workers/`, or `dashboard/`:

```bash
git clone https://github.com/verfix-dev/verfix.git
cd verfix

# Install Node.js dependencies for all packages
npm ci --prefix workers
npm ci --prefix dashboard
npm ci --prefix cli
npm ci --prefix sdk

# Start Postgres + Redis via Docker Compose
make up
# or: docker compose up -d postgres redis

# Start each service in a separate terminal
make api        # Go API server on :3001
make workers    # Playwright workers (connects to Redis)
make dashboard  # Next.js dashboard on :3000
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

### CLI Only (most common)

If you're only working on the CLI (commands, init wizard, output formatting), you can use the pre-built Docker image instead of running the full stack locally:

```bash
git clone https://github.com/verfix-dev/verfix.git
cd verfix/cli

npm ci

# Pull and start the runtime container
npx ts-node src/index.ts init

# Develop and test
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
| `src/index.ts` | All CLI commands (`init`, `run`, `flows`, `start`, `stop`, `status`, `logs`, `doctor`, `update`) |
| `src/init-wizard.ts` | Interactive setup wizard + `AGENTS.md` generator |
| `src/docker.ts` | Docker container lifecycle (create, start, stop, inspect) |
| `src/constants.ts` | Shared constants — ports, config filename, AI model list, scaffold flows |
| `src/health.ts` | Health check polling logic |

### Adding a new command

1. Add it to `src/index.ts` using `program.command('name')`
2. Follow the existing pattern: `--output json` support, spinner for long ops, chalk for pretty output
3. Update `cli/README.md` with usage examples
4. If it calls the API, add the route check to `src/constants.ts`

### Editing the AGENTS.md generator

The `generateAgentsSection()` function in `src/init-wizard.ts` produces the markdown injected into user projects. When editing:

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

## Testing

```bash
# CLI — type check
cd cli && npx tsc -p tsconfig.json

# CLI — smoke test (requires runtime running)
npx ts-node src/index.ts flows --config verfix.config.json
npx ts-node src/index.ts run --flow <id> --output json

# Workers — type check
cd workers && npx tsc --noEmit

# API — unit tests
cd api && go test ./...
```

There is currently no automated integration test suite (it's a good first issue). Manual testing against the testbed is required for any change that touches execution flow.

---

## Pull Request Process

1. **Fork** the repo and create a branch:
   - Features: `feat/your-feature-name`
   - Bug fixes: `fix/what-it-fixes`
   - Docs: `docs/what-you-changed`

2. **Make your changes** and verify locally:
   ```bash
   cd cli && npx tsc -p tsconfig.json  # must pass
   ```

3. **Test end-to-end** with a real flow if your change touches execution:
   ```bash
   npx ts-node cli/src/index.ts run \
     --config testbed/verfix.config.json \
     --flow login \
     --output json
   ```

4. **Update documentation** — if you changed a command, flag, or config shape, update `cli/README.md` and any relevant `docs/` file.

5. **Open a PR** with:
   - What problem it solves
   - How you approached it
   - Screenshots or JSON output if it changes visible behavior

6. **One maintainer review** required before merge.

> Keep PRs small. A focused 200-line PR gets reviewed the same day. A sprawling 1,000-line PR sits for a week.

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