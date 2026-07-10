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

To read a run's captured logs in the terminal instead of the trace viewer —
full untruncated console error text and every network request with status and
timing (handy for writing `exclude` / `acceptStatuses` after a failure):

```bash
npx verfix show --console            # newest run's console log
npx verfix show exec_abc123 --network --output json
```

Pretty `--network` output leads with an anomaly summary (`⚠ N failed
request(s):`) for any request with status `>= 400` or `0`, so you don't have
to eyeball hundreds of 2xx requests to spot the one that broke. Narrow either
`--console` or `--network` to entries containing a plain (case-insensitive,
non-regex) substring with `--filter` — it matches URL for `--network`, and
text/source_url for `--console`. JSON output also gets a `failed_requests`
array alongside `network_requests`:

```bash
npx verfix show --network --filter auth
npx verfix show exec_abc123 --network --filter auth --output json
```

To see steps, console lines, and network requests interleaved in one
time-sorted view instead of cross-referencing three logs by hand, use
`--timeline`. `--last <seconds>` narrows to the window before the run's
final event (the part that matters when diagnosing a failure), and
`--filter` composes with it the same way it does with `--console`/`--network`
(matching the step's message/flow/action/target, the console text/source_url,
or the network URL, depending on each entry's kind):

```bash
npx verfix show --timeline --last 5
npx verfix show exec_abc123 --timeline --filter login --output json
```

When a selector fails, dry-run replacements against the run's saved DOM
snapshot in about a second — instead of paying for a full re-run per guess:

```bash
npx verfix probe --selector "[data-testid=submit]" --text "Welcome back"
```

Exit code 0 means every query matched; 1 means something didn't. The snapshot
is end-of-run state (at-failure state for failed runs), so it's exactly the
DOM your failed selector was tested against.

`npx verfix list` shows the recent runs, and `npx verfix status` summarizes your
setup (config, browser, last run).

> **Server runtime (optional):** the Docker-based runtime with the timeline
> dashboard still exists for the future hosted product. Opt in with
> `npx verfix init --server` / `npx verfix run --server`. See
> [Docker Runtime](../4-guides/docker-runtime.md).
