#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import Ajv from 'ajv';
import fs from 'fs';
import path from 'path';
import {
  CONTAINER_NAME, DEFAULT_CONFIG, HEALTH_ENDPOINT, VERFIX_HOME, getRunnerMode,
} from './constants';
import {
  isDockerInstalled, isDockerRunning, getContainerState,
  startContainer, stopContainer, pullImage, pullImageIfMissing,
  tailLogs, formatUptime, isHostNetworkMode, syncRuntimePortsFromContainer,
} from './docker';
import { waitForHealth, isApiHealthy, isDashboardReachable, resolveApiBase } from './health';
import { buildDashboardBase, getRuntimePorts } from './runtime';
import { emitJson, emitJsonError, isJsonMode } from './json-output';
import { showPendingNotifications, scheduleBackgroundCheck, clearImageCache } from './update-check';
import { trackEvent, flushTelemetry } from './telemetry';
import {
  evaluateSourceChanges, buildSourceFinding, clearSourceBaseline,
  type SourceCodePolicy, type SourceChanges,
} from './source-guard';
import { interpolateEnv, interpolateStep, interpolateAssertions, MissingEnvVarError } from './config/interpolate';


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

// Load version dynamically from package.json
let version = '0.1.0';
try {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg && pkg.version) {
      version = pkg.version;
    }
  }
} catch (e) {
  // Fallback to default
}

program
  .name('verfix')
  .description('AI Verification Runtime CLI — reliable browser verification for AI-generated software')
  .version(version);

function refreshRuntimePortsFromContainerIfRunning(): void {
  const state = getContainerState();
  if (state?.status === 'running') {
    syncRuntimePortsFromContainer();
  }
}

/** The --server flag routes a command at the Docker runtime for this invocation. */
function applyRunnerFlag(opts: { server?: boolean }): void {
  if (opts.server) process.env.VERFIX_RUNNER = 'server';
}

/**
 * One-time notice for users upgrading from the Docker-based CLI: their old
 * runtime container keeps running until they reclaim it. Printed to stderr so
 * --output json stays pure; a flag file makes it fire once per machine.
 */
function maybeShowDockerMigrationNotice(): void {
  const flagFile = path.join(VERFIX_HOME, 'local-mode-notice-shown');
  try {
    if (fs.existsSync(flagFile)) return;
    if (isDockerInstalled() && getContainerState()) {
      console.error(chalk.yellow(
        `ℹ Verfix now runs verifications locally by default — no Docker needed. Your old '${CONTAINER_NAME}' container is still around: reclaim it with \`verfix stop --server\`, or keep the server runtime by setting VERFIX_RUNNER=server in .verfix/.env.`,
      ));
    }
    fs.mkdirSync(VERFIX_HOME, { recursive: true });
    fs.writeFileSync(flagFile, new Date().toISOString() + '\n', 'utf-8');
  } catch {
    // best-effort notice
  }
}

