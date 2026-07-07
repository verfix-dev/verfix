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

It's a local-first runtime that gives coding agents deterministic browser verification. Define browser flows in JSON, run them from the CLI, and get structured pass/fail results that agents can parse and act on automatically. Everything runs in a single Node.js process on your machine — no Docker, no services.

**No cloud. No accounts. No Docker. One command to start.**

```
npx verfix init
```

---

## Quick Start

### Prerequisites

- **Node.js** 20+ (that's it)

### 1. Initialize

Run the interactive setup wizard in your project root:

```bash
npx verfix init
```

This will:
- Detect your app's port automatically
- Ask for the verification mode (default `strict` — fully deterministic, no AI key needed)
- Download Chromium if needed (~130MB, one-time, cached in `~/.cache/ms-playwright`)
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
  "timeline_url": null,
  "trace_path": "/your/project/.verfix/runs/exec_abc123_trace.zip",
  "show_command": "verfix show exec_abc123",
  "detail_commands": {
    "console": "verfix show exec_abc123 --console --output json",
    "network": "verfix show exec_abc123 --network --output json"
  },
  "duration_ms": 3120,
  "retry_count": 0,
  "exit_code": 0,
  "execution_id": "exec_abc123"
}
```

### 3. Open the recorded trace

```bash
npx verfix show exec_abc123    # or just `verfix show` for the newest run
```

Every run records a full Playwright trace — screenshots of each step, network
requests, and console output — persisted under `.verfix/runs/` (newest 20 kept).

---

## Commands

### `verfix init`

Interactive setup wizard. Configures the runtime, scaffolds flows, and generates `AGENTS.md`.

```bash
verfix init
```

### `verfix show`

Open the Playwright trace viewer for a run (newest run if no id given).

```bash
verfix show                  # newest run
verfix show exec_abc123      # specific run
```

### `verfix status`

Check your setup at a glance.

```bash
verfix status
#   Runner:    local (no Docker needed — use --server for the container runtime)
#   Config:    verfix.config.json
#   Chromium:  installed
#   Last run:  passed  exec_abc123  (verfix show exec_abc123)
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

# Show the browser window
verfix run --flow checkout --show-browser

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
| `--show-browser` | Show browser window (local mode) | `false` |
| `--server` | Run via the Docker server runtime | `false` |

### `verfix doctor`

Run diagnostic checks on your setup. Exits non-zero on failures.

```bash
verfix doctor
#   ✓ Node 24.15.0
#   ✓ verfix.config.json valid
#   ✓ AGENTS.md found
#   ✓ Chromium installed
#   ✓ App reachable at http://localhost:3000
#   • AI key not needed (strict mode)
#   • Docker installed — optional (server mode only, see --server)
#
#   All checks passed!
```

### Server runtime commands (`--server`)

The Docker server runtime (API + queue + timeline dashboard — the base of the
future hosted product) is opt-in. `start`, `stop`, `logs`, and `update` manage
it; pass `--server` (or set `VERFIX_RUNNER=server`):

```bash
verfix start --server        # pull + start the container
verfix run --server ...      # run through the API/queue
verfix logs --server         # tail container logs
verfix stop --server         # stop and remove the container
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
| `press` | `key`, optional target | Press a keyboard key (on a target or page-wide) |
| `select_option` | `selector`, `value` | Pick a `<select>` option by value or label |
| `check` / `uncheck` | `selector` | Set a checkbox/radio to a known state (idempotent) |
| `hover` | `selector` | Hover to reveal hover-only UI |
| `upload_file` | `selector`, `file` | Set a file input — fixture path or inline `{ name, content }` |
| `wait_for_selector` | `selector`, `timeout` | Wait for an element to appear |
| `wait_for_url` | `value` | Wait until the URL contains a substring |
| `wait_for_network_idle` | — | Wait for network activity to settle |

Any step also takes `optional: true` (skip on failure instead of aborting — skips are reported in the JSON output) and `frame` (a CSS selector of an `<iframe>` to resolve the target inside). Flows take `clearState`, and `saveState`/`useState` for auth session reuse.

---

## Output Contract

Every `verfix run --output json` returns this shape — stable, parseable, and designed for agent consumption:

```json
{
  "passed": false,
  "failures": [
    {
      "type": "selector_not_found",
      "flow": "login",
      "assertion": "selector_visible",
      "selector": "[data-testid=submit]",
      "fix_hint": "Element not found. Check that the selector matches a visible DOM element."
    }
  ],
  "timeline_url": null,
  "trace_path": "/your/project/.verfix/runs/exec_abc123_trace.zip",
  "show_command": "verfix show exec_abc123",
  "detail_commands": {
    "console": "verfix show exec_abc123 --console --output json",
    "network": "verfix show exec_abc123 --network --output json"
  },
  "duration_ms": 4231,
  "retry_count": 0,
  "exit_code": 1,
  "execution_id": "exec_abc123"
}
```

`timeline_url` is `null` in local runs (it points at the dashboard only in
server mode); `trace_path`/`show_command` point at the recorded Playwright trace.

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
6. After 3 failures → stop and give the human the show_command (verfix show <id>) for trace review
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
| `VERFIX_RUNNER` | `local` (in-process) or `server` (Docker runtime) | `local` |
| `AI_PROVIDER` + provider key (e.g. `OPENAI_API_KEY`) | AI credentials for assisted/exploratory modes | — |
| `AI_MODEL` | AI model for assisted/exploratory | provider default |

---

## Architecture

By default the CLI runs the verification engine (`@verfix/engine`,
Playwright-based) directly in-process:

```
   verfix run --flow login
        │
        v
┌──────────────────────────────┐
│   CLI process (Node.js)      │
│                              │
│   @verfix/engine             │
│   + Chromium (headless)      │
└──────────────┬───────────────┘
               v
   .verfix/runs/<id>.json + trace zip
               │
               v
       verfix show <id>
```

An opt-in Docker **server runtime** (`--server`) packages a Go API, Redis
queue, containerized workers, PostgreSQL, and the timeline dashboard — the
foundation of the future hosted CI product.

---

## Requirements

| Dependency | Version |
|------------|---------|
| Node.js | ≥ 20.20.0 |
| Disk space | ~130 MB (Chromium, one-time, shared across projects) |
| Docker | only for the opt-in `--server` runtime |

---

## Links

- 🌐 **Website**: [verfix.dev](https://verfix.dev)
- 📖 **Documentation**: [verfix.dev/docs](https://verfix.dev/docs)
- 🐙 **GitHub**: [github.com/verfix-dev/verfix](https://github.com/verfix-dev/verfix)
- 🐛 **Issues**: [github.com/verfix-dev/verfix/issues](https://github.com/verfix-dev/verfix/issues)
- 📦 **Docker Images**: [verfix-server](https://github.com/verfix-dev/verfix/pkgs/container/verfix-server) · [verfix-server-slim](https://github.com/verfix-dev/verfix/pkgs/container/verfix-server-slim)

---

## Contributing

We welcome contributions. See the [Contributing Guide](https://github.com/verfix-dev/verfix/blob/main/CONTRIBUTING.md) for development setup, architecture overview, and coding standards.

---

## License

Apache 2.0 — see [LICENSE](https://github.com/verfix-dev/verfix/blob/main/LICENSE.md).
