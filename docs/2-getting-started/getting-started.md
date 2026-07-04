# Getting Started

Verfix is a local-first AI verification runtime. This guide will walk you through setting up Verfix and running your first verification flow. All you need is Node.js 20+ — no Docker, no services.

## 1. Installation

The easiest way to get started is using the Verfix CLI to initialize your project:

```bash
npx verfix init
```

> **Tip:** For non-interactive environments, CI/CD pipelines, or AI coding agents, pass the `--yes` (or `-y`) flag: `npx verfix init --yes`. See the main README for all available configuration flags and environment variables.

This command will:
1. Detect your app's local URL and ask for the verification mode (default `strict` — fully deterministic, no AI key needed).
2. Make sure a Chromium browser is available (downloads it once if missing, ~130MB, cached in `~/.cache/ms-playwright`).
3. Create a `verfix.config.json` file for your configuration.
4. Add a short Verfix stub to `AGENTS.md` — the universal instructions standard read natively by Codex, Cursor, GitHub Copilot, Kilo, opencode, Zed, Jules, and 20+ other agents — that points coding agents at the full reference in `.verfix/INSTRUCTIONS.md`. This keeps an existing `AGENTS.md` from being bloated: the detailed schema, workflow, and flow-writing guide live in the standalone file, loaded on demand. For tools that don't read `AGENTS.md` natively, verfix also writes the same stub to any detected `CLAUDE.md` (Claude Code), `.github/copilot-instructions.md` (Copilot IDE), or `.clinerules/verfix.md` (Cline).

There is no runtime to start: `verfix run` executes the browser engine
in-process and exits when it's done.

## 2. Your First Verification

Open the `verfix.config.json` file generated in step 1 and add a simple configuration:

```json
{
  "baseUrl": "https://example.com",
  "mode": "strict",
  "task": "Verify the domain is example.com",
  "assertions": [
    { "type": "text_visible", "value": "Example Domain" }
  ]
}
```

Run it using the CLI:

```bash
npx verfix run
```

Alternatively, you can specify the config explicitly:
```bash
npx verfix run -c verfix.config.json
```

## 3. Inspect the Recorded Trace

Every run records a full Playwright trace (screenshots, network requests,
console output) under `.verfix/runs/`. Open the most recent one in the
Playwright trace viewer:

```bash
npx verfix show
```

Or a specific run by its execution id (printed in the run output):

```bash
npx verfix show exec_abc123
```

`npx verfix list` shows the recent runs, and `npx verfix status` summarizes your
setup (config, browser, last run).

> **Server runtime (optional):** the Docker-based runtime with the timeline
> dashboard still exists for the future hosted product. Opt in with
> `npx verfix init --server` / `npx verfix run --server`. See
> [Docker Runtime](../4-guides/docker-runtime.md).
