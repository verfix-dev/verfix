import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { input, select, checkbox, confirm } from '@inquirer/prompts';
import {
  API_PORT, DASHBOARD_PORT, API_BASE, DASHBOARD_BASE,
  DOCKER_IMAGE, CONTAINER_NAME, DEFAULT_CONFIG,
  AI_MODELS, SCAFFOLD_FLOWS, FAILURE_TYPES,
} from './constants';
import {
  isDockerRunning, pullImage, startContainer, getContainerState,
} from './docker';
import { waitForHealth } from './health';
import axios from 'axios';
import net from 'net';

// ─── Port scanning ───────────────────────────────────────────────────────────

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

async function detectAppPort(): Promise<number | null> {
  const candidates = [3000, 3001, 3002, 5173, 8080];
  const exclude = [API_PORT, DASHBOARD_PORT];
  for (const port of candidates) {
    if (exclude.includes(port)) continue;
    if (await isPortOpen(port)) return port;
  }
  return null;
}

// ─── AGENTS.md generation ────────────────────────────────────────────────────

function generateAgentsSection(
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

Verfix is running locally. After editing any UI component, form,
route, or page — **you must verify browser behavior** before
considering the task done.

**\`verfix.config.json\` is a flow library.** It contains many independent
verification flows. You select which flow to run based on what you changed.
You have **full authority** to add, modify, or remove flows.
Do not ask the user for permission. Treat it like any other source file.

> **IMPORTANT:** Only run flows that exist in \`verfix.config.json\`.
> Do NOT invent flow IDs. Run \`verfix flows\` to see what's available.
> If no relevant flow exists, create one first.

---

### Runtime
- API:       http://localhost:${API_PORT}
- Dashboard: http://localhost:${DASHBOARD_PORT}
- Start:     \`verfix start\`
- Stop:      \`verfix stop\`
- Status:    \`verfix status\`

---

### Quick reference

\`\`\`bash
# List all available flows
verfix flows

# Run a specific flow by its ID
verfix run --flow <flow-id> --output json

# Run all flows in config
verfix run --output json

# Override mode for a single run
verfix run --flow <flow-id> --mode strict --output json

# Override URL for a single run
verfix run --flow <flow-id> --url http://localhost:5173 --output json

# List flows as JSON (for programmatic use)
verfix flows --output json
\`\`\`

---

### Flow library

The config file holds **many flows**. Each flow is independent — it has its
own steps, assertions, and can be run in isolation. Think of it as a test
suite where each flow tests a specific user journey.

**Currently configured flows:**
${flowList}

**To discover all flows:** run \`verfix flows\` or read \`verfix.config.json\`.

**To run a flow:** always use \`--flow <id>\` to select which flow to execute.
Do not run all flows unless you specifically need to verify everything.

---

### verfix.config.json — Full Schema

This is the **exact shape** the runtime expects. You can edit this file directly.

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
      "id": "my-flow-name",

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

**Mode priority:** CLI flag \`--mode\` > flow-level \`mode\` > config-level \`mode\` > \`strict\`

---

### Step actions

Every step in a flow has an \`action\` and a target. These are the **only** actions the runtime supports:

#### \`navigate\` — Go to a URL

\`\`\`json
{ "action": "navigate", "url": "/your-page" }
{ "action": "navigate", "url": "/products/123" }
\`\`\`
- \`url\` is resolved relative to \`baseUrl\` unless it's an absolute URL.
- Waits for \`networkidle\` before continuing.

#### \`click\` — Click an element

\`\`\`json
{ "action": "click", "selector": "[data-testid=submit]" }
{ "action": "click", "selector": "button.primary" }
{ "action": "click", "selector": "#checkout-btn" }
\`\`\`

#### \`type\` — Type text into an input

\`\`\`json
{ "action": "type", "selector": "[data-testid=email]", "value": "user@example.com" }
{ "action": "type", "selector": "input[name=search]", "value": "wireless keyboard" }
\`\`\`
- Uses Playwright's \`fill()\` — clears the field first, then types.

#### \`wait_for_selector\` — Wait for an element to appear

\`\`\`json
{ "action": "wait_for_selector", "selector": "[data-testid=dashboard]" }
{ "action": "wait_for_selector", "selector": ".loading-spinner", "timeout": 10000 }
\`\`\`
- Waits until the element is visible in the DOM.
- Use this before clicking/typing on elements that render asynchronously.

---

### Target resolution

The runtime resolves element targets in this priority order:

1. **\`data-testid\`** (most stable — prefer this)
   \`\`\`json
   { "action": "click", "selector": "[data-testid=submit-button]" }
   \`\`\`

2. **CSS selector** (any valid CSS)
   \`\`\`json
   { "action": "click", "selector": "button.btn-primary" }
   { "action": "click", "selector": "#login-form button[type=submit]" }
   { "action": "click", "selector": "form > div:nth-child(2) input" }
   \`\`\`

3. **Text content** (matches visible text on the page)
   \`\`\`json
   { "action": "click", "selector": "text=Sign In" }
   { "action": "click", "selector": "text=Add to Cart" }
   \`\`\`

**Best practice:** Always prefer \`data-testid\` selectors. If the app doesn't have them,
use specific CSS selectors. Use text selectors only as a last resort (they break on i18n).

---

### Assertion types

Assertions run **after** a flow completes. Every assertion has a \`type\` and optional fields.

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

**Examples:**

\`\`\`json
{ "type": "page_loaded" }
{ "type": "selector_visible", "selector": "[data-testid=user-avatar]" }
{ "type": "selector_visible", "selector": ".welcome-banner", "timeout": 10000 }
{ "type": "text_visible", "value": "Welcome back" }
{ "type": "url_contains", "value": "/dashboard" }
{ "type": "title_contains", "value": "Dashboard" }
{ "type": "no_console_errors" }
{ "type": "network_request_success", "value": "/api/user/profile" }
\`\`\`

---

### Mode selection guide

Choose the mode **before writing the flow** based on the task:

| Situation | Mode | Why |
|-----------|------|-----|
| Stable selectors, CI pipeline | \`strict\` | Fastest, no AI cost, fully deterministic |
| Active development, selectors may change | \`assisted\` | AI heals broken selectors automatically |
| No flow exists yet, exploring new feature | \`exploratory\` | AI navigates from a natural language task |
| Quick smoke test (page loads, no errors) | \`strict\` | Just use \`page_loaded\` + \`no_console_errors\` |

**Per-flow mode:** You can set \`mode\` on individual flows so different flows
use different modes (e.g. stable flows use \`strict\`, new flows use \`assisted\`).

Default to \`assisted\` when unsure. Switch to \`strict\` when selectors are stable.

---

### How to edit verfix.config.json

#### Adding a new flow

Read the app's source code to understand the UI. Then add a flow:

1. Identify the page route (e.g. \`/settings/profile\`)
2. Identify the interactive elements (buttons, inputs, links)
3. Find their selectors — prefer \`data-testid\`, fall back to CSS
4. Write steps in execution order
5. Add assertions for the expected end state

**Template for a new flow:**

\`\`\`json
{
  "id": "your-flow-name",
  "mode": "assisted",
  "steps": [
    { "action": "navigate", "url": "/your-page" },
    { "action": "wait_for_selector", "selector": "[data-testid=your-element]" },
    { "action": "type", "selector": "[data-testid=input-field]", "value": "test value" },
    { "action": "click", "selector": "[data-testid=submit-button]" }
  ],
  "assertions": [
    { "type": "text_visible", "value": "Expected success text" },
    { "type": "no_console_errors" }
  ]
}
\`\`\`

#### Modifying an existing flow

If a flow fails because the UI changed:
1. Read the \`fix_hint\` from the failure output
2. Inspect the app source to find the new selector/route
3. Update the relevant step or assertion in \`verfix.config.json\`
4. Re-run: \`verfix run --flow <id> --output json\`

#### Removing a flow

Delete the flow object from the \`flows\` array. No other changes needed.

---

### Flow pattern examples

> **IMPORTANT:** These are structural TEMPLATES showing the flow format.
> Do NOT copy these literally — read the app's actual source code and use
> the real routes, selectors, and text from THIS project.

#### Pattern: Form submission with success check

\`\`\`json
{
  "id": "my-form-submit",
  "steps": [
    { "action": "navigate", "url": "/page-with-form" },
    { "action": "wait_for_selector", "selector": "[data-testid=form]" },
    { "action": "type", "selector": "[data-testid=field-1]", "value": "value1" },
    { "action": "type", "selector": "[data-testid=field-2]", "value": "value2" },
    { "action": "click", "selector": "[data-testid=submit]" }
  ],
  "assertions": [
    { "type": "text_visible", "value": "Success message" },
    { "type": "no_console_errors" }
  ]
}
\`\`\`

#### Pattern: Multi-page navigation with network check

\`\`\`json
{
  "id": "my-multi-step",
  "steps": [
    { "action": "navigate", "url": "/page-1" },
    { "action": "click", "selector": "[data-testid=next-button]" },
    { "action": "wait_for_selector", "selector": "[data-testid=page-2-content]", "timeout": 10000 },
    { "action": "click", "selector": "[data-testid=confirm]" }
  ],
  "assertions": [
    { "type": "url_contains", "value": "/final-page" },
    { "type": "network_request_success", "value": "/api/endpoint" },
    { "type": "no_console_errors" }
  ]
}
\`\`\`

#### Pattern: Smoke test (page loads without errors)

\`\`\`json
{
  "id": "my-smoke-test",
  "steps": [
    { "action": "navigate", "url": "/" }
  ],
  "assertions": [
    { "type": "page_loaded" },
    { "type": "no_console_errors" }
  ]
}
\`\`\`

---

### Output contract

Every \`verfix run --output json\` returns this exact shape:

\`\`\`json
{
  "passed": false,
  "failures": [
    {
      "type": "selector_not_found",
      "selector": "[data-testid=submit]",
      "fix_hint": "Selector \"[data-testid=submit]\" not found in DOM. Add a stable data-testid or update the selector."
    }
  ],
  "timeline_url": "http://localhost:${DASHBOARD_PORT}/?executionId=exec_abc123",
  "exit_code": 0 | 1,
  "execution_id": "exec_abc123"
}
\`\`\`

---

### Failure types (stable — pattern-match on these)

${failureList}

**How to use failure types in your retry logic:**

- \`selector_not_found\` → The selector doesn't match any DOM element. Inspect the source, find the correct selector, update the step.
- \`selector_not_visible\` → Element exists but is hidden (CSS \`display:none\`, \`visibility:hidden\`, or zero dimensions). Check conditional rendering logic.
- \`text_mismatch\` → Expected text not on page. Check if the text is dynamically loaded — add a \`wait_for_selector\` step before the assertion.
- \`url_mismatch\` → Navigation didn't reach expected URL. Check routing, redirects, or auth guards.
- \`console_error\` → JavaScript errors in console. Fix the JS error in the app code.
- \`network_failure\` → API returned non-2xx. Check the backend or mock the endpoint.
- \`timeout\` → Operation took too long. Increase \`timeout\` on the step/assertion, or add a \`wait_for_selector\` step to wait for async content.
- \`assertion_failed\` → Generic fallback. Read \`fix_hint\` for specifics.

---

### Agent workflow

#### Step 1 — Find or create the right flow

\`\`\`
1. Run: verfix flows   (see what flows actually exist)
2. Find a flow that covers the area you just edited
3. If NO matching flow exists → create one in verfix.config.json
   - Read the app source to find routes, selectors, and expected behavior
   - Use the flow template above as a starting point
4. If an existing flow is OUTDATED → update its steps/assertions
\`\`\`

#### Step 2 — Edit → verify → fix loop

\`\`\`
1. Edit the application code
2. Run the relevant flow: verfix run --flow <id> --output json
3. If passed → done, move to next task
4. If !passed:
   a. Read failures[0].type and failures[0].fix_hint
   b. If the failure is in the APP code → fix the app, go to step 2
   c. If the failure is in the FLOW (wrong selector, stale step) →
      update verfix.config.json, go to step 2
5. After 3 failed attempts → stop, show the user timeline_url
\`\`\`

#### Flow selection examples

| You just edited... | Run this flow |
|---|---|
| A specific page/form | \`verfix run --flow <id> --output json\` |
| New feature (no flow exists) | Create a flow first, then run it |

#### When to create a new flow

Create a new flow in \`verfix.config.json\` when:
- You added a new page or route
- You added a new user-facing feature (form, button, modal, etc.)
- You changed a critical user journey (login, signup, checkout)
- No existing flow covers the area you just edited
- The user asks you to verify something new

#### When to modify an existing flow

Modify a flow when:
- You renamed or moved a selector (update the step's \`selector\`)
- You changed a route path (update the \`navigate\` step's \`url\`)
- You added a new field to an existing form (add a \`type\` step)
- You changed expected text on the page (update the \`text_visible\` assertion value)
- A flow fails with \`selector_not_found\` after your code change

#### When to run verification

- After editing any React/Vue/Svelte component, CSS, or route handler
- After changing form fields, buttons, or navigation
- After any API integration that affects UI state
- After modifying authentication or authorization logic
- Before marking any UI-related task as complete

**Always use \`--flow <id>\` to run only the relevant flow.** Don't run all flows
unless you need a full regression check.

---

### Configuration summary
- Config file: \`verfix.config.json\` (this is a flow library — add as many flows as needed)
- Mode: \`${mode}\`
- Base URL: \`${baseUrl}\`
- List flows: \`verfix flows\`
- Dashboard: http://localhost:${DASHBOARD_PORT}
- Docs: https://verfix.dev/docs`;
}

