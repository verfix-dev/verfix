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

const PAGE_HTML = `<!doctype html>
<html>
  <head><title>Verfix Test App</title></head>
  <body>
    <h1 data-testid="greeting">Hello Verfix</h1>
  </body>
</html>`;

async function main() {
  // ── Arrange: throwaway app + temp project dir ──
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
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
    ],
  };
  fs.writeFileSync(path.join(projectDir, 'verfix.config.json'), JSON.stringify(config, null, 2));

  // ── Act: run the CLI with JSON output — local is the DEFAULT runner, so no
  // VERFIX_RUNNER override (scrubbed from the inherited env to prove it).
  // Must be an async spawn: spawnSync would block this process's event loop
  // and the in-process HTTP server above could never respond.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, VERFIX_TELEMETRY: 'off' };
  delete childEnv.VERFIX_RUNNER;
  const res = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      'npx',
      ['ts-node', '--project', path.join(CLI_DIR, 'tsconfig.json'), path.join(CLI_DIR, 'src', 'index.ts'),
        'run', '--flow', 'smoke,optional-and-clear-state', '--output', 'json'],
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
  server.close();

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

    const resultFile = path.join(projectDir, '.verfix', 'runs', `${json.execution_id}.json`);
    assert.ok(fs.existsSync(resultFile), `persisted result exists: ${resultFile}`);
    const persisted = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
    assert.strictEqual(persisted.passed, true);
    assert.strictEqual(persisted.executionId, json.execution_id);
    console.log('✓ result persisted to .verfix/runs/<id>.json');

    console.log('\n4 passed, 0 failed\n');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

console.log('\nRunning local-run e2e test (needs Playwright Chromium)...\n');
main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
