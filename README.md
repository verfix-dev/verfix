<div align="center">

<img src="https://verfix.dev/logo.png" alt="Verfix" width="120" />

<h1>Verfix</h1>

<p><strong>Local-first browser verification runtime for AI coding agents.</strong><br/>
Run deterministic browser flows, assert UI state, and get structured failure reports — all from your terminal.</p>

[![npm version](https://img.shields.io/npm/v/verfix.svg?style=flat-square)](https://www.npmjs.com/package/verfix)
[![npm downloads](https://img.shields.io/npm/dm/verfix.svg?style=flat-square)](https://www.npmjs.com/package/verfix)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square)](./LICENSE.md)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Fverfix--dev%2Fverfix--server-blue?style=flat-square&logo=docker)](https://github.com/verfix-dev/verfix/packages)
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
- **Structured Output** — every run returns typed JSON with `passed`, `failures[]`, `fix_hint`, and `timeline_url`
- **Execution Timeline** — high-fidelity event-driven observability: every action, navigation, console error, and network request
- **Docker-powered** — entire stack runs locally with one command, no cloud required
- **AI Coding Agent Ready** — ships with an `AGENTS.md` generator so Claude, Cursor, and Codex know exactly how to use it

---

## Quick Start

**Requirements:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running), Node.js 18+

```bash
# In your project directory
npx verfix init
```

The interactive wizard will:
1. Ask for your AI API key (needed for Assisted/Exploratory mode)
2. Start the Docker runtime (pulls image on first run, ~2 min)
3. Detect your app's local URL
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
  "timeline_url": "http://localhost:3610/?executionId=exec_abc123",
  "exit_code": 0,
  "execution_id": "exec_abc123"
}
```

Runtime defaults:
- Dashboard: `http://localhost:3610`
- API: `http://localhost:3611`
- If occupied, Verfix automatically tries the next pair (`3612/3613`, `3614/3615`, ...)
- Resolved ports persist in `.verfix/runtime.json`

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
npx verfix init              # Interactive setup wizard
npx verfix flows             # List all flows in verfix.config.json
npx verfix run               # Run all flows
npx verfix run --flow <id>   # Run a specific flow
npx verfix start             # Start the runtime manually
npx verfix stop              # Stop the runtime
npx verfix status            # Check runtime health
npx verfix logs              # Tail runtime logs
npx verfix doctor            # Diagnose common setup issues
npx verfix update            # Pull latest runtime image
```

Run any command with `--help` for full option details.

---

## Architecture

```
+-------------------+       +-----------------------+
|   Coding Agent    | ----> |    Verfix Runtime     |
| (Cursor, Claude,  |       |   (Local / Docker)    |
|  Codex, etc.)     |       +-----------+-----------+
+-------------------+                   |
         ^                              v
         |                  +----------------------+
         |                  |  Playwright Workers  |
         |                  |  + BullMQ + Redis    |
         |                  +----------+-----------+
         |                             |
+--------+----------+      +-----------+----------+
|  Structured JSON  | <--- |  Postgres + API      |
|  (passed/failed,  |      |  (Go + Fiber)        |
|   fix_hint, etc.) |      +----------------------+
+-------------------+
```

**Execution path:** `CLI → API → Redis queue → Playwright Workers → Postgres → API → CLI output`

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
- [Full CLI Reference](./cli/README.md)

---

## Contributing

We welcome all contributions — bug fixes, new assertion types, CLI improvements, and docs.

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for local setup, architecture overview, and the PR process.

```bash
# Quick start for contributors
git clone https://github.com/verfix-dev/verfix.git
cd verfix
npm ci --prefix cli && npm ci --prefix workers && npm ci --prefix sdk
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
