import fs from 'fs';
import path from 'path';
import { FAILURE_TYPES } from './constants';

// ─── AGENTS.md generation ────────────────────────────────────────────────────

/** CLI version, read from package.json (works from src/ under ts-node and dist/ built). Memoized — package.json doesn't change mid-process. */
let cachedCliVersion: string | undefined;
export function getCliVersion(): string {
  if (cachedCliVersion) return cachedCliVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    if (pkg?.version) return (cachedCliVersion = pkg.version);
  } catch { /* fall through */ }
  return (cachedCliVersion = '0.0.0');
}

/** Matches the version stamp embedded in generated instructions, so a CLI
 *  update can detect and refresh a stale .verfix/INSTRUCTIONS.md. */
export const INSTRUCTIONS_VERSION_PATTERN = /<!-- verfix-instructions-version: (\S+) -->/;

/**
 * Path (relative to project root) where the full Verfix reference lives.
 * AGENTS.md and the platform files carry only a short stub that points here,
 * so that projects with an existing AGENTS.md aren't bloated by ~580 lines.
 */
export const VERFIX_INSTRUCTIONS_FILE = '.verfix/INSTRUCTIONS.md';

/**
 * Short stub injected into AGENTS.md. Carries only the always-in-context
 * essentials (identity, the config-first rule, the core commands) and points at
 * `.verfix/INSTRUCTIONS.md` for the full schema and workflow. Starts with the
 * same `## Verfix — Browser Verification` heading as the full section so the
 * existing section-replace logic updates it cleanly on re-init.
 */
export function generateAgentsStub(): string {
  return `## Verfix — Browser Verification

Verfix is a local browser-verification runtime. After editing any UI component,
form, route, or page, **verify browser behavior** before considering the task done:

\`\`\`bash
verfix status                          # is the setup healthy?
verfix flows                           # the ONLY source of truth for flow IDs
verfix run --flow <id> --output json   # verify the flow covering what you changed
\`\`\`

- **Verify the specific page/route/component you edited.** Pick the existing flow
  that covers it and run it.
- **No flow covers your change?** Create one: read the changed source for its route
  and element selectors, add a flow to \`verfix.config.json\`, then run it. See
  \`${VERFIX_INSTRUCTIONS_FILE}\` for the flow schema and a step-by-step guide.

> **⚠️ CONFIG-FIRST.** When a flow fails, fix it in **Verfix config**
> (\`verfix.config.json\`), not project source. Precedence — stop at the first that
> works: (1) read the source and reuse the element's **EXISTING** selector in the
> flow step or \`selectors\` alias (deterministic, works in \`strict\` mode);
> (2) semantic selector (role/name/text); (3) \`assisted\` mode self-healing
> (fallback for drift, does **not** run in strict); (4) **LAST RESORT** — add a
> \`data-testid\` to source. Editing source **is** correct for a real app bug
> (\`console_error\`, \`network_failure\`, broken route). \`verfix run\` reports
> \`source_changes\`; under \`sourceCodePolicy: "block"\` a source edit fails the run.

**Full flow schema, verification workflow, failure reference, and flow-writing
guide:** [\`${VERFIX_INSTRUCTIONS_FILE}\`](./${VERFIX_INSTRUCTIONS_FILE}) — read it
before writing or fixing a flow.

> If \`verfix.config.json\` doesn't exist, Verfix isn't initialized yet. Bootstrap
> with \`npx verfix init --yes\` (see \`${VERFIX_INSTRUCTIONS_FILE}\` for all flags).
`;
}

