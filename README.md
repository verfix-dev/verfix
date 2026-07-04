<div align="center">

<img src="https://verfix.dev/logo.png" alt="Verfix" width="120" />

<h1>Verfix</h1>

<p><strong>Local-first browser verification runtime for AI coding agents.</strong><br/>
Run deterministic browser flows, assert UI state, and get structured failure reports — all from your terminal.</p>

[![npm version](https://img.shields.io/npm/v/verfix.svg?style=flat-square)](https://www.npmjs.com/package/verfix)
[![npm downloads](https://img.shields.io/npm/dm/verfix.svg?style=flat-square)](https://www.npmjs.com/package/verfix)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square)](./LICENSE.md)
[![Docker Image](https://img.shields.io/badge/docker-verfix--server-blue?style=flat-square&logo=docker)](https://github.com/verfix-dev/verfix/packages)
[![Docker Slim](https://img.shields.io/badge/docker-verfix--server--slim-green?style=flat-square&logo=docker)](https://github.com/verfix-dev/verfix/packages)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](./CONTRIBUTING.md)

[Website](https://verfix.dev) · [Docs](https://verfix.dev/docs) · [npm Package](https://www.npmjs.com/package/verfix) · [Report a Bug](https://github.com/verfix-dev/verfix/issues/new?template=bug_report.md) · [Request a Feature](https://github.com/verfix-dev/verfix/issues/new?template=feature_request.md)

</div>

---

## The Problem

AI coding agents can generate entire application flows in seconds — but **verifying that those flows actually work in a browser remains a human bottleneck.**

Developers still manually open browsers, click through flows, and debug regressions. AI agents lack the deterministic infrastructure to confidently verify browser behavior and catch regressions before they ship.

## The Solution

**Verfix** is a browser execution runtime designed specifically for coding agents. It gives agents a local, observable verification environment where they can:

- Execute structured browser flows deterministically
- Assert UI state with typed, stable contracts
- Consume structured JSON results and failure classifications
- Watch AI self-heal broken selectors in real time

> **Verfix is not a generic AI agent or chatbot wrapper.** It is verification infrastructure. Reliability emerges from structured contracts, not unconstrained intelligence.

---

## Features

| Mode | Description |
|------|-------------|
| **Strict** | Fully deterministic. Selector-based flows, no AI. Best for CI/CD. |
| **Assisted** | Deterministic with AI fallback. If a selector breaks, the runtime heals it semantically. |
| **Exploratory** | Natural language task — AI navigates, reasons, and verifies on its own. |

- **Flow Library** — `verfix.config.json` holds as many independent flows as your app needs
- **Structured Output** — every run returns typed JSON with `passed`, `failures[]`, `fix_hint`, and a Playwright trace
- **Recorded Traces** — every run captures a full Playwright trace (screenshots, network, console); open it with `verfix show`
- **Local-first** — runs entirely in-process on Node.js 20+. No Docker, no services, no cloud. Strict mode needs no AI key.
- **AI Coding Agent Ready** — ships with an `AGENTS.md` generator so Claude, Cursor, and Codex know exactly how to use it

---

## Quick Start

**Requirements:** Node.js 20+ (that's it — no Docker)

```bash
# In your project directory
npx verfix init
```

The interactive wizard will:
1. Detect your app's local URL
2. Ask for the verification mode (default `strict` — fully deterministic, no AI key)
3. Download Chromium if needed (~130MB, one-time, cached)
4. Scaffold a `verfix.config.json` flow library
5. Generate or update `AGENTS.md` for your coding agent

### Running Verification

```bash
# See all available flows
npx verfix flows

# Run a specific flow
npx verfix run --flow <flow-id> --output json

# Run in exploratory mode (natural language)
npx verfix run --mode exploratory --task "verify the login page loads and shows a form" --output json
```

### Example Output

```json
{
  "passed": true,
  "failures": [],
  "timeline_url": null,
  "trace_path": "/your/project/.verfix/runs/exec_abc123_trace.zip",
  "show_command": "verfix show exec_abc123",
  "exit_code": 0,
  "execution_id": "exec_abc123"
}
```

Results and Playwright traces are persisted under `.verfix/runs/` (newest 20 runs kept). Open a recorded trace any time:

```bash
npx verfix show exec_abc123   # or just `verfix show` for the newest run
```

---

## verfix.config.json

The config is a **Flow Library** — add one flow per user journey you want to verify:

```json
{
  "baseUrl": "http://localhost:3000",
  "mode": "assisted",
  "flows": [
    {
      "id": "homepage-smoke",
      "steps": [
        { "action": "navigate", "url": "/" }
      ],
      "assertions": [
        { "type": "page_loaded" },
        { "type": "no_console_errors" }
      ]
    },
    {
      "id": "contact-form",
      "mode": "strict",
      "steps": [
        { "action": "navigate", "url": "/contact" },
        { "action": "type", "selector": "[data-testid=name]", "value": "Test User" },
        { "action": "click", "selector": "[data-testid=submit]" }
      ],
      "assertions": [
        { "type": "text_visible", "value": "Thank you" }
      ]
    }
  ]
}
```

Each flow can override the global `mode` — stable flows can use `strict`, new flows can use `assisted`.

---

## CLI Reference

```bash
npx verfix init              # Interactive setup wizard (run with --yes for non-interactive mode)
npx verfix agent-setup       # Output machine-readable bootstrap instructions for AI agents
npx verfix flows             # List all flows in verfix.config.json
npx verfix run               # Run all flows
npx verfix run --flow <id>   # Run a specific flow
npx verfix show [id]         # Open the Playwright trace viewer for a run
npx verfix list              # List recent runs
npx verfix status            # Check setup health (config, browser, last run)
npx verfix doctor            # Diagnose common setup issues
```

Run any command with `--help` for full option details. The Docker **server runtime** (API + dashboard, used by the future hosted product) is opt-in: pass `--server` to `init`, `run`, `start`, `stop`, `status`, `logs`, or `update`.

### Non-Interactive Bootstrapping (for CI/CD & AI Agents)

For non-interactive environments, pass the `--yes` (or `-y`) flag. The default `strict` mode needs zero credentials:

```bash
npx verfix init --yes --base-url http://localhost:3000
```

To enable AI-backed modes (assisted/exploratory), supply a key:

```bash
npx verfix init --yes \
  --mode assisted \
  --ai-provider anthropic \
  --ai-key $ANTHROPIC_API_KEY \
  --base-url http://localhost:3000
```

Alternatively, you can use environment variables:

```bash
export VERFIX_AI_KEY="your-api-key"
export VERFIX_AI_PROVIDER="anthropic" # Optional, auto-detected from key if omitted
npx verfix init --yes --mode assisted
```

#### Dry-run Mode
You can preview the generated configuration as JSON without writing any files to disk by passing the `--dry-run` flag:
```bash
npx verfix init --yes --ai-key sk-ant-... --dry-run
```

---

## Architecture

By default Verfix runs everything locally in a single Node.js process — the CLI
calls the verification engine (`@verfix/engine`, Playwright-based) directly and
persists results + traces to `.verfix/runs/`:

```
Execution path (local mode — the default):
  CLI → @verfix/engine (in-process) → Browser → .verfix/runs/<id>.json + trace
```

The Docker **server runtime** (Go API + Redis queue + containerized workers +
timeline dashboard) still exists for the future hosted CI product and is opt-in
via `--server`:

```
Execution path (server mode, --server):
  CLI → API (Docker) → Redis → Worker (container) → Browser → Postgres → Dashboard
```

---

## Monorepo Structure

| Package | Description |
|---------|-------------|
| [`cli/`](./cli/README.md) | npm package `verfix` — runtime lifecycle + flow runner |
| [`api/`](./api/) | Go + Fiber API — job ingestion, queue, execution state |
| [`workers/`](./workers/) | Node.js Playwright workers — browser execution engine |
| [`dashboard/`](./dashboard/) | Next.js execution timeline dashboard |
| [`sdk/`](./sdk/) | TypeScript SDK for programmatic integrations |
| [`docs/`](./docs/) | Full documentation |

---

## Documentation

- [What is Verfix?](./docs/1-introduction/what-is-verfix.md)
- [Getting Started](./docs/2-getting-started/getting-started.md)
- [Execution Modes](./docs/3-core-concepts/execution-modes.md)
- [Observability & Timeline](./docs/1-introduction/observability-core.md)
- [Agent Integrations](./docs/4-guides/agent-integrations.md)
- [Config-First Verification](./docs/4-guides/config-first-verification.md)
- [Full CLI Reference](./cli/README.md)

---

## Contributing

We welcome all contributions — bug fixes, new assertion types, CLI improvements, and docs.

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for local setup, architecture overview, and the PR process.

```bash
# Quick start for contributors
git clone https://github.com/verfix-dev/verfix.git
cd verfix
npm install   # workspaces: installs + live-links cli <-> workers <-> sdk
```

---

## Community & Support

- 🐛 **Bug reports** — [GitHub Issues](https://github.com/verfix-dev/verfix/issues)
- 💡 **Feature requests** — [GitHub Discussions](https://github.com/verfix-dev/verfix/discussions)
- 📦 **npm package** — [npmjs.com/package/verfix](https://www.npmjs.com/package/verfix)
- 🌐 **Website** — [verfix.dev](https://verfix.dev)

---

## License

Apache 2.0 — see [LICENSE.md](./LICENSE.md) for details.
