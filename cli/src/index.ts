#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import Ajv from 'ajv';
import fs from 'fs';
import path from 'path';

const API_BASE = process.env.VERIFY_API || 'http://localhost:3001';
const DASHBOARD_BASE = process.env.VERIFY_DASHBOARD || 'http://localhost:3000';
const DEFAULT_CONFIG = 'verify.config.json';

const program = new Command();

program
  .name('verfix')
  .description('AI Verification Runtime CLI — reliable browser verification for AI-generated software')
  .version('0.1.0');

// ─── init command ────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Create verify.config.json and AGENTS.md in the current directory')
  .option('-f, --force', 'Overwrite existing files')
  .action(async (opts) => {
    const cwd = process.cwd();
    const configPath = path.join(cwd, DEFAULT_CONFIG);
    const agentsPath = path.join(cwd, 'AGENTS.md');

    const shouldWriteConfig = opts.force || !fs.existsSync(configPath);
    const shouldWriteAgents = opts.force || !fs.existsSync(agentsPath);

    if (!shouldWriteConfig && !shouldWriteAgents) {
      console.log(chalk.gray('Nothing to do. Files already exist. Use --force to overwrite.'));
      return;
    }

    if (shouldWriteConfig) {
      fs.writeFileSync(configPath, defaultConfigTemplate(), 'utf-8');
      console.log(chalk.green(`Created ${DEFAULT_CONFIG}`));
    }

    if (shouldWriteAgents) {
      fs.writeFileSync(agentsPath, defaultAgentsTemplate(), 'utf-8');
      console.log(chalk.green('Created AGENTS.md'));
    }
  });

// ─── run command ─────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Run a verification job')
  .option('-u, --url <url>', 'Target URL to verify')
  .option('-t, --task <task>', 'Task description')
  .option('-c, --config <file>', 'Path to verify.config.json config file')
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

    const payload: any = {
      url: baseUrl,
      task: opts.task || config.task || (opts.flow ? `Verify flow ${opts.flow}` : `Verify ${baseUrl}`),
      mode: opts.mode || config.mode || 'strict',
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

// ─── status command ───────────────────────────────────────────────────────────

program
  .command('status <executionId>')
  .description('Get the status of a running or completed verification job')
  .option('-o, --output <format>', 'Output format: pretty | json', 'pretty')
  .action(async (executionId, opts) => {
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

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
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
  const schemaPath = path.resolve(process.cwd(), 'verify.config.schema.json');
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

function defaultConfigTemplate(): string {
  return JSON.stringify({
    baseUrl: 'http://localhost:3000',
    mode: 'assisted',
    flows: [
      {
        id: 'login',
        steps: [
          { action: 'navigate', url: '/login' },
          { action: 'type', selector: '[data-testid=email]', value: 'test@example.com' },
          { action: 'click', selector: '[data-testid=submit]' },
        ],
        assertions: [
          { type: 'url_contains', value: '/dashboard' },
          { type: 'no_console_errors' },
        ],
      },
    ],
  }, null, 2) + '\n';
}

function defaultAgentsTemplate(): string {
  return [
    '# VerifyRuntime agent guide',
    '',
    'This repo is the integration surface between agents (JSON contracts) and humans (timeline UI). The single source of truth is a root config file.',
    '',
    '## Config file (required)',
    '',
    'Create verify.config.json at the repo root. Agents and humans both edit this file.',
    'Schema: see verify.config.schema.json for the single source of truth.',
    '',
    'If a run fails, update the flow or assertions in verify.config.json and re-run.',
    '',
    '## Modes (when to use)',
    '',
    '- strict: deterministic CI, stable selectors',
    '- assisted: selectors are unstable or still evolving',
    '- smoke: quick availability checks',
    '- exploratory: AI-driven discovery when no flow exists yet (requires a task description)',
    '',
    '## Exploratory mode (what to send)',
    '',
    '- Provide only: baseUrl + task + mode: "exploratory"',
    '- Do not include flows or assertions; the AI navigates based on the task description',
    '',
    'Example:',
    '',
    '```json',
    '{',
    '  "baseUrl": "http://localhost:3000",',
    '  "mode": "assisted",',
    '  "flows": [',
    '    {',
    '      "id": "login",',
    '      "steps": [',
    '        { "action": "navigate", "url": "/login" },',
    '        { "action": "type", "selector": "[data-testid=email]", "value": "test@example.com" },',
    '        { "action": "click", "selector": "[data-testid=submit]" }',
    '      ],',
    '      "assertions": [',
    '        { "type": "url_contains", "value": "/dashboard" },',
    '        { "type": "no_console_errors" }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'Notes:',
    '- Flow-level `assertions` run after each flow. Top-level `assertions` run after all flows.',
    '- If neither flow-level nor top-level assertions are provided, defaults are injected.',
    '- `navigate` steps accept `url` (preferred) or `value`.',
    '',
    '## Mode-specific flow examples',
    '',
    'Strict:',
    '```json',
    '{ "id": "login", "steps": [ { "action": "navigate", "url": "/login" } ], "assertions": [ { "type": "selector_visible", "selector": "#success" } ] }',
    '```',
    'Assisted:',
    '```json',
    '{ "id": "checkout", "steps": [ { "action": "click", "selector": "[data-testid=checkout]" } ], "assertions": [ { "type": "text_visible", "value": "Order placed" } ] }',
    '```',
    'Smoke:',
    '```json',
    '{ "id": "home", "steps": [ { "action": "navigate", "url": "/" } ], "assertions": [ { "type": "page_loaded" } ] }',
    '```',
    'Exploratory:',
    '```json',
    '{ "baseUrl": "http://localhost:3000", "mode": "exploratory", "task": "Find the login form and sign in" }',
    '```',
    '',
    '## Agent retry loop',
    '',
    '1. Edit code',
    '2. `verify({ flow: "login" })`',
    '3. If `passed` continue',
    '4. If `!passed`, read `failures[0].fix_hint`, patch, retry',
    '5. After N attempts, open `timeline_url` for human review',
    '',
  ].join('\n');
}

program.parse(process.argv);
