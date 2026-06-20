import { FAILURE_TYPES } from './constants';

// ─── AGENTS.md generation ────────────────────────────────────────────────────

export function generateAgentsSection(
  flows: Array<{ id: string; description?: string }>,
  mode: string,
  baseUrl: string,
  runtimePorts: { apiPort: number; dashboardPort: number },
): string {
  const flowList = flows.map(f =>
    `- \`${f.id}\` — ${f.description || f.id.replace(/-/g, ' ') + ' flow'}`
  ).join('\n');

  const failureList = FAILURE_TYPES.map(f =>
    `- \`${f.type}\` — ${f.description}`
  ).join('\n');

  return `## Verfix — Browser Verification

### Verfix Setup (for AI agents)

> If \`verfix.config.json\` doesn't exist in the project root, Verfix hasn't been
> initialized yet. Run the following to bootstrap non-interactively:
>
> \`\`\`bash
> npx verfix init --yes --ai-provider openai --ai-model gpt-5.4-mini --ai-key "$OPENAI_API_KEY" --base-url http://localhost:3000
> \`\`\`
>
> **Flags:** \`--ai-provider\` (openai|anthropic|gemini|openrouter), \`--ai-model\`,
> \`--ai-key\`, \`--base-url\`, \`--mode\` (strict|assisted|exploratory),
> \`--skip-runtime\`, \`--skip-agent-files\`, \`--dry-run\`.
>
> **Env var fallbacks:** \`VERFIX_AI_PROVIDER\`, \`VERFIX_AI_MODEL\`, \`VERFIX_AI_KEY\`,
> \`VERFIX_BASE_URL\`, \`VERFIX_MODE\`. Provider-specific keys (\`OPENAI_API_KEY\`,
> \`ANTHROPIC_API_KEY\`, etc.) are also detected automatically.
>
> Ask the user for their API key if not already set in the environment.

Verfix is a local browser-verification runtime. After editing any UI
component, form, route, or page — **you must verify browser behavior**
before considering the task done.

---

### Section 1 — Runtime Instructions

| Resource | Location |
|----------|----------|
| API | http://localhost:${runtimePorts.apiPort} |
| Dashboard | http://localhost:${runtimePorts.dashboardPort} |
| Config | \`verfix.config.json\` |
| Docs | https://verfix.dev/docs |

\`\`\`bash
# Start / stop / check the runtime
verfix start
verfix stop
verfix status

# Run a specific flow
verfix run --flow <flow-id> --output json

# Run all flows
verfix run --output json

# Override mode for a single run
verfix run --flow <flow-id> --mode strict --output json

# Override URL for a single run
verfix run --flow <flow-id> --url http://localhost:5173 --output json
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

1. \`verfix status\` — Is the runtime healthy?
2. \`verfix flows\` — What flows exist right now?
3. Read \`verfix.config.json\` — Understand the structure of available flows.
4. **Select an existing flow** — Reuse before creating. Pick the flow whose
   steps cover the area you just edited.
5. **Create a new flow ONLY if** no existing flow covers the change.
   Read the app source to find real routes, selectors, and expected behavior.
6. \`verfix run --flow <id> --output json\` — Execute the flow.
7. **If failure:** Is it an app issue or a flow issue?
   - App issue → fix the application code.
   - Flow issue → update \`verfix.config.json\` (wrong selector, stale route, etc.).
8. **Fix and retry** — Go back to step 6.
9. **After 3 failed attempts** → Stop retrying. Show the \`timeline_url\` to the
   human and let them inspect the visual timeline on the dashboard.

#### Edit → verify → fix loop

\`\`\`
1. Edit the application code
2. Run the relevant flow:  verfix run --flow <id> --output json
3. If passed → done, move to next task
4. If !passed:
   a. Read failures[0].type and failures[0].fix_hint
   b. App code issue  → fix the app, go to step 2
   c. Flow definition issue → update verfix.config.json, go to step 2
5. After 3 failed attempts → stop, show timeline_url to user
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
4. **Find their selectors** — check for \`data-testid\` attributes first:

   \`\`\`bash
   # Search your codebase for existing data-testid attributes
   grep -r 'data-testid' src/
   \`\`\`

5. **Write steps** in execution order (navigate → wait → interact).
6. **Add assertions** for the expected end state.

#### Selector best practices

| Priority | Selector type | Example | Why |
|----------|--------------|---------|-----|
| 1 (best) | \`data-testid\` | \`[data-testid=login-button]\` | Stable, decoupled from styling |
| 2 | CSS selector | \`#checkout-form button[type=submit]\` | OK if semantically meaningful |
| 3 (last resort) | Text content | \`text=Sign In\` | Breaks on i18n, copy changes |

#### How to find selectors in source code

\`\`\`bash
# Find all data-testid attributes
grep -rn 'data-testid' src/

# Find a specific component's selectors
grep -rn 'data-testid' src/components/LoginForm.tsx
\`\`\`

#### How to add data-testid if missing

If the element you need to target has no \`data-testid\`, **add one**:

\`\`\`diff
-<button type="submit">Sign In</button>
+<button type="submit" data-testid="login-submit">Sign In</button>
\`\`\`

This is a non-breaking change. Add \`data-testid\` attributes freely — they
don't affect runtime behavior and make flows much more stable.

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

Every \`verfix run --output json\` returns this exact shape:

\`\`\`json
{
  "passed": false,
  "failures": [
    {
      "type": "selector_not_found",
      "selector": "[data-testid=submit]",
      "fix_hint": "Selector \\"[data-testid=submit]\\" not found in DOM. Add a stable data-testid or update the selector."
    }
  ],
  "timeline_url": "http://localhost:${runtimePorts.dashboardPort}/?executionId=exec_abc123",
  "exit_code": 1,
  "execution_id": "exec_abc123"
}
\`\`\`

#### Failure type reference

${failureList}

#### Fix strategies by failure type

| Failure type | What to do |
|---|---|
| \`selector_not_found\` | Inspect the source, find the correct selector, update the step. |
| \`selector_not_visible\` | Element exists but is hidden. Check conditional rendering logic (CSS \`display:none\`, \`visibility:hidden\`, or zero dimensions). |
| \`text_mismatch\` | Expected text not on page. Check if text is dynamically loaded — add a \`wait_for_selector\` step before the assertion. |
| \`url_mismatch\` | Navigation didn't reach expected URL. Check routing, redirects, or auth guards. |
| \`console_error\` | JavaScript errors in console. Fix the JS error in the app code. |
| \`network_failure\` | API returned non-2xx. Check the backend or mock the endpoint. |
| \`timeout\` | Operation took too long. Increase \`timeout\` on the step/assertion, or add a \`wait_for_selector\` step. |
| \`assertion_failed\` | Generic fallback. Read \`fix_hint\` for specifics. |

#### Retry logic

\`\`\`
1. Read failures[0].type
2. Apply the fix strategy from the table above
3. Re-run:  verfix run --flow <id> --output json
4. If still failing after 3 attempts → stop, show timeline_url to user
\`\`\`

---

### Section 8 — Runtime Recovery

If the runtime is misbehaving, use these commands to diagnose and fix:

| Command | When to use |
|---------|-------------|
| \`verfix status\` | Check if the runtime is running and healthy |
| \`verfix doctor\` | Run diagnostics (Docker, ports, config, health) |
| \`verfix logs\` | View runtime logs for errors or crashes |

**Recovery steps:**

1. \`verfix status\` → If not running, run \`verfix start\`.
2. \`verfix doctor\` → Follow any suggestions it prints.
3. \`verfix logs\` → Look for crash traces or port conflicts.
4. If all else fails: \`verfix stop && verfix start\` to restart.

---

### Section 9 — Flow Format Reference

#### Full schema

\`\`\`jsonc
{
  // REQUIRED — The base URL of the app under test.
  // All navigate step URLs are resolved relative to this.
  "baseUrl": "${baseUrl}",

  // REQUIRED — Default verification mode for all flows.
  //   "strict"      → deterministic only, no AI. Best for CI and stable selectors.
  //   "assisted"    → deterministic first, AI heals broken selectors. Best for active dev.
  //   "exploratory" → AI-driven navigation from a task description. No flows needed.
  "mode": "${mode}",

  // OPTIONAL — Global timeout in ms for all steps/assertions (default: 15000)
  "timeout": 15000,

  // OPTIONAL — Number of retries on failure (default: 2)
  "retries": 2,

  // OPTIONAL — Selector aliases. Map logical names to real selectors.
  "selectors": {
    "emailInput": "[data-testid=email]",
    "submitBtn": "[data-testid=submit]"
  },

  // OPTIONAL — App metadata. Helps the AI in assisted/exploratory mode.
  "metadata": {
    "framework": "next.js"
  },

  // REQUIRED — Array of flows. This is a LIBRARY — add as many as you need.
  // Each flow is independent and can be run with: verfix run --flow <id>
  "flows": [
    {
      // REQUIRED — Unique identifier. Used with: verfix run --flow <id>
      // Use descriptive kebab-case names matching the feature being tested.
      "id": "descriptive-flow-name",

      // OPTIONAL — Per-flow mode override. If set, this flow uses this mode
      // instead of the global mode. Allowed: "strict" | "assisted" | "exploratory"
      "mode": "assisted",

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

#### Step actions

Every step in a flow has an \`action\` and a target. These are the **only** actions the runtime supports:

**\`navigate\`** — Go to a URL
\`\`\`json
{ "action": "navigate", "url": "/your-page" }
\`\`\`
- \`url\` is resolved relative to \`baseUrl\` unless it's an absolute URL.
- Waits for \`networkidle\` before continuing.

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
| \`no_console_errors\` | — | Zero \`console.error()\` calls during execution |
| \`network_request_success\` | \`value\` | All network requests matching this URL pattern returned 2xx |

All assertions accept an optional \`timeout\` (ms, default 5000).

#### Mode selection guide

| Situation | Mode | Why |
|-----------|------|-----|
| Stable selectors, CI pipeline | \`strict\` | Fastest, no AI cost, fully deterministic |
| Active development, selectors may change | \`assisted\` | AI heals broken selectors automatically |
| No flow exists yet, exploring new feature | \`exploratory\` | AI navigates from a natural language task |
| Quick smoke test (page loads, no errors) | \`strict\` | Just use \`page_loaded\` + \`no_console_errors\` |

**Mode priority:** CLI flag \`--mode\` > flow-level \`mode\` > config-level \`mode\` > \`strict\`

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

export function generateCursorRules(
  flows: Array<{ id: string; description?: string }>,
  mode: string,
  baseUrl: string,
  runtimePorts: { apiPort: number; dashboardPort: number },
): string {
  const flowList = flows.map(f =>
    `- \`${f.id}\` — ${f.description || f.id.replace(/-/g, ' ') + ' flow'}`
  ).join('\n');

  return `You are working in a project that uses Verfix for browser verification.
Follow these instructions when verifying UI and browser behavior:

### Section 1 — Source of Truth Rules
1. \`verfix flows\` is the ONLY source of truth for available flows. Do NOT invent flow IDs.
2. \`verfix.config.json\` is the ONLY source of truth for flow definitions.
3. Template patterns in AGENTS.md are NOT executable.
4. Run \`verfix flows\` if unsure what flows exist.

### Section 2 — CLI Reference
- Check runtime: \`verfix status\`
- List flows: \`verfix flows\` / \`verfix flows --output json\`
- Run flow: \`verfix run --flow <flow-id> --output json\`

### Section 3 — Verification Workflow
1. Run \`verfix status\` to check runtime.
2. Run \`verfix flows\` to see existing flows.
3. Read \`verfix.config.json\` to understand steps.
4. Run \`verfix run --flow <id> --output json\` to verify.
5. If failed: read \`failures[0].type\` and \`fix_hint\`.
   - App bug: Fix app code.
   - Flow issue: Update \`verfix.config.json\`.
6. Max 3 retry attempts. If failing, show \`timeline_url\` to human.

### Section 4 — Configured Flows
${flowList}

For the full flow schema, selector best practices, and template patterns, refer to:
[AGENTS.md](./AGENTS.md)
`;
}

