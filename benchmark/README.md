# Loop-closure benchmark

The product metric (see `docs/6-resources/benchmarks-methodology.md` for the
broader benchmark philosophy, and GitHub issue #66): a set of deliberately
broken tiny apps. This harness runs a coding agent against each one, with
**only Verfix's JSON output** as the failure signal, and records whether the
loop closes — the agent reaches the intended fix — without human help, and
in how many verify iterations.

**Loop-closure rate** = closed cases / total cases. Every `fix_hint`/
`findings` change (see #63) is judged by whether it moves this number.

## Cases

| id | category | expected failure type | expected finding | fix scope |
|---|---|---|---|---|
| `drifted-selector` | `selector_drift` | `selector_not_found` | — | config |
| `occluding-modal` | `occluding_overlay` | `selector_not_found` | `blocking_overlay` | config |
| `stale-session` | `stale_session` | `selector_not_visible` | `stale_session` | config |
| `console-error-breaks-render` | `console_error_cascade` | `selector_not_found` | `prior_console_errors` | source |
| `changed-route` | `route_change` | `url_mismatch` | — | config |
| `slow-endpoint` | `slow_endpoint` | `timeout` | — | config |
| `broken-api` | `api_regression` | `network_failure` | — | source |
| `text-changed` | `copy_change` | `text_mismatch` | — | config |

## Running it

```bash
node benchmark/run.js --agent <null|oracle|CMD> [--case <id>] [--out results.json] [--keep]
```

- `--agent null` — does nothing to fix the failure. Expected score: 0%. This
  is a rot check: if any case closes under `null`, that case isn't actually
  broken and needs fixing.
- `--agent oracle` — applies each case's known-good fix (`fixed/`) verbatim.
  Expected score: 100%, closing in 2 iterations (fail → apply fix → pass).
  This is a correctness check: if a case doesn't close under `oracle`, the
  case's own intended fix is broken.
- Any other value is treated as a shell command — a real coding agent
  invocation. See "Adapter contract" below.

`null` and `oracle` are meant to be run as a matched pair in CI: `null` must
exit nonzero if anything closes, `oracle` must exit nonzero if anything
doesn't. Together they prove the benchmark itself is honest before it's used
to judge an agent.

Output: a human-readable table goes to stderr; machine-readable JSON (per
case: `id`, `closed`, `iterations`, `first_failure_type_ok`,
`expected_finding_ok`, `invariants_ok`; aggregate: `closure_rate`,
`mean_iterations`) goes to `--out <file>` or stdout.

Exit code is 0 for a completed run, except the `null`/`oracle` self-test
pair described above.

## Case format

Each case lives in `cases/<id>/`:

```
cases/<id>/
  app/server.js       # tiny zero-dependency HTTP app (must listen on process.env.PORT)
  verfix.config.json  # the flow config, as first shipped — contains the defect
  case.json           # metadata (see below)
  fixed/              # overlay: files that, copied over the workspace, apply the intended fix
```

`case.json`:

```json
{
  "id": "drifted-selector",
  "description": "one line: the defect and the realistic story behind it",
  "category": "selector_drift",
  "expected_failure_type": "selector_not_found",
  "expected_finding": null,
  "fix_scope": "config",
  "max_iterations": 5,
  "invariants": [
    { "file": "verfix.config.json", "must_contain": "\"type\": \"selector_visible\"" }
  ]
}
```

- `expected_failure_type` — the failure taxonomy `type` Verfix's own first
  run must report (see `workers/src/assertions/types.ts`). The harness
  checks this on iteration 1 — it validates Verfix's own reporting, not the
  agent.
- `expected_finding` — a `findings[].code` that should fire on the first run,
  or `null` if none is expected.
- `fix_scope` — `"config"` (the fix belongs in `verfix.config.json`) or
  `"source"` (the fix belongs in `app/`). Informational; the invariants below
  are what's actually enforced.
- `invariants` — anti-cheat checks run against the workspace after the loop
  closes (`passed: true`). Each entry is one of:
  - `{ "file", "must_contain": "<regex>" }` — file content must match.
  - `{ "file", "must_not_contain": "<regex>" }` — file content must not match.
  - `{ "file", "must_not_change": true }` — file must be byte-identical to
    the case's original.
  A case only counts as **closed** if the flow passes *and* every invariant
  holds. This stops an agent from "closing the loop" by deleting or
  weakening assertions, or — for a config-scope case — by hacking app source
  instead of the config.

## Adapter contract

An adapter is any command. It's spawned with:
- `cwd` = the case's temp workspace (a fresh copy of `app/` and
  `verfix.config.json`, isolated per run).
- `stdin` = the previous `verfix run --output json` result (pretty-printed).
- env `VERFIX_BENCH_CASE=<id>`, `VERFIX_BENCH_ITERATION=<n>`.

It's expected to edit workspace files (typically `verfix.config.json`) in
response to the JSON on stdin, then exit 0. The harness re-runs Verfix
afterward and loops (up to `case.json`'s `max_iterations`) until the run
passes or iterations run out.

## Adding a case

1. Copy the layout above into `cases/<new-id>/`.
2. Write `app/server.js` as a minimal zero-dependency HTTP server that
   reproduces one realistic defect (wrong selector, occluding modal, stale
   session, etc.) — it must listen on `process.env.PORT`.
3. Write `verfix.config.json` with a flow that fails against the defect.
4. Write `fixed/` with the same files, patched with the intended fix.
5. Write `case.json` (see schema above).
6. Verify: `node benchmark/run.js --agent oracle --case <new-id>` closes in 2
   iterations, and `node benchmark/run.js --agent null --case <new-id>`
   doesn't close.