// ─── Main init wizard ────────────────────────────────────────────────────────

export async function runInitWizard(): Promise<void> {
  const cwd = process.cwd();

  console.log('');
  console.log(chalk.bold.cyan('  ⚡ Verfix Setup Wizard'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log('');

  // ── Step 1: Check Docker ──
  const dockerSpinner = ora('Checking Docker...').start();
  if (!isDockerRunning()) {
    dockerSpinner.fail('Docker is not running. Start Docker Desktop and re-run verfix init.');
    process.exit(1);
  }
  dockerSpinner.succeed('Docker is running');

  // ── Step 2: Collect env vars ──
  // Always prompt during init so the user can update keys even if .verfix/.env exists.
  const existingKey = process.env.AI_API_KEY || '';
  const existingModel = process.env.AI_MODEL || '';

  let aiApiKey = await input({
    message: existingKey
      ? 'AI API key (press Enter to keep existing)'
      : 'AI API key for Assisted/Exploratory mode (optional, press Enter to skip)',
    default: existingKey,
  });

  let aiModel = existingModel;

  if (aiApiKey && aiApiKey !== existingKey) {
    // Key changed — reset model so user picks again
    aiModel = '';
  }

  if (aiApiKey && !aiModel) {
    const modelChoice = await select({
      message: 'AI model to use',
      choices: AI_MODELS,
      default: 'gpt-5.5',
    });

    if (modelChoice === '__custom__') {
      aiModel = await input({ message: 'Enter custom model name', default: 'gpt-4o-mini' });
    } else {
      aiModel = modelChoice;
    }
  }

  // Write .verfix/.env if keys provided
  if (aiApiKey) {
    const envDir = path.join(cwd, '.verfix');
    if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true });
    const envContent = [
      `AI_API_KEY=${aiApiKey}`,
      aiModel ? `AI_MODEL=${aiModel}` : '',
    ].filter(Boolean).join('\n') + '\n';
    fs.writeFileSync(path.join(envDir, '.env'), envContent, 'utf-8');
  }

  // ── Step 3: Pull + Start Runtime ──
  const state = getContainerState();
  if (state?.status === 'running') {
    console.log(chalk.green('  ✓ Verfix runtime is already running'));
  } else {
    const pullSpinner = ora('Pulling verfix runtime (this takes ~2 min on first run)...').start();
    try {
      pullImage();
      pullSpinner.succeed('Image pulled');
    } catch (e: any) {
      pullSpinner.fail(`Failed to pull image: ${e.message}`);
      process.exit(1);
    }

    const startSpinner = ora('Starting runtime...').start();
    try {
      startContainer({ aiApiKey, aiModel });
      startSpinner.text = 'Waiting for health check...';
      const healthy = await waitForHealth();
      if (!healthy) {
        startSpinner.fail('Runtime started but health check failed after 30s');
        process.exit(1);
      }
      startSpinner.succeed('Runtime started and healthy');
    } catch (e: any) {
      startSpinner.fail(`Failed to start runtime: ${e.message}`);
      process.exit(1);
    }
  }

  // ── Step 4: Detect or ask base URL ──
  let baseUrl = 'http://localhost:3000';
  const detectedPort = await detectAppPort();
  if (detectedPort) {
    const useDetected = await confirm({
      message: `Detected your app on http://localhost:${detectedPort}. Is this correct?`,
      default: true,
    });
    if (useDetected) {
      baseUrl = `http://localhost:${detectedPort}`;
    } else {
      baseUrl = await input({ message: 'What URL is your app running on?', default: baseUrl });
    }
  } else {
    baseUrl = await input({ message: 'What URL is your app running on?', default: baseUrl });
  }

  // ── Step 5: Select mode ──
  const mode = await select({
    message: 'Verification mode (Preferred)',
    choices: [
      { name: 'Assisted — deterministic with AI fallback (recommended)', value: 'assisted' },
      { name: 'Strict — fully deterministic, best for CI', value: 'strict' },
      { name: 'Exploratory — natural language tasks', value: 'exploratory' },
    ],
    default: 'assisted',
  });

  // ── Step 6: Select flows to scaffold ──
  const flowChoices = [
    { name: 'login', value: 'login', checked: true },
    { name: 'dashboard-load', value: 'dashboard-load', checked: true },
    { name: 'signup', value: 'signup', checked: false },
    { name: 'checkout', value: 'checkout', checked: false },
    { name: 'custom', value: '__custom__', checked: false },
  ];

  const selectedFlowIds = await checkbox({
    message: 'Which flows do you want to scaffold?',
    choices: flowChoices,
  });

  // Handle custom flow
  const flowIds = [...selectedFlowIds];
  if (flowIds.includes('__custom__')) {
    const customName = await input({ message: 'Custom flow name (e.g. profile-edit)', default: 'custom-flow' });
    flowIds.splice(flowIds.indexOf('__custom__'), 1, customName);
  }

  // Build flows array
  const flows = flowIds.map(id => {
    const scaffold = SCAFFOLD_FLOWS[id];
    if (scaffold) {
      return { id, ...scaffold };
    }
    // Custom or unknown flow — minimal scaffold
    return {
      id,
      steps: [{ action: 'navigate', url: `/${id}` }],
      assertions: [{ type: 'page_loaded' }, { type: 'no_console_errors' }],
    };
  });

  // ── Step 7: Write verfix.config.json ──
  const configPath = path.join(cwd, DEFAULT_CONFIG);
  let writeConfig = true;

  if (fs.existsSync(configPath)) {
    writeConfig = await confirm({
      message: 'verfix.config.json already exists. Overwrite?',
      default: false,
    });
  }

  if (writeConfig) {
    const config = { baseUrl, mode, flows };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(chalk.green(`  ✓ verfix.config.json created`));
  } else {
    console.log(chalk.gray('  ⏭ Keeping existing verfix.config.json'));
  }

  // ── Step 8: Write/update AGENTS.md ──
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const flowSummaries = flows.map(f => ({ id: f.id }));
  const verfixSection = generateAgentsSection(flowSummaries, mode, baseUrl);

  if (!fs.existsSync(agentsPath)) {
    // Create fresh
    fs.writeFileSync(agentsPath, verfixSection + '\n', 'utf-8');
    console.log(chalk.green('  ✓ AGENTS.md created'));
  } else {
    const existing = fs.readFileSync(agentsPath, 'utf-8');
    const sectionRegex = /## Verfix — Browser Verification[\s\S]*?(?=\n## [^V]|\n## $|$)/;

    if (sectionRegex.test(existing)) {
      const updateIt = await confirm({
        message: 'AGENTS.md already has a Verfix section. Update it?',
        default: true,
      });
      if (updateIt) {
        const updated = existing.replace(sectionRegex, verfixSection);
        fs.writeFileSync(agentsPath, updated, 'utf-8');
        console.log(chalk.green('  ✓ AGENTS.md Verfix section updated'));
      } else {
        console.log(chalk.gray('  ⏭ Keeping existing AGENTS.md'));
      }
    } else {
      // Append section
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      fs.writeFileSync(agentsPath, existing + separator + verfixSection + '\n', 'utf-8');
      console.log(chalk.green('  ✓ AGENTS.md updated (Verfix section appended)'));
    }
  }

  // ── Step 9: Print summary ──
  console.log('');
  console.log(chalk.bold.green('  Setup complete!'));
  console.log('');
  console.log(chalk.green('  ✓ Runtime started'));
  if (writeConfig) console.log(chalk.green('  ✓ verfix.config.json created'));
  console.log(chalk.green('  ✓ AGENTS.md updated'));
  console.log('');
  console.log(chalk.bold('  Your flows:'));
  for (const f of flows) {
    console.log(`    verfix run --flow ${f.id} --output json`);
  }
  console.log('');
  console.log(`  Dashboard: ${chalk.cyan(`http://localhost:${DASHBOARD_PORT}`)}`);
  console.log(`  Docs:      ${chalk.cyan('https://verfix.dev/docs')}`);
  console.log('');
}