export function generateClaudeSection(
  flows: Array<{ id: string; description?: string }>,
  mode: string,
  baseUrl: string,
  runtimePorts: { apiPort: number; dashboardPort: number },
): string {
  const flowList = flows.map(f =>
    `- \`${f.id}\` — ${f.description || f.id.replace(/-/g, ' ') + ' flow'}`
  ).join('\n');

  return `## Verfix — Browser Verification

Verfix is a local browser-verification runtime. Run browser flows to verify your changes.

### Source of Truth Rules
1. \`verfix flows\` is the ONLY source of truth for available flows. Do NOT invent flow IDs.
2. \`verfix.config.json\` is the ONLY source of truth for flow definitions.
3. Template patterns in AGENTS.md are NOT executable.
4. Run \`verfix flows\` if unsure what flows exist.

### CLI Reference
- Check runtime: \`verfix status\`
- List flows: \`verfix flows\`
- Run flow: \`verfix run --flow <flow-id> --output json\`

### Verification Workflow
1. Run \`verfix status\` to check runtime.
2. Run \`verfix flows\` to see existing flows.
3. Read \`verfix.config.json\` to understand steps.
4. Run \`verfix run --flow <id> --output json\` to verify.
5. If failed: read \`failures[0].type\` and \`fix_hint\`.
   - App bug: Fix app code.
   - Flow issue: Update \`verfix.config.json\`.
6. Max 3 retry attempts. If failing, show \`timeline_url\` to human.

### Configured Flows
${flowList}

For the full flow schema, selector best practices, and template patterns, refer to [AGENTS.md](./AGENTS.md).
`;
}

