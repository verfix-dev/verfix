# Config-First Verification (No Source Rewrites)

When a coding agent finishes a UI task and you ask it to verify, Verfix runs the
relevant flow. If a selector doesn't resolve, the agent has a choice:

- **Fix it in Verfix configuration** — the alias map, a semantic selector, or by
  letting assisted mode heal it. ✅
- **Rewrite the project's source** — e.g. adding a `data-testid` to a component
  just so the test passes. ⚠️

The second option rewrites production code to fit the test. Verfix is built to
prefer the first. This guide explains the principle, why it's now *reliable*, and
the guardrail that enforces it.

> **Legitimate exception:** editing project source is correct when Verfix surfaces
> a **real app bug** — a `console_error`, a `network_failure`, or genuinely wrong
> behavior. The rule is only about not hacking source to satisfy a *selector*.

---

## Targeting elements without adding `data-testid`

The primary job when writing a flow is to **read the source and reuse the selector
that already exists** — not to invent one. In priority order:

### 1. Reuse the element's existing selector (primary)

Open the component and target what is already in the code — an existing
`data-testid`, `id`, `name`, `role`, or a stable semantic CSS selector. Put it in
the flow step, or give it a logical name via the `selectors` alias map. This is
**deterministic and works in `strict` mode**, which is what CI runs.

```json
{
  "selectors": {
    "emailInput": "input[type=email]",
    "submitBtn": "#login-form button[type=submit]"
  },
  "flows": [
    {
      "id": "login",
      "steps": [
        { "action": "type", "selector": "emailInput", "value": "a@b.co" },
        { "action": "click", "selector": "submitBtn" }
      ]
    }
  ]
}
```

The `selectors` alias map is just for reuse and readability — the value must still
be a real selector you found in the source.

### 2. Semantic selector

When there's no stable structural selector, target by accessible role/name or
visible text: `role=button[name="Sign In"]`, `text=Sign In`. Works in every mode.

### 3. Assisted mode — a resilience fallback, not a targeting strategy

`assisted` mode adds self-healing: if a selector **drifts and stops resolving**,
Verfix recovers it at run time via the accessibility tree (`aria-label` / `role` /
text), then an AI suggestion. This is a safety net for flow stability over time —
**not** a substitute for finding the real selector in step 1.

> **Important:** self-healing only runs in `assisted` mode. It does **not** run in
> `strict` mode. If your flow relies on healing to resolve an element, it will fail
> the moment it runs in `strict` (e.g. CI). Always give `strict`-mode flows a real,
> correct selector.

Healing derives an intent hint from the selector/alias token, so descriptive names
heal better: a drifted `sign-in` testid or a `signIn` alias both map to the hint
"sign in" and can re-resolve the "Sign In" button.

### 4. Last resort — add `data-testid` to source

Only when an element genuinely can't be targeted (e.g. an icon-only control with no
accessible name — which is also a real a11y gap worth fixing). Add an `aria-label`
alongside it, and note the change in your summary.

---

## The source guard (enforcement)

Instructions alone aren't reliable — so Verfix makes source edits a **typed signal**
in the run contract, consistent with its philosophy of "reliability from structured
contracts, not unconstrained intelligence."

### How it works

`verfix run` snapshots a git baseline at the start of each verify cycle:

- The **first run** of a cycle baselines the working tree — your feature work is
  *not* flagged.
- **Later runs** report project files changed *since* the baseline — i.e. edits
  made inside the edit → verify → fix loop, where the anti-pattern lives.
- A **passing run** ends the cycle and clears the baseline. A new commit also
  starts a fresh cycle.
- Outside a git repo, the guard disables itself and never blocks a run.

The JSON output gains a `source_changes` field:

```json
{
  "passed": true,
  "source_changes": {
    "status": "ok",
    "baseline_captured": false,
    "files": [{ "path": "src/LoginForm.tsx", "classification": "project" }],
    "project_count": 1,
    "config_count": 0
  }
}
```

`.verfix/**`, `verfix.config.*`, and agent instruction files (`AGENTS.md`,
`CLAUDE.md`, `GEMINI.md`, `CODEX.md`, `.cursorrules`, `.cursor/**`,
`.github/copilot-instructions.md`, `.github/instructions/**`, `.clinerules/**`,
`.agents/**`) are classified as `config`; everything else is `project`.

### `sourceCodePolicy`

Set the policy in `verfix.config.json` (or override per run with `--source-policy`):

| Policy | Behavior |
|--------|----------|
| `warn` *(default)* | Run still passes, but reports changed project files and adds a `source_edit_warning` finding. Doesn't block legitimate app-bug fixes. |
| `block` | If project source changed during the loop, the run **fails** with a `source_edit_blocked` failure until reverted. Best for CI. |
| `off` | No source-change detection. |

```json
{ "sourceCodePolicy": "warn" }
```

```bash
verfix run --flow login --source-policy block --output json
verfix run --flow login --reset-baseline --output json   # start a fresh cycle
```

When you see a `source_edit_blocked` / `source_edit_warning` finding: if the edit
wasn't a genuine bug fix, revert it and target the element via the `selectors`
alias map or assisted mode instead.

---

## See also

- [Execution Modes](../3-core-concepts/execution-modes.md) — strict vs assisted vs exploratory
- [Agent Integrations](./agent-integrations.md) — how agents drive Verfix
- [Unstable Flows](../3-core-concepts/unstable-flows.md)
