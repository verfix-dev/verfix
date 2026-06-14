#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import Ajv from 'ajv';
import fs from 'fs';
import path from 'path';
import {
  DOCKER_IMAGE, CONTAINER_NAME, DEFAULT_CONFIG, HEALTH_ENDPOINT,
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

// ─── start command ───────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the Verfix runtime container')
  .action(async () => {
    if (!isDockerInstalled()) {
      console.error(chalk.red('✗ Docker is not installed. Install Docker from https://docker.com'));
      process.exit(2);
    }
    if (!isDockerRunning()) {
      console.error(chalk.red('✗ Docker daemon is not running. Start Docker Desktop first.'));
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
        return;
      }

      spinner.text = 'Waiting for health check...';
      const healthy = await waitForHealth();
      if (!healthy) {
        spinner.fail('Runtime started but health check failed after 30s');
        process.exit(2);
      }

      spinner.succeed('Verfix runtime is running');
      const startedPorts = getRuntimePorts();
      console.log(`    API:       ${chalk.cyan(`http://localhost:${startedPorts.apiPort}`)}`);
      console.log(`    Dashboard: ${chalk.cyan(`http://localhost:${startedPorts.dashboardPort}`)}`);
      showPendingNotifications();
      scheduleBackgroundCheck(['npm', 'image']);
    } catch (e: any) {
      spinner.fail(e.message);
      process.exit(2);
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
  .description('Tail Verfix runtime container logs')
  .option('--tail <n>', 'Number of lines to show', '50')
  .action((opts) => {
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
  .description('Pull latest image and restart the runtime')
  .action(async () => {
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

program
  .command('doctor')
  .description('Run diagnostic checks on the Verfix setup')
  .option('-o, --output <format>', 'Output format: pretty | json', 'pretty')
  .option('--check-connectivity', 'Also test API key connectivity (makes a live API call)', false)
  .action(async (opts) => {
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
        printCheck(chalk.red('✗'), `${DEFAULT_CONFIG} not found`, 'Run: verfix init');
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
        printCheck(chalk.red('✗'), 'AGENTS.md not found', 'Run: verfix init');
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
      process.exit(failures > 0 ? 1 : 0);
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
    process.exit(failures > 0 ? 1 : 0);
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
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'config_not_found', message: `Config file not found: ${configPath}`, hint: 'Run: verfix init' });
      }
      console.error(chalk.red(`Config file not found: ${configPath}`));
      console.error(chalk.gray('Run: verfix init'));
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
        };
      });
      emitJson({ flows: list, total: list.length });
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
    refreshRuntimePortsFromContainerIfRunning();
    const apiBase = await resolveApiBase();
    const runtimePorts = getRuntimePorts();
    const dashboardBase = buildDashboardBase(runtimePorts);
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
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'config_not_found', message: `Config file not found: ${configPath}`, hint: 'Run: verfix init' });
      }
      console.error(chalk.red(`Config file not found: ${configPath}`));
      process.exit(2);
    }

    if (didLoadConfig) {
      try {
        validateConfigSchema(config, configPath);
      } catch (e: any) {
        if (isJsonMode(opts)) {
          emitJsonError({ error: 'config_validation_failed', message: e.message, hint: 'Fix the config file to match the schema.' });
        }
        console.error(chalk.red(e.message));
        process.exit(2);
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
      process.exit(2);
    }

    const flows = selectedFlows.length > 0 ? normalizeFlows(selectedFlows) : normalizeFlows(config?.flows || []);
    const assertions = selectedFlows.length > 0 ? undefined : config.assertions;

    const baseUrl = opts.url || config.baseUrl || config.url;
    // Rewrite localhost → host.docker.internal so Playwright inside the
    // container can reach the user's app running on the host machine.
    const resolved = resolveJobUrl(baseUrl);
    const targetUrl = resolved.url;
    if (resolved.rewritten && !isJsonMode(opts)) {
      console.log(chalk.gray(`  ℹ  Target URL: ${baseUrl} → ${targetUrl} (host.docker.internal)`));
    }

    const payload: any = {
      url: targetUrl,
      task: opts.task || config.task || (opts.flow ? `Verify flow ${opts.flow}` : `Verify ${targetUrl}`),
      mode: opts.mode || selectedFlows[0]?.mode || config.mode || 'strict',
      assertions,
      flows: flows.length > 0 ? flows : undefined,
      selectors: config.selectors,
      metadata: config.metadata,
      timeout: parseInt(opts.timeout) || config.timeout || 15000,
      retries: parseInt(opts.retries) || config.retries || 2,
    };

    if (!payload.url) {
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'missing_url', message: '--url is required (or set baseUrl in config file)', hint: 'Pass --url <url> or add baseUrl to your config.' });
      }
      console.error(chalk.red('Error: --url is required (or set baseUrl in config file)'));
      process.exit(2);
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
      const res = await axios.post(`${apiBase}/api/v1/verify`, payload);
      executionId = res.data.executionId;
      submitSpinner?.succeed(`Job queued: ${chalk.bold(executionId)}`);
    } catch (e: any) {
      submitSpinner?.fail('Failed to submit job');
      if (isJsonMode(opts)) {
        emitJsonError({ error: 'submit_failed', message: e.message, hint: 'Check that the runtime is running: verfix status' });
      }
      console.error(chalk.red(e.message));
      process.exit(2);
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
      process.exit(2);
    }

    const timelineUrl = buildTimelineUrl(opts.dashboard || dashboardBase, executionId);

    if (isJsonMode(opts)) {
      const failures = buildFailures(result);

      const jsonResult = {
        passed: result.passed,
        failures,
        timeline_url: timelineUrl,
        exit_code: result.passed ? 0 : 1,
        execution_id: result.executionId,
        raw: result,
      };
      emitJson(jsonResult);
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
function resolveJobUrl(url: string): { url: string; rewritten: boolean } {
  if (!url) return { url, rewritten: false };
  // Host network mode (Linux): localhost resolves correctly inside container.
  if (isHostNetworkMode()) return { url, rewritten: false };
  // Bridge mode (Mac/Windows): must point Playwright at host.docker.internal.
  const rewritten = url.replace(
    /\/\/(localhost|127\.0\.0\.1)(:\d+)?/g,
    '//host.docker.internal$2',
  );
  return { url: rewritten, rewritten: rewritten !== url };
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
    const details = (validate.errors || []).map(err => {
      const loc = err.instancePath || '/';
      return `${loc} ${err.message || 'is invalid'}`;
    }).join('; ');
    throw new Error(`Config schema validation failed: ${configPath} — ${details}`);
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
