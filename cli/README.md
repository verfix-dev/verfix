<p align="center">
  <img src="https://verfix.dev/logo.png" alt="Verfix" width="80" />
</p>

<h1 align="center">verfix</h1>

<p align="center">
  <strong>Browser verification for AI coding agents.</strong><br/>
  Run deterministic browser flows, assert UI state, and get structured failure reports — all from a single CLI command.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/verfix"><img src="https://img.shields.io/npm/v/verfix.svg?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/verfix"><img src="https://img.shields.io/npm/dm/verfix.svg?style=flat-square&color=blue" alt="npm downloads" /></a>
  <a href="https://github.com/verfix-dev/verfix"><img src="https://img.shields.io/github/stars/verfix-dev/verfix?style=flat-square&color=yellow" alt="GitHub stars" /></a>
  <a href="https://github.com/verfix-dev/verfix/blob/main/LICENSE.md"><img src="https://img.shields.io/badge/license-Apache%202.0-green.svg?style=flat-square" alt="License" /></a>
  <a href="https://verfix.dev/docs"><img src="https://img.shields.io/badge/docs-verfix.dev-8A2BE2?style=flat-square" alt="Documentation" /></a>
</p>

<p align="center">
  <a href="https://verfix.dev">Website</a> · <a href="https://verfix.dev/docs">Docs</a> · <a href="https://github.com/verfix-dev/verfix">GitHub</a> · <a href="https://github.com/verfix-dev/verfix/issues">Issues</a>
</p>

---

## What is Verfix?

AI coding agents write code fast — but they can't verify that it actually works in a browser. **Verfix** bridges that gap.

It's a local-first runtime that spins up a full verification stack (Playwright, Redis, PostgreSQL, API, Dashboard) inside a single Docker container. Define browser flows in JSON, run them from the CLI, and get structured pass/fail results that agents can parse and act on automatically.

**No cloud. No accounts. One command to start.**

```
npx verfix init
```

---

## Quick Start

### Prerequisites

