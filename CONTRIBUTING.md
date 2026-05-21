# Contributing to Verfix

Verfix is early-stage and actively developed. Contributions are welcome — bug fixes, new assertion types, reliability improvements, and documentation are all useful right now.

---

## Before you start

Read this once so you understand how the pieces fit:

- `api/` is a Go + Fiber HTTP server. It receives verification jobs, queues them in Redis via BullMQ, persists results in Postgres, and serves the execution history.
- `workers/` is a Node.js Playwright execution engine. It pulls jobs from the queue, runs browser flows, records events, and saves artifacts (screenshots, traces, HAR, DOM snapshots).
- `dashboard/` is a Next.js app that reads from the API and shows the execution timeline.
- `cli/` is the developer-facing tool. It manages the runtime container lifecycle and sends flows to the API.
- `sdk/` is a thin TypeScript wrapper around the CLI's JSON contract.

The flow is always: `CLI → API → Redis queue → Workers → Postgres → API → CLI output`.

---

## Core philosophy

**Deterministic first.** Never reach for an LLM when a selector, assertion, or retry can solve the problem. AI is a fallback for resilience, not a substitute for good engineering.

**Observability is a feature.** If an execution fails silently or emits a generic error, that is a bug. Every failure must have a `type` from the stable taxonomy and a useful `fix_hint`.

**Local first.** The entire stack must run on a developer's laptop with a single `docker run`. Nothing in the critical path should require a cloud service.

---

## Local setup

### Prerequisites

- Docker (for running the full stack)
- Node.js 20+
- Go 1.22+

### Get running in dev mode

```bash
git clone https://github.com/verfix-dev/verfix.git
cd verfix

# Install all dependencies
npm ci --prefix workers
npm ci --prefix dashboard
npm ci --prefix cli
npm ci --prefix sdk

# Start Postgres + Redis
make up

# Start each service in separate terminals
make api        # Go API on :3001
make workers    # Playwright workers
make dashboard  # Next.js on :3000
```

The CLI talks to `http://localhost:3001` by default. Run a flow against the testbed to verify everything works:

```bash
cd cli
npx ts-node src/index.ts run --config ../testbed/verify.config.json --flow login --output json
```

`passed: true` with a populated `timeline_url` means the full stack is working.

---

## What to work on

Good first contributions right now:

- **New assertion types** — add to `workers/src/assertions/` and register in the type union in `workers/src/assertions/types.ts`. Each type needs a stable `fix_hint` template.
- **Event tracking** — the `events[]` array in execution results is currently sparse. Wiring more events (navigation, DOM change, healing) through `workers/src/artifacts/event-tracker.ts` is high value.
- **CLI improvements** — `verfix watch` (re-run on file save) and `verfix logs` (tail container logs) are both unbuilt and useful.
- **Documentation** — if something in `docs/` is unclear or missing, fix it.

If you're unsure whether something is in scope, open an issue first and describe what you want to build. A quick back-and-forth saves everyone time.

---

## Failure taxonomy

Every assertion failure must map to one of these types. Don't add new types without discussion — agents depend on this being stable:

```typescript
type FailureType =
  | "selector_not_found"
  | "selector_not_visible"
  | "text_mismatch"
  | "url_mismatch"
  | "console_error"
  | "network_failure"
  | "timeout"
  | "assertion_failed"  // generic fallback only
```

---

## Coding standards

**TypeScript** — strict mode, no `any` except at untyped external boundaries. Run `tsc --noEmit` before committing.

**Go** — standard `gofmt` formatting. Wrap errors with context (`fmt.Errorf("doing X: %w", err)`). No silent error swallowing.

**Commits** — follow Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`. Keep commits focused. One logical change per commit.

---

## PR process

1. Fork the repo, create a branch: `feat/your-feature` or `fix/what-it-fixes`
2. Make your changes
3. Test against the testbed: `npx ts-node cli/src/index.ts run --config testbed/verify.config.json --flow login --output json`
4. Open a PR with a clear description — what problem it solves, how you approached it
5. One review from a maintainer required before merge

Keep PRs small. A focused 200-line PR gets reviewed the same day. A sprawling 1000-line PR sits for a week.

---

## Issue labels

- `bug` — something produces wrong output or crashes
- `reliability` — flaky execution, selector healing, retry logic
- `assertion` — new assertion types or fixes to existing ones
- `observability` — event tracking, timeline UI, artifact capture
- `dx` — CLI, SDK, init flow, developer experience
- `docs` — documentation gaps or errors