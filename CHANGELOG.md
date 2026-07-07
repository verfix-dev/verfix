# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Auth state reuse** (`saveState` / `useState` flow fields). A flow that logs in can persist the browser's cookies (incl. `httpOnly`), `localStorage`, and IndexedDB under a name once its steps *and* assertions pass; other flows — including in later runs — restore it at context creation and start authenticated. States live in `.verfix/state/` (never committed; `.verfix` self-ignores). `verfix validate` warns when a `useState` name is never saved by any flow. `sessionStorage` is not captured.
- **`select_option`, `check`, `uncheck`, `hover` flow steps.** `select_option` matches an option by value or visible label; `check`/`uncheck` are idempotent (unlike `click` on a checkbox), keeping reruns deterministic.
- **`upload_file` flow step.** `file` accepts a project-relative fixture path (`${VAR}` substitution supported) or CI-safe inline content (`{ name, content, mimeType, encoding }`, `base64` for binary) materialized at run time with no filesystem dependency. Targets the `<input type=file>` by attachment, not visibility, since real UIs hide it behind styled buttons. `verfix validate` warns when inline content exceeds 64KB.
- **`wait_for_url` and `wait_for_network_idle` flow steps.** Substring URL wait (same semantics as the `url_contains` assertion) for client-side redirects, and a network-idle settle for background-loaded data.
- **`frame` step field (iframe targeting).** Resolves the step's `selector`/`testId`/`text` inside an `<iframe>` (payment widgets, embedded editors). Deterministic only — AI healing does not apply inside frames.
- **Scoped `text_visible`.** Optional `selector` on the assertion scopes the text search to matches inside that element. Unscoped, duplicated text no longer fails on Playwright's strict-mode violation — the assertion passes if any visible occurrence matches.
- **`verfix show --console` / `--network`.** Prints a run's captured console log (full untruncated error text) and network requests (status, method, timing) in pretty or `--output json` form — no more reading `_console.json` out of `.verfix/runs/` by hand. Defaults to the newest run when no execution id is given.
- **`verfix run --quiet`.** JSON output without the raw event timeline — only the stable contract fields (`passed`, `failures`, `fix_hint`s, `trace_path`, `show_command`, `timeline_url`). Details stay pull-on-demand via `verfix show`. Default output is unchanged.
- **AI rate-limit circuit breaker.** After 3 consecutive 429 responses, AI calls (self-healing, failure analysis) are disabled for the remainder of the run with a single log line, instead of retrying and failing on every step. Deterministic fallbacks are unaffected; the breaker resets at the start of each run.

## [0.3.5] - 2026-07-06

### Added
- **`press` flow step action.** Sends a keyboard key (`"Enter"`, `"Escape"`, `"Tab"`, etc.) — on a target locator when `selector`/`testId`/`text` is given, or at the page level otherwise. Fills a gap `type`'s `fill()` doesn't cover: UIs that submit or react on a `keydown` handler rather than form submission (search boxes, chat inputs, custom shortcuts).

### Fixed
- **Server Docker image failed to build.** `workers/` is an npm workspace member with no lockfile of its own, so `npm ci` in `Dockerfile.server`'s `workers-builder` and `final` stages errored with `EUSAGE`. Added a standalone `workers/package-lock.json`.
- **Latent `ioredis` version-skew bug**, surfaced by the fix above: `workers/package.json` declared `ioredis: ^5.10.1` while `bullmq`'s nested `ioredis` is pinned to exactly `5.10.1`. The monorepo's hoisted install happened to dedupe them, but a standalone install (what Docker does) resolved two incompatible `ioredis` copies side by side and broke the TypeScript build. Pinned to the exact version bullmq requires.
- Bumped `node:20-alpine`/`node:20-slim` → `node:22` in `Dockerfile.server`, and the GitHub Actions in `publish-server.yml` (checkout, buildx, login, metadata, build-push) to their latest majors — Node 20 is deprecated on GitHub-hosted runners.

### Changed
- **`@verfix/engine` bumped to `0.1.3`.** CLI dependency bumped to `^0.1.3`.
- Generated `.verfix/INSTRUCTIONS.md` now documents the `press` action.

## [0.3.4] - 2026-07-06

