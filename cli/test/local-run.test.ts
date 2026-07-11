/**
 * End-to-end test for local runner mode (VERFIX_RUNNER=local): spins up a tiny
 * HTTP app, runs a strict flow against it in-process (no Docker/Redis/API),
 * and asserts the JSON contract + on-disk persistence.
 *
 * Requires the Playwright Chromium (npx playwright install chromium).
 */

import assert from 'assert';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const CLI_DIR = path.resolve(__dirname, '..');

// Invoke ts-node through the current Node binary instead of `npx`: Windows
// can't spawn 'npx' without a shell, and a shell doesn't escape args
// (e.g. --text "Private OK" would split on the space).
const TS_NODE_BIN = require.resolve('ts-node/dist/bin');

const PAGE_HTML = `<!doctype html>
<html>
  <head><title>Verfix Test App</title></head>
  <body>
    <h1 data-testid="greeting">Hello Verfix</h1>
  </body>
</html>`;

// Client-side "auth": login sets a localStorage token AND a sessionStorage
// token; /private only renders its content when both are present — exactly
// what saveState/useState must carry across two separate CLI runs.
// (sessionStorage travels via the .session.json sidecar, not Playwright's
// storageState — most real SPAs keep their JWT there.)
const LOGIN_HTML = `<!doctype html>
<html>
  <head><title>Login</title></head>
  <body>
    <button data-testid="login-btn" onclick="localStorage.setItem('token','t0k3n');sessionStorage.setItem('ss_token','s3ss10n');document.getElementById('status').textContent='Logged in';">Log in</button>
    <div id="status"></div>
  </body>
</html>`;

const PRIVATE_HTML = `<!doctype html>
<html>
  <head><title>Private</title></head>
  <body>
    <div id="content"></div>
    <script>
      document.getElementById('content').textContent =
        localStorage.getItem('token') === 't0k3n' && sessionStorage.getItem('ss_token') === 's3ss10n'
          ? 'Private OK' : 'Access Denied';
    </script>
  </body>
</html>`;

// The field-review scenario behind #55/#59: the click target exists and the
// selector is correct, but a viewport-covering dialog intercepts the click.
// The failure JSON must carry page_state facts naming the open dialog.
const BLOCKED_HTML = `<!doctype html>
<html>
  <head><title>Blocked</title></head>
  <body>
    <button data-testid="buy">Buy now</button>
    <div role="dialog" aria-label="Welcome to Cleara" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;">
      <h2>Welcome to Cleara</h2>
      <button type="button">Get started</button>
    </div>
  </body>
</html>`;

// Same scenario without any ARIA role — must be caught by the geometric
// full-viewport-overlay probe (elementsFromPoint path), not the dialog query.
const BLOCKED_PLAIN_HTML = `<!doctype html>
<html>
  <head><title>Blocked Plain</title></head>
  <body>
    <button data-testid="buy">Buy now</button>
    <div id="cookie-wall" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;">
      <p>We use cookies.</p>
    </div>
  </body>
</html>`;

