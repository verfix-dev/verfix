#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import Ajv from 'ajv';
import fs from 'fs';
import path from 'path';
import {
  API_PORT, DASHBOARD_PORT, API_BASE, DASHBOARD_BASE,
  DOCKER_IMAGE, CONTAINER_NAME, DEFAULT_CONFIG, HEALTH_ENDPOINT,
} from './constants';
import {
  isDockerInstalled, isDockerRunning, getContainerState,
  startContainer, stopContainer, pullImage, pullImageIfMissing,
  tailLogs, formatUptime, isHostNetworkMode,
} from './docker';
import { waitForHealth, isApiHealthy, isDashboardReachable } from './health';

// ─── Load Environment Variables ────────────────────────────────────────────────
const envPath = path.join(process.cwd(), '.verfix', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (key && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

const program = new Command();

program
  .name('verfix')
  .description('AI Verification Runtime CLI — reliable browser verification for AI-generated software')
  .version('0.1.0');

// ─── start command ───────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the Verfix runtime container')
  .action(async () => {
    if (!isDockerInstalled()) {
      console.error(chalk.red('✗ Docker is not installed. Install Docker from https://docker.com'));
      process.exit(1);
    }
    if (!isDockerRunning()) {
      console.error(chalk.red('✗ Docker daemon is not running. Start Docker Desktop first.'));
      process.exit(1);
    }

    const spinner = ora('Starting Verfix runtime...').start();

    try {
      pullImageIfMissing();
      const result = startContainer();

      if (result === 'already_running') {
        spinner.succeed('Verfix runtime is already running');
        console.log(`    API:       ${chalk.cyan(`http://localhost:${API_PORT}`)}`);
        console.log(`    Dashboard: ${chalk.cyan(`http://localhost:${DASHBOARD_PORT}`)}`);
        return;
      }

      spinner.text = 'Waiting for health check...';
      const healthy = await waitForHealth();
      if (!healthy) {
        spinner.fail('Runtime started but health check failed after 30s');
        process.exit(1);
      }

      spinner.succeed('Verfix runtime is running');
      console.log(`    API:       ${chalk.cyan(`http://localhost:${API_PORT}`)}`);
      console.log(`    Dashboard: ${chalk.cyan(`http://localhost:${DASHBOARD_PORT}`)}`);
    } catch (e: any) {
      spinner.fail(e.message);
      process.exit(1);
    }
  });

// ─── stop command ────────────────────────────────────────────────────────────

program
  .command('stop')
  .description('Stop the Verfix runtime container')
  .action(() => {
    try {
      const stopped = stopContainer();
      if (stopped) {
        console.log(chalk.green('✓ Runtime stopped'));
      } else {
        console.log(chalk.gray('Runtime is not running'));
      }
    } catch (e: any) {
      console.log(chalk.gray('Runtime is not running'));
    }
  });

// ─── status command (runtime) ────────────────────────────────────────────────

program
  .command('status')
  .description('Check runtime, API, and dashboard status')
  .argument('[executionId]', 'Optional execution ID to check')
  .option('-o, --output <format>', 'Output format: pretty | json', 'pretty')
  .action(async (executionId, opts) => {
    // If executionId is provided, use the legacy execution status check
    if (executionId) {
      try {
        const res = await axios.get(`${API_BASE}/api/v1/executions/${executionId}`);
        if (opts.output === 'json') {
          console.log(JSON.stringify(res.data, null, 2));
        } else {
          const d = res.data;
          console.log('');
          console.log(`  ${chalk.bold('Execution:')} ${d.executionId}`);
          console.log(`  ${chalk.bold('Status:')}    ${d.status === 'completed' ? (d.passed ? chalk.green(d.status) : chalk.red(d.status)) : chalk.yellow(d.status)}`);
          if (d.duration_ms) console.log(`  ${chalk.bold('Duration:')} ${d.duration_ms}ms`);
          console.log('');
        }
      } catch (e: any) {
        console.error(chalk.red('Error: ' + e.message));
        process.exit(1);
      }
      return;
    }

    // Runtime status
    const state = getContainerState();
    const runtimeStatus = state ? state.status : 'not found';
    const apiHealthy = await isApiHealthy();
    const dashReachable = await isDashboardReachable();

    console.log('');
    console.log(`  ${chalk.bold('Runtime:')}    ${runtimeStatus === 'running' ? chalk.green(runtimeStatus) : chalk.red(runtimeStatus)}`);
    console.log(`  ${chalk.bold('API:')}        ${apiHealthy ? chalk.green('healthy') : chalk.red('unreachable')}   (http://localhost:${API_PORT})`);
    console.log(`  ${chalk.bold('Dashboard:')}  ${dashReachable ? chalk.green('healthy') : chalk.red('unreachable')}   (http://localhost:${DASHBOARD_PORT})`);
    if (state?.image) {
      console.log(`  ${chalk.bold('Image:')}      ${state.image}`);
    }
    if (state?.startedAt && runtimeStatus === 'running') {
      console.log(`  ${chalk.bold('Uptime:')}     ${formatUptime(state.startedAt)}`);
    }
    console.log('');
  });

// ─── logs command ────────────────────────────────────────────────────────────

program
  .command('logs')
  .description('Tail Verfix runtime container logs')
  .option('--tail <n>', 'Number of lines to show', '50')
  .action((opts) => {
    if (!getContainerState()) {
      console.error(chalk.red(`Container '${CONTAINER_NAME}' is not running. Start it with 'verfix start'.`));
      process.exit(1);
    }
    try {
      tailLogs(parseInt(opts.tail) || 50);
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

// ─── update command ──────────────────────────────────────────────────────────

program
  .command('update')
  .description('Pull latest image and restart the runtime')
  .action(async () => {
    if (!isDockerInstalled()) {
      console.error(chalk.red('✗ Docker is not installed.'));
      process.exit(1);
    }
    if (!isDockerRunning()) {
      console.error(chalk.red('✗ Docker daemon is not running.'));
      process.exit(1);
    }

    const pullSpinner = ora('Pulling latest image...').start();
    try {
      pullImage();
      pullSpinner.succeed('Image updated');
    } catch (e: any) {
      pullSpinner.fail(e.message);
      process.exit(1);
    }

    // Stop existing container if running
    stopContainer();

    const startSpinner = ora('Starting runtime...').start();
    try {
      startContainer();
      startSpinner.text = 'Waiting for health check...';
      const healthy = await waitForHealth();
      if (!healthy) {
        startSpinner.fail('Health check failed after 30s');
        process.exit(1);
      }
      startSpinner.succeed('Verfix runtime is running (updated)');
      console.log(`    API:       ${chalk.cyan(`http://localhost:${API_PORT}`)}`);
      console.log(`    Dashboard: ${chalk.cyan(`http://localhost:${DASHBOARD_PORT}`)}`);
    } catch (e: any) {
      startSpinner.fail(e.message);
      process.exit(1);
    }
  });

// ─── doctor command ──────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Run diagnostic checks on the Verfix setup')
  .action(async () => {
    console.log('');
    console.log(chalk.bold('  Verfix Doctor'));
    console.log(chalk.gray('  ─────────────────────────────'));
    console.log('');

    let failures = 0;

    // 1. Docker installed
    if (isDockerInstalled()) {
      console.log(chalk.green('  ✓ Docker installed'));
    } else {
      console.log(chalk.red('  ✗ Docker not installed'));
      console.log(chalk.gray('    Install from https://docker.com'));
      failures++;
    }

    // 2. Docker daemon running
    if (isDockerRunning()) {
      console.log(chalk.green('  ✓ Docker daemon running'));
    } else {
      console.log(chalk.red('  ✗ Docker daemon not running'));
      console.log(chalk.gray('    Start Docker Desktop'));
      failures++;
    }

    // 3. Container running
    const state = getContainerState();
    if (state?.status === 'running') {
      console.log(chalk.green('  ✓ Container running'));
    } else {
      console.log(chalk.red('  ✗ Container not running'));
      console.log(chalk.gray('    Run: verfix start'));
      failures++;
    }

    // 4. API healthy
    if (await isApiHealthy()) {
      console.log(chalk.green('  ✓ API healthy'));
    } else {
      console.log(chalk.red('  ✗ API unreachable'));
      console.log(chalk.gray(`    Check: curl http://localhost:${API_PORT}${HEALTH_ENDPOINT}`));
      failures++;
    }

    // 5. Dashboard reachable
    if (await isDashboardReachable()) {
      console.log(chalk.green('  ✓ Dashboard reachable'));
    } else {
      console.log(chalk.red('  ✗ Dashboard unreachable'));
      console.log(chalk.gray(`    Check: curl http://localhost:${DASHBOARD_PORT}`));
      failures++;
    }

    // 6. verfix.config.json exists
    const configPath = path.resolve(process.cwd(), DEFAULT_CONFIG);
    if (fs.existsSync(configPath)) {
      console.log(chalk.green(`  ✓ ${DEFAULT_CONFIG} found`));
    } else {
      console.log(chalk.red(`  ✗ ${DEFAULT_CONFIG} not found`));
      console.log(chalk.gray('    Run: verfix init'));
      failures++;
    }

    // 7. AGENTS.md exists
    const agentsPath = path.resolve(process.cwd(), 'AGENTS.md');
    if (fs.existsSync(agentsPath)) {
      console.log(chalk.green('  ✓ AGENTS.md found'));
    } else {
      console.log(chalk.red('  ✗ AGENTS.md not found'));
      console.log(chalk.gray('    Run: verfix init'));
      failures++;
    }

    console.log('');
    if (failures === 0) {
      console.log(chalk.bold.green('  All checks passed!'));
    } else {
      console.log(chalk.bold.red(`  ${failures} check(s) failed`));
    }
    console.log('');
    process.exit(failures);
  });

// ─── init command (interactive wizard) ───────────────────────────────────────

program
  .command('init')
  .description('Interactive setup wizard — configure runtime, flows, and AGENTS.md')
  .option('-f, --force', 'Overwrite existing files without prompting')
  .action(async () => {
    // Dynamic import to keep the main entry lean
    const { runInitWizard } = await import('./init-wizard');
    await runInitWizard();
  });

// ─── flows command ───────────────────────────────────────────────────────────

program
  .command('flows')
  .description('List all flows defined in verfix.config.json')
  .option('-c, --config <file>', 'Path to config file')
  .option('-o, --output <format>', 'Output format: pretty | json', 'pretty')
  .action((opts) => {
    const configPath = opts.config
      ? path.resolve(opts.config)
      : path.resolve(process.cwd(), DEFAULT_CONFIG);

    if (!fs.existsSync(configPath)) {
      console.error(chalk.red(`Config file not found: ${configPath}`));
      console.error(chalk.gray('Run: verfix init'));
      process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const flows = config.flows || [];

    if (flows.length === 0) {
      console.log(chalk.gray('  No flows configured. Edit verfix.config.json to add flows.'));
      return;
    }

    if (opts.output === 'json') {
      const list = flows.map((f: any) => ({
        id: f.id || f.name,
        steps: (f.steps || []).length,
        assertions: (f.assertions || []).length,
      }));
      console.log(JSON.stringify({ flows: list, total: list.length }, null, 2));
      return;
    }

    console.log('');
    console.log(chalk.bold(`  Flows in ${DEFAULT_CONFIG} (${flows.length}):`));
    console.log('');
    for (const f of flows) {
      const id = f.id || f.name || '(unnamed)';
      const stepCount = (f.steps || []).length;
      const assertCount = (f.assertions || []).length;
      const stepDesc = (f.steps || []).map((s: any) => s.action).join(' → ');
      console.log(`  ${chalk.cyan('▸')} ${chalk.bold(id)}`);
      console.log(`    ${chalk.gray(`${stepCount} step(s), ${assertCount} assertion(s)`)}`);
      if (stepDesc) {
        console.log(`    ${chalk.gray(stepDesc)}`);
      }
      console.log(`    ${chalk.gray('Run:')} verfix run --flow ${id} --output json`);
      console.log('');
    }
  });

// ─── run command ─────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Run a verification job')
  .option('-u, --url <url>', 'Target URL to verify')
  .option('-t, --task <task>', 'Task description')
  .option('-c, --config <file>', 'Path to verfix.config.json config file')
  .option('-f, --flow <id>', 'Flow id or name to run')
  .option('-m, --mode <mode>', 'Verification mode: strict | assisted | smoke | exploratory')
  .option('-o, --output <format>', 'Output format: pretty | json', 'json')
  .option('--dashboard <url>', 'Dashboard base URL for timeline links')
  .option('--timeout <ms>', 'Timeout in milliseconds', '15000')
  .option('--retries <n>', 'Number of retries on failure', '2')
  .action(async (opts) => {
    // Load config file if provided or found in cwd
    let config: any = {};
    const configPath = opts.config
      ? path.resolve(opts.config)
      : path.resolve(process.cwd(), DEFAULT_CONFIG);
    let didLoadConfig = false;

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      didLoadConfig = true;
    } else if (opts.config) {
      console.error(chalk.red(`Config file not found: ${configPath}`));
      process.exit(1);
    }

    if (didLoadConfig) {
      validateConfigSchema(config, configPath);
    }

    const selectedFlow = selectFlow(config?.flows, opts.flow);

    const flows = selectedFlow ? normalizeFlows([selectedFlow]) : normalizeFlows(config?.flows || []);
    const assertions = selectedFlow?.assertions ? undefined : config.assertions;

    const baseUrl = opts.url || config.baseUrl || config.url;
    // Rewrite localhost → host.docker.internal so Playwright inside the
    // container can reach the user's app running on the host machine.
    const targetUrl = resolveJobUrl(baseUrl);

    const payload: any = {
      url: targetUrl,
      task: opts.task || config.task || (opts.flow ? `Verify flow ${opts.flow}` : `Verify ${targetUrl}`),
      mode: opts.mode || selectedFlow?.mode || config.mode || 'strict',
      assertions,
      flows: flows.length > 0 ? flows : undefined,
      selectors: config.selectors,
      metadata: config.metadata,
      timeout: parseInt(opts.timeout) || config.timeout || 15000,
      retries: parseInt(opts.retries) || config.retries || 2,
    };

    if (!payload.url) {
      console.error(chalk.red('Error: --url is required (or set baseUrl in config file)'));
      process.exit(1);
    }

    if (opts.output === 'pretty') {
      console.log('');
      console.log(chalk.bold.cyan('  ⚡ AI Verification Runtime'));
      console.log(chalk.gray('  ─────────────────────────────'));
      console.log(`  ${chalk.gray('Task:')}    ${payload.task}`);
      console.log(`  ${chalk.gray('URL:')}     ${payload.url}`);
      console.log(`  ${chalk.gray('Mode:')}    ${payload.mode}`);
      console.log(`  ${chalk.gray('Checks:')}  ${(payload.assertions || []).length} assertion(s)`);
      console.log('');
    }

    const submitSpinner = opts.output === 'pretty' ? ora('Submitting job...').start() : null;

    let executionId = '';
    try {
      const res = await axios.post(`${API_BASE}/api/v1/verify`, payload);
      executionId = res.data.executionId;
      submitSpinner?.succeed(`Job queued: ${chalk.bold(executionId)}`);
    } catch (e: any) {
      submitSpinner?.fail('Failed to submit job');
      console.error(chalk.red(e.message));
      process.exit(1);
    }

    // Poll for result
    const pollSpinner = opts.output === 'pretty' ? ora('Running verification...').start() : null;

    let result: any = null;
    const maxWait = 120000;
    const pollInterval = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await sleep(pollInterval);
      try {
        const res = await axios.get(`${API_BASE}/api/v1/executions/${executionId}`);
        const data = res.data;
        if (data.status === 'completed' || data.status === 'failed') {
          result = data;
          break;
        }
      } catch {
        // keep polling
      }
    }

    pollSpinner?.stop();

    if (!result) {
      console.error(chalk.yellow('⚠ Timed out waiting for result. Job may still be running.'));
      console.log(`  Run: verfix status ${executionId}`);
      process.exit(1);
    }

    const timelineUrl = buildTimelineUrl(opts.dashboard || DASHBOARD_BASE, executionId);

    if (opts.output === 'json') {
      const failures = buildFailures(result);

      const jsonResult = {
        passed: result.passed,
        failures,
        timeline_url: timelineUrl,
        exit_code: result.passed ? 0 : 1,
        execution_id: result.executionId,
        raw: result,
      };
      console.log(JSON.stringify(jsonResult, null, 2));
      process.exit(jsonResult.exit_code);
    }

    // Pretty output
    console.log('');
    console.log(result.passed
      ? chalk.bold.green('  ✅ VERIFICATION PASSED')
      : chalk.bold.red('  ❌ VERIFICATION FAILED'));
    console.log(`  ${chalk.gray('Duration:')} ${result.duration_ms}ms  |  ${chalk.gray('Retries:')} ${result.retry_count}`);
    console.log('');

    if (result.assertions && result.assertions.length > 0) {
      console.log(chalk.bold('  Assertions:'));
      for (const a of result.assertions) {
        const icon = a.passed ? chalk.green('✓') : chalk.red('✗');
        const label = chalk.gray(`(${a.duration_ms}ms)`);
        const detail = a.error ? chalk.red(` — ${a.error}`) : '';
        console.log(`    ${icon} ${a.type} ${label}${detail}`);
        if (!a.passed && a.details) {
          const details = JSON.stringify(a.details, null, 2).split('\n').map((l: string) => `       ${l}`).join('\n');
          console.log(chalk.gray(details));
        }
      }
    }

    if (result.artifacts) {
      console.log('');
      console.log(chalk.bold('  Artifacts:'));
      for (const [key, val] of Object.entries(result.artifacts)) {
        if (val) console.log(`    ${chalk.gray(key + ':')} ${val}`);
      }
    }

    console.log('');
    console.log(`${chalk.gray('Timeline:')} ${timelineUrl}`);

    const errors = (result.console_logs || []).filter((l: any) => l.type === 'error');
    if (errors.length > 0) {
      console.log('');
      console.log(chalk.bold.red(`  Console Errors (${errors.length}):`));
      for (const e of errors) {
        console.log(`    ${chalk.red('•')} ${e.text}`);
      }
    }

    console.log('');
    process.exit(result.passed ? 0 : 1);
  });

// ─── list command ─────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List recent verification executions')
  .action(async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/v1/executions`);
      const { executions } = res.data;
      if (!executions || executions.length === 0) {
        console.log(chalk.gray('  No executions found.'));
        return;
      }
      console.log('');
      console.log(chalk.bold('  Recent Executions:'));
      for (const e of executions) {
        const icon = e.status === 'completed' ? (e.passed ? chalk.green('✅') : chalk.red('❌')) : chalk.yellow('⏳');
        console.log(`    ${icon} ${chalk.gray(e.executionId.slice(0, 20))}...  ${chalk.bold(e.task)}  ${chalk.gray(e.url)}`);
      }
      console.log('');
    } catch (e: any) {
      console.error(chalk.red('Error: ' + e.message));
    }
  });

// ─── Helper functions ────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Rewrite localhost / 127.0.0.1 → host.docker.internal in job target URLs.
 *
 * On Linux, the CLI starts the container with --network=host, so the
 * container's localhost IS the host's localhost (IPv4 + IPv6). No rewrite.
 *
 * On Mac/Windows, Docker runs in a VM and --network=host doesn't reach the
 * real host. We rewrite to host.docker.internal which is injected by
 * Docker Desktop and by our --add-host flag.
 */
function resolveJobUrl(url: string): string {
  if (!url) return url;
  // Host network mode (Linux): localhost resolves correctly inside container.
  if (isHostNetworkMode()) return url;
  // Bridge mode (Mac/Windows): must point Playwright at host.docker.internal.
  const rewritten = url.replace(
    /\/\/(localhost|127\.0\.0\.1)(:\d+)?/g,
    '//host.docker.internal$2',
  );
  if (rewritten !== url) {
    console.log(chalk.gray(`  ℹ  Target URL: ${url} → ${rewritten} (host.docker.internal)`));
  }
  return rewritten;
}

function buildTimelineUrl(base: string, executionId: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/?executionId=${encodeURIComponent(executionId)}`;
}

function selectFlow(flows: any[] | undefined, idOrName?: string): any | undefined {
  if (!idOrName || !flows || flows.length === 0) return undefined;
  const found = flows.find(f => f.id === idOrName || f.name === idOrName);
  if (!found) {
    console.error(chalk.red(`Flow not found: ${idOrName}`));
    process.exit(1);
  }
  return found;
}

function normalizeFlows(flows: any[]): any[] {
  if (!flows || flows.length === 0) return [];
  return flows.map((flow, idx) => ({
    name: flow.name || flow.id || `flow_${idx + 1}`,
    steps: (flow.steps || []).map((step: any) => ({
      action: step.action,
      target: step.testId
        ? { testId: step.testId }
        : step.selector
          ? { selector: step.selector }
          : step.text
            ? { text: step.text }
            : undefined,
      value: step.value ?? step.url,
      url: step.url,
      timeout: step.timeout,
    })),
    assertions: flow.assertions,
  }));
}

function validateConfigSchema(config: any, configPath: string): void {
  const schemaPath = path.resolve(process.cwd(), 'verfix.config.schema.json');
  if (!fs.existsSync(schemaPath)) return;

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(config);
  if (!valid) {
    console.error(chalk.red(`Config schema validation failed: ${configPath}`));
    for (const err of validate.errors || []) {
      const loc = err.instancePath || '/';
      console.error(chalk.red(`  ${loc} ${err.message || 'is invalid'}`));
    }
    process.exit(1);
  }
}

function buildFailures(result: any): Array<{ type: string; selector?: string; detail?: string; fix_hint?: string }> {
  const failures = (result.assertions || [])
    .filter((a: any) => !a.passed)
    .map((a: any) => ({
      type: a.failure_type || 'assertion_failed',
      selector: a.details?.selector || a.details?.resolved_selector,
      detail: a.error,
      fix_hint: a.fix_hint,
    }));

  if (failures.length === 0 && result.error) {
    const type = inferFailureTypeFromError(result.error);
    failures.push({
      type,
      detail: result.error,
      fix_hint: renderFixHint(type),
    });
  }

  return failures;
}

function inferFailureTypeFromError(error: string): string {
  if (/timeout|timed out|waiting for/i.test(error)) return 'timeout';
  return 'assertion_failed';
}

function renderFixHint(type: string): string {
  switch (type) {
    case 'timeout':
      return 'Operation timed out. Increase timeout or wait for network/DOM to settle before retrying.';
    default:
      return 'Assertion failed. Verify assertion inputs and app state before retrying.';
  }
}

program.parse(process.argv);