### Added
- **`${VAR}` env-var interpolation in config.** Flow step `value`/`url` and assertion `value` fields may reference `${VAR_NAME}`, resolved from `process.env` (including `.verfix/.env`) at run time — secrets no longer need to live in `verfix.config.json`. An unset variable fails the run immediately, naming the variable and its field path.
- **Optional flow steps.** Any step accepts `"optional": true` — if it fails for any reason within its `timeout`, it's skipped instead of aborting the flow. Use it for a UI branch that may or may not appear (e.g. a "logout previous session" dialog), paired with a short `timeout` so a dialog that never shows doesn't cost the full default wait.
- **Flow `clearState`.** `"clearState": true` on a flow clears cookies + local/session storage before it runs, for flows that must start logged-out (IndexedDB/service workers are left untouched).
- **`network_request_success` `acceptStatuses`.** Replaces the default 200-399 pass range when set, so a flow with more than one valid outcome (e.g. `200` on login success, `409` when a session is already active) doesn't need to branch — list every accepted status explicitly.
- **`no_console_errors` `exclude`.** An array of regex patterns; matching console errors are ignored instead of failing the assertion, for known/expected warnings (e.g. a third-party library notice).
- Both assertions now surface the concrete matched request (method, URL, status) or console error text in the failure's `error`/`fix_hint` on failure, to make it clear whether to add an exception above or fix a real bug.

### Changed
- **`@verfix/engine` bumped to `0.1.2`.** CLI dependency bumped to `^0.1.2`.
- Generated `.verfix/INSTRUCTIONS.md` now documents env-var interpolation, optional steps, `clearState`, and `acceptStatuses`/`exclude`.

## [0.3.3] - 2026-07-05

### Added
- **`verfix validate`** — checks `verfix.config.json` for structural and semantic errors (unknown assertion types, duplicate flow ids, a flow with no steps/assertions, `mode: "exploratory"` set per-flow, exploratory mode missing an AI key) without running anything.
- **Flow `skip` / `skipReason`.** Flows can be quarantined with `"skip": true` (+ optional `"skipReason"`) so a known-broken flow is excluded from a full `verfix run` without being deleted; it still runs if named explicitly via `--flow <id>`.

### Fixed
- **Per-flow `mode` override was silently dropped in multi-flow runs.** It only took effect when a single flow was selected via `--flow`; running multiple flows together always fell back to the global mode. `flow.mode` now correctly overrides the global mode for both step execution and assertions, for any number of flows in one run.
- **Unknown assertion type errors didn't say what was valid.** `Unknown assertion type: X` now appends `Valid types: page_loaded, selector_visible, ...`.
- **Exploratory mode failed only after launching a browser.** `verfix run` now fails fast with `ai_key_required` before launching the browser if the global mode is `exploratory` and no AI provider/key is configured — exploratory has no deterministic fallback (unlike `assisted`, which still works via semantic-selector healing without a key). `mode: "exploratory"` set on an individual flow is now rejected (both by `run` and `validate`) since the engine only ever branches on the top-level mode — a per-flow override was a silent no-op.
- **Assisted mode without an AI key now warns instead of proceeding silently.** `verfix run` prints a one-line stderr warning (JSON output on stdout is unaffected) and `verfix validate` reports it as a non-blocking warning, since assisted mode still works without a key (semantic-selector healing runs regardless; only the AI-fallback tier is skipped).
- **Headless-shell crash on partial Playwright install.** `isChromiumInstalled()` only checked the full Chromium binary (`chromium.executablePath()`), but the engine launches headless by default — which uses a *separate* `chrome-headless-shell` binary. When the full Chromium was present but the headless shell was missing (partial install, interrupted download, or cache cleared), the check passed, `ensureChromium()` skipped the download, and the run crashed with `Executable doesn't exist at chromium_headless_shell-XXXX/...`. Two fixes: (1) `isChromiumInstalled()` now also verifies the `chromium_headless_shell-{rev}` directory exists; (2) `ensureChromium()` no longer uses the check as a fast-path — it always runs `playwright install chromium` (idempotent, <1s when complete, downloads only missing pieces); (3) the retry loop now self-repairs: if a launch fails with "Executable doesn't exist", it re-runs the installer before retrying.

### Changed
- **`@verfix/engine` bumped to `0.1.1`** (`ASSERTION_TYPES` now exported, per-flow mode fix, improved assertion error message). CLI dependency bumped to `^0.1.1`.
- Generated `.verfix/INSTRUCTIONS.md` now documents `verfix validate`, flow `skip`/`skipReason`, the `task` field (previously undocumented despite being required for exploratory mode), and a minimal standalone exploratory-mode example.

