#!/usr/bin/env node
/**
 * Loop-closure benchmark harness (issue #66).
 *
 * The product metric: a set of deliberately-broken tiny apps; this harness
 * runs a coding agent against each failure with ONLY Verfix's JSON output as
 * the signal, and records whether the loop closes without human help (and in
 * how many verify iterations). Loop-closure rate = closed cases / total.
 *
 * Zero dependencies, plain Node — see benchmark/README.md for the case
 * format and adapter contract.
 *
 * Usage:
 *   node benchmark/run.js --agent <null|oracle|CMD> [--case <id>] [--out results.json] [--keep]
 *   node benchmark/run.js --report   # no browser runs — trend table from benchmark/results/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI_DIR = path.join(REPO_ROOT, 'cli');
const CASES_DIR = path.join(__dirname, 'cases');
const RESULTS_DIR = path.join(__dirname, 'results');

// ponytail: ts-node isn't hoisted to the repo root by npm workspaces, so
// resolve it the same way cli/test/local-run.test.ts does — relative to the
// cli package, which is where it's actually installed.
const TS_NODE_BIN = require.resolve('ts-node/dist/bin', { paths: [CLI_DIR] });

function parseArgs(argv) {
  const args = { agent: null, case: null, out: null, keep: false, report: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent') args.agent = argv[++i];
    else if (a === '--case') args.case = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--keep') args.keep = true;
    else if (a === '--report') args.report = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.report && !args.agent) throw new Error('--agent <null|oracle|CMD> is required');
  return args;
}

function verfixVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(CLI_DIR, 'package.json'), 'utf-8'));
  return pkg.version;
}

/** --report: no browser runs — reads every results file and prints a markdown trend table. */
function printReport() {
  if (!fs.existsSync(RESULTS_DIR)) {
    process.stdout.write('No results found in benchmark/results/.\n');
    return;
  }
  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  const measurements = files.map(f => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8')));
  measurements.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (measurements.length === 0) {
    process.stdout.write('No results found in benchmark/results/.\n');
    return;
  }

  const caseIds = measurements[0].cases.map(c => c.id);

  const header = ['version', 'date', 'agent', 'closure_rate', 'mean_iterations', ...caseIds];
  const rows = measurements.map(m => {
    const closureRate = `${((m.closure_rate || 0) * 100).toFixed(0)}%`;
    const meanIterations = (m.mean_iterations || 0).toFixed(1);
    const glyphs = caseIds.map(id => {
      const c = m.cases.find(x => x.id === id);
      return c ? (c.closed ? '✅' : '❌') : '—';
    });
    const date = (m.date || '?').slice(0, 10);
    return [m.verfix_version || '?', date, m.agent || '?', closureRate, meanIterations, ...glyphs];
  });

  const lines = [];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);

  process.stdout.write(lines.join('\n') + '\n');
}

function listCaseIds() {
  return fs.readdirSync(CASES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

function copyDirExcept(src, dest, exclude) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirExcept(s, d, []);
    else fs.copyFileSync(s, d);
  }
}

function copyDirInto(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDirInto(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ port, host: '127.0.0.1' }, () => {
        sock.end();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`app on port ${port} did not accept connections in time`));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

function startApp(appServerPath, port) {
  const child = spawn(process.execPath, [appServerPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

function runCli(workspaceDir, port) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.VERFIX_RUNNER; // local is the default runner
    const child = spawn(
      process.execPath,
      [
        TS_NODE_BIN, '--project', path.join(CLI_DIR, 'tsconfig.json'), path.join(CLI_DIR, 'src', 'index.ts'),
        'run', '--base-url', `http://127.0.0.1:${port}`, '--output', 'json',
      ],
      { cwd: workspaceDir, env },
    );
    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('verfix run timed out after 120s')); }, 120000);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(killTimer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`verfix run did not produce JSON stdout:\n${stdout}\n--- stderr ---\n${stderr}`));
      }
    });
  });
}

function runAdapter(agent, workspaceDir, caseId, iteration, lastResultJson) {
  if (agent === 'null') return Promise.resolve();
  if (agent === 'oracle') {
    const fixedDir = path.join(CASES_DIR, caseId, 'fixed');
    if (fs.existsSync(fixedDir)) copyDirInto(fixedDir, workspaceDir);
    return Promise.resolve();
  }
  // Anything else: a shell-less spawned command, workspace as cwd, last JSON on stdin.
  return new Promise((resolve, reject) => {
    const child = spawn(agent, {
      cwd: workspaceDir,
      shell: true,
      env: {
        ...process.env,
        VERFIX_BENCH_CASE: caseId,
        VERFIX_BENCH_ITERATION: String(iteration),
      },
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.stdin.end(JSON.stringify(lastResultJson));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error(`adapter command exited with code ${code}`));
      else resolve();
    });
  });
}