async function main() {
  // ── Arrange: throwaway app + temp project dir ──
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url?.startsWith('/login')) return res.end(LOGIN_HTML);
    if (req.url?.startsWith('/private')) return res.end(PRIVATE_HTML);
    if (req.url?.startsWith('/blocked-plain')) return res.end(BLOCKED_PLAIN_HTML);
    if (req.url?.startsWith('/blocked')) return res.end(BLOCKED_HTML);
    res.end(PAGE_HTML);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verfix-local-run-'));
  const config = {
    baseUrl: `http://127.0.0.1:${port}`,
    mode: 'strict',
    flows: [
      {
        id: 'smoke',
        steps: [],
        assertions: [
          { type: 'selector_visible', selector: '[data-testid="greeting"]' },
          { type: 'text_visible', value: 'Hello Verfix' },
        ],
      },
      {
        // Exercises `optional` (a step whose target never appears must not
        // abort the flow) and `clearState` (runs against a fresh
        // cookies/storage slate) together in one end-to-end run.
        id: 'optional-and-clear-state',
        clearState: true,
        steps: [
          { action: 'click', selector: '[data-testid="does-not-exist"]', optional: true, timeout: 1000 },
        ],
        assertions: [
          { type: 'selector_visible', selector: '[data-testid="greeting"]' },
        ],
      },
      {
        // Auth state reuse, save side: log in, then persist the session.
        id: 'login',
        clearState: true,
        saveState: 'auth',
        steps: [
          { action: 'navigate', url: '/login' },
          { action: 'click', testId: 'login-btn' },
        ],
        assertions: [
          { type: 'text_visible', value: 'Logged in' },
        ],
      },
      {
        // Auth state reuse, restore side: run in a SEPARATE CLI invocation —
        // must start already "logged in" without any login steps.
        id: 'private',
        useState: 'auth',
        steps: [
          { action: 'navigate', url: '/private' },
        ],
        assertions: [
          { type: 'text_visible', value: 'Private OK' },
        ],
      },
      {
        // A drifted step selector must surface as selector_not_found with the
        // selector and a config-first hint — never as a generic `timeout`
        // telling the agent to wait longer for an element that doesn't exist.
        id: 'drifted-selector',
        clearState: true,
        steps: [
          { action: 'navigate', url: '/' },
          { action: 'click', selector: '[data-testid="never-existed"]', timeout: 1500 },
        ],
        assertions: [
          { type: 'text_visible', value: 'irrelevant — the step above fails first' },
        ],
      },
      {
        // The selector is CORRECT but a full-viewport dialog intercepts the
        // click — the failure must carry page_state facts naming the dialog.
        id: 'blocked-by-dialog',
        clearState: true,
        steps: [
          { action: 'navigate', url: '/blocked' },
          { action: 'click', selector: '[data-testid="buy"]', timeout: 1500 },
        ],
        assertions: [
          { type: 'text_visible', value: 'irrelevant — the step above fails first' },
        ],
      },
      {
        // Same, but the overlay has no ARIA role — exercises the geometric
        // detection path.
        id: 'blocked-by-plain-overlay',
        clearState: true,
        steps: [
          { action: 'navigate', url: '/blocked-plain' },
          { action: 'click', selector: '[data-testid="buy"]', timeout: 1500 },
        ],
        assertions: [
          { type: 'text_visible', value: 'irrelevant — the step above fails first' },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(projectDir, 'verfix.config.json'), JSON.stringify(config, null, 2));

  // ── Act: run the CLI with JSON output — local is the DEFAULT runner, so no
  // VERFIX_RUNNER override (scrubbed from the inherited env to prove it).
  // Must be an async spawn: spawnSync would block this process's event loop
  // and the in-process HTTP server above could never respond.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, VERFIX_TELEMETRY: 'off' };
  delete childEnv.VERFIX_RUNNER;
  const runCli = (flowIds: string) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TS_NODE_BIN, '--project', path.join(CLI_DIR, 'tsconfig.json'), path.join(CLI_DIR, 'src', 'index.ts'),
        'run', '--flow', flowIds, '--output', 'json'],
      {
        cwd: projectDir,
        env: childEnv,
      },
    );
    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI run timed out after 120s')); }, 120000);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', status => { clearTimeout(killTimer); resolve({ status, stdout, stderr }); });
  });

  const res = await runCli('smoke,optional-and-clear-state,login');
  // Before 'private': the probe below reads the NEWEST run's DOM snapshot and
  // expects the /private page.
  const resDrifted = await runCli('drifted-selector');
  const resBlocked = await runCli('blocked-by-dialog');
  const resBlockedPlain = await runCli('blocked-by-plain-overlay');
  const resPrivate = await runCli('private');
  server.close();

  // Probe the newest run's DOM snapshot (the /private page) — no server needed.
  const resProbe = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TS_NODE_BIN, '--project', path.join(CLI_DIR, 'tsconfig.json'), path.join(CLI_DIR, 'src', 'index.ts'),
        'probe', '--selector', '#content', '--selector', '#does-not-exist', '--text', 'Private OK', '--output', 'json'],
      { cwd: projectDir, env: childEnv },
    );
    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('probe timed out after 60s')); }, 60000);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', status => { clearTimeout(killTimer); resolve({ status, stdout, stderr }); });
  });

  // ── Assert: exit code, pure-JSON stdout, contract fields, persistence ──
  try {
    assert.strictEqual(res.status, 0, `exit code 0 expected.\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);

    let json: any;
    try {
      json = JSON.parse(res.stdout);
    } catch {
      assert.fail(`stdout is not pure JSON:\n${res.stdout}`);
    }
    console.log('✓ local run exits 0 with pure-JSON stdout');

    assert.strictEqual(json.passed, true, `expected passed:true — got: ${res.stdout}`);
    assert.deepStrictEqual(json.failures, []);
    assert.strictEqual(json.timeline_url, null, 'timeline_url must be null in local mode');
    assert.strictEqual(json.exit_code, 0);
    assert.ok(json.execution_id?.startsWith('exec_'), 'execution_id present');
    assert.strictEqual(json.show_command, `verfix show ${json.execution_id}`);
    console.log('✓ JSON contract: passed/failures/timeline_url:null/show_command');

    assert.ok(json.trace_path, 'trace_path present');
    assert.ok(fs.existsSync(json.trace_path), `trace zip exists on disk: ${json.trace_path}`);
    console.log('✓ trace_path points at a real Playwright trace zip');

    assert.strictEqual(json.raw, undefined, 'summary is the default — raw only with --full');
    assert.ok(json.detail_commands?.console?.includes('--console'), 'detail_commands.console present');
    assert.ok(json.detail_commands?.network?.includes('--network'), 'detail_commands.network present');
    console.log('✓ default JSON is the summary shape with self-describing detail_commands');

    // The optional-and-clear-state flow skips an optional step whose target
    // never exists — the summary must say so explicitly, never silently.
    assert.ok(Array.isArray(json.skipped_optional_steps) && json.skipped_optional_steps.length === 1,
      `skipped optional step must surface in the summary, got: ${JSON.stringify(json.skipped_optional_steps)}`);
    assert.strictEqual(json.skipped_optional_steps[0].flow, 'optional-and-clear-state');
    assert.strictEqual(json.skipped_optional_steps[0].action, 'click');
    assert.ok(json.skipped_optional_steps[0].reason, 'skip reason present');
    console.log('✓ skipped optional steps are reported in the summary (nothing silent)');

    const resultFile = path.join(projectDir, '.verfix', 'runs', `${json.execution_id}.json`);
    assert.ok(fs.existsSync(resultFile), `persisted result exists: ${resultFile}`);
    const persisted = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
    assert.strictEqual(persisted.passed, true);
    assert.strictEqual(persisted.executionId, json.execution_id);
    console.log('✓ result persisted to .verfix/runs/<id>.json');

    const stateFile = path.join(projectDir, '.verfix', 'state', 'auth.json');
    assert.ok(fs.existsSync(stateFile), `saved storage state exists: ${stateFile}`);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.ok(JSON.stringify(state).includes('t0k3n'), 'state file carries the localStorage token');
    console.log('✓ passing login flow with saveState wrote .verfix/state/auth.json');

    const sessionFile = path.join(projectDir, '.verfix', 'state', 'auth.session.json');
    assert.ok(fs.existsSync(sessionFile), `sessionStorage sidecar exists: ${sessionFile}`);
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    assert.strictEqual(session.entries.ss_token, 's3ss10n', 'sidecar carries the sessionStorage token');
    assert.ok(session.origin?.startsWith('http://127.0.0.1'), 'sidecar records the origin it applies to');
    console.log('✓ saveState also captured sessionStorage to the .session.json sidecar');

    assert.strictEqual(resPrivate.status, 0, `private run exit 0 expected.\nstdout: ${resPrivate.stdout}\nstderr: ${resPrivate.stderr}`);
    const privateJson = JSON.parse(resPrivate.stdout);
    assert.strictEqual(privateJson.passed, true, `private flow should start logged-in via useState — got: ${resPrivate.stdout}`);
    console.log('✓ separate run with useState starts authenticated (no login steps)');

    assert.strictEqual(resProbe.status, 1, `probe with one miss should exit 1.\nstdout: ${resProbe.stdout}\nstderr: ${resProbe.stderr}`);
    const probeJson = JSON.parse(resProbe.stdout);
    const byQuery = Object.fromEntries(probeJson.queries.map((q: any) => [q.query, q]));
    assert.strictEqual(byQuery['#content'].count, 1, 'existing selector should match the snapshot');
    assert.ok(byQuery['#content'].matches[0].excerpt.includes('Private OK'), 'excerpt carries the matched outerHTML');
    assert.strictEqual(byQuery['#does-not-exist'].count, 0, 'missing selector reports 0 matches');
    assert.strictEqual(byQuery['Private OK'].count, 1, 'text query matches like text_visible');
    console.log('✓ probe dry-runs selectors/text against the saved DOM snapshot');

    assert.strictEqual(resDrifted.status, 1, `drifted run should exit 1.\nstdout: ${resDrifted.stdout}\nstderr: ${resDrifted.stderr}`);
    const driftedJson = JSON.parse(resDrifted.stdout);
    assert.strictEqual(driftedJson.passed, false);
    const drifted = driftedJson.failures[0];
    assert.strictEqual(drifted.type, 'selector_not_found',
      `drifted step selector must classify as selector_not_found, got: ${JSON.stringify(driftedJson.failures)}`);
    assert.strictEqual(drifted.selector, '[data-testid="never-existed"]', 'failure carries the missing selector');
    assert.ok(!/increase timeout/i.test(drifted.fix_hint), `hint must not tell the agent to wait longer: ${drifted.fix_hint}`);
    assert.ok(/verfix\.config\.json/.test(drifted.fix_hint), 'hint points at the config-first fix');
    assert.ok(!/\u001b/.test(resDrifted.stdout), 'no ANSI escape codes in JSON output');
    console.log('✓ drifted step selector reports selector_not_found with the selector, config-first hint, no ANSI');

    assert.strictEqual(resBlocked.status, 1, `blocked run should exit 1.\nstdout: ${resBlocked.stdout}\nstderr: ${resBlocked.stderr}`);
    const blockedJson = JSON.parse(resBlocked.stdout);
    assert.strictEqual(blockedJson.passed, false);
    const blockedState = blockedJson.failures[0]?.page_state;
    assert.ok(blockedState, `step failure must carry page_state facts, got: ${JSON.stringify(blockedJson.failures)}`);
    assert.ok(
      blockedState.open_dialogs.some((d: any) => d.name.includes('Welcome to Cleara')),
      `page_state must name the open dialog, got: ${JSON.stringify(blockedState.open_dialogs)}`,
    );
    assert.ok(blockedState.url.includes('/blocked'), 'page_state carries the failure-time URL');
    assert.strictEqual(typeof blockedState.prior_console_errors, 'number');
    assert.strictEqual(typeof blockedState.prior_failed_requests, 'number');
    // The JSON contract carries only the high-signal facts; the full
    // visible-elements inventory stays in the persisted run + artifact.
    assert.strictEqual(blockedState.visible_elements, undefined,
      'visible_elements must not appear in the JSON contract');
    const persistedBlocked = JSON.parse(
      fs.readFileSync(path.join(projectDir, '.verfix', 'runs', `${blockedJson.execution_id}.json`), 'utf-8'));
    assert.ok(Array.isArray(persistedBlocked.page_state?.visible_elements),
      'full facts (incl. visible_elements) persist in the run result');
    assert.ok(persistedBlocked.artifacts?.page_state, 'page_state artifact path recorded');
    assert.ok(fs.existsSync(persistedBlocked.artifacts.page_state), 'page_state facts persisted as a JSON artifact');
    console.log('✓ dialog-blocked click carries page_state facts naming the dialog; facts persisted as artifact');

    // #59: a step (crash-path) failure now also runs the analyzer pipeline —
    // the open dialog must surface as a blocking_overlay finding, and its
    // summary rendered into fix_hint (the crash path renders fix_hint in the
    // CLI, not the engine, so this exercises the CLI's own rendering too).
    const blockedFindings = blockedJson.failures[0]?.findings;
    assert.ok(Array.isArray(blockedFindings) && blockedFindings.length >= 1,
      `step failure must carry a findings array, got: ${JSON.stringify(blockedJson.failures)}`);
    const blockingOverlay = blockedFindings.find((f: any) => f.code === 'blocking_overlay');
    assert.ok(blockingOverlay, `expected a blocking_overlay finding, got: ${JSON.stringify(blockedFindings)}`);
    assert.ok(blockingOverlay.summary.includes('Welcome to Cleara'), `finding summary should name the dialog, got: ${blockingOverlay.summary}`);
    assert.ok(blockedJson.failures[0].fix_hint.includes('Welcome to Cleara'),
      `fix_hint must mention the dialog, got: ${blockedJson.failures[0].fix_hint}`);
    console.log('✓ dialog-blocked click failure carries a blocking_overlay finding, rendered into fix_hint');

    assert.strictEqual(resBlockedPlain.status, 1, `blocked-plain run should exit 1.\nstdout: ${resBlockedPlain.stdout}\nstderr: ${resBlockedPlain.stderr}`);
    const plainState = JSON.parse(resBlockedPlain.stdout).failures[0]?.page_state;
    assert.ok(plainState, 'plain-overlay step failure must carry page_state facts');
    assert.ok(
      plainState.open_dialogs.some((d: any) => d.kind === 'overlay' && d.selector.includes('cookie-wall')),
      `geometric probe must detect the role-less full-viewport overlay, got: ${JSON.stringify(plainState.open_dialogs)}`,
    );
    console.log('✓ role-less full-viewport overlay detected via the geometric probe path');

    console.log('\n14 passed, 0 failed\n');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

console.log('\nRunning local-run e2e test (needs Playwright Chromium)...\n');
main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