## [0.3.1] - 2026-07-04 (local-first)

### Changed — ⚡ Verfix is now local-first (config-compatible)
- **`verfix run` executes in-process by default — no Docker, no Redis, no API server.** The verification engine was extracted from the workers package as **`@verfix/engine`** (`runVerification(payload, opts)`), and the CLI now calls it directly. A clean machine needs only Node 20+; the first run downloads Chromium once (~130MB, cached). Existing `verfix.config.json` files need **zero changes**.
- **Strict mode needs no AI key.** `verfix init` defaults to `strict` and only asks for a provider/key when you pick `assisted`/`exploratory`. Non-interactive `init --yes` completes with zero credentials.
- **Results live in `.verfix/runs/`.** Each run persists `<id>.json` plus a full Playwright trace zip (screenshots, network, console); the newest 20 runs are kept. New commands: **`verfix show [id]`** opens the trace viewer, **`verfix list`** lists recent runs locally.
- **JSON contract:** `timeline_url` is still present but `null` in local runs; additive `trace_path` and `show_command` fields point at the recorded trace. Server-mode output is unchanged.
- **The Docker server runtime is opt-in** via `--server` (on `init`, `run`, `start`, `stop`, `status`, `logs`, `update`, `doctor`, `list`) or `VERFIX_RUNNER=server` in `.verfix/.env`. In local mode, `start`/`stop`/`logs`/`update` print what to do instead; `status` reports config/browser/last-run; `doctor` runs a local check set (Node ≥20, config valid, Chromium, app reachability — Docker is informational only and never a failure).
- **New optional config `browser: { channel?, headless? }`** — `"channel": "chrome"` reuses your installed Chrome and skips the Chromium download.
- A one-time notice tells upgrading users their old runtime container can be reclaimed with `verfix stop --server`.

### Removed
- **Hybrid host-worker mode** (`cli/src/worker-runner.ts`, `VERFIX_BROWSER_MODE`, slim-image auto-selection). Local mode covers its use case natively — the browser runs on your machine and reaches localhost directly. Server mode is container-only. `Dockerfile.server-slim` stays in the repo for the future hosted product.

### Added
- **Lightweight agent instructions (stub + reference split):** `verfix init` no longer injects the full ~580-line instruction block into `AGENTS.md`. The full reference (flow schema, verification workflow, failure table, flow-writing guide) is now written to a standalone **`.verfix/INSTRUCTIONS.md`**, and `AGENTS.md` carries only a compact ~30-line stub (identity, the config-first rule, core commands) that points to it. This keeps projects that already have an `AGENTS.md` from being bloated, and loads the detail on demand. The stub is self-sufficient for the core loop: it tells the agent to verify the specific page it edited, and to create a new flow (reading source for the route + selectors) when none covers the change.
- **Config-First Source Guard:** Verfix now discourages agents from rewriting project source to satisfy broken selectors. Two layers:
  - **Instructions (Layer 1):** The generated agent instructions now encode an explicit config-first precedence ladder: **reuse the element's existing selector from source** (works in `strict` mode) → semantic selector → `assisted`-mode self-healing as a resilience *fallback* → adding a new `data-testid` to source as a **last resort**. Previously the docs told agents to add `data-testid` to source "freely."
  - **Deterministic gate (Layer 2):** `verfix run` snapshots a git baseline at the start of each verify cycle and reports a `source_changes` field listing project files edited during the fix loop. A new `sourceCodePolicy` config option (`warn` (default) | `block` | `off`) controls enforcement — `block` fails the run with a `source_edit_blocked` failure until the source edit is reverted. Legitimate app-bug fixes are still allowed under `warn`.
  - New `run` flags: `--source-policy <warn|block|off>` and `--reset-baseline`. Degrades gracefully (disabled) when not in a git repo.