- **Docker** — [install here](https://docs.docker.com/get-docker/)
- **Node.js** 18+

### 1. Initialize

Run the interactive setup wizard in your project root:

```bash
npx verfix init
```

This will:
- Pull and start the Verfix runtime container
- Ask for your AI API key (optional — for Assisted/Exploratory modes)
- Detect your app's port automatically
- Scaffold `verfix.config.json` with starter flows
- Create/update `AGENTS.md` with verification instructions for coding agents

### 2. Run a flow

```bash
npx verfix run --flow login --output json
```

Output:

```json
{
  "passed": true,
  "failures": [],
  "timeline_url": "http://localhost:3610/?executionId=exec_abc123",
  "exit_code": 0,
  "execution_id": "exec_abc123"
}
```

### 3. Open the Dashboard

Visit **http://localhost:3610** (or the port in `.verfix/runtime.json`) to see execution timelines, screenshots, and event replays.

---

## Commands

### `verfix init`

Interactive setup wizard. Configures the runtime, scaffolds flows, and generates `AGENTS.md`.

```bash
verfix init
```

### `verfix start`

Start the Verfix runtime container. Pulls the image if not present, waits for health check.

```bash
verfix start
# ✓ Verfix runtime is running
#     API:       http://localhost:3611
#     Dashboard: http://localhost:3610
```

Default runtime ports are `3610` (dashboard) and `3611` (API).
If they are occupied, Verfix automatically picks the next free pair (`3612/3613`, etc.) and persists them to `.verfix/runtime.json`.

### `verfix stop`

Stop and remove the runtime container.

```bash
verfix stop
# ✓ Runtime stopped
```

### `verfix status`

Check runtime, API, and dashboard health at a glance.

```bash
verfix status
#   Runtime:    running
#   API:        healthy   (http://localhost:3611)
#   Dashboard:  healthy   (http://localhost:3610)
#   Image:      ghcr.io/verfix-dev/verfix-server:latest
#   Uptime:     2h 14m
```

### `verfix run`

Execute a verification flow and get structured results.

```bash
# Run a specific flow from verfix.config.json
verfix run --flow login --output json

# Run with pretty terminal output
verfix run --flow login --output pretty

# Override URL and mode
verfix run --flow checkout --url http://localhost:5173 --mode strict

# Run against a custom config
verfix run --config path/to/verfix.config.json --flow signup
```

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --flow <id>` | Flow ID to run | — |
| `-u, --url <url>` | Override target URL | from config |
| `-m, --mode <mode>` | `strict` · `assisted` · `exploratory` | from config |
| `-o, --output <fmt>` | `json` · `pretty` | `json` |
| `-c, --config <path>` | Config file path | `./verfix.config.json` |
| `--timeout <ms>` | Timeout per flow | `15000` |
| `--retries <n>` | Retries on failure | `2` |
| `--dashboard <url>` | Dashboard URL for links | `http://localhost:3610` |

### `verfix logs`

Tail container logs in real-time.

```bash
verfix logs
verfix logs --tail 100
```

### `verfix update`

Pull the latest image and restart.

```bash
verfix update
# ✔ Image updated
# ✔ Verfix runtime is running (updated)
```

### `verfix doctor`

Run diagnostic checks on your setup. Returns the number of failures as exit code.

```bash
verfix doctor
#   ✓ Docker installed
#   ✓ Docker daemon running
#   ✓ Container running
#   ✓ API healthy
#   ✓ Dashboard reachable
#   ✓ verfix.config.json found
#   ✓ AGENTS.md found
#
#   All checks passed!
```

### `verfix flows`

List all flows defined in your config. Agents use this to discover what's available.

```bash
verfix flows
#   Flows in verfix.config.json (3):
#
#   ▸ login
#     4 step(s), 2 assertion(s)
#     navigate → type → type → click
#     Run: verfix run --flow login --output json
#
#   ▸ signup
#     5 step(s), 2 assertion(s)
#     navigate → type → type → type → click
#     Run: verfix run --flow signup --output json
#
#   ▸ dashboard-load
#     1 step(s), 3 assertion(s)
#     navigate
#     Run: verfix run --flow dashboard-load --output json

# JSON output for programmatic use
verfix flows --output json
```

### `verfix list`

List recent verification executions.

```bash
verfix list
```

---

## Configuration

### `verfix.config.json`

This file is a **flow library** — it holds many independent verification flows. Each flow tests a specific user journey and can be run individually with `--flow <id>`.

```json
{
  "baseUrl": "http://localhost:3000",
  "mode": "assisted",
  "flows": [
    {
      "id": "login",
      "steps": [
        { "action": "navigate", "url": "/login" },
        { "action": "type", "selector": "[data-testid=email]", "value": "test@example.com" },
        { "action": "type", "selector": "[data-testid=password]", "value": "password123" },
        { "action": "click", "selector": "[data-testid=submit]" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/dashboard" },
        { "type": "no_console_errors" }
      ]
    },
    {
      "id": "signup",
      "steps": [
        { "action": "navigate", "url": "/signup" },
        { "action": "type", "selector": "[data-testid=name]", "value": "Test User" },
        { "action": "type", "selector": "[data-testid=email]", "value": "new@example.com" },
        { "action": "type", "selector": "[data-testid=password]", "value": "password123" },
        { "action": "click", "selector": "[data-testid=submit]" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/dashboard" },
        { "type": "no_console_errors" }
      ]
    },
    {
      "id": "dashboard-load",
      "steps": [
        { "action": "navigate", "url": "/dashboard" }
      ],
      "assertions": [
        { "type": "page_loaded" },
        { "type": "selector_visible", "selector": "[data-testid=dashboard]" },
        { "type": "no_console_errors" }
      ]
    }
  ]
}
```

Run individual flows:

```bash
verfix run --flow login --output json      # just login
verfix run --flow signup --output json     # just signup
verfix run --output json                   # all flows
```

### Verification Modes

| Mode | Description | Best for |
|------|-------------|----------|
| **strict** | Deterministic selectors only. No AI involved. | CI/CD, regression testing |
| **assisted** | Deterministic first, AI fallback for broken selectors. | Active development |
| **exploratory** | AI-driven navigation from natural language tasks. | Discovery, new features |

### Assertion Types

| Type | Description |
|------|-------------|
| `page_loaded` | Page finished loading |
| `selector_visible` | CSS selector is visible in the DOM |
| `text_visible` | Text string appears on the page |
| `url_contains` | URL includes a substring |
| `no_console_errors` | No `console.error()` calls detected |
| `network_request_success` | A network request returned 2xx |
| `title_contains` | Page title includes a substring |

### Flow Actions

| Action | Fields | Description |
|--------|--------|-------------|
| `navigate` | `url` | Navigate to a URL path |
| `click` | `selector` or `testId` | Click an element |
| `type` | `selector` or `testId`, `value` | Type text into an input |
| `wait_for_selector` | `selector`, `timeout` | Wait for an element to appear |

---

## Output Contract

Every `verfix run --output json` returns this shape — stable, parseable, and designed for agent consumption:

```json
{
  "passed": false,
  "failures": [
    {
      "type": "selector_not_found",
      "selector": "[data-testid=submit]",
      "fix_hint": "Element not found. Check that the selector matches a visible DOM element."
    }
  ],
  "timeline_url": "http://localhost:3610/?executionId=exec_abc123",
  "exit_code": 1,
  "execution_id": "exec_abc123"
}
```

### Failure Types

Agents can pattern-match on these stable failure type strings:

| Type | Meaning |
|------|---------|
| `selector_not_found` | CSS/testId selector matched zero elements |
| `selector_not_visible` | Element exists but is hidden |
| `text_mismatch` | Expected text not found on the page |
| `url_mismatch` | URL doesn't contain expected substring |
| `console_error` | `console.error()` was detected |
| `network_failure` | Network request returned non-2xx |
| `timeout` | Operation exceeded timeout duration |
| `assertion_failed` | Generic fallback — check `fix_hint` |

---

## Agent Integration

Verfix is designed for AI coding agent loops. The config is a **flow library** — agents select which flow to run based on what they just edited:

```
1. Agent edits code (e.g. login form)
2. Agent selects the matching flow: verfix run --flow login --output json
3. If passed → move to next task
4. If !passed → read failures[0].fix_hint → apply fix → retry
5. If no matching flow exists → agent creates one in verfix.config.json
6. After 3 failures → stop and show timeline_url for human review
```

### `AGENTS.md`

Running `verfix init` generates an `AGENTS.md` file with instructions that coding agents (Cursor, Claude Code, Codex, etc.) automatically pick up. It includes:

- The full config schema so agents can create and edit flows autonomously
- All supported step actions, assertion types, and target resolution strategies
- A flow selection guide (which flow to run for which code change)
- Complex flow examples (checkout, form validation, etc.)
- The output contract and failure type taxonomy
- The complete edit → verify → fix loop

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VERIFY_API` | Override API base URL | `http://localhost:3611` |
| `VERIFY_DASHBOARD` | Override Dashboard URL | `http://localhost:3610` |
| `AI_API_KEY` | API key for AI-powered modes | — |
| `AI_MODEL` | AI model for assisted/exploratory | `gpt-4o-mini` |

---

## Architecture

The entire runtime runs inside a single Docker container:

```
┌──────────────────────────────────────────────┐
│              verfix container                │
│                                              │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Go API  │  │  Redis   │  │ PostgreSQL │  │
│  │  :3611  │  │  Queue   │  │   Store    │  │
│  └────┬────┘  └────┬─────┘  └─────┬──────┘  │
│       │            │              │          │
│       v            v              │          │
│  ┌──────────────────────┐        │          │
│  │  Playwright Workers  │────────┘          │
│  │  (Chromium headless)  │                   │
│  └──────────────────────┘                   │
│                                              │
│  ┌──────────────────────┐                   │
│  │  Next.js Dashboard   │                   │
│  │       :3610          │                   │
│  └──────────────────────┘                   │
└──────────────────────────────────────────────┘
        ▲
        │  CLI / SDK / Agent
        │
   verfix run --flow login
```

- **API** (`:3611` by default) — Receives verification jobs, queues them, serves results
- **Workers** — Pulls jobs from Redis, executes Playwright flows, captures artifacts
- **Dashboard** (`:3610` by default) — Visual execution timeline with screenshots, events, and replays
- **PostgreSQL** — Persistent execution history
- **Redis** — Job queue (BullMQ)

---

## Requirements

| Dependency | Version |
|------------|---------|
| Node.js | ≥ 18 |
| Docker | ≥ 20.10 |
| Disk space | ~1.5 GB (Docker image) |

---

## Links

- 🌐 **Website**: [verfix.dev](https://verfix.dev)
- 📖 **Documentation**: [verfix.dev/docs](https://verfix.dev/docs)
- 🐙 **GitHub**: [github.com/verfix-dev/verfix](https://github.com/verfix-dev/verfix)
- 🐛 **Issues**: [github.com/verfix-dev/verfix/issues](https://github.com/verfix-dev/verfix/issues)
- 📦 **Docker Image**: [ghcr.io/verfix-dev/verfix-server](https://github.com/verfix-dev/verfix/pkgs/container/verfix-server)

---

## Contributing

We welcome contributions. See the [Contributing Guide](https://github.com/verfix-dev/verfix/blob/main/CONTRIBUTING.md) for development setup, architecture overview, and coding standards.

---

## License

Apache 2.0 — see [LICENSE](https://github.com/verfix-dev/verfix/blob/main/LICENSE.md).
