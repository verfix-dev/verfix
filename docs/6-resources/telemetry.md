# Telemetry & Privacy

Verfix CLI collects anonymous usage telemetry. This metadata helps us distinguish real developer usage and active continuous integration (CI) flows from bots, curiosity-driven registry downloads, and package mirrors.

Telemetry is fully open-source and can be reviewed in [cli/src/telemetry.ts](../../cli/src/telemetry.ts).

---

## Privacy-First Architecture

* **Anonymous Identifiers:** We generate a completely random UUID on first execution and store it locally at `~/.verfix/.machine-id`. This acts as an anonymous tracking ID that doesn't reveal any details about your local system.
* **No Secrets or PII:** Verfix never collects API keys, file system paths, code contents, local application URLs, or task descriptions.
* **Non-Blocking Performance:** Telemetry operations run asynchronously on a lazy-loaded worker path. If telemetry times out or fails, it will fail silently and will never block CLI execution.
* **One-Time Notice:** On first invocation, a single-line message transparently alerts the developer to the anonymous telemetry collection.

---

## Opting Out

If you wish to disable telemetry collection, you can set either of the following environment variables:

```bash
# Disable via Verfix-specific option
export VERFIX_TELEMETRY=off

# Or use the universal standard
export DO_NOT_TRACK=1
```

Once defined, all network traffic to the telemetry server is completely bypassed.

---

## Tracked Commands and Events

### 1. `cli_init`
Triggered when running `verfix init`.

* **interactive:** `true` if run with interactive prompts; `false` if run in `--yes` mode.
* **dry_run:** `true` if dry-running setup.
* **provider:** Selected AI provider name (e.g. `openai`, `anthropic`, `gemini`).
* **model:** Selected AI model identifier (e.g. `gpt-5.4-mini`).
* **mode:** Selected verification mode (`strict`, `assisted`, `exploratory`).

### 2. `cli_run`
Triggered when running `verfix run`.

* **mode:** The verification mode.
* **flow_count:** The number of flows executed in the current verification cycle.
* **has_config:** `true` if a custom `verfix.config.json` was loaded.
* **passed:** `true` if the verification succeeded; `false` otherwise.
* **duration_ms:** Execution time in milliseconds.

### 3. `cli_start`
Triggered when starting the container runtime using `verfix start`.

* **status:** Status code of the startup attempt (`attempted`, `already_running`, `health_check_failed`, `started`, `error`).

### 4. `cli_doctor`
Triggered when executing diagnostics via `verfix doctor`.

* **failures:** The count of check failures.
* **warnings:** The count of check warnings.
* **passed:** `true` if all diagnostic checks passed.
* **check_connectivity:** `true` if AI provider connectivity checks were requested.
* **provider:** The currently configured AI provider.
* **model:** The configured AI model.

---

## Context Parameters

Every telemetry event automatically appends basic system metadata to help segment environment details:

* **os_platform:** (e.g. `linux`, `darwin`, `win32`)
* **os_arch:** (e.g. `x64`, `arm64`)
* **node_version:** Current Node.js runtime version
* **cli_version:** Current installed version of Verfix
* **is_ci:** `true` if executing within a known CI/CD environment (GitHub Actions, GitLab CI, CircleCI, etc.)