### Changed
- **Agent files consolidated around the `AGENTS.md` standard.** `AGENTS.md` is now the primary instruction file (read natively by Codex, Cursor, GitHub Copilot, Kilo, opencode, Zed, Jules, and 20+ other agents). `verfix init` stopped generating `CODEX.md` (no tool reads it — Codex reads `AGENTS.md`) and `.cursorrules` (deprecated; Cursor reads `AGENTS.md`). For tools that don't read `AGENTS.md` natively, verfix now writes the same stub to detected `CLAUDE.md` (Claude Code), `.github/copilot-instructions.md` (Copilot IDE), and `.clinerules/verfix.md` (Cline). All agent files share a single stub generator — no more duplicated content across platforms.
- **Source-guard classification** now also treats `.github/copilot-instructions.md`, `.github/instructions/**`, and `GEMINI.md` as `config` (steering the agent), so editing them is never flagged as a project-source change.
- **OS-neutral selector search:** the flow-writing guide no longer hardcodes `grep`; it offers editor search / ripgrep / `grep` / PowerShell `Select-String` so the instructions work on Windows as well as macOS/Linux.

### Fixed
- **`npm install verfix` now resolves `@verfix/engine` out of the box.** The CLI previously declared `"@verfix/engine": "file:../workers"` — a monorepo-local path that shipped verbatim in the published tarball, leaving consumers with a dead symlink and `Cannot find module '@verfix/engine'`. The dependency is now `^0.1.0` (the engine is published to npm), and the repo uses **npm workspaces** so local dev still live-links the `workers/` package. The published tarball carries `^0.1.0`, never a `file:` path.
- **`verfix status` / `verfix doctor` no longer disguise a missing engine as "Chromium not installed".** `isChromiumInstalled()` swallowed the engine's `MODULE_NOT_FOUND` and returned `false`, so a fatal packaging break read as the benign "auto-downloads on first run". A new `isEngineInstalled()` pre-flight reports the real problem (`@verfix/engine not installed — reinstall: npm install verfix`) as a hard failure; `status` and `doctor` JSON now include `engine_installed`.
- **New `verfix install` command** downloads the one-time Chromium browser separately from `verfix run`, and **`verfix run --skip-download`** fails fast with a `browser_not_installed` JSON error (hint: `Run: verfix install`) instead of silently starting a ~130MB download that can time out a bounded tool window. Default `run` behavior (auto-download on first run) is unchanged.
- **`verfix init` now auto-detects an installed Chrome/Edge** and offers to reuse it (writing `browser.channel` to config) instead of downloading Chromium — surfacing the `browser.channel` option that was previously a config-file secret. The bundled Chromium stays the default (the prompt is opt-in, `default: false`) because it's the more deterministic choice for verification; the wizard states the tradeoff explicitly so users know Chrome/Edge can vary by version/policy. Covers macOS, Windows, and Linux install paths. Non-interactive `init --yes` stays on Chromium (the CI-safe default).
- **Config-first target resolution actually works now.** The flow executor (`workers/src/browser/flow-executor.ts`) previously ignored the `selectors` alias map and never invoked self-healing during flow execution (healing only ran in exploratory mode), so the config-without-`data-testid` path was effectively dead. `resolveLocator` now (1) resolves `selectors` alias keys to their real selector, and (2) in `assisted` mode heals unresolved selectors via the accessibility tree (aria-label / role / text) before an AI fallback. Camel/kebab/snake-case tokens are converted to intent hints for better semantic matching. `strict` mode remains fully deterministic.

## [0.2.9] - 2026-06-22

### Fixed
- Minor bug fixes and documentation updates.

## [0.2.8] - 2026-06-22

### Added
- **Hybrid Browser Mode (Host/Container):** Introduced a dual browser execution model with two modes: `host` (default on macOS/Windows) runs Playwright workers directly on the host machine with native localhost access, while `container` (default on Linux) keeps workers inside Docker with `--network=host`. Users can override via `VERFIX_BROWSER_MODE=host|container`.
  - Hybrid mode solves localhost networking issues on macOS/Windows where Docker containers cannot reach host services without a proxy.
  - On container start, the CLI automatically extracts worker files from the Docker image, installs Playwright Chromium locally, and spawns a dedicated local worker process.
  - New `--show-browser` flag on `verfix start` and `verfix run` enables visible browser window for debugging (headful mode).
- **Slim Server Image (`verfix-server-slim`):** A new lightweight Docker image built on SQLite (no PostgreSQL dependency) that CLI automatically selects when running in host browser mode on macOS/Windows, reducing resource overhead.
- **Pluggable Database Backend:** Refactored the Go API to a `Store` interface with two implementations — PostgreSQL (full image, existing behavior) and SQLite (slim image, embedded). This decouples the API from a specific database driver.
- **Local Worker Lifecycle Management:** The CLI now manages local worker processes with proper PID tracking, auto-detection of stale workers, headful/headless mode switching, graceful shutdown (`verfix stop`), and artifact directory bind-mounting for shared access between host workers and the container.
- **Update Checker Browser-Mode Awareness:** The NPM and Docker image update-checker now queries the correct image tag based on the active browser mode (slim vs. full image).