// ─── start command ───────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the Verfix server runtime container (local mode needs no runtime)')
  .option('--server', 'Target the Docker server runtime', false)
  .action(async (opts) => {
    applyRunnerFlag(opts);
    if (getRunnerMode() === 'local') {
      console.log('Local mode needs no runtime — just run: verfix run --flow <id> --output json');
      console.log(chalk.gray('Use --server to start the Docker server runtime instead.'));
      return;
    }
    trackEvent('cli_start', { status: 'attempted' });
    if (!isDockerInstalled()) {
      console.error(chalk.red('✗ Docker is not installed. Install Docker from https://docker.com'));
      await flushTelemetry();
      process.exit(2);
    }
    if (!isDockerRunning()) {
      console.error(chalk.red('✗ Docker daemon is not running. Start Docker Desktop first.'));
      await flushTelemetry();
      process.exit(2);
    }

    const spinner = ora('Starting Verfix runtime...').start();

    try {
      pullImageIfMissing();
      const result = await startContainer();

      if (result === 'already_running') {
        syncRuntimePortsFromContainer();
        const runningPorts = getRuntimePorts();
        spinner.succeed('Verfix runtime is already running');

        console.log(`    API:       ${chalk.cyan(`http://localhost:${runningPorts.apiPort}`)}`);
        console.log(`    Dashboard: ${chalk.cyan(`http://localhost:${runningPorts.dashboardPort}`)}`);
        showPendingNotifications();
        scheduleBackgroundCheck(['npm', 'image']);
        trackEvent('cli_start', { status: 'already_running' });
        await flushTelemetry();
        return;
      }

      spinner.text = 'Waiting for health check...';
      const healthy = await waitForHealth();
      if (!healthy) {
        spinner.fail('Runtime started but health check failed after 30s');
        trackEvent('cli_start', { status: 'health_check_failed' });
        await flushTelemetry();
        process.exit(2);
      }

      spinner.succeed('Verfix runtime is running');
      const startedPorts = getRuntimePorts();

      console.log(`    API:       ${chalk.cyan(`http://localhost:${startedPorts.apiPort}`)}`);
      console.log(`    Dashboard: ${chalk.cyan(`http://localhost:${startedPorts.dashboardPort}`)}`);
      showPendingNotifications();
      scheduleBackgroundCheck(['npm', 'image']);
      trackEvent('cli_start', { status: 'started' });
    } catch (e: any) {
      spinner.fail(e.message);
      trackEvent('cli_start', { status: 'error', error: e.message });
      await flushTelemetry();
      process.exit(2);
    }
    await flushTelemetry();
  });

// ─── stop command ────────────────────────────────────────────────────────────

program
  .command('stop')
  .description('Stop the Verfix server runtime container (local mode needs no runtime)')
  .option('--server', 'Target the Docker server runtime', false)
  .action((opts) => {
    applyRunnerFlag(opts);
    if (getRunnerMode() === 'local') {
      console.log('Local mode has no runtime to stop.');
      console.log(chalk.gray('Use --server to stop the Docker server runtime container.'));
      return;
    }
    let stoppedContainer = false;
    try {
      stoppedContainer = stopContainer();
    } catch (e: any) {
      // ignore
    }

    if (stoppedContainer) {
      console.log(chalk.green('✓ Runtime container stopped'));
    } else {
      console.log(chalk.gray('Runtime is not running'));
    }
  });

// ─── status command (runtime) ────────────────────────────────────────────────

program
  .command('status')
  .description('Check Verfix setup status (or the server runtime with --server)')
  .argument('[executionId]', 'Optional execution ID to check')
  .option('-o, --output <format>', 'Output format: pretty | json', 'pretty')
  .option('--server', 'Check the Docker server runtime', false)
  .action(async (executionId, opts) => {
    applyRunnerFlag(opts);
    if (getRunnerMode() === 'local') {
      // Local mode: never touch Docker or the API — read .verfix/runs/ instead.
      const { readLocalResult, listLocalResults, isChromiumInstalled, isEngineInstalled } = await import('./local-runner');

      if (executionId) {
        const result = readLocalResult(executionId);
        if (!result) {
          if (isJsonMode(opts)) {
            emitJsonError({ error: 'status_lookup_failed', message: `No local run found for ${executionId}`, hint: 'Local results live in .verfix/runs/. List them with: verfix list' });
          }
          console.error(chalk.red(`No local run found for ${executionId} under .verfix/runs/`));
          process.exit(2);
        }
        if (isJsonMode(opts)) {
          emitJson(result);
        } else {
          console.log('');
          console.log(`  ${chalk.bold('Execution:')} ${result!.executionId}`);
          console.log(`  ${chalk.bold('Status:')}    ${result!.passed ? chalk.green(result!.status) : chalk.red(result!.status)}`);
          if (result!.duration_ms) console.log(`  ${chalk.bold('Duration:')}  ${result!.duration_ms}ms`);
          console.log(`  ${chalk.bold('Trace:')}     verfix show ${result!.executionId}`);
          console.log('');
        }
        return;
      }

      const configFound = fs.existsSync(path.resolve(process.cwd(), DEFAULT_CONFIG));
      const engineInstalled = isEngineInstalled();
      const chromiumInstalled = engineInstalled && isChromiumInstalled();
      const lastRun = listLocalResults()[0] ?? null;

      if (isJsonMode(opts)) {
        emitJson({
          runner: 'local',
          config_found: configFound,
          engine_installed: engineInstalled,
          chromium_installed: chromiumInstalled,
          last_run: lastRun ? {
            execution_id: lastRun.executionId,
            passed: lastRun.passed,
            completed_at: lastRun.completed_at,
          } : null,
        });
        return;
      }

      console.log('');
      console.log(`  ${chalk.bold('Runner:')}    local (no Docker needed — use --server for the container runtime)`);
      console.log(`  ${chalk.bold('Config:')}    ${configFound ? chalk.green(DEFAULT_CONFIG) : chalk.red('not found — run: verfix init')}`);
      if (!engineInstalled) {
        console.log(`  ${chalk.bold('Engine:')}    ${chalk.red('not installed — reinstall: npm install verfix')}`);
        console.log(`  ${chalk.bold('Chromium:')}  ${chalk.gray('n/a — engine missing')}`);
      } else {
        console.log(`  ${chalk.bold('Chromium:')}  ${chromiumInstalled ? chalk.green('installed') : chalk.yellow('not installed (run: verfix install)')}`);
      }
      if (lastRun) {
        const icon = lastRun.passed ? chalk.green('passed') : chalk.red('failed');
        console.log(`  ${chalk.bold('Last run:')}  ${icon}  ${chalk.gray(lastRun.executionId)}  (verfix show ${lastRun.executionId})`);
      } else {
        console.log(`  ${chalk.bold('Last run:')}  ${chalk.gray('none yet')}`);
      }
      console.log('');
      showPendingNotifications();
      scheduleBackgroundCheck(['npm', 'image']);
      return;
    }

    refreshRuntimePortsFromContainerIfRunning();
    const apiBase = await resolveApiBase();
    const runtimePorts = getRuntimePorts();
    // If executionId is provided, use the legacy execution status check
    if (executionId) {
      try {
        const res = await axios.get(`${apiBase}/api/v1/executions/${executionId}`);
        if (isJsonMode(opts)) {
          emitJson(res.data);
        } else {
          const d = res.data;
          console.log('');
          console.log(`  ${chalk.bold('Execution:')} ${d.executionId}`);
          console.log(`  ${chalk.bold('Status:')}    ${d.status === 'completed' ? (d.passed ? chalk.green(d.status) : chalk.red(d.status)) : chalk.yellow(d.status)}`);
          if (d.duration_ms) console.log(`  ${chalk.bold('Duration:')} ${d.duration_ms}ms`);
          console.log('');
        }
      } catch (e: any) {
        if (isJsonMode(opts)) {
          emitJsonError({ error: 'status_lookup_failed', message: e.message, hint: 'Check that the execution ID is valid and the runtime is running.' });
        }
        console.error(chalk.red('Error: ' + e.message));
        process.exit(2);
      }
      return;
    }

    // Runtime status
    const state = getContainerState();
    const runtimeStatus = state ? state.status : 'not found';
    const apiHealthy = await isApiHealthy();
    const dashReachable = await isDashboardReachable();

    if (isJsonMode(opts)) {
      emitJson({
        runtime: runtimeStatus,
        api: apiHealthy ? 'healthy' : 'unreachable',
        api_url: `http://localhost:${runtimePorts.apiPort}`,
        dashboard: dashReachable ? 'healthy' : 'unreachable',
        dashboard_url: `http://localhost:${runtimePorts.dashboardPort}`,
        image: state?.image || null,
        uptime: state?.startedAt && runtimeStatus === 'running' ? formatUptime(state.startedAt) : null,
      });
      return;
    }

    console.log('');
    console.log(`  ${chalk.bold('Runtime:')}    ${runtimeStatus === 'running' ? chalk.green(runtimeStatus) : chalk.red(runtimeStatus)}`);
    console.log(`  ${chalk.bold('API:')}        ${apiHealthy ? chalk.green('healthy') : chalk.red('unreachable')}   (http://localhost:${runtimePorts.apiPort})`);
    console.log(`  ${chalk.bold('Dashboard:')}  ${dashReachable ? chalk.green('healthy') : chalk.red('unreachable')}   (http://localhost:${runtimePorts.dashboardPort})`);

    if (state?.image) {
      console.log(`  ${chalk.bold('Image:')}      ${state.image}`);
    }
    if (state?.startedAt && runtimeStatus === 'running') {
      console.log(`  ${chalk.bold('Uptime:')}     ${formatUptime(state.startedAt)}`);
    }
    console.log('');
    showPendingNotifications();
    scheduleBackgroundCheck(['npm', 'image']);
  });

// ─── logs command ────────────────────────────────────────────────────────────

program
  .command('logs')
  .description('Tail Verfix server runtime logs (local runs live in .verfix/runs/)')
  .option('--tail <n>', 'Number of lines to show', '50')
  .option('--server', 'Target the Docker server runtime', false)
  .action((opts) => {
    applyRunnerFlag(opts);
    if (getRunnerMode() === 'local') {
      console.log('Local mode has no runtime logs. Each run is persisted under .verfix/runs/:');
      console.log(`  ${chalk.cyan('verfix list')}                  ${chalk.gray('recent runs')}`);
      console.log(`  ${chalk.cyan('verfix show <execution_id>')}   ${chalk.gray('open the Playwright trace')}`);
      console.log(chalk.gray('Use --server to tail the Docker runtime container logs.'));
      return;
    }
    if (!getContainerState()) {
      console.error(chalk.red(`Container '${CONTAINER_NAME}' is not running. Start it with 'verfix start'.`));
      process.exit(2);
    }
    try {
      tailLogs(parseInt(opts.tail) || 50);
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(2);
    }
  });

// ─── update command ──────────────────────────────────────────────────────────

program
  .command('update')
  .description('Update Verfix (npm in local mode; image pull + restart with --server)')
  .option('--server', 'Update the Docker server runtime image', false)
  .action(async (opts) => {
    applyRunnerFlag(opts);
    if (getRunnerMode() === 'local') {
      console.log('Local mode updates through npm:');
      console.log(`  ${chalk.cyan('npm install -g verfix@latest')}   ${chalk.gray('(or npx verfix@latest for always-current)')}`);
      console.log(chalk.gray('Use --server to pull the latest Docker runtime image.'));
      return;
    }
    if (!isDockerInstalled()) {
      console.error(chalk.red('✗ Docker is not installed.'));
      process.exit(2);
    }
    if (!isDockerRunning()) {
      console.error(chalk.red('✗ Docker daemon is not running.'));
      process.exit(2);
    }

    const pullSpinner = ora('Pulling latest image...').start();
    try {
      pullImage();
      pullSpinner.succeed('Image updated');
    } catch (e: any) {
      pullSpinner.fail(e.message);
      process.exit(2);
    }

    // Stop existing container if running
    stopContainer();

    const startSpinner = ora('Starting runtime...').start();
    try {
      await startContainer();
      startSpinner.text = 'Waiting for health check...';
      const healthy = await waitForHealth();
      if (!healthy) {
        startSpinner.fail('Health check failed after 30s');
        process.exit(2);
      }
      startSpinner.succeed('Verfix runtime is running (updated)');
      const startedPorts = getRuntimePorts();

      console.log(`    API:       ${chalk.cyan(`http://localhost:${startedPorts.apiPort}`)}`);
      console.log(`    Dashboard: ${chalk.cyan(`http://localhost:${startedPorts.dashboardPort}`)}`);
      // Clear stale image cache — user just updated, so no banner needed next run
      clearImageCache();
    } catch (e: any) {
      startSpinner.fail(e.message);
      process.exit(2);
    }
  });

// ─── doctor command ──────────────────────────────────────────────────────────

/**
 * Local-mode diagnostics: everything `verfix run` needs on this machine, and
 * nothing it doesn't. Docker is surfaced as informational only — a machine
 * without Docker is a fully healthy local setup.
 */
async function runLocalDoctor(opts: any): Promise<never> {
  if (!isJsonMode(opts)) {
    console.log('');
    console.log(chalk.bold('  Verfix Doctor (local mode)'));
    console.log(chalk.gray('  ─────────────────────────────'));
    console.log('');
  }

  let failures = 0;
  let warnings = 0;

  function printCheck(icon: string, label: string, hint?: string): void {
    if (isJsonMode(opts)) return;
    console.log(`  ${icon} ${label}`);
    if (hint) console.log(chalk.gray(`    ${hint}`));
  }

  // 1. Node version
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  const nodeOk = nodeMajor >= 20;
  if (nodeOk) {
    printCheck(chalk.green('✓'), `Node ${process.versions.node}`);
  } else {
    printCheck(chalk.red('✗'), `Node ${process.versions.node} — Verfix needs Node 20+`, 'Upgrade at https://nodejs.org');
    failures++;
  }

  // 2. Config exists and validates
  const configPath = path.resolve(process.cwd(), DEFAULT_CONFIG);
  const configFound = fs.existsSync(configPath);
  let configValid = false;
  let config: any = {};
  if (configFound) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      validateConfigSchema(config, configPath);
      configValid = true;
      printCheck(chalk.green('✓'), `${DEFAULT_CONFIG} valid`);
    } catch (e: any) {
      printCheck(chalk.red('✗'), `${DEFAULT_CONFIG} invalid`, e.message.split('\n')[0]);
      failures++;
    }
  } else {
    printCheck(chalk.red('✗'), `${DEFAULT_CONFIG} not found`, 'Run: verfix init (or verfix init --yes for non-interactive)');
    failures++;
  }

  // 3. AGENTS.md exists
  const agentsMdFound = fs.existsSync(path.resolve(process.cwd(), 'AGENTS.md'));
  if (agentsMdFound) {
    printCheck(chalk.green('✓'), 'AGENTS.md found');
  } else {
    printCheck(chalk.red('✗'), 'AGENTS.md not found', 'Run: verfix init (or verfix init --yes for non-interactive)');
    failures++;
  }

  // 4. Engine module resolvable — the hard prerequisite for every local command.
  //    A miss means the npm install is broken (e.g. a stale file: dependency),
  //    which is fatal and must NOT be disguised as "Chromium not installed".
  const { isChromiumInstalled, isEngineInstalled } = await import('./local-runner');
  const engineInstalled = isEngineInstalled();
  if (engineInstalled) {
    printCheck(chalk.green('✓'), '@verfix/engine installed');
  } else {
    printCheck(chalk.red('✗'), '@verfix/engine not installed', 'Reinstall the CLI: npm install verfix');
    failures++;
  }

  // 5. Chromium present (a miss is only a warning — verfix install / run fetches it)
  const chromiumInstalled = engineInstalled && isChromiumInstalled(config.browser);
  if (!engineInstalled) {
    printCheck(chalk.gray('•'), chalk.gray('Chromium — skipped (engine missing)'));
  } else if (chromiumInstalled) {
    printCheck(chalk.green('✓'), 'Chromium installed');
  } else {
    printCheck(chalk.yellow('⚠'), 'Chromium not installed', 'Run: verfix install  (or it auto-downloads on first verfix run)');
    warnings++;
  }

  // 5. App base URL reachable (only a warning — the app may just not be running)
  let baseUrlReachable: boolean | null = null;
  const baseUrl = config.baseUrl || config.url;
  if (baseUrl) {
    try {
      await axios.get(baseUrl, { timeout: 2000, validateStatus: () => true });
      baseUrlReachable = true;
      printCheck(chalk.green('✓'), `App reachable at ${baseUrl}`);
    } catch {
      baseUrlReachable = false;
      printCheck(chalk.yellow('⚠'), `App not reachable at ${baseUrl}`, 'Start your dev server before verfix run');
      warnings++;
    }
  }

  // 6. AI provider — a hard requirement only when the mode actually uses AI
  const mode = config.mode || 'strict';
  let providerConfigured: boolean | null = null;
  let keyFound: boolean | null = null;
  let keyFormatValid: boolean | null = null;
  if (mode === 'strict') {
    printCheck(chalk.gray('•'), chalk.gray('AI key not needed (strict mode)'));
  } else {
    const { PROVIDER_REGISTRY } = await import('./providers/registry');
    const { loadAIConfig, loadApiKey } = await import('./config/loader');
    const aiConfig = loadAIConfig(process.cwd());
    providerConfigured = aiConfig !== null;
    if (!aiConfig) {
      printCheck(chalk.red('✗'), `No AI provider configured (mode is '${mode}')`, 'Run: verfix init to configure AI, or switch to mode: strict');
      failures++;
    } else {
      const def = PROVIDER_REGISTRY[aiConfig.provider];
      const apiKey = loadApiKey(process.cwd(), aiConfig.provider);
      keyFound = !!apiKey;
      if (!apiKey) {
        printCheck(chalk.red('✗'), 'AI API key not found', `Set ${def.envVar} in .verfix/.env or as environment variable`);
        failures++;
      } else {
        keyFormatValid = def.keyPattern.test(apiKey);
        if (keyFormatValid) {
          printCheck(chalk.green('✓'), `AI configured: ${aiConfig.provider} / ${aiConfig.model}`);
        } else {
          printCheck(chalk.red('✗'), `API key format invalid for ${def.displayName}`, `Key should ${def.keyPatternHint}. Check ${def.envVar}`);
          failures++;
        }
      }
    }
  }

  // 7. Docker — purely informational in local mode, never a failure
  printCheck(chalk.gray('•'), chalk.gray(`Docker ${isDockerInstalled() ? 'installed' : 'not installed'} — optional (server mode only, see --server)`));

  const finish = async (exitCode: number) => {
    try {
      trackEvent('cli_doctor', { failures, warnings, passed: failures === 0, runner: 'local' });
      await flushTelemetry();
    } catch {
      // ignore
    }
    process.exit(exitCode);
  };

  if (isJsonMode(opts)) {
    emitJson({
      runner: 'local',
      checks: {
        node_ok: nodeOk,
        config_found: configFound,
        config_valid: configValid,
        agents_md_found: agentsMdFound,
        engine_installed: engineInstalled,
        chromium_installed: chromiumInstalled,
        base_url_reachable: baseUrlReachable,
        provider_configured: providerConfigured,
        key_found: keyFound,
        key_format_valid: keyFormatValid,
      },
      mode,
      failures,
      warnings,
      passed: failures === 0,
    });
    return finish(failures > 0 ? 1 : 0);
  }

  console.log('');
  if (failures === 0 && warnings === 0) {
    console.log(chalk.bold.green('  All checks passed!'));
  } else if (failures === 0) {
    console.log(chalk.bold.yellow(`  All checks passed (${warnings} warning(s))`));
  } else {
    console.log(chalk.bold.red(`  ${failures} check(s) failed`));
    if (warnings > 0) console.log(chalk.yellow(`  ${warnings} warning(s)`));
  }
  console.log('');
  showPendingNotifications();
  scheduleBackgroundCheck(['npm', 'image']);
  return finish(failures > 0 ? 1 : 0);
}

program
  .command('doctor')
  .description('Run diagnostic checks on the Verfix setup')
  .option('-o, --output <format>', 'Output format: pretty | json', 'pretty')
  .option('--check-connectivity', 'Also test API key connectivity (makes a live API call)', false)
  .option('--server', 'Diagnose the Docker server runtime instead of local mode', false)
  .action(async (opts) => {
    applyRunnerFlag(opts);
    if (getRunnerMode() === 'local') {
      // Runs before ANY docker spawn — a docker-less machine must never error.
      await runLocalDoctor(opts);
      return;
    }
    refreshRuntimePortsFromContainerIfRunning();
    const runtimePorts = getRuntimePorts();
    if (!isJsonMode(opts)) {
      console.log('');
      console.log(chalk.bold('  Verfix Doctor'));
      console.log(chalk.gray('  ─────────────────────────────'));
      console.log('');
    }

    let failures = 0;
    let warnings = 0;

    // ── Helper: print check result ──
    function printCheck(
      icon: string,
      label: string,
      hint?: string,
    ): void {
      if (isJsonMode(opts)) return;
      console.log(`  ${icon} ${label}`);
      if (hint) console.log(chalk.gray(`    ${hint}`));
    }

    // 1. Docker installed
    const dockerInstalled = isDockerInstalled();
    if (!isJsonMode(opts)) {
      if (dockerInstalled) {
        printCheck(chalk.green('✓'), 'Docker installed');
      } else {
        printCheck(chalk.red('✗'), 'Docker not installed', 'Install from https://docker.com');
      }
    }
    if (!dockerInstalled) failures++;

    // 2. Docker daemon running
    const dockerRunning = isDockerRunning();
    if (!isJsonMode(opts)) {
      if (dockerRunning) {
        printCheck(chalk.green('✓'), 'Docker daemon running');
      } else {
        printCheck(chalk.red('✗'), 'Docker daemon not running', 'Start Docker Desktop');
      }
    }
    if (!dockerRunning) failures++;

    // 3. Container running
    const state = getContainerState();
    const containerRunning = state?.status === 'running';
    if (!isJsonMode(opts)) {
      if (containerRunning) {
        printCheck(chalk.green('✓'), 'Container running');
      } else {
        printCheck(chalk.red('✗'), 'Container not running', 'Run: verfix start');
      }
    }
    if (!containerRunning) failures++;

    // 4. API healthy
    const apiHealthy = await isApiHealthy();
    if (!isJsonMode(opts)) {
      if (apiHealthy) {
        printCheck(chalk.green('✓'), 'API healthy');
      } else {
        printCheck(chalk.red('✗'), 'API unreachable', `Check: curl http://localhost:${runtimePorts.apiPort}${HEALTH_ENDPOINT}`);
      }
    }
    if (!apiHealthy) failures++;

    // 5. Dashboard reachable
    const dashReachable = await isDashboardReachable();
    if (!isJsonMode(opts)) {
      if (dashReachable) {
        printCheck(chalk.green('✓'), 'Dashboard reachable');
      } else {
        printCheck(chalk.red('✗'), 'Dashboard unreachable', `Check: curl http://localhost:${runtimePorts.dashboardPort}`);
      }
    }
    if (!dashReachable) failures++;

    // 6. verfix.config.json exists
    const configPath = path.resolve(process.cwd(), DEFAULT_CONFIG);
    const configFound = fs.existsSync(configPath);
    if (!isJsonMode(opts)) {
      if (configFound) {
        printCheck(chalk.green('✓'), `${DEFAULT_CONFIG} found`);
      } else {
        printCheck(chalk.red('✗'), `${DEFAULT_CONFIG} not found`, 'Run: verfix init (or verfix init --yes for non-interactive)');
      }
    }
    if (!configFound) failures++;

    // 7. AGENTS.md exists
    const agentsPath = path.resolve(process.cwd(), 'AGENTS.md');
    const agentsMdFound = fs.existsSync(agentsPath);
    if (!isJsonMode(opts)) {
      if (agentsMdFound) {
        printCheck(chalk.green('✓'), 'AGENTS.md found');
      } else {
        printCheck(chalk.red('✗'), 'AGENTS.md not found', 'Run: verfix init (or verfix init --yes for non-interactive)');
      }
    }
    if (!agentsMdFound) failures++;

    // ── Provider checks ──
    if (!isJsonMode(opts)) {
      console.log('');
      console.log(chalk.bold('  AI Provider'));
      console.log(chalk.gray('  ─────────────────────────────'));
      console.log('');
    }

    // Dynamically import provider modules (avoid bloating the main entry)
    const { PROVIDER_REGISTRY, getAllProviders, detectProviderFromModel, isValidModel } = await import('./providers/registry');
    const { parseEnvFile, loadAIConfig, loadApiKey } = await import('./config/loader');

    const cwd = process.cwd();
    const envVars = parseEnvFile(cwd);
    const aiConfig = loadAIConfig(cwd);

    // 8. AI provider configured
    const providerConfigured = aiConfig !== null;
    let providerValid = false;
    let keyFormatValid = false;
    let modelValid = false;
    let connectivityOk: boolean | null = null;
    let connectivityError: string | undefined;

    if (!isJsonMode(opts)) {
      if (providerConfigured) {
        printCheck(chalk.green('✓'), `AI provider configured: ${chalk.bold(aiConfig!.provider)}`);
        providerValid = true;
      } else {
        // Check if there's a legacy AI_API_KEY without a provider
        const hasLegacyKey = !!(envVars['AI_API_KEY'] || process.env.AI_API_KEY);
        if (hasLegacyKey) {
          const legacyModel = envVars['AI_MODEL'] || process.env.AI_MODEL || '';
          const detectedProvider = legacyModel ? detectProviderFromModel(legacyModel) : null;
          printCheck(
            chalk.yellow('⚠'),
            'AI config uses legacy format (no provider field)',
            detectedProvider
              ? `Run: verfix init to migrate to provider: ${detectedProvider}`
              : 'Run: verfix init to set up a provider',
          );
          warnings++;
        } else {
          printCheck(chalk.yellow('⚠'), 'No AI provider configured', 'Run: verfix init to configure AI (optional)');
          warnings++;
        }
      }
    } else {
      providerValid = providerConfigured;
    }

    if (aiConfig) {
      const def = PROVIDER_REGISTRY[aiConfig.provider];

      // 9. API key format valid
      const apiKey = loadApiKey(cwd, aiConfig.provider);
      if (apiKey) {
        keyFormatValid = def.keyPattern.test(apiKey);
        if (!isJsonMode(opts)) {
          if (keyFormatValid) {
            const masked = apiKey.slice(0, 8) + '*'.repeat(Math.max(0, apiKey.length - 8));
            printCheck(chalk.green('✓'), `API key format valid (${masked})`);
          } else {
            printCheck(
              chalk.red('✗'),
              `API key format invalid for ${def.displayName}`,
              `Key should ${def.keyPatternHint}. Check ${def.envVar}`,
            );
            failures++;
          }
        } else {
          if (!keyFormatValid) failures++;
        }

        // 10. Model valid for provider
        modelValid = isValidModel(aiConfig.provider, aiConfig.model);
        if (!isJsonMode(opts)) {
          if (modelValid) {
            printCheck(chalk.green('✓'), `Model valid: ${chalk.bold(aiConfig.model)}`);
          } else {
            const available = def.models.map((m) => m.id).join(', ');
            printCheck(
              chalk.red('✗'),
              `Model '${aiConfig.model}' not in ${def.displayName} model list`,
              available ? `Available models: ${available}` : 'Run: verfix init to re-select a model',
            );
            failures++;
          }
        } else {
          if (!modelValid) failures++;
        }

        // 11. Connectivity test (optional, flag-gated)
        if (opts.checkConnectivity) {
          const connSpinner = isJsonMode(opts) ? null : ora(`Testing ${def.displayName} connectivity...`).start();
          try {
            const { createProviderInstance } = await import('./providers/factory');
            const provider = createProviderInstance(aiConfig.provider);
            const result = await provider.testConnectivity(apiKey);
            connectivityOk = result.ok;
            connectivityError = result.error;
            if (connSpinner) {
              if (result.ok) {
                connSpinner.succeed(`${def.displayName} API reachable`);
              } else {
                connSpinner.fail(`${def.displayName} connectivity failed: ${result.error}`);
                failures++;
              }
            } else {
              if (!result.ok) failures++;
            }
          } catch (e: any) {
            connectivityOk = false;
            connectivityError = e.message;
            if (connSpinner) connSpinner.fail(`Connectivity test error: ${e.message}`);
            failures++;
          }
        }
      } else {
        if (!isJsonMode(opts)) {
          printCheck(
            chalk.red('✗'),
            `API key not found`,
            `Set ${def.envVar} in .verfix/.env or as environment variable`,
          );
        }
        failures++;
      }
    }

    const finishTelemetryAndExit = async (exitCode: number) => {
      try {
        trackEvent('cli_doctor', {
          failures,
          warnings,
          passed: failures === 0,
          check_connectivity: !!opts.checkConnectivity,
          provider: aiConfig?.provider ?? null,
          model: aiConfig?.model ?? null,
        });
        await flushTelemetry();
      } catch {
        // ignore
      }
      process.exit(exitCode);
    };

    // ── Output ──
    if (isJsonMode(opts)) {
      emitJson({
        checks: {
          docker_installed: dockerInstalled,
          docker_running: dockerRunning,
          container_running: containerRunning,
          api_healthy: apiHealthy,
          dashboard_reachable: dashReachable,
          config_found: configFound,
          agents_md_found: agentsMdFound,
          provider_configured: providerValid,
          key_format_valid: keyFormatValid,
          model_valid: modelValid,
          connectivity: connectivityOk,
          connectivity_error: connectivityError,
        },
        provider: aiConfig?.provider ?? null,
        model: aiConfig?.model ?? null,
        failures,
        warnings,
        passed: failures === 0,
      });
      scheduleBackgroundCheck(['npm', 'image']);
      await finishTelemetryAndExit(failures > 0 ? 1 : 0);
    }

    console.log('');
    if (failures === 0 && warnings === 0) {
      console.log(chalk.bold.green('  All checks passed!'));
    } else if (failures === 0) {
      console.log(chalk.bold.yellow(`  All checks passed (${warnings} warning(s))`));
    } else {
      console.log(chalk.bold.red(`  ${failures} check(s) failed`));
      if (warnings > 0) console.log(chalk.yellow(`  ${warnings} warning(s)`));
    }
    console.log('');
    showPendingNotifications();
    scheduleBackgroundCheck(['npm', 'image']);
    await finishTelemetryAndExit(failures > 0 ? 1 : 0);
  });

// ─── agent-setup command ─────────────────────────────────────────────────────

program
  .command('agent-setup')
  .description('Print machine-readable setup instructions for AI coding agents')
  .action(() => {
    const configExists = fs.existsSync(path.resolve(process.cwd(), DEFAULT_CONFIG));
    const agentsMdExists = fs.existsSync(path.resolve(process.cwd(), 'AGENTS.md'));

    const output = {
      initialized: configExists,
      agents_md_exists: agentsMdExists,
      bootstrap: {
        description: 'Run this command to initialize Verfix non-interactively',
        command: 'npx verfix init --yes',
        required_flags: {},
        optional_flags: {
          '--ai-key': 'API key — only required for assisted/exploratory modes (or set VERFIX_AI_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY env var)',
          '--ai-provider': 'openai | anthropic | gemini | openrouter (auto-detected from key format if omitted)',
          '--ai-model': 'Model ID (uses provider default if omitted)',
          '--base-url': 'App URL (default: http://localhost:3000)',
          '--mode': 'strict | assisted | exploratory (default: strict — no AI key needed)',
          '--skip-runtime': 'Skip runtime setup (Chromium download in local mode; Docker start in server mode)',
          '--skip-agent-files': 'Skip writing .cursorrules/CLAUDE.md/CODEX.md',
          '--dry-run': 'Preview without writing files',
        },
        env_var_fallbacks: {
          'VERFIX_AI_PROVIDER': '--ai-provider',
          'VERFIX_AI_MODEL': '--ai-model',
          'VERFIX_AI_KEY': '--ai-key',
          'VERFIX_BASE_URL': '--base-url',
          'VERFIX_MODE': '--mode',
        },
        provider_env_vars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'],
        examples: [
          'npx verfix init --yes',
          'npx verfix init --yes --mode assisted --ai-key $OPENAI_API_KEY',
          'VERFIX_AI_KEY=$ANTHROPIC_API_KEY npx verfix init --yes --mode assisted',
          'npx verfix init --yes --ai-provider openai --ai-model gpt-5.4-mini --ai-key sk-... --base-url http://localhost:3000',
        ],
      },
    };

    console.log(JSON.stringify(output, null, 2));
  });

// ─── init command (interactive wizard + non-interactive mode) ────────────────

program
  .command('init')
  .description('Setup wizard — configure runtime, flows, and AGENTS.md')
  .option('-f, --force', 'Overwrite existing files without prompting')
  .option('-y, --yes', 'Non-interactive mode (for CI and AI agents)')
  .option('--ai-provider <id>', 'AI provider: openai | anthropic | gemini | openrouter')
  .option('--ai-model <name>', 'Model ID (e.g. gpt-5.4-mini, claude-sonnet-4-6)')
  .option('--ai-key <key>', 'API key string')
  .option('--base-url <url>', 'App URL (e.g. http://localhost:3000)')
  .option('--mode <mode>', 'Verification mode: strict | assisted | exploratory')
  .option('--skip-runtime', 'Skip runtime setup (Docker start in server mode, Chromium download in local mode)')
  .option('--skip-agent-files', 'Don\'t write .cursorrules/CLAUDE.md/CODEX.md')
  .option('--dry-run', 'Preview what would happen, don\'t write anything')
  .option('--server', 'Set up the Docker server runtime (legacy flow)', false)
  .action(async (opts) => {
    applyRunnerFlag(opts);
    let telemetryCaptured = false;

    const captureTelemetry = async (exitCode: number, errorMsg?: string) => {
      if (telemetryCaptured) return;
      telemetryCaptured = true;

      let aiConfig: any = null;
      let verfixConfig: any = null;
      try {
        const { loadAIConfig, loadVerfixConfig } = await import('./config/loader');
        aiConfig = loadAIConfig(process.cwd());
        const configPath = path.resolve(process.cwd(), DEFAULT_CONFIG);
        if (fs.existsSync(configPath)) {
          verfixConfig = loadVerfixConfig(configPath);
        }
      } catch (err) {
        // ignore load config errors for telemetry
      }

      trackEvent('cli_init', {
        interactive: !opts.yes,
        dry_run: !!opts.dryRun,
        provider: aiConfig?.provider || opts.aiProvider || null,
        model: aiConfig?.model || opts.aiModel || null,
        mode: verfixConfig?.mode || opts.mode || null,
        skip_runtime: !!opts.skipRuntime,
        skip_agent_files: !!opts.skipAgentFiles,
        exit_code: exitCode,
        error: errorMsg || (exitCode !== 0 ? 'exit_non_zero' : undefined),
      });
      await flushTelemetry();
    };

    try {
      if (opts.yes || opts.dryRun) {
        // Non-interactive mode
        const { runNonInteractiveInit } = await import('./init-noninteractive');
        await runNonInteractiveInit(opts);
      } else {
        // Interactive wizard (unchanged)
        const { runInitWizard } = await import('./init-wizard');
        await runInitWizard();
      }

      await captureTelemetry(0);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\n✗ Error: ${errorMsg}`));
      await captureTelemetry(1, errorMsg);
      process.exit(1);
    }
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
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'config_not_found', message: `Config file not found: ${configPath}`, hint: 'Run: verfix init --yes (non-interactive) or verfix init (interactive)' });
      }
      console.error(chalk.red(`Config file not found: ${configPath}`));
      console.error(chalk.gray('Run: verfix init --yes (non-interactive) or verfix init (interactive)'));
      process.exit(2);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const flows = config.flows || [];

    if (flows.length === 0) {
      if (isJsonMode(opts)) {
        emitJson({ flows: [], total: 0 });
        return;
      }
      console.log(chalk.gray('  No flows configured. Edit verfix.config.json to add flows.'));
      return;
    }

    const allFlowIds = flows.map((f: any) => f.id || f.name).filter(Boolean);
    const getDependencies = (description?: string) => {
      if (!description) return [];
      const requiresIndex = description.indexOf('Requires:');
      if (requiresIndex === -1) return [];
      const text = description.substring(requiresIndex + 9);
      return allFlowIds.filter((id: string) => text.includes(id));
    };

    if (opts.output === 'json') {
      const list = flows.map((f: any) => {
        const id = f.id || f.name;
        const deps = getDependencies(f.description);
        return {
          id,
          steps: (f.steps || []).length,
          assertions: (f.assertions || []).length,
          description: f.description,
          composable_with: deps.length > 0 ? deps : undefined,
          skip: f.skip || undefined,
          skip_reason: f.skip ? f.skipReason : undefined,
        };
      });
      emitJson({ flows: list, total: list.length });
      scheduleBackgroundCheck(['npm', 'image']);
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
      const skipTag = f.skip ? ` ${chalk.yellow('[skipped]')}` : '';
      console.log(`  ${chalk.cyan('▸')} ${chalk.bold(id)}${skipTag}`);
      console.log(`    ${chalk.gray(`${stepCount} step(s), ${assertCount} assertion(s)`)}`);
      if (f.skip && f.skipReason) {
        console.log(`    ${chalk.yellow(`⊘ Skipped: ${f.skipReason}`)}`);
      }
      if (stepDesc) {
        console.log(`    ${chalk.gray(stepDesc)}`);
      }
      if (f.description) {
        if (f.description.includes('Requires:')) {
          console.log(`    ${chalk.yellow(`⚠ ${f.description}`)}`);
        } else {
          console.log(`    ${chalk.gray(f.description)}`);
        }
      }
      console.log(`    ${chalk.gray('Run:')} verfix run --flow ${id} --output json`);
      console.log('');
    }
    showPendingNotifications();
    scheduleBackgroundCheck(['npm', 'image']);
  });

// ─── validate command ───────────────────────────────────────────────────────

program
  .command('validate')
  .description('Check verfix.config.json for structural and semantic errors without running it')
  .option('-c, --config <file>', 'Path to config file')
  .option('-o, --output <format>', 'Output format: pretty | json', 'pretty')
  .action(async (opts) => {
    const configPath = opts.config
      ? path.resolve(opts.config)
      : path.resolve(process.cwd(), DEFAULT_CONFIG);

    if (!fs.existsSync(configPath)) {
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'config_not_found', message: `Config file not found: ${configPath}`, hint: 'Run: verfix init --yes (non-interactive) or verfix init (interactive)' });
      }
      console.error(chalk.red(`Config file not found: ${configPath}`));
      process.exit(2);
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    let config: any = null;
    try {
      const { loadVerfixConfig } = await import('./config/loader');
      config = loadVerfixConfig(configPath);
    } catch (e: any) {
      errors.push(e.message);
    }

    if (config) {
      const { ASSERTION_TYPES } = await import('@verfix/engine');
      const checkAssertions = (assertions: any[] | undefined, where: string) => {
        for (const a of assertions || []) {
          if (a.type && !ASSERTION_TYPES.includes(a.type)) {
            errors.push(`${where}: unknown assertion type "${a.type}". Valid types: ${ASSERTION_TYPES.join(', ')}`);
          }
        }
      };

      checkAssertions(config.assertions, 'assertions');

      const seenIds = new Set<string>();
      (config.flows || []).forEach((flow: any, idx: number) => {
        const id = flow.id || flow.name || `flow_${idx + 1}`;
        if (seenIds.has(id)) {
          errors.push(`flows[${idx}] (${id}): duplicate flow id/name`);
        }
        seenIds.add(id);

        if (!flow.steps?.length && !flow.assertions?.length) {
          warnings.push(`flows[${idx}] (${id}): has no steps or assertions — it does nothing`);
        }
        if (flow.mode === 'exploratory') {
          errors.push(`flows[${idx}] (${id}): mode "exploratory" is not valid per-flow — it replaces flow execution entirely and only applies as the top-level "mode"`);
        }
        checkAssertions(flow.assertions, `flows[${idx}] (${id})`);
      });

      // Inline upload_file content lives in the config agents read — a large
      // blob would bloat every future context window that loads it.
      const MAX_INLINE_FILE_BYTES = 64 * 1024;
      (config.flows || []).forEach((flow: any, idx: number) => {
        const id = flow.id || flow.name || `flow_${idx + 1}`;
        (flow.steps || []).forEach((step: any, stepIdx: number) => {
          const content = step?.file?.content;
          if (typeof content === 'string' && Buffer.byteLength(content, 'utf8') > MAX_INLINE_FILE_BYTES) {
            warnings.push(`flows[${idx}] (${id}).steps[${stepIdx}]: inline file content is ${Math.round(Buffer.byteLength(content, 'utf8') / 1024)}KB — commit it as a fixture and use a "file" path instead (inline is for tiny files)`);
          }
        });
      });

      const savedStateNames = new Set((config.flows || []).map((f: any) => f.saveState).filter(Boolean));
      (config.flows || []).forEach((flow: any, idx: number) => {
        const id = flow.id || flow.name || `flow_${idx + 1}`;
        if (flow.useState && !savedStateNames.has(flow.useState)) {
          warnings.push(`flows[${idx}] (${id}): useState "${flow.useState}" is never saved by any flow — add saveState: "${flow.useState}" to the flow that logs in`);
        }
      });

      if (!config.baseUrl) {
        warnings.push('baseUrl is not set — every "verfix run" will require --url');
      }

      const assistedInUse = config.mode === 'assisted' || (config.flows || []).some((f: any) => f.mode === 'assisted');
      if (config.mode === 'exploratory' || assistedInUse) {
        const { loadAIConfig, loadApiKey } = await import('./config/loader');
        const aiConfig = loadAIConfig(process.cwd());
        const apiKey = aiConfig ? loadApiKey(process.cwd(), aiConfig.provider) : null;
        if (!apiKey && config.mode === 'exploratory') {
          errors.push('mode is "exploratory" but no AI provider/key is configured — exploratory mode has no deterministic fallback. Run: verfix init to configure AI, or switch to mode: strict/assisted.');
        }
        if (!apiKey && assistedInUse) {
          warnings.push('assisted mode is in use but no AI provider/key is configured — self-healing will only use semantic selectors (role/aria/text), no AI fallback. Run: verfix init to add one, or ignore if that\'s enough.');
        }
      }
    }

    const valid = errors.length === 0;

    if (isJsonMode(opts)) {
      emitJson({ valid, errors, warnings });
      process.exit(valid ? 0 : 2);
    }

    if (valid && warnings.length === 0) {
      console.log(chalk.green(`✓ ${configPath} is valid`));
    } else {
      console.log('');
      for (const err of errors) {
        console.log(`  ${chalk.red('✗')} ${err}`);
      }
      for (const warn of warnings) {
        console.log(`  ${chalk.yellow('⚠')} ${warn}`);
      }
      console.log('');
      console.log(valid ? chalk.green(`✓ ${configPath} is valid (with warnings)`) : chalk.red(`✗ ${configPath} is invalid`));
    }

    process.exit(valid ? 0 : 2);
  });

// ─── install command ────────────────────────────────────────────────────────

program
  .command('install')
  .description('Download the Chromium browser the local runner needs (one-time, ~130MB)')
  .option('-o, --output <format>', 'Output format: pretty | json', 'pretty')
  .action(async (opts) => {
    applyRunnerFlag(opts);
    if (getRunnerMode() !== 'local') {
      console.log(chalk.gray('verfix install is for local mode. Use --server to manage the Docker runtime.'));
      return;
    }
    const { isEngineInstalled, ensureChromium } = await import('./local-runner');
    if (!isEngineInstalled()) {
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'engine_not_installed', message: '@verfix/engine is not installed.', hint: 'Reinstall the CLI: npm install verfix' });
      }
      console.error(chalk.red('@verfix/engine is not installed — run: npm install verfix'));
      process.exit(2);
    }
    if (!isJsonMode(opts)) {
      console.log('');
      console.log(chalk.gray('  Ensuring Chromium is installed (skips if already present)...'));
      console.log('');
    }
    try {
      await ensureChromium();
      if (isJsonMode(opts)) {
        emitJson({ installed: true, browser: 'chromium' });
      } else {
        console.log(chalk.green('  ✓ Chromium ready'));
      }
    } catch (e: any) {
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'install_failed', message: e.message, hint: 'Set "browser": {"channel": "chrome"} in verfix.config.json to use installed Chrome, or run: npx playwright install chromium' });
      }
      console.error(chalk.red(e.message));
      process.exit(2);
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
  .option('--full', 'JSON output: include the raw ExecutionResult (full event timeline) — large; details are otherwise pull-on-demand via verfix show', false)
  .option('-q, --quiet', '(deprecated: summary is now the default) no-op kept for compatibility', false)
  .option('--dashboard <url>', 'Dashboard base URL for timeline links')
  .option('--timeout <ms>', 'Timeout in milliseconds', '15000')
  .option('--retries <n>', 'Number of retries on failure', '2')
  .option('--show-browser', 'Show the browser window during verification runs (local mode only)', false)
  .option('--source-policy <policy>', 'Project-source edit policy: warn | block | off (overrides config)')
  .option('--reset-baseline', 'Reset the source-change baseline for this verify cycle', false)
  .option('--skip-download', 'Do not auto-download Chromium on first run; fail fast if missing (local mode only)', false)
  .option('--server', 'Run via the Docker server runtime instead of locally', false)
  .action(async (opts) => {
    applyRunnerFlag(opts);
    if (opts.showBrowser && getRunnerMode() === 'server') {
      console.warn(chalk.yellow('⚠ --show-browser is only supported in local mode. Ignoring.'));
    }

    let trackMode = opts.mode || 'strict';
    let trackFlowCount = 0;
    let trackDurationMs = 0;
    let trackHasConfig = false;

    const finishTelemetryAndExit = async (exitCode: number, error?: string) => {
      try {
        trackEvent('cli_run', {
          mode: trackMode,
          flow_count: trackFlowCount,
          has_config: trackHasConfig,
          passed: exitCode === 0,
          duration_ms: trackDurationMs,
          error: error || (exitCode !== 0 ? (exitCode === 1 ? 'verification_failed' : 'exit_non_zero') : undefined),
        });
        await flushTelemetry();
      } catch {
        // ignore telemetry errors
      }
      process.exit(exitCode);
    };

    // Load config file if provided or found in cwd
    let config: any = {};
    const configPath = opts.config
      ? path.resolve(opts.config)
      : path.resolve(process.cwd(), DEFAULT_CONFIG);
    let didLoadConfig = false;

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      didLoadConfig = true;
      trackHasConfig = true;
    } else if (opts.config) {
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'config_not_found', message: `Config file not found: ${configPath}`, hint: 'Run: verfix init --yes (non-interactive) or verfix init (interactive)' });
      }
      console.error(chalk.red(`Config file not found: ${configPath}`));
      await finishTelemetryAndExit(2, 'config_not_found');
    }

    if (didLoadConfig) {
      try {
        validateConfigSchema(config, configPath);
      } catch (e: any) {
        if (isJsonMode(opts)) {
          emitJsonError({ error: 'config_validation_failed', message: e.message, hint: 'Fix the config file to match the schema.' });
        }
        console.error(chalk.red(e.message));
        await finishTelemetryAndExit(2, 'config_validation_failed');
      }

      // Keep agent instructions current after a CLI update: regenerate the
      // Verfix-owned .verfix/INSTRUCTIONS.md when its version stamp doesn't
      // match this CLI. Best-effort — a docs refresh must never fail a run.
      try {
        const { refreshVerfixInstructionsIfStale } = await import('./agent-writer');
        if (refreshVerfixInstructionsIfStale(process.cwd(), config)) {
          console.error(chalk.gray(`ℹ ${'.verfix/INSTRUCTIONS.md'} refreshed for verfix v${version}`));
        }
      } catch (e: any) {
        // Best-effort — a docs refresh must never fail a run — but per repo
        // convention, don't swallow it silently (helps debug prod issues).
        console.error(chalk.gray(`ℹ Could not refresh ${'.verfix/INSTRUCTIONS.md'}: ${e?.message || e}`));
      }
    }

    let selectedFlows: any[] = [];
    try {
      selectedFlows = selectFlows(config?.flows, opts.flow);
    } catch (e: any) {
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'flow_not_found', message: e.message, hint: 'Run: verfix flows to see available flows.' });
      }
      console.error(chalk.red(e.message));
      await finishTelemetryAndExit(2, 'flow_not_found');
    }

    let flows: any[];
    let assertions: any[] | undefined;
    let baseUrl: any;
    try {
      flows = selectedFlows.length > 0
        ? normalizeFlows(selectedFlows)
        : normalizeFlows((config?.flows || []).filter((f: any) => !f.skip));
      assertions = selectedFlows.length > 0 ? undefined : interpolateAssertions(config.assertions, 'assertions');
      baseUrl = opts.url || config.baseUrl || config.url;
      if (baseUrl) baseUrl = interpolateEnv(baseUrl, 'baseUrl');
    } catch (e: any) {
      if (!(e instanceof MissingEnvVarError)) throw e;
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'env_var_missing', message: e.message, hint: `Set ${e.varName} in .verfix/.env.` });
      }
      console.error(chalk.red(e.message));
      await finishTelemetryAndExit(2, 'env_var_missing');
      return;
    }

    trackFlowCount = flows.length > 0 ? flows.length : (assertions ? assertions.length : 0);

    // ── Source-change guard ───────────────────────────────────────────────────
    // Snapshot / compare the working tree at the START of the run so we can tell
    // whether the agent edited project source during this verify cycle. Prefer
    // config edits (selectors alias / assisted mode) over touching project code.
    const rawPolicy = (opts.sourcePolicy || config.sourceCodePolicy || 'warn') as string;
    const sourcePolicy: SourceCodePolicy =
      rawPolicy === 'block' || rawPolicy === 'off' ? rawPolicy : 'warn';
    const sourceChanges: SourceChanges = evaluateSourceChanges(process.cwd(), {
      reset: !!opts.resetBaseline,
    });
    const sourceGate = buildSourceFinding(sourceChanges, sourcePolicy);

    const runnerMode = getRunnerMode();

    const payload: any = {
      url: baseUrl,
      task: opts.task || config.task || (opts.flow ? `Verify flow ${opts.flow}` : `Verify ${baseUrl}`),
      mode: opts.mode || selectedFlows[0]?.mode || config.mode || 'strict',
      assertions,
      flows: flows.length > 0 ? flows : undefined,
      selectors: config.selectors,
      metadata: config.metadata,
      timeout: parseInt(opts.timeout) || config.timeout || 15000,
      retries: parseInt(opts.retries) || config.retries || 2,
    };

    trackMode = payload.mode;

    if (!payload.url) {
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'missing_url', message: '--url is required (or set baseUrl in config file)', hint: 'Pass --url <url> or add baseUrl to your config.' });
      }
      console.error(chalk.red('Error: --url is required (or set baseUrl in config file)'));
      await finishTelemetryAndExit(2, 'missing_url');
    }

    // Exploratory mode replaces flow execution entirely (an AI agent drives the
    // browser from `task`, ignoring `flows`/`assertions`) — it only makes sense
    // as the run's global mode. A per-flow override to 'exploratory' is a no-op
    // the engine silently ignores, so reject it here rather than let it pass
    // through as a config that looks like it does something it doesn't.
    const exploratoryFlow = flows.find((f: any) => f.mode === 'exploratory');
    if (exploratoryFlow) {
      const msg = `Flow "${exploratoryFlow.name}" sets mode: "exploratory" — exploratory mode only applies globally (it replaces flow execution with an AI-driven task), not per-flow. Set the top-level "mode" instead, or use "strict"/"assisted" for this flow.`;
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'invalid_flow_mode', message: msg, hint: 'Remove "mode": "exploratory" from the flow, or run it as its own exploratory config.' });
      }
      console.error(chalk.red(msg));
      await finishTelemetryAndExit(2, 'invalid_flow_mode');
    }

    // AI key check — exploratory and assisted need different treatment.
    // Exploratory has no deterministic fallback at all, so a missing key is a
    // hard error, fail fast here instead of launching a browser only to have
    // it fail mid-run. Assisted still works without a key (semantic-selector
    // healing runs regardless; only the AI-fallback tier is skipped), so a
    // missing key there is just a heads-up, not a blocker.
    const assistedInUse = payload.mode === 'assisted' || flows.some((f: any) => f.mode === 'assisted');
    if (payload.mode === 'exploratory' || assistedInUse) {
      const { loadAIConfig, loadApiKey } = await import('./config/loader');
      const aiConfig = loadAIConfig(process.cwd());
      const apiKey = aiConfig ? loadApiKey(process.cwd(), aiConfig.provider) : null;

      if (!apiKey && payload.mode === 'exploratory') {
        const msg = 'Exploratory mode requires an AI provider and API key — there is no deterministic fallback for it (unlike assisted mode).';
        const hint = 'Run: verfix init to configure AI, or switch to mode: strict/assisted.';
        if (isJsonMode(opts)) {
          emitJsonError({ error: 'ai_key_required', message: msg, hint });
        }
        console.error(chalk.red(msg));
        console.error(chalk.gray(hint));
        await finishTelemetryAndExit(2, 'ai_key_required');
      }

      if (!apiKey && assistedInUse) {
        console.warn(chalk.yellow(
          '⚠ Assisted mode is active but no AI provider/key is configured — self-healing will only use semantic selectors (role/aria/text), no AI fallback. Run: verfix init to add one, or ignore if that\'s enough.'
        ));
      }
    }

    if (opts.output === 'pretty') {
      console.log('');
      console.log(chalk.bold.cyan('  ⚡ AI Verification Runtime'));
      console.log(chalk.gray('  ─────────────────────────────'));
      console.log(`  ${chalk.gray('Task:')}    ${payload.task}`);
      console.log(`  ${chalk.gray('URL:')}     ${payload.url}`);
      console.log(`  ${chalk.gray('Mode:')}    ${payload.mode}`);
      console.log(`  ${chalk.gray('Runner:')}  ${runnerMode}`);
      console.log(`  ${chalk.gray('Checks:')}  ${(payload.assertions || []).length} assertion(s)`);
      console.log('');
    }

    let result: any = null;
    let timelineUrl: string | null = null;
    let activeProxy: { close: () => void } | null = null;

    if (runnerMode === 'local') {
      // ── Local mode: drive the engine in-process. No Docker, no Redis, no API,
      // no URL rewriting — the browser runs on this machine and reaches
      // localhost natively.
      maybeShowDockerMigrationNotice();
      const runSpinner = opts.output === 'pretty' ? ora('Running verification (local)...').start() : null;
      try {
        const { runLocal } = await import('./local-runner');
        result = await runLocal(payload, {
          headless: !opts.showBrowser,
          browser: config.browser,
          json: isJsonMode(opts),
          skipDownload: opts.skipDownload,
        });
        runSpinner?.stop();
      } catch (e: any) {
        runSpinner?.fail('Verification failed to run');
        const errName = e?.name === 'BrowserNotInstalledError' ? 'browser_not_installed' : 'run_failed';
        if (isJsonMode(opts)) {
          emitJsonError({
            error: errName,
            message: e.message,
            hint: errName === 'browser_not_installed'
              ? 'Run: verfix install  (or set "browser": {"channel": "chrome"} in verfix.config.json to use installed Chrome)'
              : 'Re-run with --output pretty for details.',
          });
        }
        console.error(chalk.red(e.message));
        await finishTelemetryAndExit(2, errName);
      }
    } else {
      // ── Server mode: submit to the containerized API and poll.
      refreshRuntimePortsFromContainerIfRunning();
      const apiBase = await resolveApiBase();
      const runtimePorts = getRuntimePorts();
      const dashboardBase = buildDashboardBase(runtimePorts);

      // Rewrite localhost → host.docker.internal so Playwright inside the
      // container can reach the user's app running on the host machine.
      const resolved = await resolveJobUrl(baseUrl);
      payload.url = resolved.url;
      activeProxy = resolved.proxy ?? null;
      if (resolved.rewritten && !isJsonMode(opts)) {
        console.log(chalk.gray(`  ℹ  Target URL: ${baseUrl} → ${resolved.url} (host.docker.internal)`));
      }

      const submitSpinner = opts.output === 'pretty' ? ora('Submitting job...').start() : null;

      let executionId = '';
      try {
        const res = await axios.post(`${apiBase}/api/v1/verify`, payload);
        executionId = res.data.executionId;
        submitSpinner?.succeed(`Job queued: ${chalk.bold(executionId)}`);
      } catch (e: any) {
        submitSpinner?.fail('Failed to submit job');
        if (isJsonMode(opts)) {
          emitJsonError({ error: 'submit_failed', message: e.message, hint: 'Check that the runtime is running: verfix status' });
        }
        console.error(chalk.red(e.message));
        if (activeProxy) activeProxy.close();
        await finishTelemetryAndExit(2, 'submit_failed');
      }

      // Poll for result
      const pollSpinner = opts.output === 'pretty' ? ora('Running verification...').start() : null;

      const maxWait = 120000;
      const pollInterval = 2000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        await sleep(pollInterval);
        try {
          const res = await axios.get(`${apiBase}/api/v1/executions/${executionId}`);
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
        if (isJsonMode(opts)) {
          emitJsonError({ error: 'poll_timeout', message: 'Timed out waiting for result. Job may still be running.', hint: `Run: verfix status ${executionId}` });
        }
        console.error(chalk.yellow('⚠ Timed out waiting for result. Job may still be running.'));
        console.log(`  Run: verfix status ${executionId}`);
        if (activeProxy) activeProxy.close();
        await finishTelemetryAndExit(2, 'poll_timeout');
      }

      timelineUrl = buildTimelineUrl(opts.dashboard || dashboardBase, executionId);
    }

    trackDurationMs = result.duration_ms || 0;
    const tracePath = runnerMode === 'local' ? (result.artifacts?.trace ?? null) : undefined;
    const showCommand = runnerMode === 'local' ? `verfix show ${result.executionId}` : undefined;

    if (isJsonMode(opts)) {
      const failures = buildFailures(result);

      // Fold the source-change gate into the contract. In 'block' mode a project
      // edit fails the run; in 'warn' mode it surfaces a non-blocking finding.
      if (sourceGate.finding) failures.push(sourceGate.finding);
      const blocked = sourceGate.block;
      const passed = result.passed && !blocked;

      // Nothing non-nominal may hide in the omitted timeline: optional steps
      // that were skipped are surfaced here explicitly, so "the dialog never
      // appeared" is always visible in the summary, not just in --full events.
      const skippedSteps = (result.events || [])
        .filter((e: any) => e.metadata?.skipped === true)
        .map((e: any) => ({
          flow: e.metadata?.flow,
          action: e.metadata?.action,
          target: e.metadata?.target,
          reason: e.metadata?.reason,
        }));

      const jsonResult = {
        passed,
        failures,
        ...(skippedSteps.length > 0 ? { skipped_optional_steps: skippedSteps } : {}),
        // AI failure analysis (assisted/exploratory modes) is failure signal —
        // it stays in the summary.
        ...(result.ai_summary ? { ai_summary: result.ai_summary } : {}),
        source_changes: sourceChanges.status === 'ok' ? sourceChanges : undefined,
        // Contract stability: timeline_url stays present but is null in local
        // mode (no dashboard); trace_path/show_command are the local additions.
        timeline_url: timelineUrl,
        ...(runnerMode === 'local' ? {
          trace_path: tracePath,
          show_command: showCommand,
          // Self-describing pulls: the summary names the exact commands that
          // return the detail it omits.
          detail_commands: {
            console: `verfix show ${result.executionId} --console --output json`,
            network: `verfix show ${result.executionId} --network --output json`,
          },
        } : {}),
        duration_ms: result.duration_ms,
        retry_count: result.retry_count,
        exit_code: passed ? 0 : 1,
        execution_id: result.executionId,
        // Summary is the default: the full ExecutionResult (event timeline,
        // per-step artifact paths) is pull-when-needed data. --full opts in.
        ...(opts.full ? { raw: result } : {}),
      };
      // End the verify cycle only on a clean pass; keep the baseline otherwise so
      // a revert-and-rerun resolves cleanly.
      if (passed) clearSourceBaseline(process.cwd());
      emitJson(jsonResult);
      scheduleBackgroundCheck(['npm', 'image']);
      if (activeProxy) activeProxy.close();
      await finishTelemetryAndExit(jsonResult.exit_code);
    }

    // Pretty output
    const prettyPassed = result.passed && !sourceGate.block;
    console.log('');
    console.log(prettyPassed
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
    if (runnerMode === 'local') {
      console.log(`${chalk.gray('Show trace:')} ${chalk.cyan(showCommand)}`);
    } else {
      console.log(`${chalk.gray('Timeline:')} ${timelineUrl}`);
    }

    const errors = (result.console_logs || []).filter((l: any) => l.type === 'error');
    if (errors.length > 0) {
      console.log('');
      console.log(chalk.bold.red(`  Console Errors (${errors.length}):`));
      for (const e of errors) {
        console.log(`    ${chalk.red('•')} ${e.text}`);
      }
    }

    if (sourceGate.finding) {
      console.log('');
      const header = sourceGate.block
        ? chalk.bold.red('  ⛔ Project source edited during verify loop (blocked):')
        : chalk.bold.yellow('  ⚠ Project source edited during verify loop:');
      console.log(header);
      for (const f of sourceGate.finding.files) {
        console.log(`    ${chalk.yellow('•')} ${f}`);
      }
      console.log(chalk.gray(`    ${sourceGate.finding.fix_hint}`));
    }

    console.log('');
    if (!isJsonMode(opts)) {
      showPendingNotifications();
      scheduleBackgroundCheck(['npm', 'image']);
    } else {
      scheduleBackgroundCheck(['npm', 'image']);
    }
    if (prettyPassed) clearSourceBaseline(process.cwd());
    if (activeProxy) activeProxy.close();
    await finishTelemetryAndExit(prettyPassed ? 0 : 1);
  });

// ─── show command ─────────────────────────────────────────────────────────────

program
  .command('show [executionId]')
  .description('Open the Playwright trace viewer for a local run (newest run if no id given); --console/--network print the captured logs instead')
  .option('--console', 'Print the run\'s captured console log (full untruncated error text)', false)
  .option('--network', 'Print the run\'s captured network requests', false)
  .option('-o, --output <format>', 'Output format for --console/--network: pretty | json', 'pretty')
  .action(async (executionId: string | undefined, opts) => {
    const { findTraceZip, findRunArtifact, playwrightCliPath } = await import('./local-runner');

    // ── Log inspection: first-class access to the artifacts every run already
    // writes, so nobody has to spelunk in .verfix/runs/ with a script.
    if (opts.console || opts.network) {
      const readArtifact = (suffix: string, label: string): any[] | null => {
        const p = findRunArtifact(suffix, executionId);
        if (!p) {
          if (opts.output === 'json') {
            emitJsonError({
              error: 'artifact_not_found',
              message: executionId
                ? `No ${label} log found for execution ${executionId} under .verfix/runs/`
                : 'No local runs found under .verfix/runs/.',
              hint: 'Run a verification first: verfix run --output json',
            });
          } else {
            console.error(chalk.red(executionId
              ? `No ${label} log found for execution ${executionId} under .verfix/runs/`
              : 'No local runs found under .verfix/runs/. Run a verification first: verfix run --output json'));
          }
          process.exit(2);
        }
        try {
          return JSON.parse(fs.readFileSync(p, 'utf-8'));
        } catch (e: any) {
          console.error(chalk.red(`Could not parse ${p}: ${e.message}`));
          process.exit(2);
        }
      };

      const out: { console_logs?: any[]; network_requests?: any[] } = {};
      if (opts.console) out.console_logs = readArtifact('_console.json', 'console') ?? [];
      if (opts.network) out.network_requests = readArtifact('_network.json', 'network') ?? [];

      if (opts.output === 'json') {
        emitJson(out);
        return;
      }
      if (out.console_logs) {
        console.log(chalk.bold(`\n  Console log (${out.console_logs.length} entries):`));
        for (const l of out.console_logs) {
          const color = l.type === 'error' ? chalk.red : l.type === 'warning' ? chalk.yellow : chalk.gray;
          console.log(`    ${color(`[${l.type}]`)} ${l.text}`);
        }
      }
      if (out.network_requests) {
        console.log(chalk.bold(`\n  Network requests (${out.network_requests.length}):`));
        for (const r of out.network_requests) {
          const color = r.status >= 400 ? chalk.red : r.status >= 300 ? chalk.yellow : chalk.green;
          console.log(`    ${color(String(r.status))} ${r.method} ${r.url} ${chalk.gray(`(${r.timing_ms}ms)`)}`);
        }
      }
      console.log('');
      return;
    }

    const traceZip = findTraceZip(executionId);

    if (!traceZip) {
      console.error(chalk.red(executionId
        ? `No trace found for execution ${executionId} under .verfix/runs/`
        : 'No local runs found under .verfix/runs/. Run a verification first: verfix run --output json'));
      process.exit(2);
    }

    console.log(chalk.gray(`Opening trace: ${traceZip}`));
    const { spawnSync } = await import('child_process');
    const res = spawnSync(process.execPath, [playwrightCliPath(), 'show-trace', traceZip], {
      stdio: 'inherit',
    });
    process.exit(res.status ?? 0);
  });

// ─── probe command ────────────────────────────────────────────────────────────

program
  .command('probe [executionId]')
  .description('Dry-run selectors/text against a run\'s saved DOM snapshot (~1s) instead of a full verification run (newest run if no id given)')
  .option('-s, --selector <selectors...>', 'CSS selector(s) to check (config `selectors` aliases resolve first)')
  .option('-t, --text <texts...>', 'Text content to check (same matching as text_visible)')
  .option('-c, --config <file>', 'Path to verfix.config.json (for the selectors alias map)')
  .option('-o, --output <format>', 'Output format: pretty | json', 'pretty')
  .action(async (executionId: string | undefined, opts) => {
    const selectors: string[] = opts.selector || [];
    const texts: string[] = opts.text || [];
    const emitErr = (error: string, message: string, hint: string) => {
      if (opts.output === 'json') emitJsonError({ error, message, hint });
      else console.error(chalk.red(message) + '\n' + chalk.gray(hint));
      process.exit(2);
    };

    if (selectors.length === 0 && texts.length === 0) {
      emitErr('missing_query', 'probe needs at least one --selector or --text', 'Example: verfix probe --selector "[data-testid=submit]"');
    }

    const { findRunArtifact, probeSnapshot, ensureChromium } = await import('./local-runner');
    const snapshotPath = findRunArtifact('.html', executionId);
    if (!snapshotPath) {
      emitErr(
        'artifact_not_found',
        executionId
          ? `No DOM snapshot found for execution ${executionId} under .verfix/runs/`
          : 'No local runs found under .verfix/runs/.',
        'Run a verification first: verfix run --output json — probe checks selectors against its saved end-of-run DOM.',
      );
    }

    // Resolve config `selectors` aliases so probing a logical name checks the
    // same real selector a flow step would use.
    let aliasMap: Record<string, string> = {};
    let browserCfg: any;
    const configPath = opts.config ? path.resolve(opts.config) : path.resolve(process.cwd(), DEFAULT_CONFIG);
    if (fs.existsSync(configPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        aliasMap = cfg.selectors || {};
        browserCfg = cfg.browser;
      } catch {
        // Unreadable config just means no alias resolution.
      }
    }

    const queries = [
      ...selectors.map(s => ({
        kind: 'selector' as const,
        query: s,
        ...(Object.prototype.hasOwnProperty.call(aliasMap, s) ? { resolvedSelector: aliasMap[s] } : {}),
      })),
      ...texts.map(t => ({ kind: 'text' as const, query: t })),
    ];

    await ensureChromium(browserCfg);
    const results = await (async () => {
      try {
        return await probeSnapshot(snapshotPath!, queries, browserCfg);
      } catch (e: any) {
        emitErr('probe_failed', `Probe failed: ${e.message}`, 'The snapshot may be corrupted — rerun the verification and probe again.');
        return []; // unreachable
      }
    })();

    const executionIdFromFile = path.basename(snapshotPath!, '.html');
    const allMatched = results.every(r => r.count > 0);
    if (opts.output === 'json') {
      emitJson({
        snapshot: snapshotPath,
        execution_id: executionIdFromFile,
        // The snapshot is END-OF-RUN state (at-failure state for failed runs),
        // not per-step state — a selector present here can still be missing at
        // the step where the flow needs it.
        snapshot_semantics: 'end_of_run',
        queries: results,
        exit_code: allMatched ? 0 : 1,
      });
      process.exit(allMatched ? 0 : 1);
    }

    console.log(chalk.gray(`\n  Probing DOM snapshot of ${executionIdFromFile} (end-of-run state)\n`));
    for (const r of results) {
      const label = r.kind === 'selector' ? r.query + (r.resolved_selector ? chalk.gray(` → ${r.resolved_selector}`) : '') : `text "${r.query}"`;
      if (r.count === 0) {
        console.log(`  ${chalk.red('✗')} ${label} — ${chalk.red('0 matches')}`);
      } else {
        console.log(`  ${chalk.green('✓')} ${label} — ${r.count} match(es)`);
        for (const m of r.matches) {
          console.log(chalk.gray(`      ${m.visible ? '' : '[hidden] '}${m.excerpt.replace(/\s+/g, ' ').slice(0, 160)}`));
        }
      }
    }
    console.log('');
    process.exit(allMatched ? 0 : 1);
  });

// ─── list command ─────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List recent verification executions')
  .option('--server', 'List executions from the Docker server runtime', false)
  .action(async (opts) => {
    applyRunnerFlag(opts);
    if (getRunnerMode() === 'local') {
      const { listLocalResults } = await import('./local-runner');
      const runs = listLocalResults();
      if (runs.length === 0) {
        console.log(chalk.gray('  No local runs found. Run a verification first: verfix run --output json'));
        return;
      }
      console.log('');
      console.log(chalk.bold('  Recent Executions (local):'));
      for (const r of runs) {
        const icon = r.passed ? chalk.green('✅') : chalk.red('❌');
        console.log(`    ${icon} ${chalk.gray(r.executionId)}  ${chalk.bold(r.task ?? '')}  ${chalk.gray(r.url ?? '')}`);
      }
      console.log('');
      console.log(chalk.gray('  Open a trace: verfix show <execution_id>'));
      console.log('');
      return;
    }
    refreshRuntimePortsFromContainerIfRunning();
    const apiBase = await resolveApiBase();
    try {
      const res = await axios.get(`${apiBase}/api/v1/executions`);
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
      showPendingNotifications();
      scheduleBackgroundCheck(['npm', 'image']);
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
async function resolveJobUrl(url: string): Promise<{ url: string; rewritten: boolean; proxy?: import('./proxy').LocalProxy }> {
  if (!url) return { url, rewritten: false };
  // Host network mode (Linux): localhost resolves correctly inside container.
  if (isHostNetworkMode()) return { url, rewritten: false };

  // Bridge mode (Mac/Windows): intercept localhost / 127.0.0.1
  const match = url.match(/^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?(.*)$/);
  if (match) {
    const protocol = match[1];
    const host = match[2];
    const portStr = match[3];
    const path = match[4];
    
    const port = portStr ? parseInt(portStr.substring(1), 10) : (protocol === 'https://' ? 443 : 80);
    
    const { LocalProxy } = await import('./proxy');
    const proxy = new LocalProxy();
    try {
      const proxyPort = await proxy.start(host, port);
      const rewritten = `${protocol}host.docker.internal:${proxyPort}${path}`;
      return { url: rewritten, rewritten: true, proxy };
    } catch (e) {
      // Fallback if proxy fails to bind for some reason
      const rewritten = url.replace(
        /\/\/(localhost|127\.0\.0\.1)(:\d+)?/g,
        '//host.docker.internal$2',
      );
      return { url: rewritten, rewritten: rewritten !== url };
    }
  }

  return { url, rewritten: false };
}

function buildTimelineUrl(base: string, executionId: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/?executionId=${encodeURIComponent(executionId)}`;
}

function selectFlows(flows: any[] | undefined, idOrNames?: string): any[] {
  if (!idOrNames || !flows || flows.length === 0) return [];
  const ids = idOrNames.split(',').map(s => s.trim()).filter(Boolean);
  const selected: any[] = [];
  for (const id of ids) {
    const found = flows.find(f => f.id === id || f.name === id);
    if (!found) {
      throw new Error(`Flow not found: ${id}`);
    }
    selected.push(found);
  }
  return selected;
}

function normalizeFlows(flows: any[]): any[] {
  if (!flows || flows.length === 0) return [];
  return flows.map((flow, idx) => {
    const flowPath = `flows[${idx}]`;
    return {
      name: flow.name || flow.id || `flow_${idx + 1}`,
      mode: flow.mode,
      clearState: flow.clearState,
      useState: flow.useState,
      saveState: flow.saveState,
      steps: (flow.steps || []).map((rawStep: any, stepIdx: number) => {
        const step = interpolateStep(rawStep, `${flowPath}.steps[${stepIdx}]`);
        return {
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
          waitUntil: step.waitUntil,
          key: step.key,
          file: step.file,
          frame: step.frame,
          timeout: step.timeout,
          optional: step.optional,
        };
      }),
      assertions: interpolateAssertions(flow.assertions, `${flowPath}.assertions`),
    };
  });
}

function validateConfigSchema(config: any, configPath: string): void {
  const schemaPath = path.resolve(process.cwd(), 'verfix.config.schema.json');
  if (!fs.existsSync(schemaPath)) return;

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(config);
  if (!valid) {
    const details = (validate.errors || []).map(err => {
      const loc = err.instancePath || '/';
      return `${loc} ${err.message || 'is invalid'}`;
    }).join('; ');
    throw new Error(`Config schema validation failed: ${configPath} — ${details}`);
  }
}

// Playwright embeds terminal color codes in its call logs; they are token
// noise inside a JSON contract.
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function buildFailures(result: any): Array<{ type: string; flow?: string; assertion?: string; selector?: string; detail?: string; fix_hint?: string }> {
  const failures = (result.assertions || [])
    .filter((a: any) => !a.passed)
    .map((a: any) => ({
      type: a.failure_type || 'assertion_failed',
      // Locate the failure without the raw timeline: which flow, which assertion.
      flow: a.flow_name,
      assertion: a.type,
      selector: a.details?.selector || a.details?.resolved_selector,
      detail: a.error ? stripAnsi(a.error) : a.error,
      fix_hint: a.fix_hint,
    }));

  if (failures.length === 0 && result.error) {
    const detail = stripAnsi(result.error);
    const type = inferFailureTypeFromError(detail);
    failures.push({
      type,
      selector: extractSelector(detail),
      detail,
      fix_hint: renderFixHint(type),
    });
  }

  return failures;
}

// Step failures arrive as a message string; the engine prefixes selector
// misses (see waitForTarget in @verfix/engine) so they map onto the taxonomy
// instead of masquerading as timeouts.
function inferFailureTypeFromError(error: string): string {
  if (error.startsWith('selector_not_found:')) return 'selector_not_found';
  if (error.startsWith('selector_not_visible:')) return 'selector_not_visible';
  // Older engine versions surface a step's locator wait as a raw Playwright
  // timeout — still a selector miss, not a timing problem.
  if (/waiting for locator\(/i.test(error)) return 'selector_not_found';
  if (/timeout|timed out|waiting for/i.test(error)) return 'timeout';
  return 'assertion_failed';
}

function extractSelector(error: string): string | undefined {
  // Engine-prefixed step failures embed the step target as JSON:
  //   selector_not_found: type target {"selector":"#user-name"} did not match …
  const target = error.match(/target (\{.*?\}) /)?.[1];
  if (target) {
    try {
      const parsed = JSON.parse(target);
      return parsed.selector || parsed.testId || parsed.text;
    } catch { /* fall through */ }
  }
  // Raw Playwright message from an older engine: waiting for locator('#x')
  return error.match(/waiting for locator\('([^']+)'\)/)?.[1];
}

function renderFixHint(type: string): string {
  switch (type) {
    case 'selector_not_found':
      return 'Selector did not match any element. Fix the selector in verfix.config.json to match the app source (verfix probe -s "<css>" dry-runs a selector against the last run\'s DOM in ~1s) — do not edit app source to satisfy it.';
    case 'selector_not_visible':
      return 'Selector matches an element that never became visible. Check conditional rendering/CSS state, or add a wait_for_selector step for the state that reveals it.';
    case 'timeout':
      return 'Operation timed out. Increase timeout or wait for network/DOM to settle before retrying.';
    default:
      return 'Assertion failed. Verify assertion inputs and app state before retrying.';
  }
}

program.parse(process.argv);
