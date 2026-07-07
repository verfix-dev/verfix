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
| `saveState` | flow | After this flow's steps **and assertions** pass, saves the browser's cookies + `localStorage` under this name (in `.verfix/state/`, never committed). Put it on your login flow. |
| `useState` | flow | Restores the named state before the run navigates, so the flow starts already logged in — no re-implementing login in every flow. If the state doesn't exist yet or the session has expired, the flow fails normally; rerun the `saveState` flow to (re)create it. One state name per run. |
| `timeout` | step | Per-step override of the default action timeout (already existed). |
| `key` | step | Keyboard key for a `press` step (Playwright key name, e.g. `"Enter"`, `"Escape"`, `"Tab"`). Pressed on the step's target if given, otherwise at the page level. |

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

## External Dependencies

Local mode (the default) has none — results are plain files under
`.verfix/runs/`. The opt-in server runtime (`--server`) bundles Redis and
PostgreSQL inside its Docker container.