### Fixed
- **Localhost Networking on macOS/Windows:** Replaced the previous CLI TCP proxy approach with hybrid browser mode, providing a more robust and maintainable solution to Docker networking restrictions.
- **Port Conflicts on Host Redis Detection:** The CLI now detects if Redis is already running on the host at port 6379 before mapping container ports, preventing "port is already allocated" errors.

## [0.2.7] - 2026-06-20

### Added
- **Anonymous Telemetry & Analytics:** Integrated privacy-first telemetry with PostHog to track usage metrics for CLI initialization, diagnostic checking, container startups, and verification runs.
  - Automatically respects standard `DO_NOT_TRACK` and `VERFIX_TELEMETRY=off` environment variables.
  - Uses an anonymous tracking identifier generated once and stored in `~/.verfix/.machine-id` (no PII, hostname, or system paths collected).
  - Shows a clear, transparent, one-time privacy notice on the first execution.
  - Telemetry works completely asynchronously on lazy-loaded paths, ensuring zero execution block.
- **Telemetry Documentation:** Added a comprehensive Telemetry & Privacy developer documentation guide.

## [0.2.6] - 2026-06-20

### Added
- **Non-Interactive Setup Wizard Mode (`--yes` / `-y`):** Added support to `verfix init` for unattended execution using flags or environment variables. Particularly useful for automated environments, CI/CD pipelines, and AI coding agents.
- **Provider Auto-Detection:** Automatically detect AI providers (OpenAI, Anthropic, Gemini, OpenRouter) based on the format of the provided API key.
- **Agent Setup Command (`verfix agent-setup`):** A new command outputting machine-readable JSON instructions for AI coding agents to bootstrap Verfix.
- **Graceful Docker Degradation:** Init wizard will warn and continue configuring if Docker is not installed or running, instead of hard failing.
- **Dry-run Mode (`--dry-run`):** Validate settings and preview the generated configurations as JSON without writing files.

## [0.2.5] - 2026-06-16

### Added
- **CLI Local Proxy:** Added transparent TCP proxy (`cli/src/proxy.ts`) for Docker networking on Windows/macOS. Automatically starts a proxy on the host machine when targeting `localhost` or `127.0.0.1` from inside Docker containers.

### Fixed
- **Docker Networking (Windows):** Fixed connection issues when running verification jobs against localhost services on Windows and macOS. The CLI now spawns a local proxy that forwards traffic from the container to the host machine, bypassing Windows Firewall and IPv6 binding restrictions that previously caused `ERR_CONNECTION_REFUSED` errors.
- **Worker Connection Errors:** Improved error messages for connection failures in workers to clearly indicate when host server connectivity issues occur.

## [0.2.2] - 2026-06-14

### Added
- **CLI Update Notifications:** Added industry-standard update notification system for both the CLI npm package and the Docker server image.
  - `verfix start` and `verfix status` now show update banners when a newer version is available.
  - Checks run in a fully detached background process (`update-checker-worker.ts`) so commands remain instant — zero blocking I/O.
  - NPM version check queries `registry.npmjs.org` and caches the result for 24 hours.
  - Docker image digest check compares local and remote GHCR digests without pulling the image.
  - New module `cli/src/update-check.ts` provides `showPendingNotifications()`, `scheduleBackgroundCheck()`, and `clearImageCache()`.

### Changed
- Redesigned the dashboard workspace with a calmer Postman-inspired shell, compact execution history, responsive split panels, and shared light/dark theme tokens.
- Improved dashboard controls with keyboard-focus styling, ARIA labels, selectable history rows, and clearer new-verification validation feedback.
- **Flaky Task Display:** Changed from URL-level to execution-level granularity.
  - Backend `handleFlaky` now returns `failed_execution_ids` so the frontend can mark only the specific failed executions as flaky.
  - Sidebar flaky tag and detail-view "Unstable Target Diagnostics" now only appear on executions that actually failed, not on all executions sharing the same URL.
  - Dashboard `WorkspaceContext` maintains a `flakyExecutionIds` Set for O(1) lookup.