export function generateAgentsSection(
  flows: Array<{ id: string; description?: string }>,
  mode: string,
  baseUrl: string,
): string {
  const flowList = flows.map(f =>
    `- \`${f.id}\` — ${f.description || f.id.replace(/-/g, ' ') + ' flow'}`
  ).join('\n');

  const failureList = FAILURE_TYPES.map(f =>
    `- \`${f.type}\` — ${f.description}`
  ).join('\n');

  return `## Verfix — Browser Verification
<!-- verfix-instructions-version: ${getCliVersion()} -->

### Verfix Setup (for AI agents)

> If \`verfix.config.json\` doesn't exist in the project root, Verfix hasn't been
> initialized yet. Run the following to bootstrap non-interactively (no Docker,
> no AI key needed — the default \`strict\` mode is fully deterministic):
>
> \`\`\`bash
> npx verfix init --yes --base-url http://localhost:3000
> \`\`\`
>
> **Flags:** \`--base-url\`, \`--mode\` (strict|assisted|exploratory),
> \`--skip-runtime\`, \`--skip-agent-files\`, \`--dry-run\`. AI flags — only for
> assisted/exploratory modes: \`--ai-key\`, \`--ai-provider\`
> (openai|anthropic|gemini|openrouter), \`--ai-model\`.
>
> **Env var fallbacks:** \`VERFIX_AI_PROVIDER\`, \`VERFIX_AI_MODEL\`, \`VERFIX_AI_KEY\`,
> \`VERFIX_BASE_URL\`, \`VERFIX_MODE\`. Provider-specific keys (\`OPENAI_API_KEY\`,
> \`ANTHROPIC_API_KEY\`, etc.) are also detected automatically.
>
> Only ask the user for an API key when configuring assisted/exploratory mode.

Verfix is a local browser-verification runtime. After editing any UI
component, form, route, or page — **you must verify browser behavior**
before considering the task done.

> **⚠️ CONFIG-FIRST RULE (read this first).**
> When a flow fails, fix it by editing **Verfix configuration**, not project
> source. Editing project code (adding \`data-testid\`, renaming elements, etc.)
> to make a selector resolve is an anti-pattern — it rewrites the app to fit the
> test. Follow this precedence and STOP at the first that works:
>
> 1. **Read the app source and use the element's EXISTING selector.** Find the
>    selector that is already in the code — a \`data-testid\` it already has, or its
>    \`id\`, \`role\`, \`name\`, or a stable semantic CSS selector — and put it in the
>    flow step (or the \`selectors\` alias map). This is the PRIMARY path: it's
>    deterministic and works in \`strict\` mode (what CI runs).
> 2. **Use a semantic selector** (accessible role/name or visible text) when there
>    is no stable structural selector, e.g. \`role=button[name="Sign In"]\`.
> 3. **Run in \`assisted\` mode for resilience** — self-healing recovers a *drifted*
>    selector at run time. This is a FALLBACK for stability, NOT a way to avoid
>    finding the real selector, and it does **not** run in \`strict\` mode.
> 4. **LAST RESORT — edit project source** (add a \`data-testid\`/\`aria-label\`).
>    Only when 1–3 genuinely cannot target the element, and state why in your summary.
>
> Editing project source **is** correct when Verfix surfaces a **real app bug**
> (a console error, a broken route, a genuine regression) — that's the point of
> verification. The rule is about not hacking source to satisfy a selector.
>
> Verfix enforces this: \`verfix run\` reports a \`source_changes\` field listing
> project files you touched during the verify loop. Under \`sourceCodePolicy: "block"\`
> the run fails with \`source_edit_blocked\` until you revert.

---

### Section 1 — Runtime Instructions

| Resource | Location |
|----------|----------|
| Config | \`verfix.config.json\` |
| Run results & traces | \`.verfix/runs/\` (open with \`verfix show <execution_id>\`) |
| Docs | https://verfix.dev/docs |

Verfix runs verifications locally in-process — no runtime to start or stop.

\`\`\`bash
# Check the setup (config, browser, last run)
verfix status

# Run a specific flow
verfix run --flow <flow-id> --output json

# Same, plus the raw event timeline (large — the default summary already
# contains every failure and skipped step; only use this when the summary
# and \`verfix show\` detail commands aren't enough)
verfix run --flow <flow-id> --output json --full

# Run all flows
verfix run --output json

# Override mode for a single run
verfix run --flow <flow-id> --mode strict --output json

# Override URL for a single run (--base-url is accepted as an alias for --url)
verfix run --flow <flow-id> --url http://localhost:5173 --output json

# Open the recorded Playwright trace of a run (for the human to inspect)
verfix show <execution_id>

# Print a run's FULL captured console errors / network requests — use this to
# inspect failure detail (e.g. before writing no_console_errors "exclude"
# patterns) instead of reading files out of .verfix/runs/.
# Omit <execution_id> to use the newest run.
verfix show <execution_id> --console --output json
verfix show <execution_id> --network --output json

# Narrow either to entries whose URL (network) or text/source_url (console)
# contain a plain substring (case-insensitive, not a regex). --network JSON
# output also includes a \`failed_requests\` array (status >= 400 or 0).
verfix show <execution_id> --network --filter auth --output json

# Dry-run a selector/text against the last run's saved DOM (~1s) BEFORE paying
# for a full re-run — exit 0 = all matched, 1 = something didn't. Config
# \`selectors\` aliases resolve. Caveat: the snapshot is END-OF-RUN state, so a
# match here doesn't guarantee the element existed at the step that failed.
verfix probe --selector "[data-testid=submit]" --output json
verfix probe --text "Welcome back" --output json
\`\`\`

---

### Section 2 — Source of Truth Rules

> **⚠️ CRITICAL — Read before doing anything with flows.**

1. \`verfix flows\` is the **ONLY** source of truth for available flows.
   Do NOT invent flow IDs. Do NOT copy IDs from examples in this document.
2. \`verfix.config.json\` is the **ONLY** source of truth for flow definitions.
3. Template patterns in this document (Section 10) are **NOT executable**.
4. If unsure whether a flow exists, run \`verfix flows\` first.

---

### Section 3 — Flow Discovery

#### List available flows

\`\`\`bash
# Human-readable list
verfix flows

# Machine-readable JSON
verfix flows --output json
\`\`\`

#### Read flow definitions directly

Open \`verfix.config.json\` and inspect the \`flows\` array. Each flow has:
- \`id\` — unique identifier used with \`--flow <id>\`
- \`steps\` — ordered browser actions
- \`assertions\` — post-run checks

#### Currently configured flows

${flowList}

> To see the live list, always run: \`verfix flows\`

---

### Section 4 — Verification Workflow

#### Agent decision hierarchy

Follow these steps **in order** every time you need to verify a UI change:

1. \`verfix status\` — Is the setup healthy?
2. \`verfix flows\` — What flows exist right now?
3. Read \`verfix.config.json\` — Understand the structure of available flows.
4. **Select an existing flow** — Reuse before creating. Pick the flow whose
   steps cover the area you just edited.
5. **Create a new flow ONLY if** no existing flow covers the change.
   Read the app source to find real routes, selectors, and expected behavior.
6. \`verfix run --flow <id> --output json\` — Execute the flow.
7. **If failure:** classify it — is it a flow/selector issue or a real app bug?
   - **Flow/selector issue** (\`selector_not_found\`, \`selector_not_visible\`,
     stale route/text) → fix it **in config** using the CONFIG-FIRST precedence:
     \`selectors\` alias → assisted mode → flow selector string → (last resort)
     project source. Do **not** jump to editing project code.
   - **Real app bug** (\`console_error\`, \`network_failure\`, wrong behavior) →
     fix the application code. This is a legitimate source edit.
8. **Fix and retry** — Go back to step 6.
9. **After 3 failed attempts** → Stop retrying. Give the human the \`show_command\`
   from the JSON output (\`verfix show <execution_id>\`) so they can inspect the
   recorded Playwright trace.

#### Edit → verify → fix loop

\`\`\`
1. Edit the application code (your feature work)
2. Run the relevant flow:  verfix run --flow <id> --output json
3. If passed → done, move to next task
4. If !passed:
   a. Read failures[0].type and failures[0].fix_hint
   b. Flow/selector issue → fix in CONFIG (selectors alias → assisted mode →
      flow selector string → project source only as last resort), go to step 2
   c. Real app bug (console_error, network_failure, wrong behavior) → fix the
      app code, go to step 2
5. After 3 failed attempts → stop, give the user the show_command
   (verfix show <execution_id>) to inspect the trace

> Note: \`verfix run\` reports \`source_changes\` — project files edited during this
> loop. If you see your feature files there and it wasn't a genuine bug fix,
> revert and use the config path instead.
\`\`\`

#### When to create a new flow

- You added a new page or route
- You added a new user-facing feature (form, button, modal, etc.)
- You changed a critical user journey (login, signup, checkout)
- No existing flow covers the area you just edited
- The user asks you to verify something new

#### When to modify an existing flow

- You renamed or moved a selector → update the step's \`selector\`
- You changed a route path → update the \`navigate\` step's \`url\`
- You added a new field to an existing form → add a \`type\` step
- You changed expected text on the page → update the assertion \`value\`
- A flow fails with \`selector_not_found\` after your code change

#### When to remove a flow

- The feature it tests has been deleted
- It has been superseded by a more comprehensive flow

#### When to run verification

- After editing any React/Vue/Svelte component, CSS, or route handler
- After changing form fields, buttons, or navigation
- After any API integration that affects UI state
- After modifying authentication or authorization logic
- Before marking any UI-related task as complete

**Always use \`--flow <id>\` to run only the relevant flow.** Don't run all
flows unless you need a full regression check.

#### Flow selection guidance

| You just edited… | Action |
|---|---|
| A specific page or form | \`verfix run --flow <id> --output json\` |
| A new feature (no flow yet) | Create a flow first, then run it |
| Global layout / CSS | Run all flows: \`verfix run --output json\` |

---

### Section 5 — Flow Writing Guide

#### How to write a new flow

1. **Read the app's source code** to understand the page structure.
2. **Find the page route** (e.g. \`/settings/profile\`).
3. **Identify interactive elements** — buttons, inputs, links, modals.
4. **Find their selectors** — search the source for existing \`data-testid\`
   attributes first (use your editor's search, ripgrep, or grep — whatever your
   environment provides). On Windows PowerShell, \`Select-String -Pattern
   data-testid -Path src\\* -Recurse\` works; on macOS/Linux, \`grep -rn data-testid src/\`.

5. **Write steps** in execution order (navigate → wait → interact).
6. **Add assertions** for the expected end state.

#### Selector best practices

| Priority | Selector type | Example | Why |
|----------|--------------|---------|-----|
| 1 (best) | \`data-testid\` | \`[data-testid=login-button]\` | Stable, decoupled from styling |
| 2 | CSS selector | \`#checkout-form button[type=submit]\` | OK if semantically meaningful |
| 3 (last resort) | Text content | \`text=Sign In\` | Breaks on i18n, copy changes |

#### How to find selectors in source code

Search the source with whatever tool your environment has — your editor's search,
ripgrep (\`rg data-testid src/\`), grep (\`grep -rn data-testid src/\`), or on Windows
PowerShell \`Select-String -Pattern data-testid -Path src\\* -Recurse\`. Narrow to a
single component (e.g. \`src/components/LoginForm.tsx\`) once you know where the
element lives.

#### If the element has no data-testid — find its real selector, don't add one

Adding \`data-testid\` to project source is the **last resort**, not the default.
The primary job when writing a flow is to **read the source and use the selector
that already exists**. Work down this ladder and stop at the first that resolves:

1. **Existing selector from source (PRIMARY).** Open the component and target what
   is already there — an existing \`data-testid\`, \`id\`, \`name\`, \`role\`, or a stable
   semantic CSS selector. Put it directly in the flow step, or give it a logical
   name via the \`selectors\` alias map. Deterministic; works in \`strict\` mode:
   \`\`\`json
   "selectors": { "loginSubmit": "#login-form button[type=submit]" }
   \`\`\`
2. **Semantic selector** — accessible role/name or visible text when there is no
   stable structural selector: \`role=button[name="Sign In"]\`, \`text=Sign In\`.
3. **\`assisted\` mode (FALLBACK).** If a selector may drift, run the flow in
   \`assisted\` mode so self-healing can recover it via \`aria-label\`/\`role\`/text at
   run time. This is a resilience net, not a substitute for step 1, and it does
   **not** run in \`strict\` mode — CI still needs the real selector.
4. **LAST RESORT — add \`data-testid\` to source.** Only when the element genuinely
   cannot be targeted (e.g. an icon-only control with no accessible name — which
   is also a real a11y gap worth fixing). Say so in your summary; expect it in
   \`source_changes\`:
   \`\`\`diff
   -<button type="submit"><Icon/></button>
   +<button type="submit" data-testid="login-submit" aria-label="Sign in"><Icon/></button>
   \`\`\`

---

### Section 6 — Flow Composability

Flows are reusable building blocks. Treat them like puzzle pieces — compose
small, focused flows into larger verification sequences.

#### Why composability matters
- A \`login\` flow is a prerequisite for ANY authenticated page verification
- Don't duplicate login steps in every flow — compose \`login\` + \`<target-flow>\`
- The browser context (cookies, localStorage, session) persists between flows
- Each flow's assertions run independently, so you get per-flow failure reports

#### Sequential flows (auth → authenticated)
Browser context persists between flows in a single \`verfix run\` session.
Cookies and localStorage set by a login flow are available to subsequent flows.

1. Create a \`login\` flow that authenticates the user.
2. Create an authenticated flow (e.g. \`dashboard\`) that expects a logged-in session.
3. Run them sequentially: \`verfix run --flow login,dashboard --output json\`

---

### Section 7 — Failure Handling

#### Output contract

Every \`verfix run --output json\` returns this summary shape (the full event
timeline is deliberately omitted — pull details with \`detail_commands\` below,
or opt into everything with \`--full\`):

\`\`\`json
{
  "passed": false,
  "failures": [
    {
      "type": "selector_not_found",
      "flow": "your-flow-id",
      "assertion": "selector_visible",
      "selector": "[data-testid=submit]",
      "fix_hint": "Selector \\"[data-testid=submit]\\" not found in DOM. Add a stable data-testid or update the selector."
    }
  ],
  "skipped_optional_steps": [
    { "flow": "your-flow-id", "action": "click", "target": { "text": "Logout other session" }, "reason": "locator.waitFor: Timeout 2000ms exceeded." }
  ],
  "timeline_url": null,
  "trace_path": "/absolute/path/to/.verfix/runs/exec_abc123_trace.zip",
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
\`\`\`

> The summary is **lossless for anything non-nominal**: every failure (with the
> flow and assertion that produced it), every skipped \`optional\` step (present
> only when something was skipped — verify skips were intentional!), the AI
> failure analysis (\`ai_summary\`, when a run in assisted/exploratory mode
> failed), and \`retry_count\` (> 0 means the run crashed and was retried).
> What's omitted is only the passing-path event timeline.
>
> \`timeline_url\` is always present but \`null\` in local runs (it points at the
> dashboard only when running against a server runtime). \`trace_path\` and
> \`show_command\` are the local-run equivalents — pass \`show_command\` to the
> human when they need to see what the browser did. Run the \`detail_commands\`
> verbatim when you need console/network detail.

#### Failure type reference

${failureList}

#### Fix strategies by failure type

| Failure type | What to do |
|---|---|
| \`selector_not_found\` | Inspect the source, find the correct selector, update the step. Check candidate selectors with \`verfix probe --selector "..."\` (~1s) before paying for a full re-run. |
| \`selector_not_visible\` | Element exists but is hidden. Check conditional rendering logic (CSS \`display:none\`, \`visibility:hidden\`, or zero dimensions). |
| \`text_mismatch\` | Expected text not on page. Check if text is dynamically loaded — add a \`wait_for_selector\` step before the assertion. |
| \`url_mismatch\` | Navigation didn't reach expected URL. Check routing, redirects, or auth guards. |
| \`console_error\` | JavaScript errors in console. Fix the JS error in the app code. |
| \`network_failure\` | API returned non-2xx. Check the backend or mock the endpoint. |
| \`timeout\` | Operation took too long. Increase \`timeout\` on the step/assertion, or add a \`wait_for_selector\` step. |
| \`assertion_failed\` | Generic fallback. Read \`fix_hint\` for specifics. |
| \`source_edit_warning\` | You edited project source during the verify loop. If it wasn't a genuine bug fix, revert and use the config path (\`selectors\` alias / assisted mode). |
| \`source_edit_blocked\` | \`sourceCodePolicy\` is \`block\` and project source changed. Revert the source edit and target the element via config, then re-run. |

#### Retry logic

\`\`\`
1. Read failures[0].type
2. Apply the fix strategy from the table above
3. For selector/text fixes: verfix probe --selector "..." first (~1s dry-run
   against the failed run's DOM) — only re-run once the probe matches
4. Re-run:  verfix run --flow <id> --output json
5. If still failing after 3 attempts → stop, give the user the show_command
\`\`\`

---

### Section 8 — Recovery

If verification runs are misbehaving, use these commands to diagnose and fix:

| Command | When to use |
|---------|-------------|
| \`verfix status\` | Check config, engine, browser install, and the last run |
| \`verfix doctor\` | Run diagnostics (Node, config, engine, Chromium, app reachability) |
| \`verfix validate\` | Check \`verfix.config.json\` for structural/semantic errors (bad assertion types, duplicate flow ids, invalid mode) without running anything |
| \`verfix install\` | Download the Chromium browser the local runner needs (one-time) |
| \`verfix show <execution_id>\` | Open the recorded Playwright trace of a run |

**Recovery steps:**

1. \`verfix doctor\` → Follow any suggestions it prints.
2. Edited \`verfix.config.json\` by hand? Run \`verfix validate\` first to catch
   typos (bad assertion type, duplicate flow id, invalid mode) before running.
3. Browser missing? Run \`verfix install\` (one-time ~130MB download), or it
   auto-downloads on the next \`verfix run\`.
4. App unreachable? Start the dev server, or fix \`baseUrl\` in \`verfix.config.json\`.

---

### Section 9 — Flow Format Reference

#### Full schema

\`\`\`jsonc
{
  // REQUIRED — The base URL of the app under test.
  // All navigate step URLs are resolved relative to this.
  "baseUrl": "${baseUrl}",

  // REQUIRED — Default verification mode.
  //   "strict"      → deterministic only, no AI. Best for CI and stable selectors.
  //   "assisted"    → deterministic first, AI heals broken selectors. Best for active dev.
  //   "exploratory" → AI-driven navigation from "task" below instead of "flows".
  //                   Requires an AI key configured (verfix init) — no fallback exists.
  //                   Global only — do NOT set this as a per-flow "mode" override.
  "mode": "${mode}",

  // REQUIRED only when mode is "exploratory" — ignored otherwise. A natural-
  // language goal the AI agent tries to achieve by clicking/typing/navigating.
  // "flows" is not used at all in exploratory mode — omit it.
  // "task": "Log in with the test account, then verify the dashboard shows the user's name.",

  // OPTIONAL — Global timeout in ms for all steps/assertions (default: 15000)
  "timeout": 15000,

  // OPTIONAL — Number of retries on failure (default: 2)
  "retries": 2,

  // OPTIONAL — What to do when project source is edited during a verify loop.
  //   "warn"  → run still passes, but reports changed project files (default)
  //   "block" → run FAILS with source_edit_blocked if project source changed
  //   "off"   → no source-change detection
  // Prefer fixing selectors via the "selectors" alias map or assisted mode.
  "sourceCodePolicy": "warn",

  // OPTIONAL — Selector aliases. Map logical names to real selectors.
  "selectors": {
    "emailInput": "[data-testid=email]",
    "submitBtn": "[data-testid=submit]"
  },

  // Step/assertion "value"/"url" and "baseUrl" may reference \${VAR_NAME} —
  // resolved from process.env (including .verfix/.env) at run time, so
  // secrets never need to be committed here. An unset variable fails the
  // run immediately with a clear error naming it.
  // "value": "\${TEST_PASSWORD}"
  //
  // Built-in macros for run-unique values (no env var needed):
  //   \${TIMESTAMP} — epoch milliseconds at run start
  //   \${RANDOM}    — 8 random alphanumerics
  // Each resolves ONCE per run: the same token yields the same value in every
  // step and assertion, so you can type it in one step and assert it visible
  // later. Use these for any "create X" flow against a backend that rejects
  // duplicates — reruns stay idempotent without hand-bumping values.
  // "value": "item-\${RANDOM}"

  // OPTIONAL — App metadata. Helps the AI in assisted/exploratory mode.
  "metadata": {
    "framework": "next.js"
  },

  // REQUIRED unless mode is "exploratory" (which uses "task" above instead).
  // This is a LIBRARY — add as many flows as you need.
  // Each flow is independent and can be run with: verfix run --flow <id>
  "flows": [
    {
      // REQUIRED — Unique identifier. Used with: verfix run --flow <id>
      // Use descriptive kebab-case names matching the feature being tested.
      "id": "descriptive-flow-name",

      // OPTIONAL — Per-flow mode override. If set, this flow uses this mode
      // instead of the global mode. Allowed: "strict" | "assisted" ONLY —
      // "exploratory" replaces flow execution entirely and is global-only;
      // setting it per-flow is a config error ("verfix validate" catches this).
      "mode": "assisted",

      // OPTIONAL — Skip this flow in "verfix run" (no --flow filter given).
      // Use to quarantine a known-broken flow without deleting it; the flow
      // still runs if explicitly named via --flow <id>.
      "skip": false,
      "skipReason": "Tracked in ISSUE-42, blocked on backend fix",

      // OPTIONAL — Clear cookies + local/session storage before this flow
      // runs. Use on a flow that must start logged-out so a session left
      // over from a previous run can't change the outcome.
      "clearState": false,

      // OPTIONAL — Auth state reuse, so flows don't re-implement login.
      // On the flow that logs in: "saveState": "auth" — once the flow's steps
      // and assertions pass, its cookies + localStorage + IndexedDB +
      // sessionStorage are saved under that name (in .verfix/state/, never
      // committed).
      // On flows that need a session: "useState": "auth" — the saved state is
      // restored immediately before THIS flow runs (earlier flows in the same
      // run never see it), so the flow starts logged in. After the flow
      // passes, the live session is re-captured to the same name by default
      // (handles single-use/rotating refresh tokens); set
      // "refreshState": false on a flow that ends logged out.
      // If the state doesn't exist yet (or the session expired and the flow
      // fails), run the saving flow once to (re)create it — or use
      // "verfix run --fresh-state" to discard saved states and re-login.
      "saveState": "auth",

      // REQUIRED — Ordered list of browser actions to execute.
      "steps": [
        // ... see "Step actions" below
      ],

      // OPTIONAL — Assertions to run AFTER this flow completes.
      // If omitted, defaults to: [{ "type": "page_loaded" }, { "type": "no_console_errors" }]
      "assertions": [
        // ... see "Assertion types" below
      ]
    }
    // Add more flows — one per user journey you want to verify.
  ],

  // OPTIONAL — Top-level assertions. Run AFTER all flows complete.
  // Use for global checks (e.g. no console errors across entire test).
  "assertions": [
    { "type": "no_console_errors" }
  ]
}
\`\`\`

#### Exploratory mode — minimal example

Exploratory mode is a **different shape of config**, not a flag on the flow-based
one above. It has no \`flows\` array — the AI agent decides what to click/type/
navigate at each step from \`task\` alone:

\`\`\`json
{
  "baseUrl": "${baseUrl}",
  "mode": "exploratory",
  "task": "Log in with the test account, then verify the dashboard shows the user's name."
}
\`\`\`

- Requires an AI provider/key (\`verfix init\`) — \`verfix run\` fails fast with
  \`ai_key_required\` if none is configured, since there is no deterministic
  fallback (unlike \`assisted\`, which still works without a key).
- Use this when no flow exists yet and you're exploring what a feature does,
  not when you already know the steps — write a real flow for anything you'll
  verify repeatedly (exploratory re-decides the path every run, so it's slower
  and less deterministic than a flow).
- \`verfix run --flow <id>\` and per-flow \`mode\` overrides do not apply here —
  exploratory mode ignores \`flows\`/\`assertions\` entirely.

#### Step actions

Every step in a flow has an \`action\` and a target. These are the **only** actions the runtime supports:

Any step also accepts \`"optional": true\` — if it fails for any reason within
its \`timeout\`, it is skipped instead of aborting the flow. Use this for a UI
branch that may or may not appear (e.g. a "logout previous session" dialog on
some login attempts but not others) — pair it with a short \`timeout\` so a
dialog that never shows doesn't cost the full default wait:
\`\`\`json
{ "action": "click", "text": "Logout previous session and login here", "optional": true, "timeout": 2000 }
\`\`\`

**\`navigate\`** — Go to a URL
\`\`\`json
{ "action": "navigate", "url": "/your-page" }
\`\`\`
- \`url\` is resolved relative to \`baseUrl\` unless it's an absolute URL.
- Waits for the \`load\` event by default. Set \`"waitUntil"\` to
  \`"domcontentloaded"\`, \`"networkidle"\`, or \`"commit"\` to change that — but
  avoid \`networkidle\` on pages that poll continuously (it never settles and
  times out); prefer a \`wait_for_selector\` step for the content you need.

**\`click\`** — Click an element
\`\`\`json
{ "action": "click", "selector": "[data-testid=submit]" }
\`\`\`

**\`type\`** — Type text into an input
\`\`\`json
{ "action": "type", "selector": "[data-testid=email]", "value": "user@example.com" }
\`\`\`
- Uses Playwright's \`fill()\` — clears the field first, then types.

**\`wait_for_selector\`** — Wait for an element to appear
\`\`\`json
{ "action": "wait_for_selector", "selector": "[data-testid=dashboard]" }
\`\`\`
- Waits until the element is visible in the DOM.
- Use before clicking/typing on elements that render asynchronously.

**\`press\`** — Press a keyboard key
\`\`\`json
{ "action": "press", "selector": "[data-testid=search-input]", "key": "Enter" }
\`\`\`
- \`key\` is a Playwright key name (e.g. \`"Enter"\`, \`"Escape"\`, \`"Tab"\`).
- If a target (\`selector\`/\`testId\`/\`text\`) is given, the key is pressed on that element; otherwise it's pressed at the page level (for global shortcuts).
- Use this when \`type\`'s \`fill()\` isn't enough — e.g. a search box or chat input that submits on Enter via a keydown handler.

**\`select_option\`** — Pick an option from a \`<select>\` dropdown
\`\`\`json
{ "action": "select_option", "selector": "[data-testid=country]", "value": "India" }
\`\`\`
- \`value\` matches the option's \`value\` attribute **or** its visible label.
- For custom (non-\`<select>\`) dropdowns, use \`click\` on the trigger and then \`click\` on the option instead.

**\`check\`** / **\`uncheck\`** — Set a checkbox or radio to a known state
\`\`\`json
{ "action": "check", "selector": "[data-testid=accept-tos]" }
\`\`\`
- Idempotent: \`check\` on an already-checked box is a no-op (unlike \`click\`, which would toggle it off) — prefer these over \`click\` for checkboxes so reruns are deterministic.

**\`hover\`** — Hover over an element
\`\`\`json
{ "action": "hover", "selector": "[data-testid=user-menu]" }
\`\`\`
- Use to reveal hover-only UI (dropdown menus, tooltips) before clicking or asserting on it.

**\`upload_file\`** — Set a file on an \`<input type="file">\`
\`\`\`json
{ "action": "upload_file", "selector": "input[type=file]", "file": { "name": "note.csv", "content": "a,b\\n1,2", "mimeType": "text/csv" } }
\`\`\`
- **Prefer inline \`{ name, content }\`** — the file is materialized at run time, so the flow has zero filesystem dependencies and runs identically in CI. Add \`"encoding": "base64"\` for binary content (a tiny PNG fits in a config line).
- **Keep inline content small** (a few KB). It lives in this config file, which agents read — for anything larger, commit a fixture and use the path form (\`verfix validate\` warns above 64KB).
- Alternatively \`"file": "fixtures/avatar.png"\` — a path resolved relative to the project root; commit the fixture so CI checkouts have it. \`\${VAR}\` substitution works in the path.
- Target the \`<input type="file">\` itself, even when it's hidden behind a styled button or drag-drop zone — the input only needs to exist, not be visible.

**\`wait_for_url\`** — Wait until the page URL contains a substring
\`\`\`json
{ "action": "wait_for_url", "value": "/dashboard", "timeout": 10000 }
\`\`\`
- Substring match, same semantics as the \`url_contains\` assertion.
- Use after an action that triggers a client-side redirect (login → dashboard) before asserting on the destination page.

**\`wait_for_network_idle\`** — Wait until network activity settles
\`\`\`json
{ "action": "wait_for_network_idle" }
\`\`\`
- Use before asserting on data that loads via background requests (tables, charts). Prefer \`wait_for_selector\` on the concrete element when you know it — it's faster and more precise.

#### Targeting inside iframes

Add \`"frame"\` (a CSS selector for the \`<iframe>\`) to any step whose target
lives inside an embedded frame — payment widgets, embedded editors:
\`\`\`json
{ "action": "type", "frame": "iframe[title=card]", "selector": "input[name=cardnumber]", "value": "4242424242424242" }
\`\`\`
- The step's \`selector\`/\`testId\`/\`text\` target is resolved inside that frame instead of the top-level page.
- Frame targeting is always deterministic — AI selector-healing does not apply inside frames.

#### Target resolution priority

1. **\`data-testid\`** (most stable — prefer this)
   \`[data-testid=submit-button]\`
2. **CSS selector** (any valid CSS)
   \`button.btn-primary\`, \`#login-form button[type=submit]\`
3. **Text content** (last resort — breaks on i18n)
   \`text=Sign In\`

#### Assertion types

| Type | Required fields | What it checks |
|------|----------------|----------------|
| \`page_loaded\` | — | Page navigated successfully (not about:blank or chrome-error://) |
| \`selector_visible\` | \`selector\` | A CSS selector is visible in the DOM |
| \`text_visible\` | \`value\` | A text string appears anywhere on the page |
| \`url_contains\` | \`value\` | Current URL contains this substring |
| \`title_contains\` | \`value\` | Page \`<title>\` contains this substring (case-insensitive) |
| \`no_console_errors\` | — | Zero \`console.error()\` calls during execution (after \`exclude\`, see below) |
| \`network_request_success\` | \`value\` | All requests matching this URL pattern returned 2xx-3xx, or a status in \`acceptStatuses\` if set |

All assertions accept an optional \`timeout\` (ms, default 5000).

A flow can have more than one valid outcome — e.g. a login endpoint that
returns \`200\` on success or \`409\` when a session is already active. Don't
branch the flow for this; tell the assertion which outcomes are expected:
\`\`\`json
{ "type": "network_request_success", "value": "/api/auth/login", "acceptStatuses": [200, 409] }
\`\`\`
\`acceptStatuses\` replaces the default 200-399 range entirely — list every
status you accept. Similarly, \`exclude\` on \`no_console_errors\` ignores
errors matching any of the given regex patterns (e.g. a known third-party
warning) without silencing every error:
\`\`\`json
{ "type": "no_console_errors", "exclude": ["ACTIVE_SESSION_EXISTS"] }
\`\`\`
On failure, both assertions' \`detail\`/\`fix_hint\` name the concrete matched
request (method, URL, status) or console error text — use that to decide
whether to add one of the exceptions above or fix a real bug.

#### Mode selection guide

| Situation | Mode | Why |
|-----------|------|-----|
| Stable selectors, CI pipeline | \`strict\` | Fastest, no AI cost, fully deterministic |
| Active development, selectors may change | \`assisted\` | AI heals broken selectors automatically |
| No flow exists yet, exploring new feature | \`exploratory\` | AI navigates from a natural language task |
| Quick smoke test (page loads, no errors) | \`strict\` | Just use \`page_loaded\` + \`no_console_errors\` |

**Mode priority:** CLI flag \`--mode\` > flow-level \`mode\` > config-level \`mode\` > \`strict\`

> \`exploratory\` is **global-only** — it replaces flow execution with an
> AI-driven task and ignores \`flows\`/\`assertions\` entirely. It also has no
> deterministic fallback (unlike \`assisted\`, which still works via semantic
> selector healing without an AI key) — \`verfix run\` fails fast with
> \`ai_key_required\` if no AI provider/key is configured. Setting
> \`"mode": "exploratory"\` on an individual flow is rejected as a config error.

---

### Section 10 — ⛔ TEMPLATE PATTERNS (DO NOT EXECUTE)

> **🚫 WARNING: The flow IDs, routes, and selectors below are FAKE.**
> They exist only to illustrate the flow JSON structure.
> **Do NOT copy these IDs into \`verfix.config.json\`.**
> **Do NOT run \`verfix run --flow example-...\`.**
> To see REAL flows, run: \`verfix flows\`

#### Pattern: Form submission with success check

\`\`\`json
{
  "id": "example-form-submit",
  "steps": [
    { "action": "navigate", "url": "/example-form-page" },
    { "action": "wait_for_selector", "selector": "[data-testid=example-form]" },
    { "action": "type", "selector": "[data-testid=example-name-input]", "value": "Jane Doe" },
    { "action": "type", "selector": "[data-testid=example-email-input]", "value": "jane@example.com" },
    { "action": "click", "selector": "[data-testid=example-submit-button]" }
  ],
  "assertions": [
    { "type": "text_visible", "value": "Example success message" },
    { "type": "no_console_errors" }
  ]
}
\`\`\`

#### Pattern: Multi-page navigation with network check

\`\`\`json
{
  "id": "example-multi-page-nav",
  "steps": [
    { "action": "navigate", "url": "/example-page-one" },
    { "action": "click", "selector": "[data-testid=example-next-button]" },
    { "action": "wait_for_selector", "selector": "[data-testid=example-page-two-content]", "timeout": 10000 },
    { "action": "click", "selector": "[data-testid=example-confirm-button]" }
  ],
  "assertions": [
    { "type": "url_contains", "value": "/example-final-page" },
    { "type": "network_request_success", "value": "/api/example-endpoint" },
    { "type": "no_console_errors" }
  ]
}
\`\`\`

#### Pattern: Smoke test (page loads without errors)

\`\`\`json
{
  "id": "example-smoke-test",
  "steps": [
    { "action": "navigate", "url": "/example-home" }
  ],
  "assertions": [
    { "type": "page_loaded" },
    { "type": "no_console_errors" }
  ]
}
\`\`\`

> **To see REAL flows, run: \`verfix flows\`**`;
}

/**
 * Stub written to platform-specific agent files (CLAUDE.md,
 * .github/copilot-instructions.md, .clinerules/verfix.md) for tools that don't
 * (yet) read AGENTS.md natively. Identical to the AGENTS.md stub — one source of
 * truth — and points at the full reference in `.verfix/INSTRUCTIONS.md`.
 *
 * Note: most modern agents (Codex, Cursor, Copilot coding agent, Kilo, opencode,
 * Zed, Jules, …) read AGENTS.md directly, so these files are belt-and-suspenders,
 * not the primary integration surface.
 */
export function generatePlatformStub(): string {
  return generateAgentsStub();
}

