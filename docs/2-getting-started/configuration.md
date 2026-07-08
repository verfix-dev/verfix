# Configuration

Verfix configuration is managed via environment variables within the `.verfix/.env` file generated during initialization.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` / provider key (e.g. `OPENAI_API_KEY`) | `""` | Your LLM provider + API key. Required only for Assisted/Exploratory modes — strict mode needs no key. |
| `AI_MODEL` | provider default | The model used for semantic reasoning. |
| `VERFIX_RUNNER` | `local` | `local` (in-process engine, no Docker) or `server` (Docker runtime). The `--server` CLI flag sets this per-invocation. |
| `MAX_CONCURRENCY` | `3` | Maximum number of concurrent Playwright browsers (server mode). |
| `API_PORT` | `3611` | Port for the Go API (server mode). |
| `DASHBOARD_PORT` | `3610` | Port for the Next.js UI (server mode). |

## `verfix.config.json` options (selected)

Beyond flows, a few config fields shape how targets are resolved and how source
edits are governed:

| Field | Default | Description |
|---|---|---|
| `selectors` | `{}` | Alias map of logical name → real selector. Steps referencing an alias are resolved at run time, so you can retarget elements without editing project source. |
| `sourceCodePolicy` | `warn` | What happens when project source is edited during a verify loop: `warn` (report only), `block` (fail with `source_edit_blocked`), or `off`. See [Config-First Verification](../4-guides/config-first-verification.md). |
| `browser` | `{}` | Local-mode browser options: `{ "channel": "chrome" }` reuses your installed Chrome (skips the Chromium download); `{ "headless": false }` shows the browser window. |

### Per-flow and per-step options

| Field | Where | Description |
|---|---|---|
| `optional` | step | Best-effort step. If it fails for any reason within its `timeout`, it is skipped (logged as a timeline event) instead of aborting the flow. Use it for a UI branch that may or may not appear — e.g. click a "logout previous session" confirmation dialog if it shows up, then continue. Give it a short `timeout` so a dialog that never appears doesn't cost the full default wait. |
| `clearState` | flow | Clears cookies and `localStorage`/`sessionStorage` before this flow runs. Use it on a flow that must start logged-out, so a stale session from a previous run doesn't produce an unexpected response. Does not clear IndexedDB or service workers. |
| `saveState` | flow | After this flow's steps **and assertions** pass, saves the browser's cookies (including `httpOnly`), `localStorage`, IndexedDB (covers Firebase Auth / MSAL token caches), and `sessionStorage` (covers JWT-in-sessionStorage SPAs; stored in a `<name>.session.json` sidecar and re-seeded per tab on restore) under this name (in `.verfix/state/`, never committed). Put it on your login flow. |
| `useState` | flow | Restores the named state before the run navigates, so the flow starts already logged in — no re-implementing login in every flow. If the state doesn't exist yet or the session has expired, the flow fails normally; rerun the `saveState` flow to (re)create it. One state name per run. |
| `timeout` | step | Per-step override of the default action timeout (already existed). |
| `waitUntil` | step | For `navigate`: the Playwright load state to wait for — `load` (default), `domcontentloaded`, `networkidle`, or `commit`. Avoid `networkidle` on pages that poll continuously (stats, live dashboards): the network never goes quiet, so it times out nondeterministically — navigate with the default and follow with a `wait_for_selector` on the content you need. |
| `key` | step | Keyboard key for a `press` step (Playwright key name, e.g. `"Enter"`, `"Escape"`, `"Tab"`). Pressed on the step's target if given, otherwise at the page level. |
| `file` | step | For `upload_file`: either a project-relative path to a committed fixture (`"fixtures/avatar.png"`, `${VAR}` substitution supported), or inline content materialized at run time — `{ "name": "note.csv", "content": "a,b\n1,2", "mimeType": "text/csv" }` (`"encoding": "base64"` for binary). Inline needs no filesystem, so it's the CI-safe default — but keep it to a few KB; `verfix validate` warns above 64KB (use a fixture path instead). Target the `<input type=file>` even if it's hidden behind a styled button. |
| `frame` | step | CSS selector of an `<iframe>`; the step's `selector`/`testId`/`text` target is resolved inside that frame (payment widgets, embedded editors). One frame level; AI selector-healing does not apply inside frames. |

```json
{
  "flows": [
    {
      "id": "login",
      "clearState": true,
      "saveState": "auth",
      "steps": [
        { "action": "type", "selector": "emailInput", "value": "${TEST_EMAIL}" },
        { "action": "type", "selector": "passwordInput", "value": "${TEST_PASSWORD}" },
        { "action": "click", "selector": "submitBtn" },
        { "action": "click", "text": "Logout previous session and login here", "optional": true, "timeout": 2000 }
      ],
      "assertions": [
        { "type": "network_request_success", "value": "/api/auth/login", "acceptStatuses": [200, 409] }
      ]
    }
  ]
}
```

### `${VAR}` environment substitution

Step `value`/`url`, assertion `value`, and `baseUrl` may reference an
environment variable with `${VAR_NAME}` syntax. It's resolved from
`process.env` at run time — which already includes anything set in
`.verfix/.env` — so secrets never need to be committed in
`verfix.config.json`. An unset variable fails the run immediately with a
clear error naming the missing variable, rather than typing the literal
`${VAR_NAME}` string into a form field.

Two macros are built in (no env var needed; an explicitly-set env var of the
same name wins):

| Macro | Value |
|---|---|
| `${TIMESTAMP}` | Epoch milliseconds at run start |
| `${RANDOM}` | 8 random alphanumeric characters |

Each resolves **once per run**: the same token yields the same value across
every step and assertion, so a flow can type `item-${RANDOM}` into a form and
assert the same `item-${RANDOM}` is visible afterwards. Use them wherever a
backend enforces uniqueness ("create product", "register user") so reruns stay
idempotent without manually bumping values.

### Job timeout

`--timeout <ms>` (or config `timeout`, default 15000) is the **per-step**
budget. A whole run is additionally capped by a hard wall-clock timeout of
`max(timeout × 4, timeout × (steps + assertions + 2), 60s)` — it scales with
the size of the flow chain, so long multi-flow runs don't need splitting. On
breach the run is torn down and reported as a failed result (with its trace
preserved); it is **not retried**, since a timed-out job would collide with
its own retry. Raise `timeout` to raise the cap.

## External Dependencies

Local mode (the default) has none — results are plain files under
`.verfix/runs/`. The opt-in server runtime (`--server`) bundles Redis and
PostgreSQL inside its Docker container.