### Fixed
- **Docker Build:** Fixed dashboard build failure caused by `.dockerignore` excluding the `cli/` directory. The CLI source is now copied into the build stage (`Dockerfile.server`) so `next.config.ts` can read `cli/package.json` for version injection.
- **Database Performance:** Added composite index `idx_executions_url_status_passed` on `(url, status, passed)` to speed up flaky URL queries.
- **Database Reliability:** Added `defer idRows.Close()` in `handleFlaky` to prevent resource leaks on early returns.

## [0.2.1] - 2026-06-10

### Added
- **AI Agent Context File:** Added the new [.github/agents.md](file:///home/aditya/projects/verfix/.github/agents.md) file containing coding standards, monorepo architecture, testing instructions, and critical networking guardrails for AI coding assistants.
- **2026 Model Support:** Updated static model lists for OpenAI (`gpt-5.4-mini`/`gpt-5.5`), Anthropic (`claude-sonnet-4-6`/`claude-opus-4-8`), and Gemini (`gemini-3.5-flash`/`gemini-3.5-pro`), and added support for the new Gemini `AQ` key prefix.

## [0.2.0] - 2026-06-10

### Added
- **Multi-provider AI Support:** Implemented custom HTTP-based adapters in the AI runtime to support OpenAI, Anthropic, Gemini, and OpenRouter, completely eliminating the external `openai` SDK dependency.
- **API Key Connectivity Testing:** Added an interactive connectivity test step for AI API keys during the `verfix init` setup wizard.
- **Config Migration & Validation:** Added schema validation and automated configuration migration support for legacy configurations.

### Changed
- Improved Docker networking resolving logic in CLI and workers to handle platform-specific URLs (`host.docker.internal` vs. host networking) across multiple AI providers.

## [0.1.5] - 2026-06-07

### Added
- Programmatic SDK for integration scenarios with class-based API.
- Platform-specific agent rules configuration support.
- Flow composability features for building complex verification workflows.
- Clean JSON output mode for CLI enabling machine-readable output.
- Exit code contracts for CLI commands providing predictable return values.
- Agent platform integration support for expanded extensibility.

### Changed
- SDK upgraded to class-based API for improved ergonomics and type safety.

### Fixed
- Improved image capturing system to save disk space in execution artifacts.

## [0.1.4] - 2026-05-25

### Added
- Introduced runtime port management with new defaults: Dashboard `3610`, API `3611`.
- Added automatic port-pair fallback when defaults are occupied (`3612/3613`, `3614/3615`, ...).
- Added runtime port persistence in `.verfix/runtime.json`.
- Added container-to-CLI runtime port sync so CLI reflects actual running container ports.

### Changed
- Updated CLI commands (`start`, `status`, `run`, `list`, `doctor`, `init`) to use shared runtime-resolved ports.
- Updated dashboard API endpoint resolution to derive API base dynamically from dashboard origin.
- Updated runtime defaults and documentation references from `3000/3001` to `3610/3611`.

### Fixed
- Fixed `verfix init` app-port auto-detection incorrectly selecting runtime/API ports as the user's app port.
- Fixed repeated `init`/`start` workflows to behave idempotently without stale port output.
- Fixed stale API port behavior by adding API health-based fallback discovery (including legacy `3001`) and self-healing runtime port persistence.

## [0.1.3] - 2026-05-23

### Fixed
- Resolved an issue where the CLI version was hardcoded to `0.1.0` inside the Commander configuration. The CLI now dynamically loads its version from `package.json` at runtime.

## [0.1.2] - 2026-05-23

### Fixed
- Fixed Docker container networking issues to reliably access services running on the host machine (e.g., local dev servers).
  - Implemented platform-specific networking: host networking (`--network=host`) on Linux to share the host network stack (allowing native `localhost` and IPv6 access).
  - Maintained bridge mode with `host.docker.internal` DNS resolution on macOS and Windows.

## [0.1.1] - 2026-05-22

### Added
- Implemented the interactive setup wizard via `verfix init` command to configure runtime environments, generate default verification flows, and scaffold `AGENTS.md` guides.
- Improved CLI stability and environment variable persistence into container runtimes.

## [0.1.0] - 2026-05-21

### Added
- Initial release of the Verfix local-first verification runtime.
  - Local Docker-powered execution environment for reliable browser verification.
  - Real-time API service and Execution Replay Dashboard for timeline observability.
  - Built-in assertion engine with automated troubleshooting and fix suggestions.
  - Verification diagnostic CLI utility (`verfix doctor`).