export function generateCodexInstructions(
  flows: Array<{ id: string; description?: string }>,
  mode: string,
  baseUrl: string,
  runtimePorts: { apiPort: number; dashboardPort: number },
): string {
  const flowList = flows.map(f =>
    `- \`${f.id}\` — ${f.description || f.id.replace(/-/g, ' ') + ' flow'}`
  ).join('\n');

  return `## Verfix Verification Instructions

### Source of Truth Rules
1. \`verfix flows\` is the ONLY source of truth for available flows. Do NOT invent flow IDs.
2. \`verfix.config.json\` is the ONLY source of truth for flow definitions.
3. Template patterns in AGENTS.md are NOT executable.
4. Run \`verfix flows\` if unsure what flows exist.

### CLI Reference
- Check runtime: \`verfix status\`
- List flows: \`verfix flows\`
- Run flow: \`verfix run --flow <flow-id> --output json\`

### Verification Workflow
1. Run \`verfix status\` to check runtime.
2. Run \`verfix flows\` to see existing flows.
3. Read \`verfix.config.json\` to understand steps.
4. Run \`verfix run --flow <id> --output json\` to verify.
5. If failed: read \`failures[0].type\` and \`fix_hint\`.
   - App bug: Fix app code.
   - Flow issue: Update \`verfix.config.json\`.
6. Max 3 retry attempts. If failing, show \`timeline_url\` to human.

### Configured Flows
${flowList}

For the full flow schema, selector best practices, and template patterns, refer to [AGENTS.md](./AGENTS.md).
`;
}

