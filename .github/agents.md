# Agentic context & Guidelines for Coding Assistants

This repository conforms to the emerging open-source standard for AI Agent context. If you are an AI Coding Agent (e.g., GitHub Copilot, Cursor, Claude Code, Aider, Gemini CLI), read this file to understand the architecture, coding standards, preferred patterns, and guardrails of the **Verfix** repository.

---

## 1. Project Overview & Philosophy

**Verfix** is a local-first, docker-powered browser verification runtime designed specifically for AI coding agents. It executes deterministic browser flows, asserts UI state, and generates structured failure reports.

### Core Philosophy
* **Deterministic First:** Never reach for an LLM when a selector, assertion, or retry can solve the problem. AI self-healing is a fallback for resilience, not a substitute for deterministic verification.
* **Observability as a Feature:** Every failure must map to a stable, classified type from the failure taxonomy, accompanied by a helpful `fix_hint`. Silent failures or uninformative generic errors are considered bugs.
* **Local First:** The entire runtime stack must run locally on a developer's machine. Core functionality must not depend on cloud services.
* **Agent-Compatible Output:** JSON contracts (e.g., CLI outputs, API payloads) must remain stable. Field names and formats must never change without a major version bump.

---

## 2. Monorepo Architecture

Verfix is organized as a monorepo. Below is the directory map and the role of each package:

```
verfix/
├── api/                  # Go + Fiber REST API server (job ingestion & state)
├── cli/                  # TypeScript CLI (the user-facing entry point)
├── workers/              # TypeScript Playwright workers (browser execution engine)
├── dashboard/            # Next.js timeline visualization dashboard
├── sdk/                  # TypeScript programmatic wrapper SDK
├── docs/                 # General markdown documentation
└── testbed/              # Test fixtures and example configuration for local dev
```

### Execution Flow
```
[CLI / SDK / Agent] ──(POST /api/v1/verify)──> [Go API] ──(Enqueue)──> [Redis / BullMQ]
                                                                            │
[CLI Output] <──(Poll /api/v1/executions)── [Go API] <──(Save)── [Postgres] <──(Execute)── [Playwright Workers]
```

---

## 3. Tech Stack Reference

| Component | Stack & Key Technologies |
|---|---|
| **CLI (`cli/`)** | TypeScript, Node.js, Commander.js, Inquirer, Chalk, Axios |
| **API (`api/`)** | Go (1.22+), Fiber web framework, GORM, Postgres |
| **Workers (`workers/`)** | TypeScript, Node.js, Playwright, BullMQ (Redis queue), Dotenv |
| **Dashboard (`dashboard/`)** | Next.js, React, Tailwind CSS (v4), Lucide Icons |
| **SDK (`sdk/`)** | TypeScript, Axios, Ajv |

---

## 4. Development & Verification Commands

Use these exact commands when setting up, developing, testing, or verifying changes:

### Local Setup
Install dependencies and run background databases:
```bash
# Install dependencies for all TS packages
npm ci --prefix workers && npm ci --prefix dashboard && npm ci --prefix cli && npm ci --prefix sdk

# Start PostgreSQL and Redis via Docker Compose
docker compose up -d postgres redis
# (or use the Makefile target)
make up
```

### Running Services Local Dev Mode
Start each service in a separate terminal:
```bash
# Go API server (runs on :3001)
make api

# Playwright Workers (connects to Redis)
make worker

# Next.js Dashboard (runs on :3000)
make ui
```

### Build & Type-Checking
Always run type-checks and builds before committing TS changes:
```bash
# Type-check TypeScript packages
(cd cli && npx tsc --noEmit) && (cd workers && npx tsc --noEmit --skipLibCheck)

# Compile TypeScript packages
(cd cli && npm run build) && (cd workers && npx tsc --skipLibCheck)
```

### Running Tests
Execute tests for specific packages:
```bash
# CLI Unit Tests
cd cli && npm test

# Worker Unit Tests
cd workers && npm test

# API builds & tests
cd api && go build ./... && go test ./...
```

---

## 5. Coding Standards & Conventions

### TypeScript (CLI, Workers, SDK)
* **Strict Types:** Run in TypeScript strict mode. Avoid `any` types.
* **Error Handling:** Never swallow errors silently. Always log with rich operational context.
* **CLI UX:** CLI commands should support `--output json` mode, use spinners for long-running actions, and print clean stderr messages.
* **Process Spawning:** In the CLI, prefer `spawnSync` with `stdio: 'pipe'` over `execSync` for running Docker/external commands. It makes output parsing and testing cleaner.

### Go (API)
* **Formatting:** Code must be formatted using `gofmt`. Run `gofmt -w .` before committing.
* **Error Handling:** Wrap all errors with appropriate context: `fmt.Errorf("context: %w", err)`.
* **State Management:** Avoid global mutable variables outside of initialized structure instances.

### Commit Guidelines
We enforce [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(<scope>): description
fix(<scope>): description
docs: description
chore(<scope>): description
```
*Example scopes:* `cli`, `workers`, `api`, `dashboard`, `sdk`. Keep commits logically scoped and clean.

---

## 6. Critical Guardrails & Boundaries

### Docker Networking
Workers run inside Docker containers and must reach targets on the host machine.
* **Linux:** Uses host networking (`--network=host`), meaning localhost inside the container points to localhost on the host.
* **Mac / Windows:** Uses bridge networking. Target URLs pointing to `localhost` must be translated to `host.docker.internal`.
* **Code References:** If editing files that deal with port/URL translation, be extremely careful. Refer to the networking logic inside:
  - `cli/src/docker.ts` (container networking modes)
  - `cli/src/index.ts` (`resolveJobUrl`)
  - `workers/src/index.ts` (`resolveTargetUrl`)
  - `workers/src/ai/provider.ts` (`resolveBaseUrl`)
  - `scripts/server-start.sh` & `Dockerfile.server` (environment injection)

### Failure Taxonomy
All assertion failures must be classified into one of these strict, stable string formats. Do not introduce new string categories without opening a GitHub Discussion:
* `selector_not_found` — Element doesn't match any DOM node.
* `selector_not_visible` — Element exists in the DOM but is hidden (CSS display/visibility, zero dimensions).
* `text_mismatch` — Expected text was not found on the page.
* `url_mismatch` — Navigation did not land on the expected URL destination.
* `console_error` — Unhandled JavaScript console errors detected in the browser during flow.
* `network_failure` — API request returned a non-2xx status code.
* `timeout` — The action or assertion exceeded its allocated duration limit.
* `assertion_failed` — Generic fallback (avoid using this if possible).

### Selector Standards
* Prefer using `data-testid` attributes (e.g., `[data-testid="submit-btn"]`) as the primary query target.
* Standard CSS selectors are the secondary preference.
* Literal text selectors (e.g., `text=Submit`) should only be used as a last resort.
* When writing or refactoring components, feel free to add missing `data-testid` attributes directly to the source markup.