/** Anti-cheat checks evaluated after the loop closes. See README.md. */
function checkInvariants(workspaceDir, caseDir, invariants) {
  for (const inv of invariants || []) {
    const filePath = path.join(workspaceDir, inv.file);
    const originalPath = path.join(caseDir, inv.file);
    if (inv.must_not_change) {
      const original = fs.existsSync(originalPath) ? fs.readFileSync(originalPath) : null;
      const current = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
      if (!original || !current || !original.equals(current)) return false;
      continue;
    }
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    if (inv.must_contain && !new RegExp(inv.must_contain).test(content)) return false;
    if (inv.must_not_contain && new RegExp(inv.must_not_contain).test(content)) return false;
  }
  return true;
}

async function runCase(caseId, agent, keep) {
  const caseDir = path.join(CASES_DIR, caseId);
  const caseConfig = JSON.parse(fs.readFileSync(path.join(caseDir, 'case.json'), 'utf-8'));

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), `verfix-bench-${caseId}-`));
  copyDirExcept(caseDir, workspaceDir, ['fixed', 'case.json']);

  const port = await getFreePort();
  const appServerPath = path.join(workspaceDir, 'app', 'server.js');
  let appProcess = startApp(appServerPath, port);

  const record = {
    id: caseId,
    closed: false,
    iterations: 0,
    first_failure_type_ok: null,
    expected_finding_ok: null,
    invariants_ok: null,
  };

  try {
    await waitForPort(port, 10000);

    let lastResult = null;
    for (let iteration = 1; iteration <= caseConfig.max_iterations; iteration++) {
      lastResult = await runCli(workspaceDir, port);
      record.iterations = iteration;

      if (iteration === 1) {
        const firstFailure = lastResult.failures?.[0];
        record.first_failure_type_ok = firstFailure?.type === caseConfig.expected_failure_type;
        if (caseConfig.expected_finding) {
          const codes = (lastResult.failures || []).flatMap(f => (f.findings || []).map(f2 => f2.code));
          record.expected_finding_ok = codes.includes(caseConfig.expected_finding);
        } else {
          record.expected_finding_ok = null;
        }
      }

      if (lastResult.passed) {
        record.invariants_ok = checkInvariants(workspaceDir, caseDir, caseConfig.invariants);
        record.closed = record.invariants_ok;
        break;
      }

      if (agent === 'null') break; // no point re-running an unchanged workspace
      await runAdapter(agent, workspaceDir, caseId, iteration, lastResult);

      // A source-scope fix edits app/server.js on disk, but the running app
      // process is a separate Node process that already loaded the old code
      // into memory — it never picks up the edit without a restart. Restart
      // unconditionally (cheap, and config-scope fixes don't touch app/ so
      // this is a no-op for them behaviorally) so any adapter that patches
      // the app is actually exercised on the next iteration.
      appProcess.kill('SIGKILL');
      appProcess = startApp(appServerPath, port);
      await waitForPort(port, 10000);
    }
  } finally {
    appProcess.kill('SIGKILL');
    if (keep && !record.closed) {
      console.error(`  ↳ workspace kept at: ${workspaceDir}`);
    } else {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  }

  return record;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.report) {
    printReport();
    process.exit(0);
    return;
  }

  const caseIds = args.case ? [args.case] : listCaseIds();

  const results = [];
  for (const caseId of caseIds) {
    process.stderr.write(`Running case: ${caseId}...\n`);
    const record = await runCase(caseId, args.agent, args.keep);
    results.push(record);
  }

  const closedCount = results.filter(r => r.closed).length;
  const closureRate = results.length > 0 ? closedCount / results.length : 0;
  const meanIterations = results.length > 0
    ? results.reduce((sum, r) => sum + r.iterations, 0) / results.length
    : 0;

  const output = {
    agent: args.agent,
    cases: results,
    closure_rate: closureRate,
    mean_iterations: meanIterations,
    verfix_version: verfixVersion(),
    date: new Date().toISOString(),
  };

  // Human-readable table to stderr.
  process.stderr.write('\n');
  process.stderr.write(`${'case'.padEnd(20)} ${'closed'.padEnd(8)} ${'iters'.padEnd(6)} ${'type_ok'.padEnd(8)} ${'finding_ok'.padEnd(11)} invariants_ok\n`);
  for (const r of results) {
    process.stderr.write(
      `${r.id.padEnd(20)} ${String(r.closed).padEnd(8)} ${String(r.iterations).padEnd(6)} ${String(r.first_failure_type_ok).padEnd(8)} ${String(r.expected_finding_ok).padEnd(11)} ${String(r.invariants_ok)}\n`,
    );
  }
  process.stderr.write(`\nclosure_rate=${(closureRate * 100).toFixed(0)}% mean_iterations=${meanIterations.toFixed(1)}\n\n`);

  const outputJson = JSON.stringify(output, null, 2);
  if (args.out) fs.writeFileSync(args.out, outputJson + '\n');
  else process.stdout.write(outputJson + '\n');

  // Self-test semantics (see README.md): --agent null must exit nonzero if
  // any case closed (cases don't actually fail = benchmark rot); --agent
  // oracle must exit nonzero if any case did NOT close (intended fix is
  // broken). Any other agent always exits 0 for a completed run.
  if (args.agent === 'null' && closedCount > 0) process.exit(1);
  if (args.agent === 'oracle' && closedCount < results.length) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(2);
});
